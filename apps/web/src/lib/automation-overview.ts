import type { createClient } from "@/lib/supabase/server";

/** What the Ticket Automation dashboard shows (see docs/design/ticket-automation-dashboard.md): which station of the
 * cycle every automated ticket is at. ONE pure function decides it (stationOf), so the counts, the station panels and the
 * search always agree. Everything is admin-only data. */

export type StationId = "marked" | "analysis" | "approval" | "fix" | "test" | "promote" | "release";
export const STATION_ORDER: StationId[] = ["marked", "analysis", "approval", "fix", "test", "promote", "release"];

export type StationSub = "waiting" | "analysing" | "proposal" | "queued" | "questions" | "branch" | "merging" | "dev" | "approved" | "releasing";

const FINAL_STATUSES = ["resolved", "closed", "cancelled", "duplicate"];

export type StationInput = {
  autoHandle: string | null;
  status: string;
  hasPendingProposal: boolean;
  hasPendingQuestions: boolean;
  /** The ticket's newest fix row, if any: pending (on its branch), merged (on dev) or approved (for production). */
  fixStatus: "pending" | "merged" | "approved" | null;
  analysisRunning: boolean;
  inPromoteRequest: boolean;
  mergeRequested: boolean;
};

/** The station a ticket is at, or null when it is not in the cycle (no flag, finished, or a flag with nothing behind it). */
export function stationOf(input: StationInput): { station: StationId; sub: StationSub } | null {
  if (!input.autoHandle || FINAL_STATUSES.includes(input.status)) return null;
  switch (input.autoHandle) {
    case "S":
      return input.analysisRunning ? { station: "analysis", sub: "analysing" } : { station: "marked", sub: "waiting" };
    case "A":
      return input.hasPendingProposal ? { station: "approval", sub: "proposal" } : null;
    case "Y":
      return { station: "fix", sub: "queued" };
    case "P":
      return input.hasPendingQuestions ? { station: "fix", sub: "questions" } : null;
    case "D":
      return input.fixStatus === "pending" || input.fixStatus === "merged" ? { station: "test", sub: input.mergeRequested ? "merging" : "branch" } : null;
    case "M":
      return input.fixStatus === "merged" ? { station: "test", sub: "dev" } : null;
    case "R":
      if (input.fixStatus !== "approved") return null;
      return input.inPromoteRequest ? { station: "release", sub: "releasing" } : { station: "promote", sub: "approved" };
    default:
      return null;
  }
}

export type OverviewTicket = {
  id: string;
  seq: number;
  subject: string;
  station: StationId;
  sub: StationSub;
  pairing: boolean;
  /** The analyst's or the night run's short text (proposal summary, the questions' reason, the fix summary). */
  summary: string | null;
  ageDays: number;
  hasMigration: boolean;
  /** The pending proposal / questions row, or the fix row, that the panel's buttons act on. */
  proposalId: string | null;
  /** When the admin signed each step off (from the automation_events trail). */
  signoffs: { marked: string | null; spec: string | null; production: string | null };
};

export type RunInfo = { finishedAt: string | null; ticketsCount: number; costUsd: number | null; result: string | null };

/** The laptop's side, as last reported by the poller's heartbeat, plus the Pause switch and the last runs. */
export type AutomationStatus = {
  paused: boolean;
  bridgeOnline: boolean;
  bridgeSeenAt: string | null;
  analysisInProgress: boolean;
  runInProgress: boolean;
  promoteInProgress: boolean;
  autoMerge: boolean;
  lastNight: RunInfo | null;
  lastAnalyst: RunInfo | null;
  /** A "run it now" request that nobody has finished yet. */
  requested: { analyze: boolean; night: boolean; digest: boolean };
};

export type AutomationOverview = {
  status: AutomationStatus;
  tickets: OverviewTicket[];
  counts: Record<StationId, number>;
  /** Tickets waiting on the admin: proposals, questions, fixes to test, fixes to promote. */
  needsYou: number;
  total: number;
};

type Client = Awaited<ReturnType<typeof createClient>>;

type RowTicket = { id: string; ticket_seq: number; subject: string; status: string; auto_handle: string | null; updated_at: string };
type RowProposal = { id: string; ticket_id: string; kind: string; status: string; summary: string | null; why: string | null; pairing: boolean | null; files: unknown };
type RowRequest = { kind: string; ticket_id: string | null; picked_at: string | null; details: { tickets?: { ticketId?: string }[] } | null };

// Wrapped so the clock can be read in one place (the render must not call Date.now directly).
const now = () => Date.now();

export async function getAutomationOverview(supabase: Client): Promise<AutomationOverview> {
  const { data: ticketRows } = await supabase
    .from("tickets")
    .select("id, ticket_seq, subject, status, auto_handle, updated_at")
    .not("auto_handle", "is", null)
    .not("status", "in", `(${FINAL_STATUSES.join(",")})`)
    .order("ticket_seq", { ascending: false })
    .limit(300);
  const tickets = (ticketRows ?? []) as RowTicket[];
  const ids = tickets.map((ticket) => ticket.id);

  const proposalsByTicket = new Map<string, RowProposal[]>();
  if (ids.length > 0) {
    const { data } = await supabase
      .from("ticket_proposals")
      .select("id, ticket_id, kind, status, summary:payload->summary, why:payload->why, pairing:payload->needsPairing, files:payload->files")
      .in("ticket_id", ids)
      .in("status", ["pending", "merged", "approved"]);
    for (const row of (data ?? []) as unknown as RowProposal[]) {
      const list = proposalsByTicket.get(row.ticket_id) ?? [];
      list.push(row);
      proposalsByTicket.set(row.ticket_id, list);
    }
  }

  const signoffsByTicket = new Map<string, { marked: string | null; spec: string | null; production: string | null }>();
  if (ids.length > 0) {
    const { data: events } = await supabase
      .from("automation_events")
      .select("ticket_id, kind, created_at")
      .in("ticket_id", ids)
      .in("kind", ["marked", "spec_approved", "approved_for_production"])
      .order("created_at", { ascending: false });
    for (const event of (events ?? []) as { ticket_id: string; kind: string; created_at: string }[]) {
      const entry = signoffsByTicket.get(event.ticket_id) ?? { marked: null, spec: null, production: null };
      const field = event.kind === "marked" ? "marked" : event.kind === "spec_approved" ? "spec" : "production";
      if (!entry[field]) entry[field] = event.created_at; // newest first: keep the latest
      signoffsByTicket.set(event.ticket_id, entry);
    }
  }

  const { data: requestRows } = await supabase.from("automation_requests").select("kind, ticket_id, picked_at, details").is("completed_at", null);
  const requests = (requestRows ?? []) as RowRequest[];

  const { data: settingsRow } = await supabase.from("automation_settings").select("paused, bridge_seen_at, bridge_status").eq("id", true).maybeSingle();
  const health = ((settingsRow?.bridge_status ?? {}) as { analysisInProgress?: boolean; runInProgress?: boolean; promoteInProgress?: boolean; autoMerge?: boolean });
  const seenAt = (settingsRow?.bridge_seen_at as string | null) ?? null;
  const bridgeOnline = seenAt !== null && now() - new Date(seenAt).getTime() < 3 * 60 * 1000;
  const { data: runRows } = await supabase.from("automation_runs").select("kind, finished_at, tickets_count, cost_usd, result").order("started_at", { ascending: false }).limit(12);
  const runOf = (kind: string): RunInfo | null => {
    const row = ((runRows ?? []) as { kind: string; finished_at: string | null; tickets_count: number; cost_usd: number | null; result: string | null }[]).find((r) => r.kind === kind);
    return row ? { finishedAt: row.finished_at, ticketsCount: row.tickets_count, costUsd: row.cost_usd === null ? null : Number(row.cost_usd), result: row.result } : null;
  };
  const analysisRunning = (bridgeOnline && Boolean(health.analysisInProgress)) || requests.some((request) => request.kind === "analyze" && request.picked_at !== null);
  const mergeTickets = new Set(requests.filter((request) => request.kind === "merge" && request.ticket_id).map((request) => request.ticket_id as string));
  const promoteTickets = new Set<string>();
  for (const request of requests) {
    if (request.kind !== "promote") continue;
    for (const item of request.details?.tickets ?? []) if (item.ticketId) promoteTickets.add(item.ticketId);
  }

  const counts: Record<StationId, number> = { marked: 0, analysis: 0, approval: 0, fix: 0, test: 0, promote: 0, release: 0 };
  const result: OverviewTicket[] = [];
  const nowMs = now();
  for (const ticket of tickets) {
    const rows = proposalsByTicket.get(ticket.id) ?? [];
    const proposal = rows.find((row) => row.kind === "proposal" && row.status === "pending");
    const questions = rows.find((row) => row.kind === "questions" && row.status === "pending");
    const fixes = rows.filter((row) => row.kind === "fix");
    const fix = fixes.find((row) => row.status === "approved") ?? fixes.find((row) => row.status === "merged") ?? fixes.find((row) => row.status === "pending") ?? null;
    const placed = stationOf({
      autoHandle: ticket.auto_handle,
      status: ticket.status,
      hasPendingProposal: Boolean(proposal),
      hasPendingQuestions: Boolean(questions),
      fixStatus: (fix?.status as StationInput["fixStatus"]) ?? null,
      analysisRunning,
      inPromoteRequest: promoteTickets.has(ticket.id),
      mergeRequested: mergeTickets.has(ticket.id),
    });
    if (!placed) continue;
    counts[placed.station] += 1;
    const source = proposal ?? questions ?? fix;
    result.push({
      id: ticket.id,
      seq: ticket.ticket_seq,
      subject: ticket.subject,
      station: placed.station,
      sub: placed.sub,
      pairing: proposal?.pairing === true,
      summary: (proposal?.summary ?? questions?.why ?? fix?.summary ?? null) || null,
      ageDays: Math.max(0, Math.floor((nowMs - new Date(ticket.updated_at).getTime()) / 86400000)),
      proposalId: source?.id ?? null,
      signoffs: signoffsByTicket.get(ticket.id) ?? { marked: null, spec: null, production: null },
      hasMigration: Array.isArray(source?.files) && (source!.files as unknown[]).some((file) => typeof file === "string" && /migrations\//.test(file)),
    });
  }
  const needsYou = counts.approval + counts.test + counts.promote + result.filter((ticket) => ticket.station === "fix" && ticket.sub === "questions").length;
  const status: AutomationStatus = {
    paused: Boolean(settingsRow?.paused),
    bridgeOnline,
    bridgeSeenAt: seenAt,
    analysisInProgress: bridgeOnline && Boolean(health.analysisInProgress),
    runInProgress: bridgeOnline && Boolean(health.runInProgress),
    promoteInProgress: bridgeOnline && Boolean(health.promoteInProgress),
    autoMerge: Boolean(health.autoMerge),
    lastNight: runOf("night"),
    lastAnalyst: runOf("analyst"),
    requested: { analyze: requests.some((r) => r.kind === "analyze"), night: requests.some((r) => r.kind === "night"), digest: requests.some((r) => r.kind === "digest") },
  };
  return { status, tickets: result, counts, needsYou, total: result.length };
}
