import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_BUNDLE_SIZE, nextBundleLetter } from "@/lib/overlap";

/** Fix bundles (docs/design/auto-ticket-handling.md, "Fix bundles"): tickets whose fixes change the same files are built, tested
 * and promoted as ONE fix. The group is `tickets.bundle_id`; the night run builds it as one job on the branch of its lowest
 * ticket (the "lead"), and every member keeps its own fix row pointing at that branch, so the per-ticket screens keep working.
 * Every step below runs with whatever client it is given (the admin's session, or the service role in the API routes). */

export type BundleMember = { id: string; seq: number; autoHandle: string | null; status: string };
export type BundleInfo = { bundleId: string; letter: string; members: BundleMember[]; lead: BundleMember };

type Row = { id: string; ticket_seq: number; auto_handle: string | null; status: string };
const asMember = (row: Row): BundleMember => ({ id: row.id, seq: row.ticket_seq, autoHandle: row.auto_handle, status: row.status });

/** The bundle a ticket belongs to (members in ticket-number order, lead first), or null for a ticket on its own. */
export async function bundleOfTicket(supabase: SupabaseClient, ticketId: string): Promise<BundleInfo | null> {
  const { data: ticket } = await supabase.from("tickets").select("bundle_id").eq("id", ticketId).maybeSingle();
  const bundleId = (ticket as { bundle_id: string | null } | null)?.bundle_id;
  return bundleId ? bundleById(supabase, bundleId) : null;
}

export async function bundleById(supabase: SupabaseClient, bundleId: string): Promise<BundleInfo | null> {
  const [{ data: bundle }, { data: rows }] = await Promise.all([
    supabase.from("automation_bundles").select("id, letter").eq("id", bundleId).maybeSingle(),
    supabase.from("tickets").select("id, ticket_seq, auto_handle, status").eq("bundle_id", bundleId).order("ticket_seq", { ascending: true }),
  ]);
  const members = ((rows ?? []) as Row[]).map(asMember);
  if (!bundle || members.length === 0) return null;
  return { bundleId, letter: (bundle as { letter: string }).letter, members, lead: members[0] };
}

/** True once any member has a fix on its branch, on dev or approved: the work exists and is shared, so members cannot leave one by one. */
export async function bundleIsBuilt(supabase: SupabaseClient, bundle: BundleInfo): Promise<boolean> {
  const { data } = await supabase
    .from("ticket_proposals")
    .select("id")
    .eq("kind", "fix")
    .in("ticket_id", bundle.members.map((member) => member.id))
    .in("status", ["pending", "merged", "approved"])
    .limit(1);
  return (data ?? []).length > 0;
}

/** Groups the tickets into a new bundle. Refuses a group that is too small or too big, a ticket that is already in a bundle, or one
 * that is already built. Returns the bundle, or an error text (plain English; the callers turn it into the right language). */
export async function createBundle(supabase: SupabaseClient, adminId: string, ticketIds: string[]): Promise<{ bundle: BundleInfo } | { error: "size" | "taken" | "built" | "db" }> {
  const ids = [...new Set(ticketIds)];
  if (ids.length < 2 || ids.length > MAX_BUNDLE_SIZE) return { error: "size" };
  const { data: rows } = await supabase.from("tickets").select("id, ticket_seq, auto_handle, status, bundle_id").in("id", ids);
  const tickets = (rows ?? []) as (Row & { bundle_id: string | null })[];
  if (tickets.length !== ids.length) return { error: "db" };
  if (tickets.some((ticket) => ticket.bundle_id)) return { error: "taken" };
  if (tickets.some((ticket) => ["D", "M", "R"].includes(ticket.auto_handle ?? ""))) return { error: "built" };
  const { data: used } = await supabase.from("automation_bundles").select("letter");
  const letter = nextBundleLetter(((used ?? []) as { letter: string }[]).map((row) => row.letter));
  const { data: created, error } = await supabase.from("automation_bundles").insert({ letter, created_by: adminId }).select("id").single();
  if (error || !created) return { error: "db" };
  const bundleId = (created as { id: string }).id;
  const { error: updateError } = await supabase.from("tickets").update({ bundle_id: bundleId }).in("id", ids);
  if (updateError) {
    await supabase.from("automation_bundles").delete().eq("id", bundleId);
    return { error: "db" };
  }
  const info = await bundleById(supabase, bundleId);
  return info ? { bundle: info } : { error: "db" };
}

/** Removes the bundle row and frees every member (they are separate tickets again). */
export async function dissolveBundle(supabase: SupabaseClient, bundleId: string): Promise<void> {
  await supabase.from("tickets").update({ bundle_id: null }).eq("bundle_id", bundleId);
  await supabase.from("automation_bundles").delete().eq("id", bundleId);
}

/** One ticket leaves its bundle (before the bundle is built). A bundle left with a single ticket is no bundle: it is dissolved. */
export async function leaveBundle(supabase: SupabaseClient, ticketId: string): Promise<void> {
  const bundle = await bundleOfTicket(supabase, ticketId);
  if (!bundle) return;
  await supabase.from("tickets").update({ bundle_id: null }).eq("id", ticketId);
  if (bundle.members.length - 1 < 2) await dissolveBundle(supabase, bundle.bundleId);
}
