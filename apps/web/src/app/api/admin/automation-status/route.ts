import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Between the laptop and the app (docs/design/ticket-automation-dashboard.md):
 *  - POST: the minute poller reports the bridge's health ({ health }); the dashboard reads it to show "Bridge online" and
 *    which run is in progress. Answers with the Pause flag so the poller knows too.
 *  - GET: the bridge asks "am I paused?" before it starts the analyst or the night run.
 */
export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminAutomationStatus");
  if (denied) return denied;
  let body: { health?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const health = body.health && typeof body.health === "object" && !Array.isArray(body.health) ? body.health : {};
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("automation_settings")
    .update({ bridge_seen_at: new Date().toISOString(), bridge_status: health, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select("paused")
    .maybeSingle();
  if (error) {
    logServerError("adminAutomationStatus", "update_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
  return NextResponse.json({ paused: Boolean(data?.paused) }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const denied = checkAutomationSecret(request, "adminAutomationStatus");
  if (denied) return denied;
  const adminClient = createAdminClient();
  const { data } = await adminClient.from("automation_settings").select("paused").eq("id", true).maybeSingle();
  return NextResponse.json({ paused: Boolean(data?.paused) }, { headers: { "Cache-Control": "no-store" } });
}
