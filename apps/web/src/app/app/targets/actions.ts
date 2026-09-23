"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prepareMedicalContextForTargets } from "@/app/app/documents/actions";
import { generateTargetsWithAi, NoActionableChangeError } from "@/lib/ai/targets";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { getRecentCustomTargetLogs } from "@/lib/daily-report";
import { normalizeLocale, tr } from "@/lib/locale";
import { createNotification, markAllTargetsNotificationsRead, markNotificationRead } from "@/lib/notifications";
import { logServerError } from "@/lib/server-log";
import {
  evaluateTargetWeightSafety,
  generateHeuristicTargetProfile,
  mapTargetProfileRowToPayload,
  TARGET_PROFILE_COLUMNS,
  targetGenerationPayloadSchema,
  targetInputSchema,
  toProfileForTargets,
  type ProfileForTargets,
  type TargetGenerationPayload,
} from "@/lib/targets";
import { computeTargetsDiff } from "@/lib/targets-diff";
import { createClient } from "@/lib/supabase/server";

export type TargetsActionState = {
  error?: string;
  success?: string;
  warning?: string;
  preview?: {
    goalText: string;
    source: "ai" | "heuristic";
    payload: TargetGenerationPayload;
  };
};

export async function hasAiTargetsConsent({
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_extraction_consents")
    .select("accepted_at, revoked_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return false;
  }

  return Boolean(data?.accepted_at) && !data?.revoked_at;
}

/**
 * Core AI-with-heuristic-fallback generation, shared by the explicit
 * "Generate/regenerate" action and the Targets page's automatic first-visit
 * baseline generation (profile data alone, no goal text required).
 */
export async function generateTargetsPayload({
  goalText,
  profile,
  locale,
  aiConfig,
  hasConsent,
  currentTargets,
  supabase,
  userId,
  onProgress,
}: {
  goalText: string;
  profile: ProfileForTargets;
  locale: ReturnType<typeof normalizeLocale>;
  aiConfig: ReturnType<typeof getAiExtractionConfig>;
  hasConsent: boolean;
  /** Present when this is an adjustment request against an already-locked
   * plan rather than a fresh generation; ignored by the heuristic fallback
   * (which is a simplified, non-AI path). */
  currentTargets?: TargetGenerationPayload;
  /** When provided alongside userId, the user's uploaded medical documents
   * are auto-extracted (if pending) and factored into the AI generation.
   * Omitted callers simply skip document context (no supabase/userId
   * available, or AI generation isn't in play). */
  supabase?: Awaited<ReturnType<typeof createClient>>;
  userId?: string;
  /** Forwarded to generateTargetsWithAi - see its own comment. */
  onProgress?: () => void;
}): Promise<{
  payload: TargetGenerationPayload;
  source: "ai" | "heuristic";
  heuristicReason: string | null;
  /** Set when the generated payload's target weight would push the user's
   * BMI into an unsafe zone; callers must not treat `payload` as a valid
   * preview/adjustment when this is present. */
  safetyRejectionMessage?: string;
  /** Set when the model determined the adjustment request didn't describe
   * any concrete, in-scope health change to make; same handling as
   * safetyRejectionMessage - do not treat `payload` as valid. */
  notActionableMessage?: string;
}> {
  let heuristicReason: string | null = null;
  let payload: TargetGenerationPayload | null = null;
  let source: "ai" | "heuristic" = "heuristic";

  if (aiConfig && hasConsent) {
    try {
      const medicalDocumentsContext =
        supabase && userId
          ? await prepareMedicalContextForTargets({ supabase, userId }).catch((error) => {
              logServerError("targets.generate", "medical_context_failed", {
                userId,
                error: error instanceof Error ? error.message : "Unknown error",
              });
              return null;
            })
          : null;

      const loggableCustomTargetIds = (currentTargets?.userTargets ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => Boolean(id));
      const recentCustomTargetLogs =
        supabase && userId && loggableCustomTargetIds.length > 0
          ? await getRecentCustomTargetLogs({ supabase, userId, ids: loggableCustomTargetIds }).catch((error) => {
              logServerError("targets.generate", "recent_custom_target_logs_failed", {
                userId,
                error: error instanceof Error ? error.message : "Unknown error",
              });
              return undefined;
            })
          : undefined;

      payload = await generateTargetsWithAi({
        config: aiConfig,
        goalText,
        profile,
        locale,
        currentTargets,
        medicalDocumentsContext: medicalDocumentsContext ?? undefined,
        recentCustomTargetLogs,
        onProgress,
      });
      source = "ai";
    } catch (error) {
      if (error instanceof NoActionableChangeError) {
        return {
          payload: currentTargets ?? generateHeuristicTargetProfile({ freeText: goalText, profile, locale }),
          source: "ai",
          heuristicReason: null,
          notActionableMessage: error.message,
        };
      }

      logServerError("targets.generate", "ai_generation_failed", {
        error: error instanceof Error ? error.message : "Unknown AI targets generation error",
      });

      if (currentTargets) {
        // This is an adjustment against an already-locked plan, not a
        // fresh generation - the heuristic fallback below builds a brand
        // new generic baseline from the profile alone and has no idea
        // about currentTargets, so falling through to it here would
        // silently blow away everything the user already built (custom
        // exercise entries, habits, prior user_targets) just because this
        // one AI call happened to fail. Keep the locked plan untouched and
        // report the failure instead, matching how NoActionableChangeError
        // is already handled above.
        return {
          payload: currentTargets,
          source: "ai",
          heuristicReason: null,
          notActionableMessage: tr(
            locale,
            "Couldn't process that update right now. Please try again.",
            "לא ניתן היה לעבד את העדכון כרגע. יש לנסות שוב.",
          ),
        };
      }

      heuristicReason = "AI generation failed at runtime; heuristic fallback was used.";
    }
  } else if (!aiConfig) {
    heuristicReason = "AI generation is disabled or missing configuration.";
  } else if (!hasConsent) {
    heuristicReason = "AI consent is missing for this user. Approve AI consent in your profile to enable AI-generated targets.";
  }

  if (!payload) {
    payload = generateHeuristicTargetProfile({ freeText: goalText, profile, locale });
  }

  const safetyRejectionMessage = evaluateTargetWeightSafety(payload, profile, locale) ?? undefined;

  return { payload, source, heuristicReason, safetyRejectionMessage };
}

export async function generateTargetsAction(
  _prevState: TargetsActionState,
  formData: FormData,
): Promise<TargetsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const parsedInput = targetInputSchema.safeParse({
    freeText: formData.get("goal_text"),
  });

  if (!parsedInput.success) {
    return { error: parsedInput.error.issues[0]?.message ?? "Invalid goal input." };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("user_profile")
    .select(
      "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating, preferred_language",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profileRow) {
    return { error: "Please complete your profile before generating targets." };
  }

  const locale = normalizeLocale(profileRow.preferred_language);
  const profile = toProfileForTargets(profileRow);

  const { data: activeRow } = await supabase
    .from("user_target_profiles")
    .select(TARGET_PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  const currentTargets = activeRow ? mapTargetProfileRowToPayload(activeRow) : undefined;

  const aiConfig = getAiExtractionConfig();
  const hasConsent = aiConfig ? await hasAiTargetsConsent({ supabase, userId: user.id }) : false;
  const { payload, source, heuristicReason, safetyRejectionMessage, notActionableMessage } = await generateTargetsPayload({
    goalText: parsedInput.data.freeText,
    profile,
    locale,
    aiConfig,
    hasConsent,
    currentTargets,
    supabase,
    userId: user.id,
  });

  if (safetyRejectionMessage || notActionableMessage) {
    return { error: safetyRejectionMessage ?? notActionableMessage };
  }

  return {
    success: "Targets generated. Review the preview below before locking it in.",
    warning: source === "heuristic" ? heuristicReason ?? undefined : undefined,
    preview: {
      goalText: parsedInput.data.freeText,
      source,
      payload,
    },
  };
}

/**
 * Shared insert/deactivate logic behind lockTargetsAction (the form-based
 * flow still used by the no-AI-consent fallback page, TargetsWorkspace),
 * approveTargetsDraftAction (the post-onboarding review flow), and the
 * new onboarding Targets step (src/app/app/onboarding/targets-actions.ts)
 * - every caller trusts its own validation of `payload` against
 * targetGenerationPayloadSchema before calling this; exported rather than
 * duplicated so the same safety-critical insert/deactivate logic has one
 * implementation regardless of which flow locks a plan in.
 */
export async function performTargetsLock({
  supabase,
  userId,
  goalText,
  source,
  payload: parsedPayload,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  goalText: string;
  source: "ai" | "heuristic";
  payload: TargetGenerationPayload;
}): Promise<{ error: string } | { success: true }> {
  const user = { id: userId };
  // Snapshot the target-relevant profile fields as of right now, so a future
  // visit can detect drift (e.g. a newly recorded medical condition) and
  // prompt the user to recalculate.
  const { data: profileRowForSnapshot } = await supabase
    .from("user_profile")
    .select(
      "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const profileSnapshot = profileRowForSnapshot ? toProfileForTargets(profileRowForSnapshot) : {};

  const { error: deactivateError } = await supabase
    .from("user_target_profiles")
    .update({ is_active: false, sys_end_date: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (deactivateError) {
    logServerError("targets.lock", "deactivate_active_profile_failed", {
      userId: user.id,
      error: deactivateError.message,
    });
    return { error: deactivateError.message };
  }

  const { error: insertError } = await supabase.from("user_target_profiles").insert({
    user_id: user.id,
    is_active: true,
    raw_goal_text: goalText,
    goal_type: parsedPayload.goalType,
    target_weight_kg: parsedPayload.targetWeightKg,
    duration_days: parsedPayload.durationDays,
    blood_balance_focus: parsedPayload.bloodBalanceFocus,
    sleep_focus: parsedPayload.sleepFocus,

    calories_min: parsedPayload.caloriesMin,
    calories_max: parsedPayload.caloriesMax,
    protein_min_g: parsedPayload.proteinMinG,
    protein_max_g: parsedPayload.proteinMaxG,
    carbs_min_g: parsedPayload.carbsMinG,
    carbs_max_g: parsedPayload.carbsMaxG,
    fats_min_g: parsedPayload.fatsMinG,
    fats_max_g: parsedPayload.fatsMaxG,
    fiber_min_g: parsedPayload.fiberMinG,
    fiber_max_g: parsedPayload.fiberMaxG,
    sodium_min_mg: parsedPayload.sodiumMinMg,
    sodium_max_mg: parsedPayload.sodiumMaxMg,
    added_sugar_min_g: parsedPayload.addedSugarMinG,
    added_sugar_max_g: parsedPayload.addedSugarMaxG,
    water_min_ml: parsedPayload.waterMinMl,
    water_max_ml: parsedPayload.waterMaxMl,

    potassium_min_mg: parsedPayload.potassiumMinMg,
    potassium_max_mg: parsedPayload.potassiumMaxMg,
    magnesium_min_mg: parsedPayload.magnesiumMinMg,
    magnesium_max_mg: parsedPayload.magnesiumMaxMg,
    calcium_min_mg: parsedPayload.calciumMinMg,
    calcium_max_mg: parsedPayload.calciumMaxMg,
    iron_min_mg: parsedPayload.ironMinMg,
    iron_max_mg: parsedPayload.ironMaxMg,
    zinc_min_mg: parsedPayload.zincMinMg,
    zinc_max_mg: parsedPayload.zincMaxMg,
    vit_c_min_mg: parsedPayload.vitCMinMg,
    vit_c_max_mg: parsedPayload.vitCMaxMg,
    vit_b12_min_mcg: parsedPayload.vitB12MinMcg,
    vit_b12_max_mcg: parsedPayload.vitB12MaxMcg,
    vit_d_min_mcg: parsedPayload.vitDMinMcg,
    vit_d_max_mcg: parsedPayload.vitDMaxMcg,
    sat_fat_min_g: parsedPayload.satFatMinG,
    sat_fat_max_g: parsedPayload.satFatMaxG,
    omega3_min_g: parsedPayload.omega3MinG,
    omega3_max_g: parsedPayload.omega3MaxG,
    cholesterol_min_mg: parsedPayload.cholesterolMinMg,
    cholesterol_max_mg: parsedPayload.cholesterolMaxMg,

    exercise_targets: parsedPayload.exerciseTargets.map((entry) => ({
      modality: entry.modality,
      frequency_per_week: entry.frequencyPerWeek,
      duration_minutes_per_session: entry.durationMinutesPerSession,
      ai_adjustment_note: entry.aiAdjustmentNote,
      search_keywords: entry.searchKeywords,
    })),
    habits_do: parsedPayload.habitsDo.map((entry) => ({
      id: entry.id,
      habit_instruction: entry.habitInstruction,
      rationale: entry.rationale,
    })),
    habits_dont: parsedPayload.habitsDont.map((entry) => ({
      id: entry.id,
      habit_instruction: entry.habitInstruction,
      rationale: entry.rationale,
    })),
    user_targets: parsedPayload.userTargets.map((entry) => ({
      label: entry.label,
      value: entry.value,
      ...(entry.id && entry.unit && entry.targetMin !== undefined && entry.targetMax !== undefined
        ? {
            id: entry.id,
            unit: entry.unit,
            target_min: entry.targetMin,
            target_max: entry.targetMax,
            higher_is_better: entry.higherIsBetter ?? true,
          }
        : {}),
    })),

    ai_rationale_explanation: parsedPayload.aiRationaleExplanation,
    translation_confidence: parsedPayload.confidence,
    requires_confirmation: source === "heuristic",
    analysis_source: source,
    generator_version: "targets-v1",
    profile_snapshot: profileSnapshot,
  });

  if (insertError) {
    logServerError("targets.lock", "insert_failed", {
      userId: user.id,
      error: insertError.message,
    });
    return { error: insertError.message };
  }

  revalidatePath("/app");
  revalidatePath("/app/targets");

  return { success: true };
}

/**
 * The fast half of the Targets save-flow redesign (see
 * docs/design/targets-save-performance-redesign.md, decision #1) - patches
 * just target_weight_kg and/or duration_days on the CURRENTLY ACTIVE row
 * (a single UPDATE, not the full deactivate+insert lock cycle), so the
 * user sees their ask reflected immediately while the full plan is
 * reviewed in the background (see runBackgroundTargetsCheck below). Both
 * values have already been validated by the caller (route.ts) against
 * evaluateTargetWeightSafety before this is called - this function trusts
 * that and just writes.
 */
export async function applyQuickTargetFieldAction({
  weightKg,
  durationDays,
}: {
  weightKg: number | null;
  durationDays: number | null;
}): Promise<{ error?: string; targetProfileId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const patch: Record<string, number> = {};
  if (weightKg !== null) patch.target_weight_kg = weightKg;
  if (durationDays !== null) patch.duration_days = durationDays;

  if (Object.keys(patch).length === 0) {
    return { error: "Nothing to apply." };
  }

  const { data: activeRow, error: activeRowError } = await supabase
    .from("user_target_profiles")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (activeRowError || !activeRow) {
    return { error: activeRowError?.message ?? "No active target profile to update." };
  }

  const { error: updateError } = await supabase.from("user_target_profiles").update(patch).eq("id", activeRow.id);

  if (updateError) {
    logServerError("targets.quickApply", "update_failed", { userId: user.id, error: updateError.message });
    return { error: updateError.message };
  }

  revalidatePath("/app");
  revalidatePath("/app/targets");

  return { targetProfileId: activeRow.id };
}

/**
 * The slow, thorough half of the redesign - runs the full AI regeneration
 * (now including medical-document context, deliberately moved here rather
 * than blocking the fast path - see decision #3) and performs the
 * authoritative save. Called via Next.js's after() from route.ts, so it
 * keeps running once the fast SSE response has already reached the
 * browser, rather than blocking on it.
 *
 * Never silently overwrites a value the user already saw quick-applied and
 * confirmed: if the full pass finds a real safety concern
 * (safetyRejectionMessage) or a profile inconsistency worth flagging
 * (profileDiscrepancyMessage), it records a notification instead of
 * discarding/replacing what's already showing - see
 * docs/design/targets-save-performance-redesign.md's own decision on this.
 */
export async function runBackgroundTargetsCheck({
  supabase,
  userId,
  goalText,
  displayGoalText,
  profile,
  locale,
  aiConfig,
  quickAppliedFieldKeys,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  goalText: string;
  /** The same request in presentable form - see route.ts's own comment on
   * why this is kept separate from goalText (the full AI-prompt wrapper). */
  displayGoalText: string;
  profile: ProfileForTargets;
  locale: ReturnType<typeof normalizeLocale>;
  aiConfig: ReturnType<typeof getAiExtractionConfig>;
  quickAppliedFieldKeys: string[];
}): Promise<void> {
  try {
    const { data: activeRow } = await supabase
      .from("user_target_profiles")
      .select(TARGET_PROFILE_COLUMNS)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (!activeRow) return;

    const currentTargets = mapTargetProfileRowToPayload(activeRow);
    const hasConsent = aiConfig ? await hasAiTargetsConsent({ supabase, userId }) : false;

    const {
      payload: rawPayload,
      source,
      safetyRejectionMessage,
      notActionableMessage,
    } = await generateTargetsPayload({
      goalText,
      profile,
      locale,
      aiConfig,
      hasConsent,
      currentTargets,
      supabase,
      userId,
    });

    if (safetyRejectionMessage) {
      await createNotification({
        supabase,
        userId,
        targetProfileId: activeRow.id,
        severity: "concern",
        message: safetyRejectionMessage,
        fieldKeys: quickAppliedFieldKeys.length ? quickAppliedFieldKeys : ["target_weight_kg"],
      });
      return;
    }

    if (notActionableMessage) {
      // Only worth a notification if something had already been quick-
      // applied on the strength of this same request - otherwise there's
      // genuinely nothing to flag or save.
      if (quickAppliedFieldKeys.length) {
        await createNotification({
          supabase,
          userId,
          targetProfileId: activeRow.id,
          severity: "info",
          message: notActionableMessage,
          fieldKeys: quickAppliedFieldKeys,
        });
      }
      return;
    }

    // Neither generateTargetsPayload's own return type nor the AI's raw
    // JSON schema (aiTargetsSchema in lib/ai/targets.ts) actually
    // guarantees every field satisfies targetGenerationPayloadSchema's
    // stricter bounds (string length caps in particular - the two schemas
    // aren't kept in lockstep by construction). The old direct-lock path
    // never validated this either, which is exactly how a too-long
    // aiRationaleExplanation could previously reach the database
    // unnoticed; now that a later step (approveTargetsDraftAction) does
    // validate strictly before locking in, an invalid payload needs to be
    // caught HERE instead, or it would sit in user_target_profile_drafts
    // as a draft the user can see (targets/page.tsx's own safeParse) but
    // can never actually approve.
    const validatedPayload = targetGenerationPayloadSchema.safeParse(rawPayload);
    if (!validatedPayload.success) {
      logServerError("targets.backgroundCheck", "invalid_generated_payload", {
        userId,
        error: validatedPayload.error.message,
      });
      return;
    }
    const payload = validatedPayload.data;

    if (payload.profileDiscrepancyMessage) {
      await createNotification({
        supabase,
        userId,
        targetProfileId: activeRow.id,
        severity: "info",
        message: payload.profileDiscrepancyMessage,
        fieldKeys: quickAppliedFieldKeys,
      });
    }

    // Targets redesign, round 2 (docs/design/targets-save-performance-
    // redesign.md's own follow-up): this used to lock the freshly computed
    // plan in automatically the moment it finished, with no chance for the
    // user to actually see what changed before it took effect. It now
    // stops one step short - save the computed payload as a draft and
    // notify, and let the user's own explicit approval
    // (approveTargetsDraftAction) do the actual locking. "en" here is
    // arbitrary and only used to detect whether there's anything to show
    // at all - the diff itself is recomputed with the viewer's real locale
    // at display time (see targets/page.tsx), never stored pre-formatted.
    const diffRows = computeTargetsDiff(currentTargets, payload, "en");

    if (diffRows.length === 0) {
      // Reviewed, nothing actually changed - still worth a quiet
      // confirmation rather than leaving the user to wonder, but nothing
      // to approve.
      await createNotification({
        supabase,
        userId,
        targetProfileId: activeRow.id,
        severity: "info",
        message: tr(
          locale,
          "I reviewed this and your targets are still accurate as-is - no changes needed.",
          "בדקתי את זה והיעדים שלך עדיין מדויקים כפי שהם - אין צורך בשינויים.",
        ),
        fieldKeys: quickAppliedFieldKeys,
      });
      return;
    }

    const { error: draftError } = await supabase
      .from("user_target_profile_drafts")
      .upsert({ user_id: userId, goal_text: displayGoalText, source, payload }, { onConflict: "user_id" });

    if (draftError) {
      logServerError("targets.backgroundCheck", "draft_save_failed", { userId, error: draftError.message });
      return;
    }

    const notification = await createNotification({
      supabase,
      userId,
      targetProfileId: activeRow.id,
      severity: "info",
      message: tr(
        locale,
        "I've reviewed this and have an updated plan ready for you to approve.",
        "בדקתי את זה ויש לי תכנית מעודכנת שמוכנה לאישורך.",
      ),
      fieldKeys: quickAppliedFieldKeys,
    });

    // Best-effort link-back, not a blocking step: approveTargetsDraftAction/
    // discardTargetsDraftAction use this to also mark the notification read
    // when the draft is resolved directly from the auto-refreshing chat -
    // never visiting /app/notifications at all - so the user doesn't still
    // find the same "ready to review" notification sitting unread
    // afterward and click back into a now-empty draft. If this update
    // fails for any reason, the draft (already saved above) is still fully
    // approvable/discardable - it just won't also mark the notification
    // read on its own.
    if (notification?.id) {
      await supabase.from("user_target_profile_drafts").update({ notification_id: notification.id }).eq("user_id", userId);
    }
  } catch (error) {
    logServerError("targets.backgroundCheck", "unhandled_error", {
      userId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export type TargetsDraftActionState = { error?: string };

/**
 * The user's explicit approval of a pending draft (see
 * runBackgroundTargetsCheck's own comment on why this now stops short of
 * locking automatically) - the only thing this does is the same fast DB
 * write lockTargetsAction already does for the manually-generated-preview
 * case, since the slow part (actually computing the payload) already
 * happened in the background well before this is ever clicked.
 */
export async function approveTargetsDraftAction(): Promise<TargetsDraftActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: draft, error: draftError } = await supabase
    .from("user_target_profile_drafts")
    .select("goal_text, source, payload, notification_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (draftError || !draft) {
    return { error: "No pending targets update found. It may have already been handled." };
  }

  // safeParse, not parse: runBackgroundTargetsCheck already validates the
  // payload against this exact schema before ever saving it as a draft, so
  // this should never actually fail - but it's cheap insurance against an
  // uncaught exception crashing this server action outright (which reads
  // to the user as the button spinning forever, with no way to tell what
  // happened) if the two ever drift out of sync again.
  const parsedResult = targetGenerationPayloadSchema.safeParse(draft.payload);
  if (!parsedResult.success) {
    logServerError("targets.approveDraft", "invalid_draft_payload", { userId: user.id, error: parsedResult.error.message });
    return { error: "This pending update could not be validated. Please discard it and ask the AI to review your targets again." };
  }
  const parsedPayload = parsedResult.data;
  const result = await performTargetsLock({
    supabase,
    userId: user.id,
    goalText: draft.goal_text,
    source: draft.source === "ai" ? "ai" : "heuristic",
    payload: parsedPayload,
  });

  if ("error" in result) {
    return { error: result.error };
  }

  await supabase.from("user_target_profile_drafts").delete().eq("user_id", user.id);

  // Resolves every still-unread targets notification, not just the one
  // that announced this specific draft (see markAllTargetsNotificationsRead's
  // own comment) - a successful save makes any earlier "ready to review"/
  // "still accurate"/profile-discrepancy note moot regardless of which
  // draft or check it came from, and leaving those behind was reported
  // directly as confusing ("several with the target changes not knowing
  // what changed").
  await markAllTargetsNotificationsRead({ supabase, userId: user.id });

  revalidatePath("/app/targets");
  revalidatePath("/app");
  return {};
}

/** Declining a pending draft - discards the computed payload without
 * locking it in. Doesn't touch the active target profile at all, so
 * whatever was already in effect stays exactly as it was. */
export async function discardTargetsDraftAction(): Promise<TargetsDraftActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  // .select() after .delete() returns the deleted row(s) in one round
  // trip - used here only to grab notification_id, same reasoning as
  // approveTargetsDraftAction's own use of it.
  const { data: deletedDrafts, error } = await supabase
    .from("user_target_profile_drafts")
    .delete()
    .eq("user_id", user.id)
    .select("notification_id");

  if (error) {
    return { error: error.message };
  }

  const notificationId = deletedDrafts?.[0]?.notification_id;
  if (notificationId) {
    await markNotificationRead({ supabase, userId: user.id, notificationId });
  }

  revalidatePath("/app/targets");
  return {};
}

export async function lockTargetsAction(
  _prevState: TargetsActionState,
  formData: FormData,
): Promise<TargetsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const goalText = formData.get("goal_text")?.toString().trim() ?? "";
  const payloadJson = formData.get("payload_json")?.toString() ?? "";
  const source = formData.get("source")?.toString() === "ai" ? "ai" : "heuristic";

  if (!payloadJson) {
    return { error: "Missing generated target data. Please generate targets again." };
  }

  let parsedPayload: TargetGenerationPayload;
  try {
    const rawPayload = JSON.parse(payloadJson);
    parsedPayload = targetGenerationPayloadSchema.parse(rawPayload);
  } catch (error) {
    logServerError("targets.lock", "invalid_payload", {
      userId: user.id,
      error: error instanceof Error ? error.message : "Unknown payload validation error",
    });
    return { error: "The generated target data was invalid. Please generate targets again." };
  }

  const result = await performTargetsLock({ supabase, userId: user.id, goalText, source, payload: parsedPayload });
  if ("error" in result) {
    return { error: result.error };
  }
  return { success: "Targets approved and locked in." };
}

/**
 * Acknowledges a detected profile change without recalculating: re-baselines
 * the active target profile's stored snapshot to the current profile, so the
 * staleness banner stops firing for this specific drift while the locked
 * target numbers themselves are left untouched.
 */
export async function dismissProfileChangeAction(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profileRow } = await supabase
    .from("user_profile")
    .select(
      "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profileRow) {
    return { error: "Profile not found." };
  }

  const profileSnapshot = toProfileForTargets(profileRow);

  const { error } = await supabase
    .from("user_target_profiles")
    .update({ profile_snapshot: profileSnapshot })
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (error) {
    logServerError("targets.dismissProfileChange", "snapshot_update_failed", {
      userId: user.id,
      error: error.message,
    });
    return { error: error.message };
  }

  revalidatePath("/app/targets");

  return {};
}
