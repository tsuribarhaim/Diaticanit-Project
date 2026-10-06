import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * "Run analysis now" and "Merge to dev" are clicked in the hosted app but must run on the
 * admin's laptop. The click leaves a row in automation_requests; the n8n poller on the laptop
 * reads the unclaimed ones here (GET), claims each one before acting (POST action "claim"), and
 * reports the outcome (POST action "complete", with a short result text the admin sees).
 */
export async function GET(request: Request) {
  const denied = checkAutomationSecret(request, "adminAutomationRequests");
  if (denied) return denied;

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("automation_requests")
    .select("id, kind, ticket_id, requested_at, tickets(ticket_seq)")
    .is("picked_at", null)
    .is("completed_at", null)
    .order("requested_at", { ascending: true })
    .limit(20);
  if (error) {
    logServerError("adminAutomationRequests", "query_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to load requests." }, { status: 500 });
  }
  const requests = (data ?? []).map((row) => {
    const joined = row.tickets as { ticket_seq?: number } | { ticket_seq?: number }[] | null;
    const ticketSeq = Array.isArray(joined) ? joined[0]?.ticket_seq : joined?.ticket_seq;
    return { id: row.id, kind: row.kind, ticketId: row.ticket_id, ticketSeq: ticketSeq ?? null, requestedAt: row.requested_at };
  });
  return NextResponse.json({ requests }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminAutomationRequests");
  if (denied) return denied;

  let body: { id?: unknown; action?: unknown; result?: unknown; ok?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { id, action, result, ok } = body;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  if (action !== "claim" && action !== "complete") {
    return NextResponse.json({ error: "action must be claim or complete." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  if (action === "claim") {
    // Only one poller can win: the update only matches a row nobody claimed yet.
    const { data, error } = await adminClient
      .from("automation_requests")
      .update({ picked_at: now })
      .eq("id", id)
      .is("picked_at", null)
      .select("id");
    if (error) {
      logServerError("adminAutomationRequests", "claim_failed", { id, error: error.message });
      return NextResponse.json({ error: "Failed to claim." }, { status: 500 });
    }
    return NextResponse.json({ claimed: (data ?? []).length === 1 }, { headers: { "Cache-Control": "no-store" } });
  }

  const { error } = await adminClient
    .from("automation_requests")
    .update({ completed_at: now, result: typeof result === "string" ? result.slice(0, 2000) : null })
    .eq("id", id);
  if (error) {
    logServerError("adminAutomationRequests", "complete_failed", { id, error: error.message });
    return NextResponse.json({ error: "Failed to complete." }, { status: 500 });
  }

  // A merge that went through: the ticket's fix card now reads "Merged on dev".
  if (ok === true) {
    const { data: done } = await adminClient.from("automation_requests").select("kind, ticket_id").eq("id", id).maybeSingle();
    if (done?.kind === "merge" && done.ticket_id) {
      await adminClient
        .from("ticket_proposals")
        .update({ status: "merged", decided_at: now })
        .eq("ticket_id", done.ticket_id)
        .eq("kind", "fix")
        .eq("status", "pending");
    }
  }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
