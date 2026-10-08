import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The bridge records every analyst / night run here when it ends (docs/design/ticket-automation-dashboard.md), so the
 * dashboard can say "Last night run 02:42 - 7 fixed - $4.32". */
export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminAutomationRuns");
  if (denied) return denied;
  let body: { kind?: unknown; startedAt?: unknown; finishedAt?: unknown; ticketsCount?: unknown; costUsd?: unknown; result?: unknown; details?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.kind !== "analyst" && body.kind !== "night") return NextResponse.json({ error: "kind must be analyst or night." }, { status: 400 });
  const adminClient = createAdminClient();
  const { error } = await adminClient.from("automation_runs").insert({
    kind: body.kind,
    started_at: typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString(),
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
