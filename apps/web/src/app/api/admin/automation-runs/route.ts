import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The bridge records every agent run here when it ends (docs/design/ticket-automation-dashboard.md), so the
 * dashboard can say "Last night run 02:42 - 7 fixed - $4.32", and the control room can say who started it. */

/** Who started a run. A manual or batch run always begins with a request the laptop's poller claimed just before
 * (automation_requests): the admin's "run now" (manual) or the daily batch's own request (details.batchId). Anything else
 * came from the schedule; the planner runs on its own after the analyst and at the start of the night run. */
async function triggerOf(admin: ReturnType<typeof createAdminClient>, kind: string, startedAt: string): Promise<"schedule" | "manual" | "batch" | "auto"> {
  if (kind === "planner") return "auto";
  if (kind === "triage") return "schedule";
  const started = new Date(startedAt).getTime();
  const { data } = await admin
    .from("automation_requests")
    .select("details, picked_at, requested_at")
    .eq("kind", kind === "analyst" ? "analyze" : "night")
    .gte("requested_at", new Date(started - 90 * 60 * 1000).toISOString())
    .lte("requested_at", new Date(started + 2 * 60 * 1000).toISOString())
    .order("requested_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as { details: { batchId?: string } | null; picked_at: string | null } | undefined;
  // Claimed shortly before the run started (it may have waited up to an hour for another agent).
  if (!row || !row.picked_at || new Date(row.picked_at).getTime() > started + 2 * 60 * 1000) return "schedule";
  return row.details?.batchId ? "batch" : "manual";
}
export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminAutomationRuns");
  if (denied) return denied;
  let body: { kind?: unknown; startedAt?: unknown; finishedAt?: unknown; ticketsCount?: unknown; costUsd?: unknown; result?: unknown; details?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  // triage: the daily batch scan at 16:00 (bridge POST /triage); planner: tonight's work order (lib/work-order.ts).
  if (typeof body.kind !== "string" || !["analyst", "night", "triage", "planner"].includes(body.kind)) return NextResponse.json({ error: "kind must be analyst, night, triage or planner." }, { status: 400 });
  const adminClient = createAdminClient();
  const startedAt = typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString();
  const { error } = await adminClient.from("automation_runs").insert({
    kind: body.kind,
    trigger: await triggerOf(adminClient, body.kind, startedAt),
    started_at: startedAt,
    finished_at: typeof body.finishedAt === "string" ? body.finishedAt : new Date().toISOString(),
    tickets_count: typeof body.ticketsCount === "number" ? Math.max(0, Math.round(body.ticketsCount)) : 0,
    cost_usd: typeof body.costUsd === "number" ? body.costUsd : null,
    result: typeof body.result === "string" ? body.result.slice(0, 500) : null,
    details: body.details && typeof body.details === "object" ? body.details : {},
  });
  if (error) {
    logServerError("adminAutomationRuns", "insert_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
