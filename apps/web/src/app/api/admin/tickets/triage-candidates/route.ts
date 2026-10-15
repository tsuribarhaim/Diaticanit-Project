import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachmentLinksFor } from "@/lib/ticket-attachment-links";
import { batchLockActive, type Batch } from "@/lib/daily-batch";

export const dynamic = "force-dynamic";

/**
 * The tickets the daily triage (bridge POST /triage, 16:00) may pick from: open or reopened, not already in automation,
 * and not ones the admin recently chose to handle without it - taken out of automation or handled by hand in the last
 * 14 days, or unticked in a batch in the last 7. Each comes with its screenshots (short-lived signed links).
 */
export async function GET(request: Request) {
  const denied = checkAutomationSecret(request, "adminTriageCandidates");
  if (denied) return denied;
  const admin = createAdminClient();
  // Yesterday's batch is still running: no scan today (the bridge skips the triage agent).
  if (await batchLockActive(admin)) return NextResponse.json({ tickets: [], batchActive: true }, { headers: { "Cache-Control": "no-store" } });

  const { data: tickets, error } = await admin
    .from("tickets")
    .select("id, ticket_seq, subject, ticket_type, area, priority, description, status, created_at, fix_description")
    .in("status", ["open", "reopened"])
    .is("auto_handle", null)
    .order("ticket_seq", { ascending: true })
    .limit(200);
  if (error) {
    logServerError("adminTriageCandidates", "query_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to load tickets." }, { status: 500 });
  }

  const now = Date.now();
  const since14 = new Date(now - 14 * 86400000).toISOString();
  const since7 = new Date(now - 7 * 86400000).toISOString();
  const { data: events } = await admin.from("automation_events").select("ticket_id").in("kind", ["taken_out", "handled_by_hand"]).gte("created_at", since14);
  const handledByAdmin = new Set(((events ?? []) as { ticket_id: string }[]).map((event) => event.ticket_id));
  const { data: recentBatches } = await admin.from("automation_batches").select("tickets").gte("created_at", since7);
  const unticked = new Set(((recentBatches ?? []) as Pick<Batch, "tickets">[]).flatMap((batch) => batch.tickets.filter((t) => t.state === "unselected").map((t) => t.ticketId)));

  const candidates = (tickets ?? []).filter((ticket) => !handledByAdmin.has(ticket.id) && !unticked.has(ticket.id));
  const attachments = await attachmentLinksFor(admin, candidates.map((ticket) => ticket.id));
  return NextResponse.json(
    {
      tickets: candidates.map((ticket) => ({
        ...ticket,
        description: String(ticket.description ?? "").slice(0, 6000),
        attachments: attachments.get(ticket.id) ?? [],
      })),
      excluded: { handledByAdmin: handledByAdmin.size, untickedRecently: unticked.size },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
