import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const KINDS = ["proposal", "questions", "fix"] as const;
type Kind = (typeof KINDS)[number];

/**
 * The bridge reports what it hands over to the admin: the analyst's proposal, the night run's
 * questions, or a committed fix (see db/migrations/065_phase22_ticket_proposals.sql). Inserts a
 * new versioned row and marks any older still-pending row of the same kind as superseded.
 * Only a proposal moves the ticket's flag itself (to 'A'); for questions and fixes the bridge
 * keeps using /auto-handle-result for the flag, notes and status, exactly as before.
 */
export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminProposalResult");
  if (denied) return denied;

  let body: { ticketId?: unknown; kind?: unknown; payload?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { ticketId, kind, payload, status } = body;
  // A fix the night run already merged into dev (gated auto-merge) is stored as "merged" and flags the ticket M.
  const mergedFix = kind === "fix" && status === "merged";
  if (typeof ticketId !== "string" || !ticketId) {
    return NextResponse.json({ error: "ticketId is required." }, { status: 400 });
  }
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${KINDS.join(", ")}` }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "payload must be an object." }, { status: 400 });
  }
  // Mockup HTML and screenshots are the only large parts - keep one row comfortably small.
  if (JSON.stringify(payload).length > 1_500_000) {
    return NextResponse.json({ error: "payload is too large." }, { status: 413 });
  }

  const adminClient = createAdminClient();
  const { data: latest } = await adminClient
    .from("ticket_proposals")
    .select("version")
    .eq("ticket_id", ticketId)
    .eq("kind", kind as Kind)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (latest?.version ?? 0) + 1;

  await adminClient
    .from("ticket_proposals")
    .update({ status: "superseded" })
    .eq("ticket_id", ticketId)
    .eq("kind", kind as Kind)
    .eq("status", "pending");

  const { data: inserted, error } = await adminClient
    .from("ticket_proposals")
    .insert({ ticket_id: ticketId, kind, version, status: mergedFix ? "merged" : "pending", payload })
    .select("id")
    .single();
  if (error || !inserted) {
    logServerError("adminProposalResult", "insert_failed", { ticketId, kind, error: error?.message });
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }

  if (mergedFix) {
    const { error: flagError } = await adminClient.from("tickets").update({ auto_handle: "M" }).eq("id", ticketId);
    if (flagError) {
      logServerError("adminProposalResult", "flag_update_failed", { ticketId, error: flagError.message });
      return NextResponse.json({ error: "Saved, but the ticket flag could not be updated." }, { status: 500 });
    }
  }

  if (kind === "proposal") {
    const { error: flagError } = await adminClient.from("tickets").update({ auto_handle: "A" }).eq("id", ticketId);
    if (flagError) {
      logServerError("adminProposalResult", "flag_update_failed", { ticketId, error: flagError.message });
      return NextResponse.json({ error: "Saved, but the ticket flag could not be updated." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, id: inserted.id, version }, { headers: { "Cache-Control": "no-store" } });
}
