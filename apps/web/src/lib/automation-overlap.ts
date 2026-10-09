import type { SupabaseClient } from "@supabase/supabase-js";

import { collectFiles, filesFromText, overlapBlockers, type Blocker, type TicketFiles } from "@/lib/overlap";

/** Events that put a ticket (back) in the night run's queue: an "overlap_override" only counts when it is newer than the last of these. */
const QUEUED_EVENTS = ["spec_approved", "answered", "requeued", "auto_requeued", "sent_back", "returned"];

/** Who each queued ticket has to wait for, by ticket id (see lib/overlap.ts). Used by the night-run queue and by the dashboard,
 * so both always agree. */
export async function loadOverlapBlockers(supabase: SupabaseClient): Promise<Map<string, Blocker[]>> {
  const out = new Map<string, Blocker[]>();
  const { data: queueRows } = await supabase.from("tickets").select("id, ticket_seq, bundle_id").eq("auto_handle", "Y").in("status", ["open", "reopened"]);
  const queue = (queueRows ?? []) as { id: string; ticket_seq: number; bundle_id: string | null }[];
  if (queue.length === 0) return out;
  const ids = queue.map((row) => row.id);

  // What each queued ticket is going to change: the analyst's own list (new proposals) plus the files its brief names (all of them).
  const { data: proposalRows } = await supabase
    .from("ticket_proposals")
    .select("ticket_id, created_at, brief:payload->>brief, expected:payload->expectedFiles")
    .in("ticket_id", ids)
    .eq("kind", "proposal")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  const newest = new Map<string, { brief: string | null; expected: unknown }>();
  for (const row of (proposalRows ?? []) as { ticket_id: string; brief: string | null; expected: unknown }[]) if (!newest.has(row.ticket_id)) newest.set(row.ticket_id, row);
  const queued: (TicketFiles & { id: string })[] = queue.map((row) => {
    const proposal = newest.get(row.id);
    return { id: row.id, seq: row.ticket_seq, files: collectFiles(proposal?.expected, filesFromText(proposal?.brief)) };
  });

  // Fixes that are built but not promoted yet: what they really changed.
  const { data: fixRows } = await supabase
    .from("ticket_proposals")
    .select("ticket_id, files:payload->files, tickets!inner(ticket_seq, bundle_id)")
    .eq("kind", "fix")
    .in("status", ["pending", "merged", "approved"]);
  const inFlight: TicketFiles[] = [];
  const bundleOf = new Map<number, string>();
  for (const row of queue) if (row.bundle_id) bundleOf.set(row.ticket_seq, row.bundle_id);
  for (const row of (fixRows ?? []) as unknown as { files: unknown; tickets: { ticket_seq: number; bundle_id: string | null } | { ticket_seq: number; bundle_id: string | null }[] }[]) {
    const joined = Array.isArray(row.tickets) ? row.tickets[0] : row.tickets;
    if (!joined) continue;
    inFlight.push({ seq: joined.ticket_seq, files: collectFiles(row.files) });
    if (joined.bundle_id) bundleOf.set(joined.ticket_seq, joined.bundle_id);
  }

  // "Build anyway": valid only if the admin said it after the ticket was last queued.
  const overridden = new Set<number>();
  const { data: events } = await supabase
    .from("automation_events")
    .select("ticket_id, kind, created_at")
    .in("ticket_id", ids)
    .in("kind", ["overlap_override", ...QUEUED_EVENTS]);
  const lastQueued = new Map<string, string>();
  const lastOverride = new Map<string, string>();
  for (const event of (events ?? []) as { ticket_id: string; kind: string; created_at: string }[]) {
    const target = event.kind === "overlap_override" ? lastOverride : lastQueued;
    if (!target.has(event.ticket_id) || target.get(event.ticket_id)! < event.created_at) target.set(event.ticket_id, event.created_at);
  }
  for (const row of queue) {
    const override = lastOverride.get(row.id);
    if (override && override > (lastQueued.get(row.id) ?? "")) overridden.add(row.ticket_seq);
  }

  const bySeq = overlapBlockers(queued, inFlight, overridden, bundleOf);
  for (const ticket of queued) {
    const blockers = bySeq.get(ticket.seq);
    if (blockers) out.set(ticket.id, blockers);
  }

  // A bundle is built as one job, so it is ready only when EVERY ticket of it is queued, and it waits when any one of them has to wait:
  // each member gets the union of what its bundle is waiting for.
  const bundleIds = [...new Set(queue.map((row) => row.bundle_id).filter((id): id is string => Boolean(id)))];
  if (bundleIds.length > 0) {
    const { data: memberRows } = await supabase.from("tickets").select("id, ticket_seq, auto_handle, status, bundle_id").in("bundle_id", bundleIds);
    const members = (memberRows ?? []) as { id: string; ticket_seq: number; auto_handle: string | null; status: string; bundle_id: string }[];
    for (const bundleId of bundleIds) {
      const group = members.filter((member) => member.bundle_id === bundleId);
      const merged = new Map<string, Blocker>();
      for (const member of group) for (const blocker of out.get(member.id) ?? []) merged.set(`${blocker.seq}:${blocker.why}`, blocker);
      for (const member of group) {
        if (member.auto_handle !== "Y" || !["open", "reopened"].includes(member.status)) {
          // Someone in the bundle is not queued (still waiting for approval, or stopped): the others wait for it.
          for (const other of group) if (other.id !== member.id) merged.set(`${member.ticket_seq}:bundle`, { seq: member.ticket_seq, files: [], why: "bundle" });
        }
      }
      if (merged.size === 0) continue;
      for (const member of group) {
        const own = [...merged.values()].filter((blocker) => blocker.seq !== member.ticket_seq);
        if (own.length > 0 && member.auto_handle === "Y") out.set(member.id, own);
      }
    }
  }
  return out;
}
