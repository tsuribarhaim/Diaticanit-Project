"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { generateTargetsWithAi } from "@/lib/ai/targets";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { normalizeLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import {
  generateHeuristicTargetProfile,
  mapTargetProfileRowToPayload,
  TARGET_PROFILE_COLUMNS,
  targetGenerationPayloadSchema,
  targetInputSchema,
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
}): Promise<{ payload: TargetGenerationPayload; source: "ai" | "heuristic"; heuristicReason: string | null }> {
  let heuristicReason: string | null = null;
  let payload: TargetGenerationPayload | null = null;
  let source: "ai" | "heuristic" = "heuristic";

  if (aiConfig && hasConsent) {
    try {
      payload = await generateTargetsWithAi({ config: aiConfig, goalText, profile, locale, currentTargets });
      source = "ai";
    } catch (error) {
      heuristicReason = "AI generation failed at runtime; heuristic fallback was used.";
      logServerError("targets.generate", "ai_generation_failed", {
        error: error instanceof Error ? error.message : "Unknown AI targets generation error",
      });
    }
  } else if (!aiConfig) {
    heuristicReason = "AI generation is disabled or missing configuration.";
  } else if (!hasConsent) {
    heuristicReason = "AI consent is missing for this user. Approve AI consent in your profile to enable AI-generated targets.";
  }

  if (!payload) {
    payload = generateHeuristicTargetProfile({ freeText: goalText, profile, locale });
  }

  return { payload, source, heuristicReason };
}

function toProfileForTargets(profile: Record<string, unknown>): ProfileForTargets {
  return {
    age: Number(profile.age ?? 0),
    gender: (profile.gender as string) ?? null,
    biological_sex: (profile.biological_sex as string) ?? null,
    height_cm: Number(profile.height_cm ?? 0),
    weight_kg: Number(profile.weight_kg ?? 0),
    activity_level: (profile.activity_level as ProfileForTargets["activity_level"]) ?? "sedentary",
    allergies: Array.isArray(profile.allergies) ? (profile.allergies as string[]) : [],
    medical_conditions: Array.isArray(profile.medical_conditions) ? (profile.medical_conditions as string[]) : [],
    medical_conditions_details: (profile.medical_conditions_details as string) ?? null,
    regular_medications_details: (profile.regular_medications_details as string) ?? null,
    dietary_preference: (profile.dietary_preference as string) ?? null,
    exercise_modalities: Array.isArray(profile.exercise_modalities) ? (profile.exercise_modalities as string[]) : [],
    exercise_schedule_by_modality:
      (profile.exercise_schedule_by_modality as ProfileForTargets["exercise_schedule_by_modality"]) ?? null,
    habits: Array.isArray(profile.habits) ? (profile.habits as string[]) : [],
    pregnancy_lactation_status: (profile.pregnancy_lactation_status as string) ?? null,
    hot_climate_or_heavy_sweating: Boolean(profile.hot_climate_or_heavy_sweating),
  };
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
      "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating, preferred_language",
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
  const { payload, source, heuristicReason } = await generateTargetsPayload({
    goalText: parsedInput.data.freeText,
    profile,
    locale,
    aiConfig,
    hasConsent,
    currentTargets,
  });

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

    ai_rationale_explanation: parsedPayload.aiRationaleExplanation,
    translation_confidence: parsedPayload.confidence,
    requires_confirmation: source === "heuristic",
    analysis_source: source,
    generator_version: "targets-v1",
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

  return { success: "Targets approved and locked in." };
}
