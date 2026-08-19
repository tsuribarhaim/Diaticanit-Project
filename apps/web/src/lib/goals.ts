import { z } from "zod";

import { activityLevelOptions } from "@/lib/profile";

export const goalTypes = ["weight_loss", "weight_gain", "maintain", "general"] as const;

export const goalInputSchema = z.object({
  freeText: z
    .string()
    .trim()
    .min(8, "Please add a bit more detail about your goal.")
    .max(500, "Goal text must be 500 characters or less."),
});

export type GoalType = (typeof goalTypes)[number];

type UserProfileForGoals = {
  weight_kg: number;
  activity_level: (typeof activityLevelOptions)[number];
};

export type GoalTargetResult = {
  goalType: GoalType;
  targetDeltaKg: number | null;
  durationDays: number | null;
  targetWeightKg: number | null;
  dailyCalorieDelta: number;
  proteinTargetG: number;
  hydrationTargetL: number;
  stepsTarget: number;
  confidence: number;
  detectedGoals: string[];
  bloodBalanceFocus: boolean;
  sleepFocus: boolean;
  assumptions: string[];
};

export type GoalAnalysis = {
  primaryGoalType: GoalType;
  weightDeltaKg: number | null;
  durationDays: number | null;
  detectedGoals: string[];
  bloodBalanceFocus: boolean;
  sleepFocus: boolean;
  confidence: number;
};

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function extractWeightDeltaKg(freeText: string): number | null {
  const directMatch = freeText.match(/(-?\d+(?:\.\d+)?)\s*(kg|kgs|kilogram|kilograms)/i);
  if (directMatch) {
    return Math.abs(Number(directMatch[1]));
  }

  const wordsToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  const wordMatch = freeText.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b\s*(kg|kilogram|kilograms)/i);
  if (wordMatch) {
    const value = wordsToNumber[wordMatch[1].toLowerCase()];
    return typeof value === "number" ? value : null;
  }

  return null;
}

function extractDurationDays(freeText: string): number | null {
  const match = freeText.match(/(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months)/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (unit.startsWith("day")) {
    return Math.max(1, Math.round(value));
  }
  if (unit.startsWith("week")) {
    return Math.max(1, Math.round(value * 7));
  }
  return Math.max(1, Math.round(value * 30));
}

function detectGoalType(freeText: string): GoalType {
  const text = freeText.toLowerCase();

  if (/(lose|reduce|drop|cut)\b/.test(text) && /\b(weight|kg|fat)\b/.test(text)) {
    return "weight_loss";
  }

  if (/(gain|increase|add)\b/.test(text) && /\b(weight|kg|mass)\b/.test(text)) {
    return "weight_gain";
  }

  if (/(maintain|keep)\b/.test(text) && /\b(weight)\b/.test(text)) {
    return "maintain";
  }

  return "general";
}

function detectGoalsList(freeText: string): string[] {
  const text = freeText.toLowerCase();
  const goals: string[] = [];

  if (/(lose|reduce|drop|cut)\b/.test(text) && /\b(weight|kg|fat)\b/.test(text)) {
    goals.push("Reduce body weight");
  }
  if (/(gain|increase|add)\b/.test(text) && /\b(weight|kg|mass)\b/.test(text)) {
    goals.push("Increase body weight");
  }
  if (/(maintain|keep)\b/.test(text) && /\bweight\b/.test(text)) {
    goals.push("Maintain body weight");
  }
  if (/\b(blood|lab|test|marker|out of range|range)\b/.test(text)) {
    goals.push("Improve out-of-range blood test markers");
  }
  if (/\b(sleep|sleep quality|better sleep|rest)\b/.test(text)) {
    goals.push("Improve sleep quality");
  }

  if (!goals.length) {
    goals.push("General wellness improvement");
  }

  return Array.from(new Set(goals));
}

export function heuristicAnalyzeGoalText(freeText: string): GoalAnalysis {
  const goalType = detectGoalType(freeText);
  const weightDeltaKg = extractWeightDeltaKg(freeText);
  const durationDays = extractDurationDays(freeText);
  const detectedGoals = detectGoalsList(freeText);
  const lowered = freeText.toLowerCase();

  return {
    primaryGoalType: goalType,
    weightDeltaKg,
    durationDays,
    detectedGoals,
    bloodBalanceFocus: /\b(blood|lab|test|marker|out of range|range)\b/.test(lowered),
    sleepFocus: /\b(sleep|sleep quality|better sleep|rest)\b/.test(lowered),
    confidence: detectedGoals.length > 1 ? 0.7 : 0.62,
  };
}

function buildBaseTargets(profile: UserProfileForGoals): Pick<GoalTargetResult, "proteinTargetG" | "hydrationTargetL" | "stepsTarget"> {
  const hydrationTargetL = roundTo(Math.min(4.5, Math.max(1.8, profile.weight_kg * 0.033)), 2);

  const stepsByActivity: Record<(typeof activityLevelOptions)[number], number> = {
    sedentary: 8000,
    moderate: 9500,
    active: 11000,
  };

  return {
    proteinTargetG: roundTo(profile.weight_kg * 1.2, 1),
    hydrationTargetL,
    stepsTarget: stepsByActivity[profile.activity_level],
  };
}

export function translateGoalTextToTargets({
  freeText,
  profile,
}: {
  freeText: string;
  profile: UserProfileForGoals;
}): GoalTargetResult {
  return translateGoalAnalysisToTargets({
    analysis: heuristicAnalyzeGoalText(freeText),
    profile,
  });
}

export function translateGoalAnalysisToTargets({
  analysis,
  profile,
}: {
  analysis: GoalAnalysis;
  profile: UserProfileForGoals;
}): GoalTargetResult {
  const goalType = analysis.primaryGoalType;
  const targetDeltaKg = analysis.weightDeltaKg;
  const durationDays = analysis.durationDays;

  const base = buildBaseTargets(profile);
  const assumptions: string[] = [];

  function applyFocusAdjustments(input: {
    proteinTargetG: number;
    stepsTarget: number;
  }): { proteinTargetG: number; stepsTarget: number } {
    let proteinTargetG = input.proteinTargetG;
    let stepsTarget = input.stepsTarget;

    if (analysis.bloodBalanceFocus) {
      proteinTargetG = roundTo(proteinTargetG * 1.1, 1);
      assumptions.push("Blood markers focus enabled: protein target raised by 10% to support nutrition quality.");
    }

    if (analysis.sleepFocus) {
      stepsTarget = Math.max(7000, stepsTarget - 1000);
      assumptions.push("Sleep quality focus enabled: activity target reduced by 1,000 steps to support recovery.");
    }

    return { proteinTargetG, stepsTarget };
  }

  if (goalType === "weight_loss") {
    const deltaKg = targetDeltaKg ?? 2;
    const days = durationDays ?? 60;

    if (targetDeltaKg === null) {
      assumptions.push("Weight-loss amount was not explicit, defaulted to 2 kg.");
    }
    if (durationDays === null) {
      assumptions.push("Timeline was not explicit, defaulted to 60 days.");
    }

    const rawDailyDeficit = (deltaKg * 7700) / days;
    const dailyDeficit = Math.round(Math.min(900, Math.max(200, rawDailyDeficit)));

    if (dailyDeficit !== Math.round(rawDailyDeficit)) {
      assumptions.push("Calorie deficit was safety-bounded to a practical range.");
    }

    const adjustedTargets = applyFocusAdjustments({
      proteinTargetG: roundTo(profile.weight_kg * 1.6, 1),
      stepsTarget: base.stepsTarget,
    });

    return {
      goalType,
      targetDeltaKg: deltaKg,
      durationDays: days,
      targetWeightKg: roundTo(profile.weight_kg - deltaKg, 1),
      dailyCalorieDelta: -dailyDeficit,
      proteinTargetG: adjustedTargets.proteinTargetG,
      hydrationTargetL: base.hydrationTargetL,
      stepsTarget: adjustedTargets.stepsTarget,
      confidence: Math.max(0.5, Math.min(0.95, analysis.confidence || 0.7)),
      detectedGoals: analysis.detectedGoals,
      bloodBalanceFocus: analysis.bloodBalanceFocus,
      sleepFocus: analysis.sleepFocus,
      assumptions,
    };
  }

  if (goalType === "weight_gain") {
    const deltaKg = targetDeltaKg ?? 2;
    const days = durationDays ?? 90;

    if (targetDeltaKg === null) {
      assumptions.push("Weight-gain amount was not explicit, defaulted to 2 kg.");
    }
    if (durationDays === null) {
      assumptions.push("Timeline was not explicit, defaulted to 90 days.");
    }

    const rawDailySurplus = (deltaKg * 7700) / days;
    const dailySurplus = Math.round(Math.min(700, Math.max(150, rawDailySurplus)));

    const adjustedTargets = applyFocusAdjustments({
      proteinTargetG: roundTo(profile.weight_kg * 1.5, 1),
      stepsTarget: base.stepsTarget,
    });

    return {
      goalType,
      targetDeltaKg: deltaKg,
      durationDays: days,
      targetWeightKg: roundTo(profile.weight_kg + deltaKg, 1),
      dailyCalorieDelta: dailySurplus,
      proteinTargetG: adjustedTargets.proteinTargetG,
      hydrationTargetL: base.hydrationTargetL,
      stepsTarget: adjustedTargets.stepsTarget,
      confidence: Math.max(0.5, Math.min(0.95, analysis.confidence || 0.68)),
      detectedGoals: analysis.detectedGoals,
      bloodBalanceFocus: analysis.bloodBalanceFocus,
      sleepFocus: analysis.sleepFocus,
      assumptions,
    };
  }

  if (goalType === "maintain") {
    const adjustedTargets = applyFocusAdjustments({
      proteinTargetG: base.proteinTargetG,
      stepsTarget: base.stepsTarget,
    });

    return {
      goalType,
      targetDeltaKg: 0,
      durationDays: durationDays ?? 60,
      targetWeightKg: roundTo(profile.weight_kg, 1),
      dailyCalorieDelta: 0,
      proteinTargetG: adjustedTargets.proteinTargetG,
      hydrationTargetL: base.hydrationTargetL,
      stepsTarget: adjustedTargets.stepsTarget,
      confidence: Math.max(0.5, Math.min(0.95, analysis.confidence || 0.72)),
      detectedGoals: analysis.detectedGoals,
      bloodBalanceFocus: analysis.bloodBalanceFocus,
      sleepFocus: analysis.sleepFocus,
      assumptions: durationDays ? assumptions : ["Timeline was not explicit, defaulted to 60 days."],
    };
  }

  assumptions.push("Could not map a specific weight objective; generated a balanced baseline target set.");

  const adjustedTargets = applyFocusAdjustments({
    proteinTargetG: base.proteinTargetG,
    stepsTarget: base.stepsTarget,
  });

  return {
    goalType,
    targetDeltaKg: null,
    durationDays: durationDays ?? 60,
    targetWeightKg: null,
    dailyCalorieDelta: -150,
    proteinTargetG: adjustedTargets.proteinTargetG,
    hydrationTargetL: base.hydrationTargetL,
    stepsTarget: adjustedTargets.stepsTarget,
    confidence: Math.max(0.45, Math.min(0.85, analysis.confidence || 0.55)),
    detectedGoals: analysis.detectedGoals,
    bloodBalanceFocus: analysis.bloodBalanceFocus,
    sleepFocus: analysis.sleepFocus,
    assumptions,
  };
}
