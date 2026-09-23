"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { generateTargetsPayload, hasAiTargetsConsent, performTargetsLock } from "@/app/app/targets/actions";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import { targetGenerationPayloadSchema, toProfileForTargets, type TargetGenerationPayload } from "@/lib/targets";
import { computeTargetsDiff } from "@/lib/targets-diff";

const PROFILE_COLUMNS_FOR_TARGETS =
  "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating, preferred_language, first_name, nutritional_goal";

export type OnboardingTargetsResult =
  | { error: string }
  | { payload: TargetGenerationPayload; source: "ai" | "heuristic"; goalText: string };

/**
 * Generates the user's first target plan right after onboarding's step 4
 * completes, from the profile they've already saved - no free-text goal
 * input needed, since nutritional_goal (collected in step 2) already IS
 * the goal. Called as soon as the Targets step mounts, which is itself
 * the "start early to hide AI latency" the design doc calls for (see
 * docs/design/onboarding-redesign.md §4) - there's no separate earlier
 * trigger, this call is as early as it can meaningfully be.
 */
export async function generateOnboardingTargetsAction(): Promise<OnboardingTargetsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("user_profile")
    .select(PROFILE_COLUMNS_FOR_TARGETS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profileRow) {
    return { error: "Your profile could not be found. Please complete the earlier steps first." };
  }

  const locale = normalizeLocale(profileRow.preferred_language);
  const profile = toProfileForTargets(profileRow);
  const aiConfig = getAiExtractionConfig();
  const hasConsent = aiConfig ? await hasAiTargetsConsent({ supabase, userId: user.id }) : false;

  // No free-text ask the way the standalone Targets page's "Adjust" flow
  // needs one - the profile (nutritional_goal included) already fully
  // describes what's wanted. This text only needs to carry the goal
  // direction for the AI/heuristic to act on.
  const goalText = `Generate my initial daily targets. My goal is: ${profileRow.nutritional_goal ?? "maintain"}.`;

  const { payload, source, safetyRejectionMessage, notActionableMessage } = await generateTargetsPayload({
    goalText,
    profile,
    locale,
    aiConfig,
    hasConsent,
    supabase,
    userId: user.id,
  });

  if (safetyRejectionMessage || notActionableMessage) {
    logServerError("onboarding.generateTargets", "generation_rejected", {
      userId: user.id,
      error: safetyRejectionMessage ?? notActionableMessage ?? "unknown",
    });
    return {
      error:
        safetyRejectionMessage ??
        notActionableMessage ??
        "Something went wrong generating your targets. Please try again.",
    };
  }

  const validated = targetGenerationPayloadSchema.safeParse(payload);
  if (!validated.success) {
    logServerError("onboarding.generateTargets", "invalid_payload", {
      userId: user.id,
      error: validated.error.message,
    });
    return { error: "Something went wrong generating your targets. Please try again." };
  }

  return { payload: validated.data, source, goalText };
}

export type LockOnboardingTargetsState = { error?: string };

/**
 * Locks in the plan the user reviewed/negotiated on the Targets step, then
 * sends them into the app - reuses performTargetsLock, the exact same
 * insert/deactivate logic every other lock-in flow in the app already
 * uses, so this isn't a second implementation of that safety-critical
 * write. Redirects to /app/daily-report on success (decided - not /app;
 * see the design doc's own "Completion" note), so the very next thing a
 * new user sees is the screen they'll actually use day to day.
 */
export async function lockOnboardingTargetsAction({
  payload,
  source,
  goalText,
}: {
  payload: TargetGenerationPayload;
  source: "ai" | "heuristic";
  goalText: string;
}): Promise<LockOnboardingTargetsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const validated = targetGenerationPayloadSchema.safeParse(payload);
  if (!validated.success) {
    logServerError("onboarding.lockTargets", "invalid_payload", { userId: user.id, error: validated.error.message });
    return { error: "This plan could not be validated. Please go back and try again." };
  }

  const result = await performTargetsLock({
    supabase,
    userId: user.id,
    goalText,
    source,
    payload: validated.data,
  });

  if ("error" in result) {
    return { error: result.error };
  }

  // Cleared here, not at the step-4 profile save - see that action's own
  // comment on this column. This is the point the whole onboarding flow
  // (profile *and* its first target plan) is actually done, so this is
  // the only place "no longer needs a refresh" is true.
  await supabase.from("user_profile").update({ needs_onboarding_refresh: false }).eq("user_id", user.id);

  revalidatePath("/app");
  revalidatePath("/app/targets");
  revalidatePath("/app/daily-report");
  redirect("/app/daily-report");
}

export type NegotiateOnboardingTargetsResult =
  | { error: string }
  | { payload: TargetGenerationPayload; source: "ai" | "heuristic"; reply: string; changed: boolean };

/**
 * The onboarding Targets step's own chat/negotiation, deliberately
 * simpler than the standalone Targets page's chat (src/app/api/targets/
 * chat/route.ts) rather than reusing it directly - that route assumes an
 * already-locked user_target_profiles row to negotiate against and read
 * quick-apply state from, which doesn't exist yet here (nothing is locked
 * in until the user finishes this step). Every message is treated as a
 * request to regenerate against the still-unlocked currentPayload the
 * client already holds; the reply is derived from what generation
 * actually did (a real diff, or the AI's own explanation when nothing
 * changed) rather than a second, separate conversational AI call - no
 * quick-apply/queued distinction either, since there's no already-visible
 * "saved" state here for a fast path to protect the way there is on the
 * real Targets page.
 */
export async function negotiateOnboardingTargetsAction({
  currentPayload,
  message,
}: {
  currentPayload: TargetGenerationPayload;
  message: string;
}): Promise<NegotiateOnboardingTargetsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return { error: "Nothing to send yet." };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("user_profile")
    .select(PROFILE_COLUMNS_FOR_TARGETS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profileRow) {
    return { error: "Your profile could not be found." };
  }

  const currentValidated = targetGenerationPayloadSchema.safeParse(currentPayload);
  if (!currentValidated.success) {
    return { error: "The current plan could not be validated. Please go back and regenerate it." };
  }

  const locale = normalizeLocale(profileRow.preferred_language);
  const profile = toProfileForTargets(profileRow);
  const aiConfig = getAiExtractionConfig();
  const hasConsent = aiConfig ? await hasAiTargetsConsent({ supabase, userId: user.id }) : false;

  const { payload, source, safetyRejectionMessage, notActionableMessage } = await generateTargetsPayload({
    goalText: trimmedMessage,
    profile,
    locale,
    aiConfig,
    hasConsent,
    currentTargets: currentValidated.data,
    supabase,
    userId: user.id,
  });

  if (safetyRejectionMessage) {
    return { error: safetyRejectionMessage };
  }

  if (notActionableMessage) {
    // A real, AI-explained answer to a question or an unclear/out-of-scope
    // ask - shown as the reply itself rather than treated as a failure,
    // since nothing actually went wrong here.
    return { payload: currentValidated.data, source, reply: notActionableMessage, changed: false };
  }

  const validated = targetGenerationPayloadSchema.safeParse(payload);
  if (!validated.success) {
    logServerError("onboarding.negotiateTargets", "invalid_payload", {
      userId: user.id,
      error: validated.error.message,
    });
    return {
      error: tr(locale, "Something went wrong applying that change. Please try again.", "משהו השתבש בהחלת השינוי. יש לנסות שוב."),
    };
  }

  const diffRows = computeTargetsDiff(currentValidated.data, validated.data, locale);
  if (diffRows.length === 0) {
    return {
      payload: validated.data,
      source,
      reply:
        validated.data.aiRationaleExplanation ||
        tr(locale, "I reviewed this and nothing needs to change.", "בדקתי את זה ואין צורך בשינוי."),
      changed: false,
    };
  }

  // The AI's own explanation leads, same reasoning as the standalone
  // Targets page's negotiate action (see its own comment) - a mechanical
  // diff alone can't convey *why* something was or wasn't changed.
  const changeSummary = diffRows
    .slice(0, 6)
    .map((row) => `${tr(locale, row.labelEn, row.labelHe)}: ${row.before} → ${row.after}`)
    .join("\n");
  const updatedLabel = tr(locale, "Updated:", "עודכן:");
  const reply = validated.data.aiRationaleExplanation
    ? `${validated.data.aiRationaleExplanation}\n\n${updatedLabel}\n${changeSummary}`
    : tr(locale, `Here's what I updated:\n${changeSummary}`, `הנה מה שעדכנתי:\n${changeSummary}`);

  return { payload: validated.data, source, reply, changed: true };
}
