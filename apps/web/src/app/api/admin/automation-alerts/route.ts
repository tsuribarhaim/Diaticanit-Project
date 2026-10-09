import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The start of every automation alert's notification text: the dashboard finds them by it. */
export const AUTOMATION_ALERT_PREFIX = "⚠ Automation alert: ";
const REPEAT_WINDOW_MS = 6 * 60 * 60 * 1000;

const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * "Something in the automation failed" (called by the n8n "Daffy - Error Alert" workflow, which every Daffy workflow names as
 * its error workflow). It puts an in-app notification in front of every admin - the bell shows it on every screen and the
 * dashboard shows it in red - because an e-mail alone is no use when the e-mail sending is what broke. The same alert (same
 * workflow and step) is not repeated within six hours, so a failing step that runs every minute cannot flood anyone.
 */
export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminAutomationAlerts");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { workflow?: unknown; node?: unknown; message?: unknown } | null;
  const workflow = clean(body?.workflow, 80) || "n8n";
  const node = clean(body?.node, 80);
  const message = clean(body?.message, 300) || "no details";
  const key = node ? `${workflow} / ${node}` : workflow;

  const admin = createAdminClient();
  const { data: admins, error } = await admin.from("user_profile").select("user_id").eq("is_admin", true);
  if (error) {
    logServerError("adminAutomationAlerts", "admins_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to load admins." }, { status: 500 });
  }
  const since = new Date(Date.now() - REPEAT_WINDOW_MS).toISOString();
  let alerted = 0;
  let skipped = 0;
  for (const row of (admins ?? []) as { user_id: string }[]) {
    const { data: recent } = await admin
      .from("user_notifications")
      .select("id")
      .eq("user_id", row.user_id)
      .like("message", `${AUTOMATION_ALERT_PREFIX}${key}:%`)
      .gte("created_at", since)
      .limit(1);
    if ((recent ?? []).length > 0) {
      skipped += 1;
      continue;
    }
    const { error: insertError } = await admin
      .from("user_notifications")
      .insert({ user_id: row.user_id, target_profile_id: null, severity: "info", message: `${AUTOMATION_ALERT_PREFIX}${key}: ${message}`, field_keys: [] });
    if (insertError) logServerError("adminAutomationAlerts", "insert_failed", { error: insertError.message });
    else alerted += 1;
  }
  return NextResponse.json({ ok: true, alerted, skipped }, { headers: { "Cache-Control": "no-store" } });
}
