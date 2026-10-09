import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The last step of "Promote to production": the bridge deployed the approved fixes and the live
 * site passed its smoke test, so the tickets are marked resolved here. This is the one place the
 * automation may set a ticket to resolved (auto-handle-result refuses it), and it only does so for a
 * ticket the admin explicitly approved for production (flag R with an approved fix row). Resolving
 * notifies the ticket's creator through the existing status-change trigger.
 */
export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminMarkReleased");
  if (denied) return denied;

  let body: { version?: unknown; tickets?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const version = typeof body.version === "string" ? body.version : "";
  const items = Array.isArray(body.tickets) ? (body.tickets as { ticketId?: unknown; proposalId?: unknown }[]) : [];
  if (!version || items.length === 0) return NextResponse.json({ error: "version and tickets are required." }, { status: 400 });

  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  let resolved = 0;
  const touched: string[] = [];
  const bundleIds = new Set<string>();
  const skipped: string[] = [];
  for (const item of items) {
    if (typeof item.ticketId !== "string" || typeof item.proposalId !== "string") continue;
    const { data: proposal } = await adminClient.from("ticket_proposals").select("id, status, ticket_id").eq("id", item.proposalId).maybeSingle();
    const { data: ticket } = await adminClient.from("tickets").select("id, auto_handle, status, fix_description, bundle_id").eq("id", item.ticketId).maybeSingle();
    if (!proposal || !ticket || proposal.ticket_id !== ticket.id || proposal.status !== "approved" || ticket.auto_handle !== "R") {
      skipped.push(item.ticketId);
      continue;
    }
    if ((ticket as { bundle_id?: string | null }).bundle_id) bundleIds.add((ticket as { bundle_id: string }).bundle_id);
    const patch: Record<string, unknown> = { status: "resolved", resolved_at: now, auto_handle: "D" };
    if (!ticket.fix_description) patch.fix_description = `Fixed automatically and released in version ${version}.`;
    const { error } = await adminClient.from("tickets").update(patch).eq("id", ticket.id);
    if (error) {
      logServerError("adminMarkReleased", "ticket_update_failed", { ticketId: ticket.id, error: error.message });
      skipped.push(item.ticketId);
      continue;
    }
    await adminClient.from("ticket_proposals").update({ status: "released", decided_at: now }).eq("id", proposal.id);
    resolved += 1;
    touched.push(ticket.id);
  }
  // A released bundle is finished: its tickets are freed and the letter can be used again.
  if (touched.length > 0 && bundleIds.size > 0) {
    await adminClient.from("tickets").update({ bundle_id: null }).in("id", touched);
    for (const bundleId of bundleIds) {
      const { data: left } = await adminClient.from("tickets").select("id").eq("bundle_id", bundleId).limit(1);
      if ((left ?? []).length === 0) await adminClient.from("automation_bundles").delete().eq("id", bundleId);
    }
  }
  return NextResponse.json({ success: true, resolved, skipped }, { headers: { "Cache-Control": "no-store" } });
}
