"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAiExtractionConfig } from "@/lib/ai/env";
import { analyzeGoalTextWithAi } from "@/lib/ai/goals";
import {
  goalInputSchema,
  heuristicAnalyzeGoalText,
  type GoalAnalysis,
  translateGoalAnalysisToTargets,
  translateGoalTextToTargets,
} from "@/lib/goals";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export type GoalsActionState = {
  error?: string;
  success?: string;
  warning?: string;
  preview?: {
    source: "ai" | "heuristic";
    goalType: string;
    durationDays: number;
    targetDeltaKg: number;
    targetWeightKg: number;
    dailyCalorieDelta: number;
    proteinTargetG: number;
    hydrationTargetL: number;
    stepsTarget: number;
    confidence: number;
    detectedGoals: string[];
    bloodBalanceFocus: boolean;
    sleepFocus: boolean;
  };
};

function normalizeGoalList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 10);
}

async function hasAiGoalConsent({
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

export async function saveGoalAction(
  _prevState: GoalsActionState,
  formData: FormData,
): Promise<GoalsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const parsedInput = goalInputSchema.safeParse({
    freeText: formData.get("goal_text"),
  });
  const intent = formData.get("intent")?.toString() === "analyze" ? "analyze" : "save";

  if (!parsedInput.success) {
    return { error: parsedInput.error.issues[0]?.message ?? "Invalid goal input." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profile")
    .select("weight_kg, activity_level")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { error: "Please complete your profile before saving goals." };
  }

  const profileForGoals = {
    weight_kg: Number(profile.weight_kg),
    activity_level: profile.activity_level,
  };

  const aiConfig = getAiExtractionConfig();
  const hasConsent = aiConfig
    ? await hasAiGoalConsent({ supabase, userId: user.id })
    : false;
  let heuristicReason: string | null = null;

  let analysis: GoalAnalysis | null = null;
  let analysisSource: "ai" | "heuristic" = "heuristic";

  if (aiConfig && hasConsent) {
    try {
      const aiAnalysis = await analyzeGoalTextWithAi({
        config: aiConfig,
        goalText: parsedInput.data.freeText,
      });

      analysis = {
        primaryGoalType: aiAnalysis.primaryGoalType,
        weightDeltaKg: aiAnalysis.weightDeltaKg,
        durationDays: aiAnalysis.durationDays,
        detectedGoals: aiAnalysis.detectedGoals,
        bloodBalanceFocus: aiAnalysis.bloodBalanceFocus,
        sleepFocus: aiAnalysis.sleepFocus,
        confidence: aiAnalysis.confidence,
      };
      analysisSource = "ai";
    } catch (error) {
      heuristicReason = "AI analysis failed at runtime; heuristic fallback was used.";
      logServerError("goals.save", "ai_goal_analysis_failed", {
        userId: user.id,
        error: error instanceof Error ? error.message : "Unknown AI goal analysis error",
      });
    }
  } else if (!aiConfig) {
    heuristicReason = "AI analysis is disabled or missing configuration.";
  } else if (!hasConsent) {
    heuristicReason = "AI consent is missing for this user. Approve AI consent in Documents extraction to enable AI analysis.";
  }

  if (!analysis) {
    analysis = heuristicAnalyzeGoalText(parsedInput.data.freeText);
  }

  const target = analysis
    ? translateGoalAnalysisToTargets({
        analysis,
        profile: profileForGoals,
      })
    : translateGoalTextToTargets({
        freeText: parsedInput.data.freeText,
        profile: profileForGoals,
      });

  if (!analysis) {
    return { error: "Goal analysis could not be completed." };
  }

  if (intent === "analyze") {
    return {
      success: "Analysis ready. Review the suggested targets below.",
      warning: analysisSource === "heuristic" ? heuristicReason ?? undefined : undefined,
      preview: {
        source: analysisSource,
        goalType: target.goalType,
        durationDays: target.durationDays,
        targetDeltaKg: target.targetDeltaKg,
        targetWeightKg: target.targetWeightKg,
        dailyCalorieDelta: target.dailyCalorieDelta,
        proteinTargetG: target.proteinTargetG,
        hydrationTargetL: target.hydrationTargetL,
        stepsTarget: target.stepsTarget,
        confidence: target.confidence,
        detectedGoals: target.detectedGoals,
        bloodBalanceFocus: target.bloodBalanceFocus,
        sleepFocus: target.sleepFocus,
      },
    };
  }

  const { error: deactivateError } = await supabase
    .from("user_goals")
    .update({ is_active: false })
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (deactivateError) {
    logServerError("goals.save", "deactivate_active_goal_failed", {
      userId: user.id,
      error: deactivateError.message,
    });
    return { error: deactivateError.message };
  }

  const { error: insertError } = await supabase.from("user_goals").insert({
    user_id: user.id,
    raw_goal_text: parsedInput.data.freeText,
    goal_type: target.goalType,
    target_delta_kg: target.targetDeltaKg,
    duration_days: target.durationDays,
    target_weight_kg: target.targetWeightKg,
    daily_calorie_delta: target.dailyCalorieDelta,
    protein_target_g: target.proteinTargetG,
    hydration_target_l: target.hydrationTargetL,
    steps_target: target.stepsTarget,
    translation_confidence: target.confidence,
    assumptions: [
      ...target.assumptions,
      ...(analysisSource === "heuristic"
        ? ["AI parsing not used; deterministic goal analysis fallback applied."]
        : []),
    ],
    detected_goals: target.detectedGoals,
    blood_balance_focus: target.bloodBalanceFocus,
    sleep_focus: target.sleepFocus,
    analysis_source: analysisSource,
    is_active: true,
    translated_at: new Date().toISOString(),
  });

  if (insertError) {
    logServerError("goals.save", "insert_goal_failed", {
      userId: user.id,
      error: insertError.message,
    });
    return { error: insertError.message };
  }

  revalidatePath("/app");
  revalidatePath("/app/goals");

  return {
    success: "Goal translated and saved.",
    warning: analysisSource === "heuristic" ? heuristicReason ?? undefined : undefined,
  };
}

export async function updateDetectedGoalAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const reportId = formData.get("report_id")?.toString();
  const goalIndex = Number(formData.get("goal_index"));
  const goalText = formData.get("goal_text")?.toString().trim() ?? "";

  if (!reportId || !Number.isInteger(goalIndex) || goalIndex < 0 || !goalText) {
    return;
  }

  const { data: row, error: rowError } = await supabase
    .from("user_goals")
    .select("detected_goals")
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (rowError || !row) {
    return;
  }

  const goals = normalizeGoalList(row.detected_goals);
  if (goalIndex >= goals.length) {
    return;
  }

  goals[goalIndex] = goalText;

  const { error: updateError } = await supabase
    .from("user_goals")
    .update({ detected_goals: goals })
    .eq("id", reportId)
    .eq("user_id", user.id);

  if (updateError) {
    logServerError("goals.updateDetectedGoal", "update_failed", {
      userId: user.id,
      reportId,
      goalIndex,
      error: updateError.message,
    });
    return;
  }

  revalidatePath("/app/goals");
}

export async function addDetectedGoalAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const reportId = formData.get("report_id")?.toString();
  const goalText = formData.get("goal_text")?.toString().trim() ?? "";

  if (!reportId || !goalText) {
    return;
  }

  const { data: row, error: rowError } = await supabase
    .from("user_goals")
    .select("detected_goals")
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (rowError || !row) {
    return;
  }

  const goals = normalizeGoalList(row.detected_goals);
  if (goals.length >= 10) {
    return;
  }

  goals.push(goalText);

  const { error: updateError } = await supabase
    .from("user_goals")
    .update({ detected_goals: goals })
    .eq("id", reportId)
    .eq("user_id", user.id);

  if (updateError) {
    logServerError("goals.addDetectedGoal", "update_failed", {
      userId: user.id,
      reportId,
      error: updateError.message,
    });
    return;
  }

  revalidatePath("/app/goals");
}

export async function deleteDetectedGoalAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const reportId = formData.get("report_id")?.toString();
  const goalIndex = Number(formData.get("goal_index"));

  if (!reportId || !Number.isInteger(goalIndex) || goalIndex < 0) {
    return;
  }

  const { data: row, error: rowError } = await supabase
    .from("user_goals")
    .select("detected_goals")
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (rowError || !row) {
    return;
  }

  const goals = normalizeGoalList(row.detected_goals);
  if (goalIndex >= goals.length) {
    return;
  }

  goals.splice(goalIndex, 1);

  const { error: updateError } = await supabase
    .from("user_goals")
    .update({ detected_goals: goals })
    .eq("id", reportId)
    .eq("user_id", user.id);

  if (updateError) {
    logServerError("goals.deleteDetectedGoal", "update_failed", {
      userId: user.id,
      reportId,
      goalIndex,
      error: updateError.message,
    });
    return;
  }

  revalidatePath("/app/goals");
}
