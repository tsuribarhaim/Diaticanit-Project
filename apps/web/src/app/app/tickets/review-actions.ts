"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";
import {
  answerQuestions,
  approveForProduction,
  approveProposal,
  rejectProposal,
  requestAnalysis,
  requestChange,
  requestMerge,
  handledByHand,
  requeueStopped,
  overrideOverlap,
  requestAgentRun,
  requestPromote,
  returnFix,
  sendBackFix,
  takeOutOfAutomation,
  setAutomationPaused,
  takeTicketOut,
  withdrawApproval,
  type ReviewResult,
} from "@/lib/ticket-review";
import { isCurrentUserAdmin } from "@/lib/tickets";

/** Thin server-action wrappers around lib/ticket-review.ts: sign-in and admin checks first (RLS
 * still enforces it underneath), then the step, then a refresh of the screens that show it. */
async function withAdmin(run: (ctx: { supabase: Awaited<ReturnType<typeof createClient>>; adminId: string; locale: AppLocale }) => Promise<ReviewResult>): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");
  const { data } = await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle();
  const locale = normalizeLocale(data?.preferred_language);
  if (!(await isCurrentUserAdmin(supabase, user.id))) {
    return { error: tr(locale, "Not authorized.", "אין הרשאה.") };
  }
  const result = await run({ supabase, adminId: user.id, locale });
  if (!result.error) {
    revalidatePath("/app/tickets");
    revalidatePath("/app/tickets/review");
    revalidatePath("/app/tickets/automation");
  }
  return result;
}

export async function approveProposalAction(proposalId: string, chosen: Record<string, number>, comment: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => approveProposal(supabase, adminId, locale, proposalId, chosen, comment || null));
}
export async function requestChangeAction(proposalId: string, chosen: Record<string, number>, comment: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => requestChange(supabase, adminId, locale, proposalId, chosen, comment));
}
export async function rejectProposalAction(proposalId: string, comment: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => rejectProposal(supabase, adminId, locale, proposalId, comment));
}
export async function answerQuestionsAction(proposalId: string, chosen: Record<string, number>, comment: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => answerQuestions(supabase, adminId, locale, proposalId, chosen, comment || null));
}
export async function takeOutOfAutomationAction(proposalId: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => takeOutOfAutomation(supabase, adminId, locale, proposalId));
}
export async function returnFixAction(proposalId: string, comment: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => returnFix(supabase, adminId, locale, proposalId, comment));
}
export async function requestAnalysisAction(): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => requestAnalysis(supabase, adminId, locale));
}
export async function requestMergeAction(proposalId: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => requestMerge(supabase, adminId, locale, proposalId));
}
export async function approveForProductionAction(proposalId: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => approveForProduction(supabase, adminId, locale, proposalId));
}
export async function withdrawApprovalAction(proposalId: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => withdrawApproval(supabase, adminId, locale, proposalId));
}
export async function sendBackFixAction(proposalId: string, comment: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => sendBackFix(supabase, adminId, locale, proposalId, comment));
}
export type AutomationSearchHit = { id: string; seq: number; subject: string; status: string; autoHandle: string | null; releasedAt: string | null };

/** Finds tickets by number or words for the dashboard's search (admin only). The in-cycle ones are matched on the page; this
 * also finds tickets that are NOT in the cycle (never marked, or already released) so the search can say where they are. */
export async function searchAutomationTicketsAction(query: string): Promise<AutomationSearchHit[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isCurrentUserAdmin(supabase, user.id))) return [];
  const q = query.trim().slice(0, 80);
  if (q.length < 1) return [];
  const digits = q.replace(/\D/g, "");
  let request = supabase.from("tickets").select("id, ticket_seq, subject, status, auto_handle").order("ticket_seq", { ascending: false }).limit(8);
  if (/^(tck)?[-\s]?\d+$/i.test(q) && digits) request = request.eq("ticket_seq", Number(digits));
  else request = request.ilike("subject", `%${q.replace(/[%_]/g, "")}%`);
  const { data } = await request;
  const rows = (data ?? []) as { id: string; ticket_seq: number; subject: string; status: string; auto_handle: string | null }[];
  const released = new Map<string, string>();
  if (rows.length > 0) {
    const { data: fixes } = await supabase.from("ticket_proposals").select("ticket_id, decided_at").eq("kind", "fix").eq("status", "released").in("ticket_id", rows.map((row) => row.id));
    for (const fix of (fixes ?? []) as { ticket_id: string; decided_at: string | null }[]) if (fix.decided_at) released.set(fix.ticket_id, fix.decided_at);
  }
  return rows.map((row) => ({ id: row.id, seq: row.ticket_seq, subject: row.subject, status: row.status, autoHandle: row.auto_handle, releasedAt: released.get(row.id) ?? null }));
}

export async function takeTicketOutAction(ticketId: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => takeTicketOut(supabase, adminId, locale, ticketId));
}
export async function setLessonActiveAction(lessonId: string, active: boolean): Promise<ReviewResult> {
  return withAdmin(async ({ supabase, adminId, locale }) => {
    const { error } = await supabase
      .from("automation_lessons")
      .update({ active, disabled_at: active ? null : new Date().toISOString(), disabled_by: active ? null : adminId })
      .eq("id", lessonId);
    if (error) return { error: tr(locale, "Could not save. Please try again.", "לא ניתן היה לשמור. יש לנסות שוב.") };
    revalidatePath("/app/tickets/automation");
    return { success: active ? tr(locale, "Lesson switched on.", "הלקח הופעל.") : tr(locale, "Lesson switched off.", "הלקח כובה.") };
  });
}
export async function requestPromoteAction(proposalIds: string[]): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => requestPromote(supabase, adminId, locale, proposalIds));
}
export async function requestAgentRunAction(kind: "analyze" | "night" | "digest"): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => requestAgentRun(supabase, adminId, locale, kind));
}
export async function setAutomationPausedAction(paused: boolean): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => setAutomationPaused(supabase, adminId, locale, paused));
}
export async function handledByHandAction(ticketId: string, resolve: boolean, note: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => handledByHand(supabase, adminId, locale, ticketId, resolve, note));
}
export async function requeueStoppedAction(ticketId: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => requeueStopped(supabase, adminId, locale, ticketId));
}
export async function overrideOverlapAction(ticketId: string): Promise<ReviewResult> {
  return withAdmin(({ supabase, adminId, locale }) => overrideOverlap(supabase, adminId, locale, ticketId));
}
