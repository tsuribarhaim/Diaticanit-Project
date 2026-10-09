import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Fixes that exist but are not in production yet: on their branch (pending), merged on dev (merged) or approved for
 * production (approved). After a release lands, the bridge checks each one: a fix built on an older production can no longer
 * be promoted (docs/design/auto-ticket-handling.md, "Fixes are built on production"), so it is rebuilt on the new one.
 */
export async function GET(request: Request) {
  const denied = checkAutomationSecret(request, "adminUnpromotedFixes");
  if (denied) return denied;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ticket_proposals")
    .select("id, ticket_id, status, branch:payload->>branch, tickets!inner(ticket_seq, auto_handle, status)")
    .eq("kind", "fix")
    .in("status", ["pending", "merged", "approved"]);
  if (error) {
    logServerError("adminUnpromotedFixes", "query_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to load the fixes." }, { status: 500 });
  }
  type Joined = { ticket_seq: number; auto_handle: string | null; status: string };
  const fixes = ((data ?? []) as unknown as { id: string; ticket_id: string; status: string; branch: string | null; tickets: Joined | Joined[] }[])
    .map((row) => ({ row, ticket: Array.isArray(row.tickets) ? row.tickets[0] : row.tickets }))
    // Only tickets still waiting for their fix to reach production.
    .filter(({ ticket }) => ticket && ["D", "M", "R"].includes(ticket.auto_handle ?? "") && !["resolved", "closed", "cancelled", "duplicate"].includes(ticket.status))
    .map(({ row, ticket }) => ({ proposalId: row.id, ticketId: row.ticket_id, ticketSeq: ticket.ticket_seq, status: row.status, branch: row.branch }));
  return NextResponse.json({ fixes }, { headers: { "Cache-Control": "no-store" } });
}
