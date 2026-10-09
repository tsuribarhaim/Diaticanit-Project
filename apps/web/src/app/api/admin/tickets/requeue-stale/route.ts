import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { appendTicketDescriptionEntry } from "@/lib/tickets";
import { bundleOfTicket } from "@/lib/bundles";

export const dynamic = "force-dynamic";

/**
 * Puts a ticket whose fix went stale (production moved on after it was built) back in the night run's queue, with a note the
 * agent reads. Called by the bridge after a promotion, once it has moved the old branch out of the way (and undone the fix's
 * merge on dev if it had one). The fix rows are marked "returned", the same state "Return with a comment" leaves them in.
 */
export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminRequeueStale");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { ticketId?: unknown; note?: unknown } | null;
  const ticketId = typeof body?.ticketId === "string" ? body.ticketId : "";
  const note = String(body?.note ?? "").slice(0, 1000);
  if (!ticketId || !note) return NextResponse.json({ error: "ticketId and note are required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: ticket } = await admin.from("tickets").select("id, ticket_seq, description, auto_handle").eq("id", ticketId).maybeSingle();
  if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!["D", "M", "R"].includes(ticket.auto_handle ?? "")) return NextResponse.json({ ok: true, skipped: "The ticket is not waiting for a fix to reach production." });

  // A bundle goes back as a whole: its fix is one branch, so every ticket of it is rebuilt together.
  const bundle = await bundleOfTicket(admin, ticketId);
  const ids = bundle ? bundle.members.map((member) => member.id) : [ticketId];
  for (const id of ids) {
    const { data: row } = await admin.from("tickets").select("id, description").eq("id", id).maybeSingle();
    if (!row) continue;
    const { error } = await admin
      .from("tickets")
      .update({ description: appendTicketDescriptionEntry({ currentDescription: row.description ?? "", changeLines: [], note, authoredBySupport: true }), auto_handle: "Y", status: "open" })
      .eq("id", id);
    if (error) {
      logServerError("adminRequeueStale", "ticket_update_failed", { error: error.message });
      return NextResponse.json({ error: "Failed to update the ticket." }, { status: 500 });
    }
    await admin.from("automation_events").insert({ ticket_id: id, kind: "auto_requeued", actor: null, detail: { note } });
  }
  await admin
    .from("ticket_proposals")
    .update({ status: "returned", admin_comment: note, decided_at: new Date().toISOString() })
    .in("ticket_id", ids)
    .eq("kind", "fix")
    .in("status", ["pending", "merged", "approved"]);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
