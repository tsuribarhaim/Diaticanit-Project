import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildWorkOrder, planCandidates, recordWorkOrderOutcome } from "@/lib/work-order";

export const dynamic = "force-dynamic";

/**
 * The bridge's side of the night planner (lib/work-order.ts), after the analyst and when the night run starts:
 *   action "candidates": what each queued ticket will change and since when (the bridge then asks git what changed since)
 *   action "plan":       { plannedBy, budgetUsd, baseRef, stale, nextMigration } -> builds and saves the work order
 *   action "outcome":    after the night run -> what became of every job, and the night's success rate
 */
export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminWorkOrder");
  if (denied) return denied;
  let body: { action?: unknown; plannedBy?: unknown; budgetUsd?: unknown; baseRef?: unknown; stale?: unknown; nextMigration?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const admin = createAdminClient();
  const headers = { "Cache-Control": "no-store" };
  try {
    if (body.action === "candidates") return NextResponse.json({ candidates: await planCandidates(admin) }, { headers });
    if (body.action === "plan") {
      const stale: Record<string, string[]> = {};
      if (body.stale && typeof body.stale === "object") {
        for (const [id, files] of Object.entries(body.stale as Record<string, unknown>)) if (Array.isArray(files)) stale[id] = files.filter((f): f is string => typeof f === "string");
      }
      const order = await buildWorkOrder(admin, {
        plannedBy: body.plannedBy === "night" ? "night" : "analyst",
        budgetUsd: Number(body.budgetUsd) > 0 ? Number(body.budgetUsd) : 20,
        baseRef: typeof body.baseRef === "string" ? body.baseRef.slice(0, 80) : null,
        stale,
        nextMigration: Number.isInteger(Number(body.nextMigration)) && Number(body.nextMigration) > 0 ? Number(body.nextMigration) : null,
      });
      return NextResponse.json({ workOrder: { id: order.id, jobs: order.jobs.length, deferred: order.deferred.length, estimateUsd: order.estimate_usd, successEstimate: order.success_estimate } }, { headers });
    }
    if (body.action === "outcome") {
      const order = await recordWorkOrderOutcome(admin);
      return NextResponse.json({ workOrder: order ? { id: order.id, successRate: order.success_rate } : null }, { headers });
    }
  } catch (err) {
    logServerError("adminWorkOrder", "failed", { action: String(body.action), error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "The work order could not be built." }, { status: 500 });
  }
  return NextResponse.json({ error: "action must be candidates, plan or outcome." }, { status: 400 });
}
