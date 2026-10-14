import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { MAX_BATCH_TICKETS, renderBatchDoneEmail, renderBatchProposalEmail, renderBatchReadyEmail, type BatchTicket } from "@/lib/daily-batch";
import { syncActiveBatch } from "@/lib/daily-batch-progress";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { DAFFY_PUBLIC_URL } from "@/lib/welcome-email";

export const dynamic = "force-dynamic";

/**
 * The bridge's side of the daily batch. action "create": the 16:00 triage's picks become a proposed batch (an older one
 * the admin never approved expires), and the approval email is returned for n8n to send. Every pick is checked again here:
 * still open or reopened, not in automation, at most MAX_BATCH_TICKETS.
 */
type Pick = { ticketSeq?: unknown; reason?: unknown; needsMigration?: unknown };

export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminBatches");
  if (denied) return denied;
  let body: { action?: unknown; picks?: unknown; scannedCount?: unknown; costUsd?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const admin = createAdminClient();
  const appUrl = (process.env.RESET_LINK_BASE_URL || DAFFY_PUBLIC_URL).replace(/\/+$/, "");
  if (body.action === "sync") {
    // After the night run or a promotion: bring the batch up to date; when it just became ready or done, hand back the email.
    const synced = await syncActiveBatch(admin);
    const email = synced.batch && synced.becameReady ? renderBatchReadyEmail(synced.batch, appUrl) : synced.batch && synced.becameDone ? renderBatchDoneEmail(synced.batch, appUrl) : null;
    return NextResponse.json(
      { status: synced.batch?.status ?? null, ...(email ? { emailSubject: email.subject, emailBody: email.html, emailText: email.text } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (body.action !== "create") return NextResponse.json({ error: "action must be create or sync." }, { status: 400 });

  const picks = (Array.isArray(body.picks) ? (body.picks as Pick[]) : []).filter((pick) => Number.isInteger(Number(pick.ticketSeq)) && typeof pick.reason === "string" && pick.reason.trim());
  const seqs = [...new Set(picks.map((pick) => Number(pick.ticketSeq)))].slice(0, MAX_BATCH_TICKETS);
  const { data: rows } = seqs.length
    ? await admin.from("tickets").select("id, ticket_seq, subject, status, auto_handle").in("ticket_seq", seqs)
    : { data: [] as { id: string; ticket_seq: number; subject: string; status: string; auto_handle: string | null }[] };
  const eligible = new Map(((rows ?? []) as { id: string; ticket_seq: number; subject: string; status: string; auto_handle: string | null }[]).filter((t) => ["open", "reopened"].includes(t.status) && !t.auto_handle).map((t) => [t.ticket_seq, t]));
  const tickets: BatchTicket[] = seqs
    .filter((seq) => eligible.has(seq))
    .map((seq) => {
      const ticket = eligible.get(seq)!;
      const pick = picks.find((p) => Number(p.ticketSeq) === seq)!;
      return { ticketId: ticket.id, seq, subject: ticket.subject, reason: String(pick.reason).trim().slice(0, 240), needsMigration: pick.needsMigration === true, state: "proposed" };
    });

  // The previous proposal the admin never approved is replaced by today's.
  await admin.from("automation_batches").update({ status: "expired", closed_at: new Date().toISOString(), note: "Not approved before the next scan." }).eq("status", "proposed");
  if (tickets.length === 0) return NextResponse.json({ batchId: null, reason: "Nothing clear and small today." }, { headers: { "Cache-Control": "no-store" } });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const { data: created, error } = await admin
    .from("automation_batches")
    .insert({ batch_date: today, status: "proposed", tickets, scanned_count: Math.max(tickets.length, Number(body.scannedCount) || 0), triage_cost_usd: Number(body.costUsd) || null })
    .select("id, batch_date, tickets, scanned_count")
    .single();
  if (error || !created) {
    // The unique index refuses a second active batch: one is still approved or in progress.
    logServerError("adminBatches", "create_failed", { error: error?.message });
    return NextResponse.json({ batchId: null, reason: "Another batch is still in progress." }, { status: 409 });
  }
  // The link points at the app that sent it (dev: the laptop, see RESET_LINK_BASE_URL; otherwise production).
  const email = renderBatchProposalEmail(created as { batch_date: string; tickets: BatchTicket[]; scanned_count: number }, appUrl);
  return NextResponse.json({ batchId: created.id, emailSubject: email.subject, emailBody: email.html, emailText: email.text }, { headers: { "Cache-Control": "no-store" } });
}
