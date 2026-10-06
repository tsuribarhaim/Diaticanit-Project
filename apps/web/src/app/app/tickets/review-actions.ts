"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";
import {
  answerQuestions,
  approveProposal,
  rejectProposal,
  requestAnalysis,
  requestChange,
  requestMerge,
  returnFix,
  takeOutOfAutomation,
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
