"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prepareMedicalContextForTargets } from "@/app/app/documents/actions";
import { ExplicitFieldRequestRejectedError, generateTargetsWithAi, NoActionableChangeError } from "@/lib/ai/targets";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { getRecentCustomTargetLogs } from "@/lib/daily-report";
import { normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import {
  evaluateTargetWeightSafety,
  generateHeuristicTargetProfile,
  mapTargetProfileRowToPayload,
  TARGET_PROFILE_COLUMNS,
  targetGenerationPayloadSchema,
  targetInputSchema,
  toProfileForTargets,
  type ExplicitFieldRequest,
  type ProfileForTargets,
  type TargetGenerationPayload,
} from "@/lib/targets";
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
  explicitFieldRequest,
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
  /** Forwarded to generateTargetsWithAi - see ExplicitFieldRequest's own
   * comment (lib/targets.ts) for what this does and why. */
  explicitFieldRequest?: ExplicitFieldRequest;
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
  /** Set when explicitFieldRequest was provided but the model did not
   * accept the literal requested value as safe - same handling as
   * safetyRejectionMessage (do not treat `payload` as valid; the field in
   * question was NOT changed). */
  explicitFieldRejectionMessage?: string;
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
        explicitFieldRequest,
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

      if (error instanceof ExplicitFieldRequestRejectedError) {
        return {
          payload: currentTargets ?? generateHeuristicTargetProfile({ freeText: goalText, profile, locale }),
          source: "ai",
          heuristicReason: null,
          explicitFieldRejectionMessage: error.message,
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
 * plan-actions.ts's applyActiveTargetsAction/edit-actions.ts's direct-edit
 * writes/runTargetsBackgroundReview's auto-apply, and the onboarding
 * Targets step (src/app/app/onboarding/targets-actions.ts) - every caller
 * trusts its own validation of `payload` against
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
}): Promise<{ error: string } | { success: true; version: number; updatedAt: string }> {
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

  // .select() after .update() returns the just-deactivated row(s) in the
  // same round trip - used here only to read the outgoing row's version,
  // so the new one can increment it (see the version column's own
  // migration comment - a simple, user-facing counter for "which plan is
  // this", shown in the header and quoted in review notifications).
  // Starts at 1 when there's no previous active row (a user's very first
  // plan, e.g. onboarding).
  const { data: deactivatedRows, error: deactivateError } = await supabase
    .from("user_target_profiles")
    .update({ is_active: false, sys_end_date: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("is_active", true)
    .select("version");

  if (deactivateError) {
    logServerError("targets.lock", "deactivate_active_profile_failed", {
      userId: user.id,
      error: deactivateError.message,
    });
    return { error: deactivateError.message };
  }

  const newVersion = (deactivatedRows?.[0]?.version ?? 0) + 1;

  const { data: insertedRows, error: insertError } = await supabase
    .from("user_target_profiles")
    .insert({
    user_id: user.id,
    is_active: true,
    version: newVersion,
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
      activity_name: entry.activityName,
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
  })
    .select("sys_start_date")
    .single();

  if (insertError) {
    logServerError("targets.lock", "insert_failed", {
      userId: user.id,
      error: insertError.message,
    });
    return { error: insertError.message };
  }

  revalidatePath("/app");
  revalidatePath("/app/targets");

  return { success: true, version: newVersion, updatedAt: insertedRows.sys_start_date };
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
