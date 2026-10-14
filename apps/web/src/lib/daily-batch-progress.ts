import { loadActiveBatch, type Batch, type BatchTicket } from "@/lib/daily-batch";
import { tr, type AppLocale } from "@/lib/locale";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { resolveChoices, type FixPayload, type ProposalPayload } from "@/lib/ticket-proposals";
import { approveForProduction, approveProposal, requestPromote } from "@/lib/ticket-review";

/**
 * The daily batch after the admin's approval (lib/daily-batch.ts): the analyst's proposals for batch tickets are approved
 * automatically (recommended choices), each ticket's state follows its real automation flag, and the batch moves on to
 * "ready" (all fixed or out), then "promoting" (the admin approved the promotion) and "done" (Promote resolved them).
 */
type Client = Awaited<ReturnType<typeof createClient>>;
type Admin = ReturnType<typeof createAdminClient>;
const asClient = (admin: Admin) => admin as unknown as Client;

async function saveTickets(admin: Admin, batch: Batch, patch: Partial<Batch> = {}) {
  await admin.from("automation_batches").update({ tickets: batch.tickets, ...patch }).eq("id", batch.id);
}

/**
 * Called when the analyst's proposal for a ticket arrives (api/admin/tickets/proposal-result). For a ticket in the active
 * batch: approved right away with the analyst's recommended option for every decision - or, when the analyst says it needs
 * the admin (needsPairing), taken out of the batch with the analyst's reason; its proposal then waits for the admin as usual.
 */
export async function autoApproveBatchProposal(admin: Admin, ticketId: string, proposalId: string, payload: ProposalPayload): Promise<void> {
  const batch = await loadActiveBatch(admin);
  if (!batch || !["approved", "building"].includes(batch.status) || !batch.approved_by) return;
  const member = batch.tickets.find((t) => t.ticketId === ticketId && ["queued", "analysing"].includes(t.state));
  if (!member) return;
  if (payload.needsPairing) {
    member.state = "out";
    member.note = `האנליסט צריך החלטה שלך, ולכן הפנייה יצאה מהחבילה וממתינה בסקירה. ${String((payload as { pairingReason?: string }).pairingReason ?? "").slice(0, 300)}`.trim();
  } else {
    const chosen = Object.fromEntries(resolveChoices(payload.decisions ?? [], null).map((option, index) => [String(index), option]));
    const result = await approveProposal(asClient(admin), batch.approved_by, "he", proposalId, chosen, `Approved automatically - daily batch ${batch.batch_date} (the analyst's recommended choices).`);
    if (result.error) {
      member.state = "out";
      member.note = `האישור האוטומטי נכשל: ${result.error}`;
    } else {
      member.state = "building";
      member.summary = payload.summary ?? null;
    }
  }
  const stillAnalysing = batch.tickets.some((t) => ["queued", "analysing"].includes(t.state));
  await saveTickets(admin, batch, stillAnalysing ? {} : { status: batch.status === "approved" ? "building" : batch.status });
}

export type BatchSyncResult = { batch: Batch | null; becameReady: boolean; becameDone: boolean };

/**
 * Brings the active batch up to date with the tickets' real flags. Called by the bridge after the night run and after a
 * promotion (POST /api/admin/batches action "sync"), which then mails the ready/done email when the batch just got there.
 *   S/A -> analysing · Y -> building · M (fix merged on dev) or R (approved for production) -> built
 *   D (built, could not be merged to dev by itself) -> out, with a note · P (the fix stopped) -> requeued once, then out
 *   resolved/closed with a released fix -> released · anything else (taken out, flag cleared) -> out
 */
export async function syncActiveBatch(admin: Admin): Promise<BatchSyncResult> {
  const batch = await loadActiveBatch(admin);
  if (!batch || batch.status === "proposed") return { batch, becameReady: false, becameDone: false };
  const members = batch.tickets.filter((t) => !["unselected", "out"].includes(t.state));
  const ids = members.map((t) => t.ticketId);
  const { data: rows } = ids.length ? await admin.from("tickets").select("id, status, auto_handle").in("id", ids) : { data: [] };
  const byId = new Map(((rows ?? []) as { id: string; status: string; auto_handle: string | null }[]).map((row) => [row.id, row]));
  const { data: fixes } = ids.length ? await admin.from("ticket_proposals").select("ticket_id, status, payload, created_at").eq("kind", "fix").in("ticket_id", ids).order("created_at", { ascending: false }) : { data: [] };
  const latestFix = new Map<string, { status: string; payload: FixPayload }>();
  for (const row of (fixes ?? []) as { ticket_id: string; status: string; payload: FixPayload }[]) if (!latestFix.has(row.ticket_id)) latestFix.set(row.ticket_id, row);

  for (const member of members) {
    const ticket = byId.get(member.ticketId);
    const fix = latestFix.get(member.ticketId);
    if (!ticket) {
      member.state = "out";
      member.note = "הפנייה לא נמצאה.";
    } else if (["resolved", "closed"].includes(ticket.status) && fix?.status === "released") {
      member.state = "released";
    } else if (ticket.auto_handle === "S" || ticket.auto_handle === "A") {
      member.state = "analysing";
    } else if (ticket.auto_handle === "Y") {
      member.state = "building";
    } else if (ticket.auto_handle === "M" || ticket.auto_handle === "R") {
      member.state = "built";
      if (fix?.payload && "summary" in fix.payload) member.summary = String((fix.payload as { summary?: string }).summary ?? member.summary ?? "");
    } else if (ticket.auto_handle === "D") {
      member.state = "out";
      member.note = "התיקון נבנה אבל לא מוזג לפיתוח אוטומטית. אפשר לבדוק ולמזג אותו מכרטיס התיקון.";
    } else if (ticket.auto_handle === "P") {
      if (!member.retried) {
        // One more try at tonight's run (or the next one) before it leaves the batch.
        await admin.from("tickets").update({ auto_handle: "Y", status: "open" }).eq("id", member.ticketId).eq("auto_handle", "P");
        await admin.from("ticket_proposals").update({ status: "superseded", decided_at: new Date().toISOString() }).eq("ticket_id", member.ticketId).eq("kind", "questions").eq("status", "pending");
        member.retried = true;
        member.state = "building";
        member.note = "התיקון נעצר פעם אחת ונכנס שוב לתור.";
      } else {
        member.state = "out";
        member.note = "התיקון נעצר פעמיים, ולכן הפנייה יצאה מהחבילה וחזרה אליך.";
      }
    } else {
      member.state = "out";
      member.note = member.note ?? "הפנייה יצאה מהאוטומציה.";
    }
  }

  const live = batch.tickets.filter((t) => !["unselected", "out"].includes(t.state));
  const now = new Date().toISOString();
  let becameReady = false;
  let becameDone = false;
  const patch: Partial<Batch> = {};
  if (["approved", "building"].includes(batch.status)) {
    if (live.length === 0) {
      Object.assign(patch, { status: "failed", closed_at: now, note: "No ticket of the batch could be fixed." });
    } else if (live.every((t) => t.state === "built")) {
      Object.assign(patch, { status: "ready", ready_at: now });
      becameReady = true;
    } else if (!live.some((t) => ["queued", "analysing"].includes(t.state))) {
      patch.status = "building";
    }
  } else if (batch.status === "promoting" && live.length > 0 && live.every((t) => t.state === "released")) {
    Object.assign(patch, { status: "done", closed_at: now, promoted_at: now });
    becameDone = true;
  }
  await saveTickets(admin, batch, patch);
  return { batch: { ...batch, ...patch }, becameReady, becameDone };
}

/** "Approve and promote" on the batch page: every built fix is approved for production and one promotion is requested. */
export async function promoteBatch(supabase: Client, adminId: string, locale: AppLocale, batchId: string, devTested: boolean): Promise<{ error?: string; success?: string }> {
  const batch = await loadActiveBatch(supabase);
  if (!batch || batch.id !== batchId || batch.status !== "ready") return { error: tr(locale, "This batch is not ready to promote. Refresh the page.", "החבילה לא מוכנה להעלאה. יש לרענן את הדף.") };
  const built = batch.tickets.filter((t: BatchTicket) => t.state === "built");
  const { data: fixes } = await supabase.from("ticket_proposals").select("id, ticket_id, status").eq("kind", "fix").in("status", ["merged", "approved"]).in("ticket_id", built.map((t) => t.ticketId));
  const rows = (fixes ?? []) as { id: string; ticket_id: string; status: string }[];
  for (const row of rows.filter((r) => r.status === "merged")) {
    const result = await approveForProduction(supabase, adminId, locale, row.id);
    if (result.error && !/already|כבר/.test(result.error)) return { error: result.error };
  }
  const result = await requestPromote(supabase, adminId, locale, rows.map((row) => row.id));
  if (result.error) return result;
  await supabase.from("automation_batches").update({ status: "promoting", dev_tested: devTested }).eq("id", batchId).eq("status", "ready");
  return { success: tr(locale, "Promotion requested. It starts within a minute; you get an email when it is live.", "ההעלאה התבקשה. היא תתחיל תוך דקה; יישלח מייל כשהיא תהיה באוויר.") };
}
