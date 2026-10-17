import { loadOverlapBlockers } from "@/lib/automation-overlap";
import { createBundle } from "@/lib/bundles";
import { loadActiveBatch, type Batch } from "@/lib/daily-batch";
import { collectFiles, filesFromText, suggestBundles, type Blocker } from "@/lib/overlap";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logAutomationEvent } from "@/lib/ticket-review";
import type { createClient } from "@/lib/supabase/server";

/**
 * The night planner (agreed 2026-10-15): one work order per night, so the night run builds what can really be built, in a
 * sensible order, within its budget - and everything else waits with a reason the admin can read. Plain rules, no AI:
 *   - queued tickets that change the same files are bundled (built as one job), unless that would mix the daily batch with
 *     other tickets; what still overlaps a fix not in production waits
 *   - a ticket whose files changed in production since it was analysed goes back to the analyst (its plan is stale)
 *   - jobs are ordered daily batch first, then the least risky, and filled up to 80% of the night's budget
 *   - each migration gets its number in advance, so two fixes never write the same one
 * It runs after the analyst and again when the night run starts (the bridge sends what git says changed); the night run's
 * queue (api/admin/tickets/auto-handle-queue) follows the newest work order of the night. The admin can pull a job out.
 */

type Admin = ReturnType<typeof createAdminClient>;
type AnyClient = Admin | Awaited<ReturnType<typeof createClient>>;

export type WorkOrderJob = {
  position: number;
  ticketIds: string[];
  seqs: number[];
  subjects: string[];
  bundleLetter: string | null;
  inBatch: boolean;
  files: string[];
  migrationNumber: number | null;
  estimateUsd: number;
  /** 0 = plain; +2 stopped before, +1 reopened after a fix, +1 database change, +1 bundle. */
  risk: number;
  pulled?: boolean;
};
export type DeferReason = "held_fix" | "held_queue" | "bundle_partner" | "stale" | "budget" | "pulled";
export type WorkOrderDeferred = { ticketId: string; seq: number; subject: string; reason: DeferReason; detail: string; waitsFor: number[] };
export type JobResult = "merged" | "built" | "stopped" | "tooling" | "not_reached";
/** The bridge starts a ticket's notes with this when the run's own tools failed, not the ticket (TOOLING_MARK in server.js). */
export const TOOLING_MARK = "[tooling]";
export type WorkOrder = {
  id: string;
  night_date: string;
  status: "planned" | "running" | "done" | "superseded";
  created_at: string;
  planned_by: "analyst" | "night" | "admin";
  base_ref: string | null;
  budget_usd: number | null;
  estimate_usd: number | null;
  success_estimate: number | null;
  jobs: WorkOrderJob[];
  deferred: WorkOrderDeferred[];
  outcome: { position: number; seqs: number[]; result: JobResult }[] | null;
  success_rate: number | null;
  finished_at: string | null;
};

/** The share of the night's budget the plan fills; the rest absorbs jobs that cost more than estimated. */
const BUDGET_FILL = 0.8;
const DEFAULT_TICKET_COST_USD = 3.5;

/** The night a plan is for, as an Israel date: from noon on it is the coming night (02:15 tomorrow). */
export function nightDateFor(now = new Date()): string {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  if (local.getHours() >= 12) local.setDate(local.getDate() + 1);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

/** The newest live work order of the coming night (or of tonight, during the run), or null. */
export async function loadCurrentWorkOrder(supabase: AnyClient, nightDate = nightDateFor()): Promise<WorkOrder | null> {
  const { data } = await supabase.from("automation_work_orders").select("*").eq("night_date", nightDate).neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as WorkOrder | null) ?? null;
}

/** The plan the night run follows: the newest one not replaced or finished, from the last 20 hours. */
export async function loadActiveWorkOrder(supabase: AnyClient): Promise<WorkOrder | null> {
  const { data } = await supabase
    .from("automation_work_orders")
    .select("*")
    .in("status", ["planned", "running"])
    .gte("created_at", new Date(Date.now() - 20 * 3600 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as WorkOrder | null) ?? null;
}

type Queued = { id: string; seq: number; subject: string; bundleId: string | null; files: string[]; analysedAt: string | null; brief: string };

async function loadQueue(admin: Admin): Promise<Queued[]> {
  const { data: rows } = await admin.from("tickets").select("id, ticket_seq, subject, bundle_id").eq("auto_handle", "Y").in("status", ["open", "reopened"]).order("ticket_seq");
  const tickets = (rows ?? []) as { id: string; ticket_seq: number; subject: string; bundle_id: string | null }[];
  if (tickets.length === 0) return [];
  const { data: proposals } = await admin
    .from("ticket_proposals")
    .select("ticket_id, created_at, decided_at, brief:payload->>brief, expected:payload->expectedFiles")
    .in("ticket_id", tickets.map((t) => t.id))
    .eq("kind", "proposal")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  const newest = new Map<string, { created_at: string; brief: string | null; expected: unknown }>();
  for (const row of (proposals ?? []) as { ticket_id: string; created_at: string; brief: string | null; expected: unknown }[]) if (!newest.has(row.ticket_id)) newest.set(row.ticket_id, row);
  return tickets.map((t) => {
    const p = newest.get(t.id);
    return { id: t.id, seq: t.ticket_seq, subject: t.subject, bundleId: t.bundle_id, files: collectFiles(p?.expected, filesFromText(p?.brief)), analysedAt: p?.created_at ?? null, brief: p?.brief ?? "" };
  });
}

/** For the bridge: what each queued ticket will change and since when, so it can ask git what changed in production since. */
export async function planCandidates(admin: Admin): Promise<{ ticketId: string; seq: number; files: string[]; since: string | null }[]> {
  return (await loadQueue(admin)).map((t) => ({ ticketId: t.id, seq: t.seq, files: t.files, since: t.analysedAt }));
}

async function anyAdminId(admin: Admin, batch: Batch | null): Promise<string | null> {
  if (batch?.approved_by) return batch.approved_by;
  const { data } = await admin.from("user_profile").select("user_id").eq("is_admin", true).limit(1).maybeSingle();
  return (data as { user_id: string } | null)?.user_id ?? null;
}

/** Average cost of one ticket in the recent night runs (what the estimates are built on). */
async function costPerTicket(admin: Admin): Promise<number> {
  const { data } = await admin.from("automation_runs").select("tickets_count, cost_usd").eq("kind", "night").gt("tickets_count", 0).not("cost_usd", "is", null).order("started_at", { ascending: false }).limit(14);
  const rows = (data ?? []) as { tickets_count: number; cost_usd: number }[];
  const tickets = rows.reduce((sum, r) => sum + r.tickets_count, 0);
  const cost = rows.reduce((sum, r) => sum + Number(r.cost_usd), 0);
  return tickets >= 3 ? Math.max(0.5, cost / tickets) : DEFAULT_TICKET_COST_USD;
}

const needsMigration = (t: Queued, batch: Batch | null) =>
  Boolean(batch?.tickets.find((m) => m.ticketId === t.id)?.needsMigration) || t.files.some((f) => f.includes("migrations/")) || /\bmigration\b/i.test(t.brief);

export type PlanInput = {
  plannedBy: "analyst" | "night";
  budgetUsd: number;
  baseRef?: string | null;
  /** ticket id -> production files that changed since its analysis and that it expects to change (from the bridge's git). */
  stale?: Record<string, string[]>;
  /** The next free migration number in the repository (the bridge reads it). */
  nextMigration?: number | null;
};

/** Builds and saves tonight's work order. Bundles overlapping queued tickets and sends stale ones back to the analyst on the way. */
export async function buildWorkOrder(admin: Admin, input: PlanInput): Promise<WorkOrder> {
  const nightDate = nightDateFor();
  const previous = await loadCurrentWorkOrder(admin, nightDate);
  const pulledBefore = new Set((previous?.jobs ?? []).filter((j) => j.pulled).flatMap((j) => j.ticketIds));
  const batch = await loadActiveBatch(admin);
  const batchLive = new Set(batch && ["approved", "building"].includes(batch.status) ? batch.tickets.filter((t) => !["unselected", "out"].includes(t.state)).map((t) => t.ticketId) : []);
  const adminId = await anyAdminId(admin, batch);
  const deferred: WorkOrderDeferred[] = [];

  // 1. Stale plans go back to the analyst (a batch ticket stays in its batch, waiting for the analysis again).
  let queue = await loadQueue(admin);
  for (const t of queue) {
    const changed = input.stale?.[t.id] ?? [];
    if (changed.length === 0) continue;
    await admin.from("tickets").update({ auto_handle: "S" }).eq("id", t.id).eq("auto_handle", "Y");
    if (adminId) await logAutomationEvent(admin, adminId, t.id, "requeued", { by: "planner", reason: "stale", files: changed.slice(0, 5) });
    if (batch && batchLive.has(t.id)) {
      const member = batch.tickets.find((m) => m.ticketId === t.id)!;
      member.state = "analysing";
      member.note = "הקוד השתנה מאז הניתוח, ולכן הפנייה חזרה לאנליסט.";
      await admin.from("automation_batches").update({ tickets: batch.tickets }).eq("id", batch.id);
    }
    deferred.push({ ticketId: t.id, seq: t.seq, subject: t.subject, reason: "stale", detail: changed.slice(0, 3).join(", "), waitsFor: [] });
  }
  queue = queue.filter((t) => !(input.stale?.[t.id]?.length));

  // 2. Queued tickets that overlap each other (and are not waiting for a fix) become bundles.
  let blockers = await loadOverlapBlockers(admin);
  const heldByFix = (id: string) => (blockers.get(id) ?? []).some((b) => b.why === "fix");
  const loose = queue.filter((t) => !t.bundleId && !heldByFix(t.id) && !pulledBefore.has(t.id));
  let bundled = false;
  for (const group of suggestBundles(loose.map((t) => ({ seq: t.seq, files: t.files })))) {
    const members = group.map((seq) => loose.find((t) => t.seq === seq)!);
    // Inside or outside the daily batch, never both (lib/bundles.ts refuses it while a batch runs).
    if (new Set(members.map((m) => batchLive.has(m.id))).size > 1 || !adminId) continue;
    const made = await createBundle(admin as unknown as Parameters<typeof createBundle>[0], adminId, members.map((m) => m.id));
    if ("bundle" in made) {
      bundled = true;
      for (const m of members) await logAutomationEvent(admin, adminId, m.id, "bundle_created", { letter: made.bundle.letter, by: "planner" });
    }
  }
  if (bundled) {
    queue = await loadQueue(admin);
    queue = queue.filter((t) => !(input.stale?.[t.id]?.length));
    blockers = await loadOverlapBlockers(admin);
  }

  // 3. Jobs: a bundle is one job; whatever still has to wait is deferred with its reason.
  const { data: bundleRows } = await admin.from("automation_bundles").select("id, letter");
  const letterOf = new Map(((bundleRows ?? []) as { id: string; letter: string }[]).map((b) => [b.id, b.letter]));
  const ids = queue.map((t) => t.id);
  const { data: events } = ids.length ? await admin.from("automation_events").select("ticket_id, kind").in("ticket_id", ids).in("kind", ["requeued", "reopened_after_fix"]) : { data: [] };
  const { data: stops } = ids.length ? await admin.from("ticket_proposals").select("ticket_id").in("ticket_id", ids).eq("kind", "questions") : { data: [] };
  const stoppedBefore = new Set(((stops ?? []) as { ticket_id: string }[]).map((r) => r.ticket_id));
  const reopened = new Set(((events ?? []) as { ticket_id: string; kind: string }[]).filter((e) => e.kind === "reopened_after_fix").map((e) => e.ticket_id));
  const perTicket = await costPerTicket(admin);

  const groups = new Map<string, Queued[]>();
  for (const t of queue) {
    const key = t.bundleId ?? t.id;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const candidates: Omit<WorkOrderJob, "position" | "migrationNumber">[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.seq - b.seq);
    const waits: Blocker[] = members.flatMap((m) => blockers.get(m.id) ?? []);
    if (members.some((m) => pulledBefore.has(m.id))) {
      for (const m of members) deferred.push({ ticketId: m.id, seq: m.seq, subject: m.subject, reason: "pulled", detail: "", waitsFor: [] });
      continue;
    }
    if (waits.length > 0) {
      const reason: DeferReason = waits.some((b) => b.why === "fix") ? "held_fix" : waits.some((b) => b.why === "queue") ? "held_queue" : "bundle_partner";
      const waitsFor = [...new Set(waits.map((b) => b.seq))].filter((seq) => !members.some((m) => m.seq === seq));
      for (const m of members) deferred.push({ ticketId: m.id, seq: m.seq, subject: m.subject, reason, detail: [...new Set(waits.flatMap((b) => b.files))].slice(0, 3).join(", "), waitsFor });
      continue;
    }
    const migration = members.some((m) => needsMigration(m, batch));
    const risk = (members.some((m) => stoppedBefore.has(m.id)) ? 2 : 0) + (members.some((m) => reopened.has(m.id)) ? 1 : 0) + (migration ? 1 : 0) + (members.length > 1 ? 1 : 0);
    const base = perTicket * (1 + 0.6 * (members.length - 1)) + (migration ? 0.8 : 0);
    candidates.push({
      ticketIds: members.map((m) => m.id),
      seqs: members.map((m) => m.seq),
      subjects: members.map((m) => m.subject),
      bundleLetter: members[0].bundleId ? letterOf.get(members[0].bundleId) ?? null : null,
      inBatch: members.some((m) => batchLive.has(m.id)),
      files: [...new Set(members.flatMap((m) => m.files))],
      estimateUsd: Math.round(base * (1 + 0.2 * risk) * 100) / 100,
      risk,
    });
  }

  // 4. Order (batch first, least risky, lowest number) and fill the budget; migrations get their numbers in that order.
  candidates.sort((a, b) => Number(b.inBatch) - Number(a.inBatch) || a.risk - b.risk || a.seqs[0] - b.seqs[0]);
  const cap = input.budgetUsd * BUDGET_FILL;
  let spent = 0;
  let nextMigration = input.nextMigration ?? null;
  const jobs: WorkOrderJob[] = [];
  for (const c of candidates) {
    if (jobs.length > 0 && spent + c.estimateUsd > cap) {
      c.ticketIds.forEach((id, i) => deferred.push({ ticketId: id, seq: c.seqs[i], subject: c.subjects[i], reason: "budget", detail: `$${c.estimateUsd.toFixed(2)}`, waitsFor: [] }));
      continue;
    }
    spent += c.estimateUsd;
    const migrationNumber = nextMigration !== null && c.inBatch && needsMigrationJob(c, queue, batch) ? nextMigration++ : null;
    jobs.push({ ...c, position: jobs.length + 1, migrationNumber });
  }
  const successEstimate = await estimateSuccess(admin, jobs);

  // 5. Save: the newer plan replaces the older one of the same night.
  if (previous) await admin.from("automation_work_orders").update({ status: "superseded" }).eq("id", previous.id);
  const { data: saved, error } = await admin
    .from("automation_work_orders")
    .insert({
      night_date: nightDate,
      status: input.plannedBy === "night" ? "running" : "planned",
      planned_by: input.plannedBy,
      base_ref: input.baseRef ?? null,
      budget_usd: input.budgetUsd,
      estimate_usd: Math.round(spent * 100) / 100,
      success_estimate: successEstimate,
      jobs,
      deferred: deferred.sort((a, b) => a.seq - b.seq),
    })
    .select("*")
    .single();
  if (error || !saved) throw new Error(`work order not saved: ${error?.message}`);
  return saved as WorkOrder;
}

function needsMigrationJob(job: Omit<WorkOrderJob, "position" | "migrationNumber">, queue: Queued[], batch: Batch | null): boolean {
  return job.ticketIds.some((id) => {
    const t = queue.find((q) => q.id === id);
    return t ? needsMigration(t, batch) : false;
  });
}

/** Per job: 95% less 10 points per risk point; blended half-and-half with the real rate of the recent nights once there are three. */
async function estimateSuccess(admin: Admin, jobs: WorkOrderJob[]): Promise<number | null> {
  if (jobs.length === 0) return null;
  const rules = jobs.reduce((sum, j) => sum + Math.max(0.5, 0.95 - 0.1 * j.risk), 0) / jobs.length;
  const { data } = await admin.from("automation_work_orders").select("success_rate").eq("status", "done").not("success_rate", "is", null).order("finished_at", { ascending: false }).limit(10);
  const rates = ((data ?? []) as { success_rate: number }[]).map((r) => Number(r.success_rate));
  const value = rates.length >= 3 ? 0.5 * rules + 0.5 * (rates.reduce((a, b) => a + b, 0) / rates.length) : rules;
  return Math.round(value * 1000) / 1000;
}

/**
 * After the night run: what became of every planned job, read from the tickets' flags. merged = on dev (the goal);
 * built = a fix that could not be merged by itself; stopped = questions; tooling = stopped (or sent back to the queue) because the
 * run's own tools failed, not the ticket; not_reached = still queued (budget or time).
 * The success rate is merged jobs out of the jobs the night run was meant to build (pulled ones do not count); tooling stops stay
 * in it (they are a real miss) but are counted apart, so they point at the bridge rather than at the tickets.
 */
export async function recordWorkOrderOutcome(admin: Admin): Promise<WorkOrder | null> {
  const { data } = await admin.from("automation_work_orders").select("*").eq("status", "running").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const order = data as WorkOrder | null;
  if (!order) return null;
  const planned = order.jobs.filter((j) => !j.pulled);
  const ids = planned.flatMap((j) => j.ticketIds);
  const { data: rows } = ids.length ? await admin.from("tickets").select("id, status, auto_handle, auto_handle_notes").in("id", ids) : { data: [] };
  const byId = new Map(((rows ?? []) as { id: string; status: string; auto_handle: string | null; auto_handle_notes: string | null }[]).map((r) => [r.id, r]));
  const outcome = planned.map((job) => {
    const flags = job.ticketIds.map((id) => byId.get(id)?.auto_handle ?? null);
    const tooling = job.ticketIds.some((id) => (byId.get(id)?.auto_handle_notes ?? "").startsWith(TOOLING_MARK));
    const result: JobResult = flags.every((f) => f === "M" || f === "R")
      ? "merged"
      : flags.some((f) => f === "D")
        ? "built"
        : tooling
          ? "tooling"
          : flags.some((f) => f === "P")
            ? "stopped"
            : "not_reached";
    return { position: job.position, seqs: job.seqs, result };
  });
  const successRate = planned.length ? Math.round((outcome.filter((o) => o.result === "merged").length / planned.length) * 1000) / 1000 : null;
  const { data: saved } = await admin.from("automation_work_orders").update({ status: "done", outcome, success_rate: successRate, finished_at: new Date().toISOString() }).eq("id", order.id).select("*").single();
  return (saved as WorkOrder | null) ?? null;
}

/** "Pull out of tonight" / "Put back": the night run's queue skips a pulled job; the next plan of the same night keeps it out. */
export async function setJobPulled(supabase: AnyClient, workOrderId: string, position: number, pulled: boolean): Promise<boolean> {
  const { data } = await supabase.from("automation_work_orders").select("id, status, jobs").eq("id", workOrderId).maybeSingle();
  const order = data as Pick<WorkOrder, "id" | "status" | "jobs"> | null;
  if (!order || order.status !== "planned") return false;
  const jobs = order.jobs.map((j) => (j.position === position ? { ...j, pulled } : j));
  const { error } = await supabase.from("automation_work_orders").update({ jobs }).eq("id", workOrderId).eq("status", "planned");
  return !error;
}
