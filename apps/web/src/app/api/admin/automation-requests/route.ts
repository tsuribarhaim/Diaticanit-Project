import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderPromotionEmail, type PromoteReport } from "@/lib/promotion-email";
import { appendTicketDescriptionEntry } from "@/lib/tickets";
import { bundleOfTicket } from "@/lib/bundles";
import { renderWelcomeEmail } from "@/lib/welcome-email";

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
    .select("id, kind, ticket_id, requested_at, details, tickets(ticket_seq)")
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
    return { id: row.id, kind: row.kind, ticketId: row.ticket_id, ticketSeq: ticketSeq ?? null, requestedAt: row.requested_at, details: row.details ?? {} };
  });
  return NextResponse.json({ requests }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminAutomationRequests");
  if (denied) return denied;

  let body: { id?: unknown; action?: unknown; result?: unknown; ok?: unknown; report?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { id, action, result, ok, report } = body;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  if (action !== "claim" && action !== "complete" && action !== "email" && action !== "recipients" && action !== "invite_email") {
    return NextResponse.json({ error: "action must be claim, complete, email, invite_email or recipients." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  if (action === "recipients") {
    // Who gets the e-mails the automation sends about its own work: every admin.
    const { data: admins } = await adminClient.from("user_profile").select("user_id").eq("is_admin", true);
    const adminEmails = (
      await Promise.all(((admins ?? []) as { user_id: string }[]).map(async (admin) => (await adminClient.auth.admin.getUserById(admin.user_id)).data.user?.email ?? null))
    ).filter((email): email is string => Boolean(email));
    return NextResponse.json({ adminEmails }, { headers: { "Cache-Control": "no-store" } });
  }
  if (action === "invite_email") {
    // The welcome email for an "Add new user" request: the poller's "Welcome Invite" workflow sends what this returns.
    const { data: row } = await adminClient.from("automation_requests").select("kind, details").eq("id", id).maybeSingle();
    const details = (row?.details ?? {}) as { email?: unknown; language?: unknown };
    if (!row || row.kind !== "invite" || typeof details.email !== "string" || !details.email) {
      return NextResponse.json({ error: "Not an invite request." }, { status: 404 });
    }
    const email = renderWelcomeEmail({ email: details.email, language: details.language === "en" ? "en" : "he" });
    return NextResponse.json({ to: details.email, subject: email.subject, html: email.html }, { headers: { "Cache-Control": "no-store" } });
  }
  if (action === "email") {
    // The confirmation email for a finished promote request: the poller sends what this returns.
    const { data: row } = await adminClient.from("automation_requests").select("kind, requested_at, result, details").eq("id", id).maybeSingle();
    if (!row || row.kind !== "promote") return NextResponse.json({ error: "Not a promote request." }, { status: 404 });
    const report = ((row.details ?? {}) as { report?: PromoteReport }).report ?? null;
    const { data: admins } = await adminClient.from("user_profile").select("user_id").eq("is_admin", true);
    const adminEmails = (
      await Promise.all(((admins ?? []) as { user_id: string }[]).map(async (admin) => (await adminClient.auth.admin.getUserById(admin.user_id)).data.user?.email ?? null))
    ).filter((email): email is string => Boolean(email));
    const email = renderPromotionEmail({ report, requestedAt: row.requested_at, resultText: row.result, publicUrl: "https://daffy-pilot.vercel.app" });
    return NextResponse.json({ subject: email.subject, html: email.html, adminEmails }, { headers: { "Cache-Control": "no-store" } });
  }
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

  if (ok === true) {
    const { data: done } = await adminClient.from("automation_requests").select("kind, ticket_id, details").eq("id", id).maybeSingle();
    // A merge that went through: the fix is on dev and waits for the admin's test (flag M).
    // The request is on the lead ticket (the bundle's branch); every ticket of a bundle is on dev with it.
    const bundle = done?.ticket_id ? await bundleOfTicket(adminClient, done.ticket_id) : null;
    const groupIds = bundle ? bundle.members.map((member) => member.id) : done?.ticket_id ? [done.ticket_id] : [];
    if (done?.kind === "merge" && done.ticket_id) {
      await adminClient
        .from("ticket_proposals")
        .update({ status: "merged", decided_at: now })
        .in("ticket_id", groupIds)
        .eq("kind", "fix")
        .eq("status", "pending");
      await adminClient.from("tickets").update({ auto_handle: "M" }).in("id", groupIds).eq("auto_handle", "D");
    }
    // A revert that went through ("Send back"): the merge is undone on dev, so the ticket goes back to
    // the night run with the admin's comment in its log (where the agent reads decisions from).
    if (done?.kind === "revert" && done.ticket_id && (done.details as { split?: boolean } | null)?.split !== true) {
      // (A split bundle was already put back in the queue, ticket by ticket, when it was split: only its merge on dev was left to undo.)
      const details = (done.details ?? {}) as { comment?: string };
      for (const ticketId of groupIds) {
        const { data: ticket } = await adminClient.from("tickets").select("description, created_by, ticket_seq").eq("id", ticketId).maybeSingle();
        if (!ticket) continue;
        const together = bundle ? `; it was built together with ${bundle.members.filter((member) => member.id !== ticketId).map((member) => `TCK-${member.seq}`).join(", ")} as Bundle ${bundle.letter} and is rebuilt together` : "";
        const note = `Admin sent the fix back after testing it on dev (the merge was reverted, a fresh attempt is needed${together}). What needs to change: ${details.comment ?? "(no comment)"}`;
        await adminClient
          .from("tickets")
          .update({
            description: appendTicketDescriptionEntry({ currentDescription: ticket.description ?? "", changeLines: [], note, authoredBySupport: true }),
            auto_handle: "Y",
            status: "open",
          })
          .eq("id", ticketId);
      }
      await adminClient
        .from("ticket_proposals")
        .update({ status: "returned", admin_comment: details.comment ?? null, decided_at: now })
        .in("ticket_id", groupIds)
        .eq("kind", "fix")
        .in("status", ["merged", "approved"]);
    }
  }
  // A promote reports itself in `report` (see the bridge's /promote): stored on the request for the
  // confirmation email and the review screen.
  if (report && typeof report === "object") {
    const { data: current } = await adminClient.from("automation_requests").select("details").eq("id", id).maybeSingle();
    await adminClient.from("automation_requests").update({ details: { ...((current?.details as object | null) ?? {}), report } }).eq("id", id);
  }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
