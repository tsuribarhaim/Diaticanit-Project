import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/server-log";
import { ticketAutoHandleOptions, ticketStatusOptions } from "@/lib/tickets";

export const dynamic = "force-dynamic";

type RequestBody = {
  ticketId?: unknown;
  autoHandle?: unknown;
  notes?: unknown;
  status?: unknown;
};

/**
 * Auto Ticket Handling via n8n (see docs/design/auto-ticket-handling.md) -
 * the bridge reports back here once per ticket after Claude has looked at
 * it. autoHandle is the ONLY required field (Y/P/D - Y means "retry me
 * next run", for a genuine processing failure rather than a real
 * classification). notes replaces auto_handle_notes wholesale (it's meant
 * to be "the current plan", not an accumulating log - unlike
 * technical_response elsewhere on this table, which IS a manually-kept
 * audit trail and is never touched by this route). status is optional -
 * the bridge only passes it when it actually has something to move the
 * ticket to (in_progress for Phase 1, fixed for Phase 2); never 'resolved'
 * from here, matching this project's standing rule that only a human,
 * after live verification, marks a ticket resolved.
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.N8N_TICKET_AUTOMATION_SECRET;
  if (!expectedSecret) {
    logServerError("adminAutoHandleResult", "missing_secret_env", {});
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  const providedSecret = request.headers.get("x-ticket-automation-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { ticketId, autoHandle, notes, status } = body;

  if (typeof ticketId !== "string" || !ticketId) {
    return NextResponse.json({ error: "ticketId is required." }, { status: 400 });
  }
  if (typeof autoHandle !== "string" || !(ticketAutoHandleOptions as readonly string[]).includes(autoHandle)) {
    return NextResponse.json({ error: `autoHandle must be one of: ${ticketAutoHandleOptions.join(", ")}` }, { status: 400 });
  }
  if (status !== undefined && (typeof status !== "string" || !(ticketStatusOptions as readonly string[]).includes(status))) {
    return NextResponse.json({ error: "status, if provided, must be a known ticket status." }, { status: 400 });
  }
  if (status === "resolved") {
    return NextResponse.json({ error: "This route never sets status to resolved - that stays a manual step." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { auto_handle: autoHandle };
  if (typeof notes === "string") {
    patch.auto_handle_notes = notes;
  }
  if (typeof status === "string") {
    patch.status = status;
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("tickets").update(patch).eq("id", ticketId);

  if (error) {
    logServerError("adminAutoHandleResult", "update_failed", { ticketId, error: error.message });
    return NextResponse.json({ error: "Failed to update ticket." }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
