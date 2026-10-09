import { loadOverlapBlockers } from "@/lib/automation-overlap";
import { collectFiles, filesFromText, sharedFiles, suggestBundles } from "@/lib/overlap";
import type { createClient } from "@/lib/supabase/server";

/** What the Ticket Automation dashboard shows (see docs/design/ticket-automation-dashboard.md): which station of the
 * cycle every automated ticket is at. ONE pure function decides it (stationOf), so the counts, the station panels and the
 * search always agree. Everything is admin-only data. */

export type StationId = "marked" | "analysis" | "approval" | "fix" | "test" | "promote" | "release";
export const STATION_ORDER: StationId[] = ["marked", "analysis", "approval", "fix", "test", "promote", "release"];

export type StationSub = "waiting" | "analysing" | "proposal" | "queued" | "questions" | "branch" | "merging" | "dev" | "approved" | "releasing" | "stopped" | "building" | "held";

const FINAL_STATUSES = ["resolved", "closed", "cancelled", "duplicate"];

export type StationInput = {
  autoHandle: string | null;
  status: string;
  hasPendingProposal: boolean;
  hasPendingQuestions: boolean;
  /** The ticket's newest fix row, if any: pending (on its branch), merged (on dev) or approved (for production). */
  fixStatus: "pending" | "merged" | "approved" | null;
  analysisRunning: boolean;
  /** A night run is going right now (it flags a ticket P when its read-only pass ends and keeps that flag while it builds the fix). */
  buildRunning: boolean;
  /** Queued, but it changes the same files as another ticket and waits for it (lib/overlap.ts). */
  held: boolean;
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
      return { station: "fix", sub: input.held ? "held" : "queued" };
    case "P":
      if (input.hasPendingQuestions) return { station: "fix", sub: "questions" };
      // No question to answer: either the night run is building the fix right now, or it stopped without leaving one.
      return input.buildRunning ? { station: "fix", sub: "building" } : { station: "fix", sub: "stopped" };
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

export type BundleSuggestion = { ids: string[]; seqs: number[]; files: string[]; subjects: string[] };

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
  /** Why the last merge or revert for this ticket failed, when it did (shown in red on the row). */
  issue: string | null;
  /** For a held ticket: the tickets it waits for and whether their fix exists ("fix") or they are queued ahead of it ("queue"). */
  heldBy: { seq: number; why: "fix" | "queue" | "bundle" }[];
  /** The bundle this ticket is part of (built, tested and promoted as one fix with the other tickets of it), or null. */
  bundle: { id: string; letter: string; seqs: number[] } | null;
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
  /** The newest unread "something in the automation failed" notification for the viewer (see /api/admin/automation-alerts). */
  alert: { message: string; at: string } | null;
};

export type RecentRelease = { version: string | null; at: string; ok: boolean; rolledBack: boolean; tickets: number };

export type AutomationOverview = {
  status: AutomationStatus;
  /** The last few promotions, newest first (full history is on its own page). */
  recentReleases: RecentRelease[];
  tickets: OverviewTicket[];
  /** Fixes at each station: a bundle counts once, however many tickets it has. */
  counts: Record<StationId, number>;
  /** Tickets at each station (a bundle of three counts three here). */
  ticketCounts: Record<StationId, number>;
  /** Groups of tickets waiting for approval that change the same files: the analyst suggests building each as one fix. */
  suggestions: BundleSuggestion[];
  /** Tickets waiting on the admin: proposals, questions, fixes to test, fixes to promote. */
  needsYou: number;
  total: number;
};

type Client = Awaited<ReturnType<typeof createClient>>;

type RowTicket = { id: string; ticket_seq: number; subject: string; status: string; auto_handle: string | null; updated_at: string; bundle_id: string | null };
type RowProposal = { brief: string | null; expected: unknown; questions: unknown; id: string; ticket_id: string; kind: string; status: string; summary: string | null; why: string | null; pairing: boolean | null; files: unknown };
type RowRequest = { kind: string; ticket_id: string | null; picked_at: string | null; details: { tickets?: { ticketId?: string }[] } | null };

// Wrapped so the clock can be read in one place (the render must not call Date.now directly).
const now = () => Date.now();

/** PostgREST queries only run once something waits on them: wrapping one in a Promise starts it now. The screens below used to wait for
 * sixteen queries one after another; starting every independent query at once makes the wait about one round trip per stage. */
const start = <T>(query: PromiseLike<T>): Promise<T> => Promise.resolve(query);

export async function getAutomationOverview(supabase: Client): Promise<AutomationOverview> {
  const requestsP = start(supabase.from("automation_requests").select("kind, ticket_id, picked_at, details").is("completed_at", null));
  const settingsP = start(supabase.from("automation_settings").select("paused, bridge_seen_at, bridge_status").eq("id", true).maybeSingle());
  const runsP = start(supabase.from("automation_runs").select("kind, finished_at, tickets_count, cost_usd, result").order("started_at", { ascending: false }).limit(12));
  const recentP = start(supabase.from("automation_requests").select("kind").in("kind", ["analyze", "night", "digest"]).gte("completed_at", new Date(now() - 2 * 60 * 1000).toISOString()));
  const releasesP = start(supabase.from("automation_requests").select("requested_at, completed_at, report:details->report").eq("kind", "promote").not("completed_at", "is", null).order("requested_at", { ascending: false }).limit(3));
  const alertP = start(supabase.from("user_notifications").select("message, created_at").like("message", "⚠ Automation alert:%").is("read_at", null).order("created_at", { ascending: false }).limit(1));
  const blockersP = loadOverlapBlockers(supabase).catch(() => new Map<string, { seq: number; why: "fix" | "queue" | "bundle" }[]>());
  const { data: ticketRows } = await supabase
    .from("tickets")
    .select("id, ticket_seq, subject, status, auto_handle, updated_at, bundle_id")
    .not("auto_handle", "is", null)
    .not("status", "in", `(${FINAL_STATUSES.join(",")})`)
    .order("ticket_seq", { ascending: false })
    .limit(300);
  const tickets = (ticketRows ?? []) as RowTicket[];
  const ids = tickets.map((ticket) => ticket.id);
  const bundleIds = [...new Set(tickets.map((ticket) => ticket.bundle_id).filter((id): id is string => Boolean(id)))];
  const none = Promise.resolve({ data: [] as unknown[] });
  const proposalsP = ids.length > 0 ? start(supabase
      .from("ticket_proposals")
      .select("id, ticket_id, kind, status, summary:payload->summary, why:payload->why, pairing:payload->needsPairing, files:payload->files, questions:payload->questions, brief:payload->>brief, expected:payload->expectedFiles")
      .in("ticket_id", ids)
      .in("status", ["pending", "merged", "approved"])) : none;
  const eventsP = ids.length > 0 ? start(supabase
      .from("automation_events")
      .select("ticket_id, kind, created_at")
      .in("ticket_id", ids)
      .in("kind", ["marked", "spec_approved", "approved_for_production"])
      .order("created_at", { ascending: false })) : none;
  const issuesP = ids.length > 0 ? start(supabase
      .from("automation_requests")
      .select("ticket_id, result, completed_at")
      .in("kind", ["merge", "revert"])
      .in("ticket_id", ids)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(200)) : none;
  const bundlesP = bundleIds.length > 0 ? start(supabase.from("automation_bundles").select("id, letter").in("id", bundleIds)) : none;

  const proposalsByTicket = new Map<string, RowProposal[]>();
  if (ids.length > 0) {
    const { data } = await proposalsP;
    for (const row of (data ?? []) as unknown as RowProposal[]) {
      const list = proposalsByTicket.get(row.ticket_id) ?? [];
      list.push(row);
      proposalsByTicket.set(row.ticket_id, list);
    }
  }

  const signoffsByTicket = new Map<string, { marked: string | null; spec: string | null; production: string | null }>();
  if (ids.length > 0) {
    const { data: events } = await eventsP;
    for (const event of (events ?? []) as { ticket_id: string; kind: string; created_at: string }[]) {
      const entry = signoffsByTicket.get(event.ticket_id) ?? { marked: null, spec: null, production: null };
      const field = event.kind === "marked" ? "marked" : event.kind === "spec_approved" ? "spec" : "production";
      if (!entry[field]) entry[field] = event.created_at; // newest first: keep the latest
      signoffsByTicket.set(event.ticket_id, entry);
    }
  }

  const { data: requestRows } = await requestsP;
  const requests = (requestRows ?? []) as RowRequest[];

  const { data: settingsRow } = await settingsP;
  const health = ((settingsRow?.bridge_status ?? {}) as { analysisInProgress?: boolean; runInProgress?: boolean; promoteInProgress?: boolean; autoMerge?: boolean });
  const seenAt = (settingsRow?.bridge_seen_at as string | null) ?? null;
  const bridgeOnline = seenAt !== null && now() - new Date(seenAt).getTime() < 3 * 60 * 1000;
  const { data: runRows } = await runsP;
  const runOf = (kind: string): RunInfo | null => {
    const row = ((runRows ?? []) as { kind: string; finished_at: string | null; tickets_count: number; cost_usd: number | null; result: string | null }[]).find((r) => r.kind === kind);
    return row ? { finishedAt: row.finished_at, ticketsCount: row.tickets_count, costUsd: row.cost_usd === null ? null : Number(row.cost_usd), result: row.result } : null;
  };
  // A request the admin just fired counts as running right away, and keeps counting for two minutes after the poller started it,
  // until the bridge's own heartbeat shows the run (so a ticket never flips back to "Marked" and the button never re-enables).
  const { data: recentRows } = await recentP;
  const recent = new Set(((recentRows ?? []) as { kind: string }[]).map((row) => row.kind));
  const analysisRunning = (bridgeOnline && Boolean(health.analysisInProgress)) || requests.some((request) => request.kind === "analyze") || recent.has("analyze");
  const buildRunning = (bridgeOnline && Boolean(health.runInProgress)) || requests.some((request) => request.kind === "night") || recent.has("night");
  // The newest finished merge or revert per ticket: a failure is shown on the row, a later success clears it.
  const issueByTicket = new Map<string, string>();
  if (ids.length > 0) {
    const { data: doneRows } = await issuesP;
    const seenTickets = new Set<string>();
    for (const row of (doneRows ?? []) as { ticket_id: string; result: string | null }[]) {
      if (seenTickets.has(row.ticket_id)) continue;
      seenTickets.add(row.ticket_id);
      if (row.result && /(failed|does not exist|not main|could not|nothing was (merged|reverted|changed))/i.test(row.result)) issueByTicket.set(row.ticket_id, row.result);
    }
  }
  const mergeTickets = new Set(requests.filter((request) => request.kind === "merge" && request.ticket_id).map((request) => request.ticket_id as string));
  const promoteTickets = new Set<string>();
  for (const request of requests) {
    if (request.kind !== "promote") continue;
    for (const item of request.details?.tickets ?? []) if (item.ticketId) promoteTickets.add(item.ticketId);
  }

  const letterById = new Map<string, string>();
  if (bundleIds.length > 0) {
    const { data: bundleRows } = await bundlesP;
    for (const row of (bundleRows ?? []) as { id: string; letter: string }[]) letterById.set(row.id, row.letter);
  }
  const seqsByBundle = new Map<string, number[]>();
  for (const ticket of tickets) if (ticket.bundle_id) seqsByBundle.set(ticket.bundle_id, [...(seqsByBundle.get(ticket.bundle_id) ?? []), ticket.ticket_seq].sort((a, b) => a - b));
  const blockersById = await blockersP;
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
      buildRunning,
      held: (blockersById.get(ticket.id) ?? []).length > 0,
      inPromoteRequest: promoteTickets.has(ticket.id),
      mergeRequested: mergeTickets.has(ticket.id),
    });
    if (!placed) continue;
    // The night run can stop with nothing to ask (it ran into a limit): that is "stopped", not "questions for you".
    if (placed.sub === "questions" && Array.isArray(questions?.questions) && (questions?.questions as unknown[]).length === 0) placed.sub = "stopped";
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
      heldBy: (blockersById.get(ticket.id) ?? []).map((b) => ({ seq: b.seq, why: b.why })),
      bundle: ticket.bundle_id && letterById.has(ticket.bundle_id) ? { id: ticket.bundle_id, letter: letterById.get(ticket.bundle_id)!, seqs: seqsByBundle.get(ticket.bundle_id) ?? [ticket.ticket_seq] } : null,
      issue: placed.station === "test" && placed.sub === "branch" ? issueByTicket.get(ticket.id) ?? null : null,
      hasMigration: Array.isArray(source?.files) && (source!.files as unknown[]).some((file) => typeof file === "string" && /migrations\//.test(file)),
    });
  }
  // Count fixes, not tickets: a bundle is one fix (one thing to approve, test and promote).
  const ticketCounts: Record<StationId, number> = { marked: 0, analysis: 0, approval: 0, fix: 0, test: 0, promote: 0, release: 0 };
  const unitsAt = new Map<StationId, Set<string>>();
  const waitingUnits = new Set<string>();
  for (const ticket of result) {
    ticketCounts[ticket.station] += 1;
    const unit = ticket.bundle ? `b:${ticket.bundle.id}` : `t:${ticket.id}`;
    unitsAt.set(ticket.station, (unitsAt.get(ticket.station) ?? new Set()).add(unit));
    const waiting = ticket.station === "approval" || ticket.station === "test" || ticket.station === "promote" || (ticket.station === "fix" && (ticket.sub === "questions" || ticket.sub === "stopped"));
    if (waiting) waitingUnits.add(`${ticket.station}:${unit}`);
  }
  for (const station of STATION_ORDER) counts[station] = unitsAt.get(station)?.size ?? 0;
  const needsYou = waitingUnits.size;
  // Tickets waiting for approval that change the same files: suggest building each group as one fix.
  const candidates = tickets
    .filter((ticket) => ticket.auto_handle === "A" && !ticket.bundle_id)
    .map((ticket) => {
      const proposal = (proposalsByTicket.get(ticket.id) ?? []).find((row) => row.kind === "proposal" && row.status === "pending");
      return proposal ? { id: ticket.id, seq: ticket.ticket_seq, subject: ticket.subject, files: collectFiles(proposal.expected, filesFromText(proposal.brief)) } : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  const suggestions: BundleSuggestion[] = suggestBundles(candidates.map(({ seq, files }) => ({ seq, files }))).map((seqs) => {
    const group = seqs.map((seq) => candidates.find((candidate) => candidate.seq === seq)!);
    const shared = new Set<string>();
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) for (const file of sharedFiles(group[i].files, group[j].files)) shared.add(file);
    return { ids: group.map((member) => member.id), seqs, files: [...shared], subjects: group.map((member) => member.subject) };
  });
  const { data: releaseRows } = await releasesP;
  const recentReleases: RecentRelease[] = ((releaseRows ?? []) as unknown as { requested_at: string; completed_at: string | null; report: { version?: string; ok?: boolean; rolledBack?: boolean; tickets?: { status?: string }[] } | null }[]).map((row) => ({
    version: row.report?.version ?? null,
    at: row.completed_at ?? row.requested_at,
    ok: row.report?.ok === true,
    rolledBack: row.report?.rolledBack === true,
    tickets: (row.report?.tickets ?? []).filter((ticket) => ticket.status === "released" || ticket.status === "deployed").length,
  }));
  const { data: alertRows } = await alertP;
  const alertRow = ((alertRows ?? []) as { message: string; created_at: string }[])[0];
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
    alert: alertRow ? { message: alertRow.message.replace(/^⚠ Automation alert:\s*/, ""), at: alertRow.created_at } : null,
    requested: {
      analyze: requests.some((r) => r.kind === "analyze") || recent.has("analyze"),
      night: requests.some((r) => r.kind === "night") || recent.has("night"),
      digest: requests.some((r) => r.kind === "digest") || recent.has("digest"),
    },
  };
  return { status, recentReleases, tickets: result, counts, ticketCounts, suggestions, needsYou, total: result.length };
}

/** The number on the "Review & approvals" tab: what waits for the admin, counted as fixes - the same as AutomationOverview.needsYou, but from
 * three queries started together instead of the whole overview (this runs on every screen of the tickets area). */
export async function getWaitingCount(supabase: Client): Promise<number> {
  const [ticketRes, proposalRes, requestRes, settingsRes] = await Promise.all([
    start(supabase.from("tickets").select("id, status, auto_handle, bundle_id").in("auto_handle", ["A", "P", "D", "M", "R"]).not("status", "in", `(${FINAL_STATUSES.join(",")})`).limit(300)),
    start(
      supabase
        .from("ticket_proposals")
        .select("ticket_id, kind, status, questions:payload->questions")
        .or("status.in.(pending,merged),and(kind.eq.fix,status.eq.approved)"),
    ),
    start(supabase.from("automation_requests").select("kind, details").is("completed_at", null)),
    start(supabase.from("automation_settings").select("bridge_seen_at, bridge_status").eq("id", true).maybeSingle()),
  ]);
  const tickets = (ticketRes.data ?? []) as { id: string; status: string; auto_handle: string | null; bundle_id: string | null }[];
  const rows = (proposalRes.data ?? []) as unknown as { ticket_id: string; kind: string; status: string; questions: unknown }[];
  const requests = (requestRes.data ?? []) as unknown as { kind: string; details: { tickets?: { ticketId?: string }[] } | null }[];
  const health = (settingsRes.data?.bridge_status ?? {}) as { runInProgress?: boolean };
  const seenAt = (settingsRes.data?.bridge_seen_at as string | null) ?? null;
  const online = seenAt !== null && now() - new Date(seenAt).getTime() < 3 * 60 * 1000;
  const buildRunning = (online && Boolean(health.runInProgress)) || requests.some((request) => request.kind === "night");
  const promoteTickets = new Set<string>();
  for (const request of requests) if (request.kind === "promote") for (const item of request.details?.tickets ?? []) if (item.ticketId) promoteTickets.add(item.ticketId);
  const waiting = new Set<string>();
  for (const ticket of tickets) {
    const own = rows.filter((row) => row.ticket_id === ticket.id);
    const fixes = own.filter((row) => row.kind === "fix");
    const fix = fixes.find((row) => row.status === "approved") ?? fixes.find((row) => row.status === "merged") ?? fixes.find((row) => row.status === "pending") ?? null;
    const placed = stationOf({
      autoHandle: ticket.auto_handle,
      status: ticket.status,
      hasPendingProposal: own.some((row) => row.kind === "proposal" && row.status === "pending"),
      hasPendingQuestions: own.some((row) => row.kind === "questions" && row.status === "pending"),
      fixStatus: (fix?.status as StationInput["fixStatus"]) ?? null,
      analysisRunning: false,
      buildRunning,
      held: false,
      inPromoteRequest: promoteTickets.has(ticket.id),
      mergeRequested: false,
    });
    if (!placed) continue;
    const isWaiting = placed.station === "approval" || placed.station === "test" || placed.station === "promote" || (placed.station === "fix" && (placed.sub === "questions" || placed.sub === "stopped"));
    if (isWaiting) waiting.add(`${placed.station}:${ticket.bundle_id ? `b:${ticket.bundle_id}` : `t:${ticket.id}`}`);
  }
  return waiting.size;
}
