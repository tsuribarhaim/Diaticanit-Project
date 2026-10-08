import type { createClient } from "@/lib/supabase/server";
import { tr, type AppLocale } from "@/lib/locale";
import {
  buildAnswersEntry,
  buildApprovedSpecEntry,
  type FixPayload,
  type ProposalPayload,
  type QuestionsPayload,
  type TicketProposalRow,
} from "@/lib/ticket-proposals";
import { appendTicketDescriptionEntry } from "@/lib/tickets";

/** The server-side steps behind every button on the review screens (see
 * app/app/tickets/review-actions.ts, which wraps them as server actions, and
 * updateTicketAutoHandleAdminAction, which reuses approve for the dropdown's A -> Y).
 * All of them run with the ADMIN's own session: RLS (tickets_update_admin,
 * ticket_proposals_update_admin) is what actually enforces who may do this. */

type Client = Awaited<ReturnType<typeof createClient>>;
export type ReviewResult = { error?: string; success?: string };

type TicketBits = { id: string; ticket_seq: number; description: string | null; status: string; created_by: string };

async function loadProposal(supabase: Client, proposalId: string): Promise<{ proposal: TicketProposalRow; ticket: TicketBits } | null> {
  const { data: proposal } = await supabase.from("ticket_proposals").select("*").eq("id", proposalId).maybeSingle();
  if (!proposal) return null;
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, ticket_seq, description, status, created_by")
    .eq("id", (proposal as TicketProposalRow).ticket_id)
    .maybeSingle();
  if (!ticket) return null;
  return { proposal: proposal as TicketProposalRow, ticket: ticket as TicketBits };
}

function supportEntry(ticket: TicketBits, adminId: string, note: string): string {
  return appendTicketDescriptionEntry({
    currentDescription: ticket.description ?? "",
    changeLines: [],
    note,
    authoredBySupport: ticket.created_by !== adminId,
  });
}

function notFound(locale: AppLocale): ReviewResult {
  return { error: tr(locale, "That proposal no longer exists.", "ההצעה כבר לא קיימת.") };
}
function alreadyDecided(locale: AppLocale): ReviewResult {
  return { error: tr(locale, "This was already decided - refresh the page.", "כבר התקבלה החלטה - יש לרענן את הדף.") };
}
function dbError(locale: AppLocale): ReviewResult {
  return { error: tr(locale, "Could not save. Please try again.", "לא ניתן היה לשמור. יש לנסות שוב.") };
}

/** Every correction the admin makes is a chance for the agents to learn. This only leaves a request; the laptop
 * distils it into a lesson (or decides there is none), stores it and e-mails the admin what happened. Never blocks the action itself. */
async function queueLearning(
  supabase: Client,
  adminId: string,
  ticket: { id: string; ticket_seq: number },
  source: "send_back" | "return_fix" | "change_request",
  comment: string,
  context: string,
): Promise<void> {
  try {
    await supabase.from("automation_requests").insert({
      kind: "learn",
      ticket_id: ticket.id,
      requested_by: adminId,
      details: { ticketSeq: ticket.ticket_seq, source, comment: comment.slice(0, 2000), context: context.slice(0, 1500) },
    });
  } catch {
    /* learning is a bonus - the correction itself must still go through */
  }
}

/** The audit trail of the admin's sign-offs and hand-offs (automation_events): who did what to which ticket, and when.
 * It feeds the "You approved the spec - 5 Oct" chips on the Ticket Automation dashboard. Never blocks the action itself. */
export async function logAutomationEvent(supabase: Client, adminId: string, ticketId: string, kind: string, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await supabase.from("automation_events").insert({ ticket_id: ticketId, kind, actor: adminId, detail });
  } catch {
    /* the trail is a record, not a gate */
  }
}

/** Takes any ticket out of automation (from any station), whatever is pending on it. */
export async function takeTicketOut(supabase: Client, adminId: string, locale: AppLocale, ticketId: string): Promise<ReviewResult> {
  const { data: ticket } = await supabase.from("tickets").select("id, ticket_seq").eq("id", ticketId).maybeSingle();
  if (!ticket) return notFound(locale);
  const { error } = await supabase.from("tickets").update({ auto_handle: null }).eq("id", ticketId);
  if (error) return dbError(locale);
  await supabase.from("ticket_proposals").update({ status: "taken_out", decided_at: new Date().toISOString(), decided_by: adminId }).eq("ticket_id", ticketId).eq("status", "pending");
  await logAutomationEvent(supabase, adminId, ticketId, "taken_out");
  return { success: tr(locale, `TCK-${ticket.ticket_seq} is out of automation. It stays open for you.`, `TCK-${ticket.ticket_seq} יצאה מהאוטומציה. היא נשארת פתוחה עבורך.`) };
}

async function decide(
  supabase: Client,
  proposalId: string,
  adminId: string,
  status: TicketProposalRow["status"],
  chosen: Record<string, number> | null,
  comment: string | null,
) {
  return supabase
    .from("ticket_proposals")
    .update({ status, chosen, admin_comment: comment, decided_at: new Date().toISOString(), decided_by: adminId })
    .eq("id", proposalId)
    .eq("status", "pending");
}

export async function approveProposal(
  supabase: Client,
  adminId: string,
  locale: AppLocale,
  proposalId: string,
  chosen: Record<string, number> | null,
  comment: string | null,
): Promise<ReviewResult> {
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded || loaded.proposal.kind !== "proposal") return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const payload = loaded.proposal.payload as ProposalPayload;
  const entry = buildApprovedSpecEntry({ decisions: payload.decisions ?? [], chosen, brief: payload.brief ?? "", comment });
  const patch: Record<string, unknown> = { description: supportEntry(loaded.ticket, adminId, entry), auto_handle: "Y" };
  if (loaded.ticket.status === "in_progress") patch.status = "open";
  const { error } = await supabase.from("tickets").update(patch).eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await decide(supabase, proposalId, adminId, "approved", chosen, comment);
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "spec_approved");
  return { success: tr(locale, `TCK-${loaded.ticket.ticket_seq} approved and queued for the night run.`, `פנייה TCK-${loaded.ticket.ticket_seq} אושרה ונכנסה לתור של ריצת הלילה.`) };
}

export async function requestChange(
  supabase: Client,
  adminId: string,
  locale: AppLocale,
  proposalId: string,
  chosen: Record<string, number> | null,
  comment: string,
): Promise<ReviewResult> {
  if (!comment.trim()) return { error: tr(locale, "Add a comment: the analyst needs to know what to change.", "יש להוסיף הערה: האנליסט צריך לדעת מה לשנות.") };
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded || loaded.proposal.kind !== "proposal") return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const { error } = await supabase.from("tickets").update({ auto_handle: "S" }).eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await decide(supabase, proposalId, adminId, "changes_requested", chosen, comment.trim());
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "change_requested");
  await queueLearning(supabase, adminId, loaded.ticket, "change_request", comment.trim(), (loaded.proposal.payload as ProposalPayload).summary ?? "");
  return { success: tr(locale, "Sent back to the analyst with your comment. A new version appears after the next analysis run.", "הוחזר לאנליסט עם ההערה שלך. גרסה חדשה תופיע אחרי ריצת הניתוח הבאה.") };
}

export async function rejectProposal(supabase: Client, adminId: string, locale: AppLocale, proposalId: string, comment: string): Promise<ReviewResult> {
  if (!comment.trim()) return { error: tr(locale, "Add the reason: it is saved on the ticket.", "יש להוסיף סיבה: היא נשמרת בפנייה.") };
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded || loaded.proposal.kind !== "proposal") return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const { error } = await supabase
    .from("tickets")
    .update({ auto_handle: null, status: "deferred", deferred_reason: comment.trim() })
    .eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await decide(supabase, proposalId, adminId, "rejected", null, comment.trim());
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "rejected");
  return { success: tr(locale, `TCK-${loaded.ticket.ticket_seq} deferred with your reason.`, `פנייה TCK-${loaded.ticket.ticket_seq} נדחתה עם הסיבה שלך.`) };
}

export async function answerQuestions(
  supabase: Client,
  adminId: string,
  locale: AppLocale,
  proposalId: string,
  chosen: Record<string, number>,
  comment: string | null,
): Promise<ReviewResult> {
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded || loaded.proposal.kind !== "questions") return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const payload = loaded.proposal.payload as QuestionsPayload;
  const questions = payload.questions ?? [];
  if (questions.some((_, index) => typeof chosen[String(index)] !== "number")) {
    return { error: tr(locale, "Answer every question first.", "יש לענות על כל השאלות קודם.") };
  }
  const entry = buildAnswersEntry({ questions, chosen, comment });
  const patch: Record<string, unknown> = { description: supportEntry(loaded.ticket, adminId, entry), auto_handle: "Y" };
  if (loaded.ticket.status === "in_progress") patch.status = "open";
  const { error } = await supabase.from("tickets").update(patch).eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await decide(supabase, proposalId, adminId, "answered", chosen, comment);
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "answered");
  return { success: tr(locale, `Answers saved in the ticket. TCK-${loaded.ticket.ticket_seq} runs again tonight.`, `התשובות נשמרו בפנייה. TCK-${loaded.ticket.ticket_seq} תרוץ שוב הלילה.`) };
}

export async function takeOutOfAutomation(supabase: Client, adminId: string, locale: AppLocale, proposalId: string): Promise<ReviewResult> {
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded) return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const { error } = await supabase.from("tickets").update({ auto_handle: null }).eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await decide(supabase, proposalId, adminId, "taken_out", null, null);
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "taken_out");
  return { success: tr(locale, `TCK-${loaded.ticket.ticket_seq} is out of automation. It stays open for you.`, `TCK-${loaded.ticket.ticket_seq} יצאה מהאוטומציה. היא נשארת פתוחה עבורך.`) };
}

export async function returnFix(supabase: Client, adminId: string, locale: AppLocale, proposalId: string, comment: string): Promise<ReviewResult> {
  if (!comment.trim()) return { error: tr(locale, "Say what is wrong so the next run can fix it.", "יש לכתוב מה לא תקין כדי שהריצה הבאה תתקן.") };
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded || loaded.proposal.kind !== "fix") return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const fix = loaded.proposal.payload as FixPayload;
  const entry = `Admin returned the fix on branch ${fix.branch} for another try. What needs to change: ${comment.trim()}`;
  const patch: Record<string, unknown> = { description: supportEntry(loaded.ticket, adminId, entry), auto_handle: "Y", status: "open" };
  const { error } = await supabase.from("tickets").update(patch).eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await decide(supabase, proposalId, adminId, "returned", null, comment.trim());
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "returned");
  await queueLearning(supabase, adminId, loaded.ticket, "return_fix", comment.trim(), fix.summary ?? "");
  return { success: tr(locale, "Returned to the night run with your comment.", "הוחזר לריצת הלילה עם ההערה שלך.") };
}

/** "Run analysis now" - leaves a request the laptop's poller picks up within a few minutes. */
export async function requestAnalysis(supabase: Client, adminId: string, locale: AppLocale): Promise<ReviewResult> {
  const { data: pending } = await supabase.from("automation_requests").select("id").eq("kind", "analyze").is("completed_at", null).limit(1);
  if ((pending ?? []).length > 0) {
    return { success: tr(locale, "An analysis is already requested or running.", "ניתוח כבר התבקש או רץ כעת.") };
  }
  const { error } = await supabase.from("automation_requests").insert({ kind: "analyze", requested_by: adminId });
  if (error) return dbError(locale);
  return { success: tr(locale, "Requested. It starts within a few minutes while your laptop is on.", "התבקש. הוא יתחיל תוך כמה דקות כל עוד המחשב הנייד דלוק.") };
}

/** "Merge to dev" - same hand-off: the branch lives on the laptop, so the laptop does the merge. */
export async function requestMerge(supabase: Client, adminId: string, locale: AppLocale, proposalId: string): Promise<ReviewResult> {
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded || loaded.proposal.kind !== "fix") return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const { data: pending } = await supabase
    .from("automation_requests")
    .select("id")
    .eq("kind", "merge")
    .eq("ticket_id", loaded.ticket.id)
    .is("completed_at", null)
    .limit(1);
  if ((pending ?? []).length > 0) return { success: tr(locale, "A merge is already requested.", "מיזוג כבר התבקש.") };
  const { error } = await supabase.from("automation_requests").insert({ kind: "merge", ticket_id: loaded.ticket.id, requested_by: adminId });
  if (error) return dbError(locale);
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "merge_requested");
  return { success: tr(locale, `Merge queued for TCK-${loaded.ticket.ticket_seq}. It runs within about a minute while your laptop is on.`, `המיזוג של TCK-${loaded.ticket.ticket_seq} נכנס לתור. הוא ירוץ תוך בערך דקה כל עוד המחשב הנייד דלוק.`) };
}

/** The ticket's fix row, in one of the given statuses (a merged-on-dev or approved fix). */
async function loadFix(supabase: Client, proposalId: string, statuses: string[]) {
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded || loaded.proposal.kind !== "fix") return { loaded: null, wrong: false };
  return { loaded, wrong: !statuses.includes(loaded.proposal.status) };
}

/** M -> R: the admin tested the fix on dev and wants it in the next production release. */
export async function approveForProduction(supabase: Client, adminId: string, locale: AppLocale, proposalId: string): Promise<ReviewResult> {
  const { loaded, wrong } = await loadFix(supabase, proposalId, ["merged"]);
  if (!loaded) return notFound(locale);
  if (wrong) return alreadyDecided(locale);
  const { error } = await supabase.from("tickets").update({ auto_handle: "R" }).eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await supabase
    .from("ticket_proposals")
    .update({ status: "approved", decided_at: new Date().toISOString(), decided_by: adminId })
    .eq("id", proposalId)
    .eq("status", "merged");
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "approved_for_production");
  return { success: tr(locale, `TCK-${loaded.ticket.ticket_seq} approved for production. It ships with the next promote.`, `TCK-${loaded.ticket.ticket_seq} אושרה לייצור. היא תעלה עם ההעלאה הבאה.`) };
}

/** R -> M: changed their mind before promoting. */
export async function withdrawApproval(supabase: Client, adminId: string, locale: AppLocale, proposalId: string): Promise<ReviewResult> {
  const { loaded, wrong } = await loadFix(supabase, proposalId, ["approved"]);
  if (!loaded) return notFound(locale);
  if (wrong) return alreadyDecided(locale);
  const { error } = await supabase.from("tickets").update({ auto_handle: "M" }).eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await supabase.from("ticket_proposals").update({ status: "merged", decided_at: null, decided_by: null }).eq("id", proposalId).eq("status", "approved");
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "approval_withdrawn");
  return { success: tr(locale, "Approval withdrawn. The fix is back on dev, waiting for your test.", "האישור בוטל. התיקון חזר לפיתוח וממתין לבדיקה שלך.") };
}

/** "Send back": undo the merge on dev (the laptop does it) and re-queue the ticket with the admin's
 * comment. The ticket only changes once the revert really happened - see the automation-requests route. */
export async function sendBackFix(supabase: Client, adminId: string, locale: AppLocale, proposalId: string, comment: string): Promise<ReviewResult> {
  if (!comment.trim()) return { error: tr(locale, "Say what is wrong so the next run can fix it.", "יש לכתוב מה לא תקין כדי שהריצה הבאה תתקן.") };
  const { loaded, wrong } = await loadFix(supabase, proposalId, ["merged", "approved"]);
  if (!loaded) return notFound(locale);
  if (wrong) return alreadyDecided(locale);
  const { data: pending } = await supabase
    .from("automation_requests")
    .select("id")
    .eq("kind", "revert")
    .eq("ticket_id", loaded.ticket.id)
    .is("completed_at", null)
    .limit(1);
  if ((pending ?? []).length > 0) return { success: tr(locale, "A revert is already requested.", "ביטול מיזוג כבר התבקש.") };
  const { error } = await supabase
    .from("automation_requests")
    .insert({ kind: "revert", ticket_id: loaded.ticket.id, requested_by: adminId, details: { comment: comment.trim(), proposalId } });
  if (error) return dbError(locale);
  await logAutomationEvent(supabase, adminId, loaded.ticket.id, "sent_back");
  await queueLearning(supabase, adminId, loaded.ticket, "send_back", comment.trim(), (loaded.proposal.payload as FixPayload).summary ?? "");
  return {
    success: tr(
      locale,
      `Revert queued for TCK-${loaded.ticket.ticket_seq}. It is undone on dev within about a minute, then goes back to the night run with your comment.`,
      `ביטול המיזוג של TCK-${loaded.ticket.ticket_seq} נכנס לתור. הוא יבוטל בפיתוח תוך בערך דקה ואז יחזור לריצת הלילה עם ההערה שלך.`,
    ),
  };
}

/** "Promote to production": one request covering every fix approved right now. Fire and forget - the
 * laptop does the work and a confirmation email reports the outcome. */
export async function requestPromote(supabase: Client, adminId: string, locale: AppLocale, proposalIds?: string[]): Promise<ReviewResult> {
  const { data: open } = await supabase.from("automation_requests").select("id").eq("kind", "promote").is("completed_at", null).limit(1);
  if ((open ?? []).length > 0) return { success: tr(locale, "A promotion is already requested or running.", "העלאה לייצור כבר התבקשה או רצה כעת.") };
  const { data: approved } = await supabase
    .from("ticket_proposals")
    .select("id, ticket_id, payload, tickets!inner(ticket_seq, subject, auto_handle)")
    .eq("kind", "fix")
    .eq("status", "approved");
  const items = (approved ?? [])
    .map((row) => {
      const joined = row.tickets as unknown as { ticket_seq: number; subject: string; auto_handle: string | null } | { ticket_seq: number; subject: string; auto_handle: string | null }[];
      const ticket = Array.isArray(joined) ? joined[0] : joined;
      return ticket && ticket.auto_handle === "R"
        ? { proposalId: row.id as string, ticketId: row.ticket_id as string, ticketSeq: ticket.ticket_seq, subject: ticket.subject, branch: (row.payload as FixPayload).branch }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    // The admin may untick fixes in the dialog; with no list at all, everything approved ships.
    .filter((item) => !proposalIds || proposalIds.includes(item.proposalId));
  if (items.length === 0) return { error: tr(locale, "No fix is approved for production yet.", "אין עדיין תיקון שאושר לייצור.") };
  const { error } = await supabase.from("automation_requests").insert({ kind: "promote", requested_by: adminId, details: { tickets: items } });
  if (error) return dbError(locale);
  for (const item of items) await logAutomationEvent(supabase, adminId, item.ticketId, "promote_requested");
  return {
    success: tr(
      locale,
      `Promotion requested for ${items.length} fix${items.length === 1 ? "" : "es"}. A confirmation email follows when it ends.`,
      `התבקשה העלאה לייצור של ${items.length} תיקונים. מייל אישור יישלח בסיומה.`,
    ),
  };
}

export type AgentRunKind = "analyze" | "night" | "digest";

/** The dashboard's "run it now" buttons: leave a request the laptop's poller picks up within a minute (it starts the same
 * workflow the schedule uses). Refused while automation is paused; a second press while one is waiting does nothing. */
export async function requestAgentRun(supabase: Client, adminId: string, locale: AppLocale, kind: AgentRunKind): Promise<ReviewResult> {
  if (kind !== "digest") {
    const { data: settings } = await supabase.from("automation_settings").select("paused").eq("id", true).maybeSingle();
    if (settings?.paused) return { error: tr(locale, "Automation is paused - resume it first.", "האוטומציה מושהית - יש לחדש אותה קודם.") };
  }
  const { data: open } = await supabase.from("automation_requests").select("id").eq("kind", kind).is("completed_at", null).limit(1);
  if ((open ?? []).length > 0) return { success: tr(locale, "It is already requested.", "זה כבר התבקש.") };
  // Already started a moment ago, or running now according to the bridge's heartbeat: never start it twice.
  const { data: recent } = await supabase.from("automation_requests").select("id").eq("kind", kind).gte("completed_at", new Date(Date.now() - 2 * 60 * 1000).toISOString()).limit(1);
  if ((recent ?? []).length > 0) return { success: tr(locale, "It was just started - it is running.", "זה הותחל זה עתה - והוא רץ.") };
  if (kind !== "digest") {
    const { data: beat } = await supabase.from("automation_settings").select("bridge_seen_at, bridge_status").eq("id", true).maybeSingle();
    const status = (beat?.bridge_status ?? {}) as { analysisInProgress?: boolean; runInProgress?: boolean };
    const fresh = beat?.bridge_seen_at && Date.now() - new Date(beat.bridge_seen_at as string).getTime() < 3 * 60 * 1000;
    if (fresh && (kind === "analyze" ? status.analysisInProgress : status.runInProgress)) {
      return { error: tr(locale, "It is already running - wait for it to finish.", "זה כבר רץ - יש להמתין לסיומו.") };
    }
  }
  const { error } = await supabase.from("automation_requests").insert({ kind, requested_by: adminId });
  if (error) return dbError(locale);
  const what = kind === "analyze" ? tr(locale, "The analyst", "האנליסט") : kind === "night" ? tr(locale, "The night run", "ריצת הלילה") : tr(locale, "The daily digest", "הסיכום היומי");
  return { success: tr(locale, `${what} starts within about a minute (while your laptop is on). An email follows when it ends.`, `${what} יתחיל תוך כדקה (כל עוד המחשב הנייד דלוק). מייל יישלח בסיומו.`) };
}

/** The Pause switch: stops ONLY the two AI agents (scheduled and manual starts). Your own actions are never blocked. */
export async function setAutomationPaused(supabase: Client, adminId: string, locale: AppLocale, paused: boolean): Promise<ReviewResult> {
  const { error } = await supabase
    .from("automation_settings")
    .update({ paused, paused_by: paused ? adminId : null, paused_at: paused ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return dbError(locale);
  return { success: paused ? tr(locale, "Automation paused: the analyst and the night run will not start until you resume.", "האוטומציה הושהתה: האנליסט וריצת הלילה לא יתחילו עד שתחדש.") : tr(locale, "Automation resumed.", "האוטומציה חודשה.") };
}

/** "I handled this myself": a ticket that was settled outside the automation (a "better done together" one worked through with
 * Claude Code) leaves automation, whatever is pending on it, and - if the admin says so - is marked resolved. */
export async function handledByHand(supabase: Client, adminId: string, locale: AppLocale, ticketId: string, resolve: boolean, note: string): Promise<ReviewResult> {
  const { data: ticket } = await supabase.from("tickets").select("id, ticket_seq, fix_description").eq("id", ticketId).maybeSingle();
  if (!ticket) return notFound(locale);
  const patch: Record<string, unknown> = { auto_handle: null };
  if (resolve) {
    patch.status = "resolved";
    patch.resolved_at = new Date().toISOString();
    if (!ticket.fix_description) patch.fix_description = note.trim() || "Handled together with Claude Code.";
  }
  const { error } = await supabase.from("tickets").update(patch).eq("id", ticketId);
  if (error) return dbError(locale);
  await supabase.from("ticket_proposals").update({ status: "taken_out", decided_at: new Date().toISOString(), decided_by: adminId }).eq("ticket_id", ticketId).eq("status", "pending");
  await logAutomationEvent(supabase, adminId, ticketId, "handled_by_hand", { resolved: resolve });
  return {
    success: resolve
      ? tr(locale, `TCK-${ticket.ticket_seq} is out of automation and marked resolved.`, `TCK-${ticket.ticket_seq} יצאה מהאוטומציה וסומנה כנפתרה.`)
      : tr(locale, `TCK-${ticket.ticket_seq} is out of automation. It stays open for you.`, `TCK-${ticket.ticket_seq} יצאה מהאוטומציה. היא נשארת פתוחה עבורך.`),
  };
}
