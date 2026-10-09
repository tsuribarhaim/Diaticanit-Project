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
import { bundleById, bundleIsBuilt, bundleOfTicket, createBundle, dissolveBundle, leaveBundle, type BundleInfo } from "@/lib/bundles";
import { MAX_BUNDLE_SIZE } from "@/lib/overlap";

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

/** A ticket and, when it is in a bundle, the whole bundle (the lead - the lowest ticket - first). A ticket on its own is a group of one. */
async function groupOf(supabase: Client, ticketId: string, seq: number): Promise<{ bundle: BundleInfo | null; members: { id: string; seq: number }[]; lead: { id: string; seq: number } }> {
  const bundle = await bundleOfTicket(supabase, ticketId);
  const members = bundle ? bundle.members.map((member) => ({ id: member.id, seq: member.seq })) : [{ id: ticketId, seq }];
  return { bundle, members, lead: members[0] };
}

const seqList = (members: { seq: number }[]) => members.map((member) => `TCK-${member.seq}`).join(", ");

/** Before a ticket leaves automation: out of a bundle that is not built yet (the bundle shrinks, or dissolves when one ticket is left);
 * refused when the bundle is already built, because the work is shared - split it first. Returns the error, or null when it may go on. */
async function bundleExitGuard(supabase: Client, locale: AppLocale, ticketId: string, seq: number): Promise<ReviewResult | null> {
  const bundle = await bundleOfTicket(supabase, ticketId);
  if (!bundle) return null;
  if (await bundleIsBuilt(supabase, bundle)) {
    return {
      error: tr(
        locale,
        `TCK-${seq} is part of Bundle ${bundle.letter}, which is already built. Split the bundle first (its tickets are then rebuilt as separate fixes), then take this ticket out.`,
        `TCK-${seq} היא חלק מחבילה ${bundle.letter} שכבר נבנתה. יש לפצל קודם את החבילה (הפניות ייבנו מחדש כתיקונים נפרדים) ואז להוציא את הפנייה.`,
      ),
    };
  }
  await leaveBundle(supabase, ticketId);
  return null;
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
  const blocked = await bundleExitGuard(supabase, locale, ticketId, ticket.ticket_seq);
  if (blocked) return blocked;
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
  await leaveBundle(supabase, loaded.ticket.id);
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
  // The night run asked the same question of every ticket of a bundle (it builds them as one job): one answer puts them all back.
  const bundle = await bundleOfTicket(supabase, loaded.ticket.id);
  for (const other of bundle?.members ?? []) {
    if (other.id === loaded.ticket.id || other.autoHandle !== "P") continue;
    await supabase.from("tickets").update({ description: supportEntry({ ...loaded.ticket, id: other.id, description: (await supabase.from("tickets").select("description").eq("id", other.id).maybeSingle()).data?.description ?? "" }, adminId, entry), auto_handle: "Y", status: "open" }).eq("id", other.id);
    await supabase.from("ticket_proposals").update({ status: "answered", decided_at: new Date().toISOString(), decided_by: adminId }).eq("ticket_id", other.id).eq("kind", "questions").eq("status", "pending");
    await logAutomationEvent(supabase, adminId, other.id, "answered");
  }
  return { success: tr(locale, `Answers saved in the ticket. TCK-${loaded.ticket.ticket_seq} runs again tonight.`, `התשובות נשמרו בפנייה. TCK-${loaded.ticket.ticket_seq} תרוץ שוב הלילה.`) };
}

export async function takeOutOfAutomation(supabase: Client, adminId: string, locale: AppLocale, proposalId: string): Promise<ReviewResult> {
  const loaded = await loadProposal(supabase, proposalId);
  if (!loaded) return notFound(locale);
  if (loaded.proposal.status !== "pending") return alreadyDecided(locale);
  const blocked = await bundleExitGuard(supabase, locale, loaded.ticket.id, loaded.ticket.ticket_seq);
  if (blocked) return blocked;
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
  // A bundle goes back as a whole (it is one branch): every ticket in it is queued again, still together.
  const group = await groupOf(supabase, loaded.ticket.id, loaded.ticket.ticket_seq);
  const entry = `Admin returned the fix on branch ${fix.branch} for another try${group.bundle ? ` (it covers ${seqList(group.members)}, built together as Bundle ${group.bundle.letter})` : ""}. What needs to change: ${comment.trim()}`;
  for (const member of group.members) {
    const { data: row } = await supabase.from("tickets").select("id, ticket_seq, description, status, created_by").eq("id", member.id).maybeSingle();
    if (!row) continue;
    const { error } = await supabase.from("tickets").update({ description: supportEntry(row as TicketBits, adminId, entry), auto_handle: "Y", status: "open" }).eq("id", member.id);
    if (error) return dbError(locale);
    await logAutomationEvent(supabase, adminId, member.id, "returned");
  }
  await supabase.from("ticket_proposals").update({ status: "returned", admin_comment: comment.trim(), decided_at: new Date().toISOString(), decided_by: adminId }).eq("kind", "fix").eq("status", "pending").in("ticket_id", group.members.map((member) => member.id));
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
  // A bundle is one branch (the lead's), so one merge covers every ticket in it.
  const group = await groupOf(supabase, loaded.ticket.id, loaded.ticket.ticket_seq);
  const { data: pending } = await supabase
    .from("automation_requests")
    .select("id")
    .eq("kind", "merge")
    .eq("ticket_id", group.lead.id)
    .is("completed_at", null)
    .limit(1);
  if ((pending ?? []).length > 0) return { success: tr(locale, "A merge is already requested.", "מיזוג כבר התבקש.") };
  const { error } = await supabase.from("automation_requests").insert({ kind: "merge", ticket_id: group.lead.id, requested_by: adminId });
  if (error) return dbError(locale);
  for (const member of group.members) await logAutomationEvent(supabase, adminId, member.id, "merge_requested");
  const what = group.bundle ? `Bundle ${group.bundle.letter} (${seqList(group.members)})` : `TCK-${loaded.ticket.ticket_seq}`;
  const whatHe = group.bundle ? `חבילה ${group.bundle.letter} (${seqList(group.members)})` : `TCK-${loaded.ticket.ticket_seq}`;
  return { success: tr(locale, `Merge queued for ${what}. It runs within about a minute while your laptop is on.`, `המיזוג של ${whatHe} נכנס לתור. הוא ירוץ תוך כדקה כל עוד המחשב שלך דלוק.`) };
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
  const group = await groupOf(supabase, loaded.ticket.id, loaded.ticket.ticket_seq);
  const ids = group.members.map((member) => member.id);
  if (group.bundle) {
    // All or nothing: every ticket of the bundle must be on dev.
    const { data: onDev } = await supabase.from("ticket_proposals").select("ticket_id").eq("kind", "fix").eq("status", "merged").in("ticket_id", ids);
    if (new Set((onDev ?? []).map((row) => row.ticket_id as string)).size !== ids.length) {
      return { error: tr(locale, `Every ticket of Bundle ${group.bundle.letter} must be on dev first.`, `כל הפניות של חבילה ${group.bundle.letter} חייבות להיות בפיתוח קודם.`) };
    }
  }
  const { error } = await supabase.from("tickets").update({ auto_handle: "R" }).in("id", ids);
  if (error) return dbError(locale);
  const update = supabase.from("ticket_proposals").update({ status: "approved", decided_at: new Date().toISOString(), decided_by: adminId });
  if (group.bundle) await update.eq("kind", "fix").eq("status", "merged").in("ticket_id", ids);
  else await update.eq("id", proposalId).eq("status", "merged");
  for (const id of ids) await logAutomationEvent(supabase, adminId, id, "approved_for_production");
  const what = group.bundle ? `Bundle ${group.bundle.letter} (${seqList(group.members)}) is` : `TCK-${loaded.ticket.ticket_seq} is`;
  const whatHe = group.bundle ? `חבילה ${group.bundle.letter} (${seqList(group.members)})` : `TCK-${loaded.ticket.ticket_seq}`;
  return { success: tr(locale, `${what} approved for production. It ships with the next promote.`, `${whatHe} אושרה לייצור. היא תעלה בהעלאה הבאה.`) };
}

/** R -> M: changed their mind before promoting. */
export async function withdrawApproval(supabase: Client, adminId: string, locale: AppLocale, proposalId: string): Promise<ReviewResult> {
  const { loaded, wrong } = await loadFix(supabase, proposalId, ["approved"]);
  if (!loaded) return notFound(locale);
  if (wrong) return alreadyDecided(locale);
  const group = await groupOf(supabase, loaded.ticket.id, loaded.ticket.ticket_seq);
  const ids = group.members.map((member) => member.id);
  const { error } = await supabase.from("tickets").update({ auto_handle: "M" }).in("id", ids);
  if (error) return dbError(locale);
  const update = supabase.from("ticket_proposals").update({ status: "merged", decided_at: null, decided_by: null });
  if (group.bundle) await update.eq("kind", "fix").eq("status", "approved").in("ticket_id", ids);
  else await update.eq("id", proposalId).eq("status", "approved");
  for (const id of ids) await logAutomationEvent(supabase, adminId, id, "approval_withdrawn");
  return { success: tr(locale, "Approval withdrawn. The fix is back on dev, waiting for your test.", "האישור בוטל. התיקון חזר לפיתוח וממתין לבדיקה שלך.") };
}

/** "Send back": undo the merge on dev (the laptop does it) and re-queue the ticket with the admin's
 * comment. The ticket only changes once the revert really happened - see the automation-requests route. */
export async function sendBackFix(supabase: Client, adminId: string, locale: AppLocale, proposalId: string, comment: string): Promise<ReviewResult> {
  if (!comment.trim()) return { error: tr(locale, "Say what is wrong so the next run can fix it.", "יש לכתוב מה לא תקין כדי שהריצה הבאה תתקן.") };
  const { loaded, wrong } = await loadFix(supabase, proposalId, ["merged", "approved"]);
  if (!loaded) return notFound(locale);
  if (wrong) return alreadyDecided(locale);
  // A bundle is undone on dev once (its lead's branch) and every ticket of it goes back to the night run together.
  const group = await groupOf(supabase, loaded.ticket.id, loaded.ticket.ticket_seq);
  const { data: pending } = await supabase
    .from("automation_requests")
    .select("id")
    .eq("kind", "revert")
    .eq("ticket_id", group.lead.id)
    .is("completed_at", null)
    .limit(1);
  if ((pending ?? []).length > 0) return { success: tr(locale, "A revert is already requested.", "ביטול מיזוג כבר התבקש.") };
  const { error } = await supabase
    .from("automation_requests")
    .insert({ kind: "revert", ticket_id: group.lead.id, requested_by: adminId, details: { comment: comment.trim(), proposalId, bundle: Boolean(group.bundle) } });
  if (error) return dbError(locale);
  for (const member of group.members) await logAutomationEvent(supabase, adminId, member.id, "sent_back");
  await queueLearning(supabase, adminId, loaded.ticket, "send_back", comment.trim(), (loaded.proposal.payload as FixPayload).summary ?? "");
  const what = group.bundle ? `Bundle ${group.bundle.letter} (${seqList(group.members)})` : `TCK-${loaded.ticket.ticket_seq}`;
  const whatHe = group.bundle ? `חבילה ${group.bundle.letter} (${seqList(group.members)})` : `TCK-${loaded.ticket.ticket_seq}`;
  return {
    success: tr(
      locale,
      `Revert queued for ${what}. It is undone on dev within about a minute, then goes back to the night run with your comment.`,
      `ביטול המיזוג של ${whatHe} נכנס לתור. הוא יבוטל בפיתוח תוך בערך דקה ואז יחזור לריצת הלילה עם ההערה שלך.`,
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
    .select("id, ticket_id, payload, tickets!inner(ticket_seq, subject, auto_handle, bundle_id)")
    .eq("kind", "fix")
    .eq("status", "approved");
  type Joined = { ticket_seq: number; subject: string; auto_handle: string | null; bundle_id: string | null };
  const rows = (approved ?? [])
    .map((row) => {
      const joined = row.tickets as unknown as Joined | Joined[];
      const ticket = Array.isArray(joined) ? joined[0] : joined;
      return ticket && ticket.auto_handle === "R"
        ? { proposalId: row.id as string, ticketId: row.ticket_id as string, ticketSeq: ticket.ticket_seq, subject: ticket.subject, branch: (row.payload as FixPayload).branch, bundleId: ticket.bundle_id }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  // The admin may untick fixes in the dialog; with no list at all, everything approved ships. A bundle is in if any of its tickets is ticked.
  const wanted = (item: (typeof rows)[number]) => !proposalIds || proposalIds.includes(item.proposalId);
  const picked = rows.filter(wanted);
  const bundleIds = [...new Set(picked.map((item) => item.bundleId).filter((id): id is string => Boolean(id)))];
  const items: Record<string, unknown>[] = picked.filter((item) => !item.bundleId).map((item) => ({ proposalId: item.proposalId, ticketId: item.ticketId, ticketSeq: item.ticketSeq, subject: item.subject, branch: item.branch }));
  for (const bundleId of bundleIds) {
    const bundle = await bundleById(supabase, bundleId);
    const members = bundle ? bundle.members.map((member) => rows.find((row) => row.ticketId === member.id)) : [];
    if (!bundle || members.some((member) => !member)) {
      return { error: tr(locale, `Bundle ${bundle?.letter ?? ""} is not fully approved for production yet: all its tickets must be.`, `חבילה ${bundle?.letter ?? ""} עדיין לא אושרה במלואה לייצור: כל הפניות שלה חייבות להיות מאושרות.`) };
    }
    const [lead, ...others] = members as NonNullable<(typeof rows)[number]>[];
    items.push({
      proposalId: lead.proposalId,
      ticketId: lead.ticketId,
      ticketSeq: lead.ticketSeq,
      subject: lead.subject,
      branch: lead.branch,
      bundleLetter: bundle.letter,
      alsoTickets: others.map((other) => ({ ticketId: other.ticketId, proposalId: other.proposalId, ticketSeq: other.ticketSeq, subject: other.subject })),
    });
  }
  if (items.length === 0) return { error: tr(locale, "No fix is approved for production yet.", "אין עדיין תיקון שאושר לייצור.") };
  const { error } = await supabase.from("automation_requests").insert({ kind: "promote", requested_by: adminId, details: { tickets: items } });
  if (error) return dbError(locale);
  for (const item of picked) await logAutomationEvent(supabase, adminId, item.ticketId, "promote_requested");
  const ticketCount = picked.length;
  return {
    success: tr(
      locale,
      `Promotion requested for ${items.length} fix${items.length === 1 ? "" : "es"}${ticketCount !== items.length ? ` (${ticketCount} tickets)` : ""}. A confirmation email follows when it ends.`,
      `התבקשה העלאה לייצור של ${items.length} תיקונים${ticketCount !== items.length ? ` (${ticketCount} פניות)` : ""}. מייל אישור יישלח בסיומה.`,
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

/** A ticket the night run left flagged "stopped" (no question to answer, nothing building) goes back in the queue. */
export async function requeueStopped(supabase: Client, adminId: string, locale: AppLocale, ticketId: string): Promise<ReviewResult> {
  const { data: ticket } = await supabase.from("tickets").select("id, ticket_seq, auto_handle, status").eq("id", ticketId).maybeSingle();
  if (!ticket) return notFound(locale);
  if (ticket.auto_handle !== "P") return alreadyDecided(locale);
  const { error } = await supabase.from("tickets").update({ auto_handle: "Y", status: ticket.status === "in_progress" ? "open" : ticket.status }).eq("id", ticketId);
  if (error) return dbError(locale);
  await supabase.from("ticket_proposals").update({ status: "superseded", decided_at: new Date().toISOString(), decided_by: adminId }).eq("ticket_id", ticketId).eq("kind", "questions").eq("status", "pending");
  await logAutomationEvent(supabase, adminId, ticketId, "requeued");
  return { success: tr(locale, `TCK-${ticket.ticket_seq} is back in the queue for the next night run.`, `TCK-${ticket.ticket_seq} חזרה לתור של ריצת הלילה הבאה.`) };
}

/** "Build anyway": a queued ticket that waits for another one (they change the same files) is built in the next run regardless.
 * Only valid until the ticket is queued again (lib/automation-overlap.ts). Expect a merge conflict if the other fix is not promoted first. */
export async function overrideOverlap(supabase: Client, adminId: string, locale: AppLocale, ticketId: string): Promise<ReviewResult> {
  const { data: ticket } = await supabase.from("tickets").select("id, ticket_seq, auto_handle").eq("id", ticketId).maybeSingle();
  if (!ticket) return notFound(locale);
  if (ticket.auto_handle !== "Y") return alreadyDecided(locale);
  await logAutomationEvent(supabase, adminId, ticketId, "overlap_override");
  return { success: tr(locale, `TCK-${ticket.ticket_seq} will be built in the next run without waiting.`, `TCK-${ticket.ticket_seq} תיבנה בריצה הבאה בלי להמתין.`) };
}

// ------------------------------------------------------------------------------------------------------------------
// Fix bundles (docs/design/auto-ticket-handling.md, "Fix bundles")

/** "Approve as one bundle" / "Approve separately" on a suggested group: approves every ticket's proposal with the analyst's recommended picks.
 * As a bundle the tickets are grouped first, so the night run builds them as one fix; separately they are built one after another. */
export async function approveSuggestedGroup(supabase: Client, adminId: string, locale: AppLocale, ticketIds: string[], asBundle: boolean): Promise<ReviewResult> {
  const ids = [...new Set(ticketIds)];
  if (ids.length < 2 || ids.length > MAX_BUNDLE_SIZE) return { error: tr(locale, `A bundle has 2 to ${MAX_BUNDLE_SIZE} tickets.`, `בחבילה יש 2 עד ${MAX_BUNDLE_SIZE} פניות.`) };
  const { data: proposals } = await supabase.from("ticket_proposals").select("id, ticket_id").eq("kind", "proposal").eq("status", "pending").in("ticket_id", ids);
  const byTicket = new Map(((proposals ?? []) as { id: string; ticket_id: string }[]).map((row) => [row.ticket_id, row.id]));
  if (ids.some((id) => !byTicket.has(id))) return { error: tr(locale, "Every ticket needs a proposal that is waiting for approval. Refresh the page.", "לכל פנייה חייבת להיות הצעה שממתינה לאישור. יש לרענן את הדף.") };
  let letter = "";
  if (asBundle) {
    const created = await createBundle(supabase, adminId, ids);
    if ("error" in created) {
      const text = {
        size: tr(locale, `A bundle has 2 to ${MAX_BUNDLE_SIZE} tickets.`, `בחבילה יש 2 עד ${MAX_BUNDLE_SIZE} פניות.`),
        taken: tr(locale, "One of these tickets is already in a bundle.", "אחת הפניות כבר בחבילה."),
        built: tr(locale, "One of these tickets already has a fix built.", "לאחת הפניות כבר נבנה תיקון."),
        db: dbError(locale).error!,
      }[created.error];
      return { error: text };
    }
    letter = created.bundle.letter;
  }
  for (const id of ids) {
    const result = await approveProposal(supabase, adminId, locale, byTicket.get(id)!, null, null);
    if (result.error) return result;
  }
  return {
    success: asBundle
      ? tr(locale, `Bundle ${letter} approved: ${ids.length} tickets, built together by the night run as one fix.`, `חבילה ${letter} אושרה: ${ids.length} פניות, ריצת הלילה תבנה אותן יחד כתיקון אחד.`)
      : tr(locale, `${ids.length} tickets approved separately. They are built one after another because they change the same files.`, `${ids.length} פניות אושרו בנפרד. הן ייבנו אחת אחרי השנייה כי הן משנות את אותם קבצים.`),
  };
}

/** Splits a bundle into separate tickets. Not built yet: they are simply separate again. Built: the fix is set aside (its merge on dev is
 * undone) and every ticket goes back to the night run on its own - the overlap guard then builds them one after another. */
export async function splitBundle(supabase: Client, adminId: string, locale: AppLocale, bundleId: string): Promise<ReviewResult> {
  const bundle = await bundleById(supabase, bundleId);
  if (!bundle) return { error: tr(locale, "That bundle no longer exists.", "החבילה כבר לא קיימת.") };
  const ids = bundle.members.map((member) => member.id);
  const built = await bundleIsBuilt(supabase, bundle);
  if (built) {
    const note = `Admin split Bundle ${bundle.letter} (${seqList(bundle.members)}) into separate fixes: this ticket is rebuilt on its own, after the others that change the same files.`;
    for (const member of bundle.members) {
      const { data: row } = await supabase.from("tickets").select("id, ticket_seq, description, status, created_by").eq("id", member.id).maybeSingle();
      if (!row) continue;
      await supabase.from("tickets").update({ description: supportEntry(row as TicketBits, adminId, note), auto_handle: "Y", status: "open" }).eq("id", member.id);
    }
    const { data: merged } = await supabase.from("ticket_proposals").select("id").eq("kind", "fix").in("status", ["merged", "approved"]).in("ticket_id", ids).limit(1);
    await supabase.from("ticket_proposals").update({ status: "returned", admin_comment: "Bundle split", decided_at: new Date().toISOString(), decided_by: adminId }).eq("kind", "fix").in("status", ["pending", "merged", "approved"]).in("ticket_id", ids);
    // Its merge on dev is undone by the laptop (the lead's branch); the tickets are already back in the queue.
    if ((merged ?? []).length > 0) await supabase.from("automation_requests").insert({ kind: "revert", ticket_id: bundle.lead.id, requested_by: adminId, details: { comment: "Bundle split by the admin", bundle: true, split: true } });
  }
  await dissolveBundle(supabase, bundleId);
  for (const id of ids) await logAutomationEvent(supabase, adminId, id, "bundle_split", { letter: bundle.letter });
  return {
    success: built
      ? tr(locale, `Bundle ${bundle.letter} is split. Its fix is set aside and the tickets are rebuilt one after another.`, `חבילה ${bundle.letter} פוצלה. התיקון שלה הונח בצד והפניות ייבנו מחדש אחת אחרי השנייה.`)
      : tr(locale, `Bundle ${bundle.letter} is split. The tickets are separate again.`, `חבילה ${bundle.letter} פוצלה. הפניות נפרדות שוב.`),
  };
}

/** "Bundle them again" after a split, or grouping tickets by hand: only tickets that are waiting for approval or queued, and not built. */
export async function bundleTickets(supabase: Client, adminId: string, locale: AppLocale, ticketIds: string[]): Promise<ReviewResult> {
  const created = await createBundle(supabase, adminId, ticketIds);
  if ("error" in created) {
    return {
      error: {
        size: tr(locale, `A bundle has 2 to ${MAX_BUNDLE_SIZE} tickets.`, `בחבילה יש 2 עד ${MAX_BUNDLE_SIZE} פניות.`),
        taken: tr(locale, "One of these tickets is already in a bundle.", "אחת הפניות כבר בחבילה."),
        built: tr(locale, "One of these tickets already has a fix built.", "לאחת הפניות כבר נבנה תיקון."),
        db: dbError(locale).error!,
      }[created.error],
    };
  }
  for (const member of created.bundle.members) await logAutomationEvent(supabase, adminId, member.id, "bundle_created", { letter: created.bundle.letter });
  return { success: tr(locale, `Bundle ${created.bundle.letter} created: ${seqList(created.bundle.members)}.`, `חבילה ${created.bundle.letter} נוצרה: ${seqList(created.bundle.members)}.`) };
}

/** "Approve bundle": every ticket of a bundle that is still waiting for approval is approved with the analyst's recommended picks. */
export async function approveBundleMembers(supabase: Client, adminId: string, locale: AppLocale, bundleId: string): Promise<ReviewResult> {
  const bundle = await bundleById(supabase, bundleId);
  if (!bundle) return { error: tr(locale, "That bundle no longer exists.", "החבילה כבר לא קיימת.") };
  const { data: proposals } = await supabase.from("ticket_proposals").select("id, ticket_id").eq("kind", "proposal").eq("status", "pending").in("ticket_id", bundle.members.map((member) => member.id));
  const pending = (proposals ?? []) as { id: string; ticket_id: string }[];
  if (pending.length === 0) return { error: tr(locale, "Nothing in this bundle is waiting for approval.", "אין בחבילה דבר שממתין לאישור.") };
  for (const row of pending) {
    const result = await approveProposal(supabase, adminId, locale, row.id, null, null);
    if (result.error) return result;
  }
  return { success: tr(locale, `Bundle ${bundle.letter} approved (${pending.length} ticket${pending.length === 1 ? "" : "s"}). The night run builds it as one fix.`, `חבילה ${bundle.letter} אושרה (${pending.length} פניות). ריצת הלילה תבנה אותה כתיקון אחד.`) };
}
