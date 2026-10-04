import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/server-log";

export const dynamic = "force-dynamic";

/**
 * Auto Ticket Handling via n8n (see docs/design/auto-ticket-handling.md) -
 * the bridge's daily pickup. Returns every ticket an admin has explicitly
 * opted in (auto_handle = 'Y') that's still live (open or reopened - a
 * ticket closed/resolved/etc. some other way in the meantime is no longer
 * eligible even if it was once marked Y). Deliberately returns the full
 * ticket content (not just ids) so the bridge/Claude has everything needed
 * to start investigating without a second round-trip.
 */
export async function GET(request: Request) {
  const expectedSecret = process.env.N8N_TICKET_AUTOMATION_SECRET;
  if (!expectedSecret) {
    logServerError("adminAutoHandleQueue", "missing_secret_env", {});
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  const providedSecret = request.headers.get("x-ticket-automation-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("tickets")
    .select("id, ticket_seq, subject, ticket_type, area, priority, description, status, created_at")
    .in("status", ["open", "reopened"])
    .eq("auto_handle", "Y")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    logServerError("adminAutoHandleQueue", "query_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to load queue." }, { status: 500 });
  }

  return NextResponse.json({ tickets: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
