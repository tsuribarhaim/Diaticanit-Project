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
  return { success: tr(locale, `Answers saved in the ticket. TCK-${loaded.ticket.ticket_seq} runs again tonight.`, `התשובות נשמרו בפנייה. TCK-${loaded.ticket.ticket_seq} תרוץ שוב הלילה.`) };
}

export async function takeOutOfAutomation(supabase: Client, adminId: string, locale: AppLocale, proposalId: string): Promise<ReviewResult> {
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded) return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const { error } = await supabase.from("tickets").update({ auto_handle: null }).eq("id", loaded.ticket.id);
  if (error) return dbError(locale);
  await decide(supabase, proposalId, adminId, "taken_out", null, null);
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
  return {
    success: tr(
      locale,
      `Promotion requested for ${items.length} fix${items.length === 1 ? "" : "es"}. A confirmation email follows when it ends.`,
      `התבקשה העלאה לייצור של ${items.length} תיקונים. מייל אישור יישלח בסיומה.`,
    ),
  };
}
