import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachmentLinksFor } from "@/lib/ticket-attachment-links";

export const dynamic = "force-dynamic";

/**
 * The analyst's pickup (see docs/design/auto-ticket-handling.md): every live ticket the admin
 * has asked a spec for (auto_handle = 'S'), with the ticket text and - when this is a revision -
 * the previous proposal and the admin's comment asking for the change, so the analyst can
 * answer it instead of starting over.
 */
export async function GET(request: Request) {
  const denied = checkAutomationSecret(request, "adminAnalyzeQueue");
  if (denied) return denied;

  const adminClient = createAdminClient();
  const { data: tickets, error } = await adminClient
    .from("tickets")
    .select("id, ticket_seq, subject, ticket_type, area, priority, description, status, created_at, fix_description")
    .not("status", "in", "(resolved,closed,cancelled,duplicate)")
    .eq("auto_handle", "S")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    logServerError("adminAnalyzeQueue", "query_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to load queue." }, { status: 500 });
  }

  const ids = (tickets ?? []).map((ticket) => ticket.id);
  const previousByTicket = new Map<string, { version: number; payload: unknown; admin_comment: string | null }>();
  if (ids.length > 0) {
    const { data: previous } = await adminClient
      .from("ticket_proposals")
      .select("ticket_id, version, payload, admin_comment, status, created_at")
      .eq("kind", "proposal")
      .in("ticket_id", ids)
      .order("created_at", { ascending: false });
    for (const row of previous ?? []) {
      if (!previousByTicket.has(row.ticket_id)) {
        previousByTicket.set(row.ticket_id, { version: row.version, payload: row.payload, admin_comment: row.admin_comment });
      }
    }
  }

  // The tickets' screenshots, and which of them already had a fix shipped (reopened by the tester since): the analyst then
  // works from what is still wrong instead of starting over.
  const attachments = await attachmentLinksFor(adminClient, ids);
  const shipped = new Set<string>();
  if (ids.length > 0) {
    const { data: fixes } = await adminClient.from("ticket_proposals").select("ticket_id").eq("kind", "fix").in("status", ["released", "approved", "merged"]).in("ticket_id", ids);
    for (const row of fixes ?? []) shipped.add(row.ticket_id);
  }

  return NextResponse.json(
    {
      tickets: (tickets ?? []).map((ticket) => ({
        ...ticket,
        previousProposal: previousByTicket.get(ticket.id) ?? null,
        attachments: attachments.get(ticket.id) ?? [],
        reopenedAfterFix: shipped.has(ticket.id) || Boolean(ticket.fix_description && ticket.status === "reopened"),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
