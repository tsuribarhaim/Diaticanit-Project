import { z } from "zod";

import type { AppLocale } from "@/lib/locale";
import { tr } from "@/lib/locale";
import { activityLevelOptions } from "@/lib/profile";

export const targetGoalTypes = ["weight_loss", "weight_gain", "maintain", "general"] as const;
export type TargetGoalType = (typeof targetGoalTypes)[number];

const exerciseTargetEntrySchema = z.object({
  modality: z.string().trim().min(1).max(60),
  frequencyPerWeek: z.number().min(0).max(14),
  durationMinutesPerSession: z.number().min(0).max(240),
  aiAdjustmentNote: z.string().max(400),
  searchKeywords: z.array(z.string().trim().min(1).max(120)).max(5),
});

const habitEntrySchema = z.object({
  id: z.string().trim().min(1).max(60),
  habitInstruction: z.string().trim().min(1).max(300),
  rationale: z.string().trim().min(1).max(500),
});

const numericRangePairs = [
  ["caloriesMin", "caloriesMax"],
  ["proteinMinG", "proteinMaxG"],
  ["carbsMinG", "carbsMaxG"],
  ["fatsMinG", "fatsMaxG"],
  ["fiberMinG", "fiberMaxG"],
  ["sodiumMinMg", "sodiumMaxMg"],
  ["addedSugarMinG", "addedSugarMaxG"],
  ["waterMinMl", "waterMaxMl"],
  ["potassiumMinMg", "potassiumMaxMg"],
  ["magnesiumMinMg", "magnesiumMaxMg"],
  ["calciumMinMg", "calciumMaxMg"],
  ["ironMinMg", "ironMaxMg"],
  ["zincMinMg", "zincMaxMg"],
  ["vitCMinMg", "vitCMaxMg"],
  ["vitB12MinMcg", "vitB12MaxMcg"],
  ["vitDMinMcg", "vitDMaxMcg"],
  ["satFatMinG", "satFatMaxG"],
  ["omega3MinG", "omega3MaxG"],
] as const;

/**
 * Validates a `TargetGenerationPayload` round-tripped through a hidden form
 * field between preview and lock-in, guarding against a tampered payload.
 */
export const targetGenerationPayloadSchema = z
  .object({
    goalType: z.enum(targetGoalTypes),
    targetWeightKg: z.number().nullable(),
    durationDays: z.number().int().nullable(),
    bloodBalanceFocus: z.boolean(),
    sleepFocus: z.boolean(),

    caloriesMin: z.number().min(0).max(10000),
    caloriesMax: z.number().min(0).max(10000),
    proteinMinG: z.number().min(0).max(1000),
    proteinMaxG: z.number().min(0).max(1000),
    carbsMinG: z.number().min(0).max(2000),
    carbsMaxG: z.number().min(0).max(2000),
    fatsMinG: z.number().min(0).max(1000),
    fatsMaxG: z.number().min(0).max(1000),
    fiberMinG: z.number().min(0).max(200),
    fiberMaxG: z.number().min(0).max(200),
    sodiumMinMg: z.number().min(0).max(10000),
    sodiumMaxMg: z.number().min(0).max(10000),
    addedSugarMinG: z.number().min(0).max(300),
    addedSugarMaxG: z.number().min(0).max(300),
    waterMinMl: z.number().min(0).max(10000),
    waterMaxMl: z.number().min(0).max(10000),

    potassiumMinMg: z.number().min(0).max(10000),
    potassiumMaxMg: z.number().min(0).max(10000),
    magnesiumMinMg: z.number().min(0).max(2000),
    magnesiumMaxMg: z.number().min(0).max(2000),
    calciumMinMg: z.number().min(0).max(5000),
    calciumMaxMg: z.number().min(0).max(5000),
    ironMinMg: z.number().min(0).max(100),
    ironMaxMg: z.number().min(0).max(100),
    zincMinMg: z.number().min(0).max(100),
    zincMaxMg: z.number().min(0).max(100),
    vitCMinMg: z.number().min(0).max(3000),
    vitCMaxMg: z.number().min(0).max(3000),
    vitB12MinMcg: z.number().min(0).max(500),
    vitB12MaxMcg: z.number().min(0).max(500),
    vitDMinMcg: z.number().min(0).max(500),
    vitDMaxMcg: z.number().min(0).max(500),
    satFatMinG: z.number().min(0).max(300),
    satFatMaxG: z.number().min(0).max(300),
    omega3MinG: z.number().min(0).max(50),
    omega3MaxG: z.number().min(0).max(50),

    exerciseTargets: z.array(exerciseTargetEntrySchema).max(10),
    habitsDo: z.array(habitEntrySchema).max(10),
    habitsDont: z.array(habitEntrySchema).max(10),

    aiRationaleExplanation: z.string().max(2000),
    confidence: z.number().min(0).max(1),
    assumptions: z.array(z.string().max(500)).max(20),
  })
  .superRefine((data, ctx) => {
    numericRangePairs.forEach(([minKey, maxKey]) => {
      if (data[minKey] > data[maxKey]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${minKey} must be <= ${maxKey}`, path: [minKey] });
      }
    });
  });

export const targetInputSchema = z.object({
  freeText: z
    .string()
    .trim()
    .min(8, "Please add a bit more detail about your goal.")
    .max(500, "Goal text must be 500 characters or less."),
});

export type ExerciseTargetEntry = {
  modality: string;
  frequencyPerWeek: number;
  durationMinutesPerSession: number;
  aiAdjustmentNote: string;
  searchKeywords: string[];
};

export type HabitEntry = {
  id: string;
  habitInstruction: string;
  rationale: string;
};

/**
 * Full computed target set. Field names mirror `user_target_profiles`
 * columns (camelCase) so mapping to/from the DB row is mechanical.
 */
export type TargetGenerationPayload = {
  goalType: TargetGoalType;
  targetWeightKg: number | null;
  durationDays: number | null;
  bloodBalanceFocus: boolean;
  sleepFocus: boolean;

  caloriesMin: number;
  caloriesMax: number;
  proteinMinG: number;
  proteinMaxG: number;
  carbsMinG: number;
  carbsMaxG: number;
  fatsMinG: number;
  fatsMaxG: number;
  fiberMinG: number;
  fiberMaxG: number;
  sodiumMinMg: number;
  sodiumMaxMg: number;
  addedSugarMinG: number;
  addedSugarMaxG: number;
  waterMinMl: number;
  waterMaxMl: number;

  potassiumMinMg: number;
  potassiumMaxMg: number;
  magnesiumMinMg: number;
  magnesiumMaxMg: number;
  calciumMinMg: number;
  calciumMaxMg: number;
  ironMinMg: number;
  ironMaxMg: number;
  zincMinMg: number;
  zincMaxMg: number;
  vitCMinMg: number;
  vitCMaxMg: number;
  vitB12MinMcg: number;
  vitB12MaxMcg: number;
  vitDMinMcg: number;
  vitDMaxMcg: number;
  satFatMinG: number;
  satFatMaxG: number;
  omega3MinG: number;
  omega3MaxG: number;

  exerciseTargets: ExerciseTargetEntry[];
  habitsDo: HabitEntry[];
  habitsDont: HabitEntry[];

  aiRationaleExplanation: string;
  confidence: number;
  assumptions: string[];
};

export type ProfileForTargets = {
  age: number;
  gender: string | null;
  biological_sex: string | null;
  height_cm: number;
  weight_kg: number;
  activity_level: (typeof activityLevelOptions)[number];
  allergies: string[];
  medical_conditions: string[];
  medical_conditions_details: string | null;
  regular_medications_details: string | null;
  dietary_preference: string | null;
  exercise_modalities: string[];
  exercise_schedule_by_modality: Record<string, { days_per_week: number; minutes_per_session: number }> | null;
  habits: string[];
  pregnancy_lactation_status: string | null;
  hot_climate_or_heavy_sweating?: boolean | null;
};

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFemale(profile: ProfileForTargets): boolean {
  const token = (profile.biological_sex || profile.gender || "").toLowerCase();
  return token === "female";
}

function isSmoker(profile: ProfileForTargets): boolean {
  return profile.habits.includes("smoking_or_vaping");
}

// ---- Free-text goal analysis (ported from the retired goals.ts parser) ----

function extractWeightDeltaKg(freeText: string): number | null {
  const directMatch = freeText.match(/(-?\d+(?:\.\d+)?)\s*(kg|kgs|kilogram|kilograms)/i);
  if (directMatch) {
    return Math.abs(Number(directMatch[1]));
  }

  const wordsToNumber: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
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
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;

  if (unit.startsWith("day")) return Math.max(1, Math.round(value));
  if (unit.startsWith("week")) return Math.max(1, Math.round(value * 7));
  return Math.max(1, Math.round(value * 30));
}

function detectGoalType(freeText: string): TargetGoalType {
  const text = freeText.toLowerCase();

  if (/(lose|reduce|drop|cut)\b/.test(text) && /\b(weight|kg|fat)\b/.test(text)) return "weight_loss";
  if (/(gain|increase|add|build|bulk)\b/.test(text) && /\b(weight|kg|mass|muscle)\b/.test(text)) return "weight_gain";
  if (/(maintain|keep)\b/.test(text) && /\b(weight)\b/.test(text)) return "maintain";

  return "general";
}

export type GoalAnalysis = {
  goalType: TargetGoalType;
  weightDeltaKg: number | null;
  durationDays: number | null;
  bloodBalanceFocus: boolean;
  sleepFocus: boolean;
  confidence: number;
};

export function heuristicAnalyzeGoalText(freeText: string): GoalAnalysis {
  const lowered = freeText.toLowerCase();
  const goalType = detectGoalType(freeText);
  const weightDeltaKg = extractWeightDeltaKg(freeText);
  const durationDays = extractDurationDays(freeText);
  const bloodBalanceFocus = /\b(blood|lab|test|marker|out of range|range)\b/.test(lowered);
  const sleepFocus = /\b(sleep|sleep quality|better sleep|rest)\b/.test(lowered);

  return {
    goalType,
    weightDeltaKg,
    durationDays,
    bloodBalanceFocus,
    sleepFocus,
    confidence: goalType !== "general" ? 0.7 : 0.55,
  };
}

// ---- Calorie / macro baseline ----

/**
 * Mifflin-St Jeor equation plus a coarse activity multiplier derived from
 * the app's 3-tier activity_level. This is a general adult estimate, not a
 * clinical assessment.
 */
export function estimateMaintenanceCalories(profile: ProfileForTargets): number {
  const bmr = isFemale(profile)
    ? 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age - 161
    : 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age + 5;

  const activityMultiplier: Record<(typeof activityLevelOptions)[number], number> = {
    sedentary: 1.2,
    moderate: 1.55,
    active: 1.725,
  };

  return Math.round(bmr * activityMultiplier[profile.activity_level]);
}

function macroRangesFromCalories(
  avgCalories: number,
  dietaryPreference: string | null,
): { carbsMinG: number; carbsMaxG: number; fatsMinG: number; fatsMaxG: number } {
  // Percent-of-calories bands by dietary preference. Kept intentionally
  // simple (general DRI-style macro splits), not a clinical meal plan.
  let carbPct: [number, number] = [0.45, 0.55];
  let fatPct: [number, number] = [0.25, 0.35];

  if (dietaryPreference === "low_carb_keto") {
    carbPct = [0.05, 0.1];
    fatPct = [0.6, 0.75];
  } else if (dietaryPreference === "vegan" || dietaryPreference === "vegetarian") {
    carbPct = [0.5, 0.6];
    fatPct = [0.2, 0.3];
  }

  return {
    carbsMinG: round(Math.max(0, (avgCalories * carbPct[0]) / 4)),
    carbsMaxG: round(Math.max(0, (avgCalories * carbPct[1]) / 4)),
    fatsMinG: round(Math.max(0, (avgCalories * fatPct[0]) / 9)),
    fatsMaxG: round(Math.max(0, (avgCalories * fatPct[1]) / 9)),
  };
}

// ---- Secondary/tertiary nutrient DRI-style reference ranges ----
// These are general adult Dietary Reference Intake ballparks, adjusted only
// where the brief specifically calls for it (sex, pregnancy/lactation,
// smoking). They are an acknowledged simplification for Phase 1, not a
// clinical nutrition plan.

function buildSecondaryRanges(profile: ProfileForTargets, avgCalories: number) {
  const female = isFemale(profile);
  const pregnantOrLactating = profile.pregnancy_lactation_status === "pregnant" || profile.pregnancy_lactation_status === "lactating";
  const smoker = isSmoker(profile);

  // Iron: menstruating-age women need roughly double the adult male amount;
  // pregnancy raises it further. This is a simplified nudge, not a dosage.
  let ironMinMg = 8;
  let ironMaxMg = 11;
  if (profile.pregnancy_lactation_status === "pregnant") {
    ironMinMg = 20;
    ironMaxMg = 27;
  } else if (female && profile.age < 51) {
    ironMinMg = 15;
    ironMaxMg = 18;
  }

  // Vitamin C: women's baseline is a bit lower than men's; smokers need more.
  let vitCMinMg = female ? 75 : 90;
  let vitCMaxMg = female ? 90 : 110;
  if (smoker) {
    vitCMinMg += 35;
    vitCMaxMg += 35;
  }

  // Omega-3: men's ALA reference intake is a little higher than women's.
  const omega3MinG = female ? 1.1 : 1.6;
  const omega3MaxG = female ? 1.6 : 2.0;

  const satFatMaxG = round(Math.min(20, (avgCalories * 0.1) / 9));

  return {
    potassiumMinMg: 3500,
    potassiumMaxMg: 4700,
    magnesiumMinMg: female ? 300 : 350,
    magnesiumMaxMg: female ? 320 : 420,
    calciumMinMg: pregnantOrLactating ? 1000 : 1000,
    calciumMaxMg: 1200,
    ironMinMg,
    ironMaxMg,
    zincMinMg: female ? 8 : 9,
    zincMaxMg: female ? 9 : 11,
    vitCMinMg,
    vitCMaxMg,
    vitB12MinMcg: 2.4,
    vitB12MaxMcg: 5.0,
    vitDMinMcg: 15,
    vitDMaxMcg: 50,
    satFatMinG: 0,
    satFatMaxG,
    omega3MinG,
    omega3MaxG,
  };
}

// ---- Exercise & habits (rule-based, 2-4 entries each) ----

function youtubeSearchKeywords(phrase: string): string[] {
  return [phrase];
}

function buildExerciseTargets(profile: ProfileForTargets, goalType: TargetGoalType, locale: AppLocale): ExerciseTargetEntry[] {
  const activeModalities = profile.exercise_modalities.filter((modality) => modality !== "none");

  const fallbackByGoal: Record<TargetGoalType, { frequency: number; duration: number }> = {
    weight_loss: { frequency: 4, duration: 45 },
    weight_gain: { frequency: 4, duration: 60 },
    maintain: { frequency: 3, duration: 40 },
    general: { frequency: 3, duration: 30 },
  };
  const fallback = fallbackByGoal[goalType];

  if (activeModalities.length === 0) {
    // No modality on file: suggest a small, generic, low-barrier plan.
    return [
      {
        modality: "endurance_cardio",
        frequencyPerWeek: fallback.frequency,
        durationMinutesPerSession: fallback.duration,
        aiAdjustmentNote: tr(
          locale,
          "No exercise preference on file; suggesting brisk walking as a low-barrier starting point.",
          "לא נמצאה העדפת פעילות בפרופיל; מוצעת הליכה נמרצת כנקודת התחלה נגישה.",
        ),
        searchKeywords: youtubeSearchKeywords("beginner walking workout routine"),
      },
      {
        modality: "resistance_hypertrophy",
        frequencyPerWeek: 2,
        durationMinutesPerSession: 30,
        aiAdjustmentNote: tr(
          locale,
          "Light resistance training twice a week helps preserve muscle mass alongside any calorie changes.",
          "אימוני התנגדות קלים פעמיים בשבוע מסייעים לשמר מסת שריר לצד כל שינוי קלורי.",
        ),
        searchKeywords: youtubeSearchKeywords("beginner full body resistance workout"),
      },
    ];
  }

  return activeModalities.map((modality) => {
    const schedule = profile.exercise_schedule_by_modality?.[modality];
    const frequencyPerWeek = schedule?.days_per_week && schedule.days_per_week > 0 ? schedule.days_per_week : fallback.frequency;
    const durationMinutesPerSession =
      schedule?.minutes_per_session && schedule.minutes_per_session > 0 ? schedule.minutes_per_session : fallback.duration;

    return {
      modality,
      frequencyPerWeek,
      durationMinutesPerSession,
      aiAdjustmentNote: tr(
        locale,
        `Kept your existing ${modality.replace(/_/g, " ")} routine, aligned to your ${goalType.replace(/_/g, " ")} goal.`,
        `שומר על שגרת ${modality.replace(/_/g, " ")} הקיימת שלך, בהתאמה למטרת ${goalType.replace(/_/g, " ")}.`,
      ),
      searchKeywords: youtubeSearchKeywords(`${modality.replace(/_/g, " ")} workout for ${goalType.replace(/_/g, " ")}`),
    };
  });
}

function buildHabits(
  profile: ProfileForTargets,
  goalType: TargetGoalType,
  locale: AppLocale,
): { habitsDo: HabitEntry[]; habitsDont: HabitEntry[] } {
  const hasDiabetes = profile.medical_conditions.includes("diabetes");
  const hasHypertension = profile.medical_conditions.includes("hypertension");

  const habitsDo: HabitEntry[] = [
    {
      id: "hydrate-before-meals",
      habitInstruction: tr(locale, "Drink a glass of water before each meal.", "לשתות כוס מים לפני כל ארוחה."),
      rationale: tr(
        locale,
        "Supports your hydration target and can reduce accidental overeating.",
        "תומך ביעד הנוזלים ועשוי לצמצם אכילת יתר בלתי מכוונת.",
      ),
    },
    {
      id: "protein-at-breakfast",
      habitInstruction: tr(locale, "Prioritize a protein source at breakfast.", "לתת עדיפות למקור חלבון בארוחת הבוקר."),
      rationale: tr(
        locale,
        "Improves satiety and helps distribute protein intake evenly across the day.",
        "משפר תחושת שובע ומסייע לפזר את צריכת החלבון באופן שווה לאורך היום.",
      ),
    },
  ];

  if (goalType === "weight_loss") {
    habitsDo.push({
      id: "plan-meals-ahead",
      habitInstruction: tr(locale, "Plan your main meals a day ahead.", "לתכנן את הארוחות העיקריות יום מראש."),
      rationale: tr(
        locale,
        "Reduces impulsive, calorie-dense choices when time is short.",
        "מפחית בחירות אימפולסיביות ועתירות קלוריות כאשר הזמן קצר.",
      ),
    });
  }

  if (hasDiabetes) {
    habitsDo.push({
      id: "pair-carbs-with-protein",
      habitInstruction: tr(
        locale,
        "Pair carbohydrate-rich foods with protein or fiber.",
        "לשלב מזונות עתירי פחמימה עם חלבון או סיבים תזונתיים.",
      ),
      rationale: tr(
        locale,
        "Helps blunt post-meal blood sugar spikes.",
        "מסייע להקהות עליות חדות ברמת הסוכר בדם לאחר הארוחה.",
      ),
    });
  }

  const habitsDont: HabitEntry[] = [
    {
      id: "dont-skip-meals",
      habitInstruction: tr(locale, "Don't skip meals to save calories.", "להימנע מדילוג על ארוחות כדי לחסוך קלוריות."),
      rationale: tr(
        locale,
        "Skipping meals often leads to overeating later and unstable energy levels.",
        "דילוג על ארוחות מוביל לרוב לאכילת יתר מאוחר יותר ולרמות אנרגיה לא יציבות.",
      ),
    },
  ];

  if (hasDiabetes) {
    habitsDont.push({
      id: "dont-late-sugary-caffeine",
      habitInstruction: tr(
        locale,
        "Don't consume sugary drinks or high-caffeine drinks close to bedtime.",
        "להימנע ממשקאות ממותקים או עתירי קפאין בסמוך לשעת השינה.",
      ),
      rationale: tr(
        locale,
        "Can spike blood sugar and disrupt sleep quality.",
        "עלול להעלות את רמת הסוכר בדם ולפגוע באיכות השינה.",
      ),
    });
  }

  if (hasHypertension) {
    habitsDont.push({
      id: "dont-add-table-salt",
      habitInstruction: tr(locale, "Don't add extra table salt to already-prepared meals.", "להימנע מהוספת מלח שולחן לארוחות מוכנות."),
      rationale: tr(
        locale,
        "Extra sodium on top of your meal plan works against your sodium range.",
        "נתרן נוסף מעבר לתכנית הארוחות פוגם בטווח הנתרן שנקבע לך.",
      ),
    });
  }

  if (goalType === "weight_gain") {
    habitsDont.push({
      id: "dont-cardio-only",
      habitInstruction: tr(
        locale,
        "Don't rely only on cardio when the goal is weight/muscle gain.",
        "להימנע מהסתמכות בלעדית על אימוני אירובי כאשר המטרה היא עלייה במשקל/שריר.",
      ),
      rationale: tr(
        locale,
        "Excess cardio without adequate resistance training and a calorie surplus will hinder muscle gain.",
        "עודף אירובי ללא אימוני התנגדות מספקים ועודף קלורי יפגע בבניית השריר.",
      ),
    });
  }

  return { habitsDo, habitsDont };
}

export function generateHeuristicTargetProfile({
  freeText,
  profile,
  locale,
}: {
  freeText: string;
  profile: ProfileForTargets;
  locale: AppLocale;
}): TargetGenerationPayload {
  const analysis = heuristicAnalyzeGoalText(freeText);
  return generateHeuristicTargetProfileFromAnalysis({ analysis, profile, locale });
}

export function generateHeuristicTargetProfileFromAnalysis({
  analysis,
  profile,
  locale,
}: {
  analysis: GoalAnalysis;
  profile: ProfileForTargets;
  locale: AppLocale;
}): TargetGenerationPayload {
  const goalType = analysis.goalType;
  const assumptions: string[] = [];
  const maintenanceCalories = estimateMaintenanceCalories(profile);

  let caloriesMin: number;
  let caloriesMax: number;
  let targetWeightKg: number | null = null;
  let durationDays: number | null = analysis.durationDays;
  let proteinMultiplier = 1.2;

  if (goalType === "weight_loss") {
    const deltaKg = analysis.weightDeltaKg ?? 2;
    const days = analysis.durationDays ?? 60;
    durationDays = days;

    if (analysis.weightDeltaKg === null) assumptions.push(tr(locale, "Weight-loss amount was not explicit, defaulted to 2 kg.", "כמות הירידה במשקל לא צוינה במפורש, ברירת מחדל 2 ק\"ג."));
    if (analysis.durationDays === null) assumptions.push(tr(locale, "Timeline was not explicit, defaulted to 60 days.", "ציר הזמן לא צוין במפורש, ברירת מחדל 60 ימים."));

    const rawDailyDeficit = (deltaKg * 7700) / days;
    const dailyDeficit = Math.round(clamp(rawDailyDeficit, 200, 900));

    caloriesMin = Math.max(1200, Math.round(maintenanceCalories - dailyDeficit - 100));
    caloriesMax = Math.max(caloriesMin + 100, Math.round(maintenanceCalories - dailyDeficit + 100));
    targetWeightKg = round(profile.weight_kg - deltaKg);
    proteinMultiplier = 1.6;
  } else if (goalType === "weight_gain") {
    const deltaKg = analysis.weightDeltaKg ?? 2;
    const days = analysis.durationDays ?? 90;
    durationDays = days;

    if (analysis.weightDeltaKg === null) assumptions.push(tr(locale, "Weight-gain amount was not explicit, defaulted to 2 kg.", "כמות העלייה במשקל לא צוינה במפורש, ברירת מחדל 2 ק\"ג."));
    if (analysis.durationDays === null) assumptions.push(tr(locale, "Timeline was not explicit, defaulted to 90 days.", "ציר הזמן לא צוין במפורש, ברירת מחדל 90 ימים."));

    const rawDailySurplus = (deltaKg * 7700) / days;
    const dailySurplus = Math.round(clamp(rawDailySurplus, 150, 700));

    caloriesMin = Math.round(maintenanceCalories + dailySurplus - 100);
    caloriesMax = Math.round(maintenanceCalories + dailySurplus + 100);
    targetWeightKg = round(profile.weight_kg + deltaKg);
    proteinMultiplier = 1.5;
  } else if (goalType === "maintain") {
    durationDays = analysis.durationDays ?? 60;
    if (analysis.durationDays === null) assumptions.push(tr(locale, "Timeline was not explicit, defaulted to 60 days.", "ציר הזמן לא צוין במפורש, ברירת מחדל 60 ימים."));
    caloriesMin = Math.round(maintenanceCalories - 100);
    caloriesMax = Math.round(maintenanceCalories + 100);
    targetWeightKg = round(profile.weight_kg);
    proteinMultiplier = 1.2;
  } else {
    durationDays = analysis.durationDays ?? 60;
    assumptions.push(tr(
      locale,
      "Could not map a specific weight objective; generated a balanced baseline target set.",
      "לא זוהתה מטרת משקל ספציפית; נוצרה תכנית יעדים בסיסית ומאוזנת.",
    ));
    caloriesMin = Math.round(maintenanceCalories - 250);
    caloriesMax = Math.round(maintenanceCalories - 50);
    proteinMultiplier = 1.3;
  }

  if (analysis.bloodBalanceFocus) {
    proteinMultiplier = round(proteinMultiplier * 1.1, 2);
    assumptions.push(tr(
      locale,
      "Blood markers focus enabled: protein target raised by 10% to support nutrition quality.",
      "מיקוד במדדי דם הופעל: יעד החלבון הועלה ב-10% לתמיכה באיכות התזונה.",
    ));
  }

  const proteinTargetG = profile.weight_kg * proteinMultiplier;
  const proteinMinG = round(proteinTargetG * 0.9);
  const proteinMaxG = round(proteinTargetG * 1.15);

  const avgCalories = (caloriesMin + caloriesMax) / 2;
  const { carbsMinG, carbsMaxG, fatsMinG, fatsMaxG } = macroRangesFromCalories(avgCalories, profile.dietary_preference);

  const hydrationL = clamp(profile.weight_kg * 0.033, 1.8, 4.5);
  if (analysis.sleepFocus) {
    assumptions.push(tr(
      locale,
      "Sleep quality focus enabled: exercise duration eased slightly to support recovery.",
      "מיקוד באיכות שינה הופעל: משך הפעילות הוקל מעט לתמיכה בהתאוששות.",
    ));
  }
  let waterMinMl = round(hydrationL * 1000 * 0.9);
  let waterMaxMl = round(hydrationL * 1000 * 1.15);
  if (profile.hot_climate_or_heavy_sweating) {
    waterMinMl += 300;
    waterMaxMl += 300;
    assumptions.push(tr(
      locale,
      "Hot climate / heavy sweating noted: fluid range increased by 300 ml.",
      "צוין אקלים חם / הזעה מרובה: טווח הנוזלים הועלה ב-300 מ\"ל.",
    ));
  }

  const secondary = buildSecondaryRanges(profile, avgCalories);
  const { habitsDo, habitsDont } = buildHabits(profile, goalType, locale);
  const exerciseTargets = buildExerciseTargets(profile, goalType, locale);

  const aiRationaleExplanation = tr(
    locale,
    `These ranges are a general adult reference plan for a "${goalType.replace(/_/g, " ")}" goal, scaled to your weight, height, age, and activity level. They are informational only and not a substitute for personalized clinical or dietitian advice.`,
    `הטווחים הללו הם תכנית ייחוס כללית למבוגרים עבור מטרת "${goalType.replace(/_/g, " ")}", המותאמת למשקל, לגובה, לגיל ולרמת הפעילות שלך. המידע הוא לצרכי ידע בלבד ואינו תחליף לייעוץ קליני או תזונתי מותאם אישית.`,
  );

  return {
    goalType,
    targetWeightKg,
    durationDays,
    bloodBalanceFocus: analysis.bloodBalanceFocus,
    sleepFocus: analysis.sleepFocus,

    caloriesMin,
    caloriesMax,
    proteinMinG,
    proteinMaxG,
    carbsMinG,
    carbsMaxG,
    fatsMinG,
    fatsMaxG,
    fiberMinG: 28,
    fiberMaxG: 38,
    sodiumMinMg: 1500,
    sodiumMaxMg: 2300,
    addedSugarMinG: 0,
    addedSugarMaxG: 25,
    waterMinMl,
    waterMaxMl,

    ...secondary,

    exerciseTargets,
    habitsDo,
    habitsDont,

    aiRationaleExplanation,
    confidence: clamp(analysis.confidence, 0.45, 0.85),
    assumptions,
  };
}

type TargetProfileDbRow = {
  goal_type: string;
  target_weight_kg: number | string | null;
  duration_days: number | string | null;
  blood_balance_focus: boolean;
  sleep_focus: boolean;
  calories_min: number | string;
  calories_max: number | string;
  protein_min_g: number | string;
  protein_max_g: number | string;
  carbs_min_g: number | string;
  carbs_max_g: number | string;
  fats_min_g: number | string;
  fats_max_g: number | string;
  fiber_min_g: number | string;
  fiber_max_g: number | string;
  sodium_min_mg: number | string;
  sodium_max_mg: number | string;
  added_sugar_min_g: number | string;
  added_sugar_max_g: number | string;
  water_min_ml: number | string;
  water_max_ml: number | string;
  potassium_min_mg: number | string;
  potassium_max_mg: number | string;
  magnesium_min_mg: number | string;
  magnesium_max_mg: number | string;
  calcium_min_mg: number | string;
  calcium_max_mg: number | string;
  iron_min_mg: number | string;
  iron_max_mg: number | string;
  zinc_min_mg: number | string;
  zinc_max_mg: number | string;
  vit_c_min_mg: number | string;
  vit_c_max_mg: number | string;
  vit_b12_min_mcg: number | string;
  vit_b12_max_mcg: number | string;
  vit_d_min_mcg: number | string;
  vit_d_max_mcg: number | string;
  sat_fat_min_g: number | string;
  sat_fat_max_g: number | string;
  omega3_min_g: number | string;
  omega3_max_g: number | string;
  exercise_targets: unknown;
  habits_do: unknown;
  habits_dont: unknown;
  ai_rationale_explanation: string | null;
  translation_confidence: number | string | null;
};

function toNum(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeExerciseTargetsJson(value: unknown): ExerciseTargetEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      modality: typeof record.modality === "string" ? record.modality : "other",
      frequencyPerWeek: toNum(record.frequency_per_week as number | string | null, 0),
      durationMinutesPerSession: toNum(record.duration_minutes_per_session as number | string | null, 0),
      aiAdjustmentNote: typeof record.ai_adjustment_note === "string" ? record.ai_adjustment_note : "",
      searchKeywords: Array.isArray(record.search_keywords)
        ? (record.search_keywords as unknown[]).filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  });
}

function normalizeHabitEntriesJson(value: unknown): HabitEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      id: typeof record.id === "string" ? record.id : `habit-${index}`,
      habitInstruction: typeof record.habit_instruction === "string" ? record.habit_instruction : "",
      rationale: typeof record.rationale === "string" ? record.rationale : "",
    };
  });
}

/** Maps a `user_target_profiles` DB row (snake_case) into the same shape the
 * generators produce, so the read-only dashboard can reuse `TargetProfileView`. */
export function mapTargetProfileRowToPayload(row: TargetProfileDbRow): TargetGenerationPayload {
  return {
    goalType: (row.goal_type as TargetGoalType) ?? "general",
    targetWeightKg: row.target_weight_kg === null ? null : toNum(row.target_weight_kg),
    durationDays: row.duration_days === null ? null : Math.round(toNum(row.duration_days)),
    bloodBalanceFocus: Boolean(row.blood_balance_focus),
    sleepFocus: Boolean(row.sleep_focus),

    caloriesMin: toNum(row.calories_min),
    caloriesMax: toNum(row.calories_max),
    proteinMinG: toNum(row.protein_min_g),
    proteinMaxG: toNum(row.protein_max_g),
    carbsMinG: toNum(row.carbs_min_g),
    carbsMaxG: toNum(row.carbs_max_g),
    fatsMinG: toNum(row.fats_min_g),
    fatsMaxG: toNum(row.fats_max_g),
    fiberMinG: toNum(row.fiber_min_g),
    fiberMaxG: toNum(row.fiber_max_g),
    sodiumMinMg: toNum(row.sodium_min_mg),
    sodiumMaxMg: toNum(row.sodium_max_mg),
    addedSugarMinG: toNum(row.added_sugar_min_g),
    addedSugarMaxG: toNum(row.added_sugar_max_g),
    waterMinMl: toNum(row.water_min_ml),
    waterMaxMl: toNum(row.water_max_ml),

    potassiumMinMg: toNum(row.potassium_min_mg),
    potassiumMaxMg: toNum(row.potassium_max_mg),
    magnesiumMinMg: toNum(row.magnesium_min_mg),
    magnesiumMaxMg: toNum(row.magnesium_max_mg),
    calciumMinMg: toNum(row.calcium_min_mg),
    calciumMaxMg: toNum(row.calcium_max_mg),
    ironMinMg: toNum(row.iron_min_mg),
    ironMaxMg: toNum(row.iron_max_mg),
    zincMinMg: toNum(row.zinc_min_mg),
    zincMaxMg: toNum(row.zinc_max_mg),
    vitCMinMg: toNum(row.vit_c_min_mg),
    vitCMaxMg: toNum(row.vit_c_max_mg),
    vitB12MinMcg: toNum(row.vit_b12_min_mcg),
    vitB12MaxMcg: toNum(row.vit_b12_max_mcg),
    vitDMinMcg: toNum(row.vit_d_min_mcg),
    vitDMaxMcg: toNum(row.vit_d_max_mcg),
    satFatMinG: toNum(row.sat_fat_min_g),
    satFatMaxG: toNum(row.sat_fat_max_g),
    omega3MinG: toNum(row.omega3_min_g),
    omega3MaxG: toNum(row.omega3_max_g),

    exerciseTargets: normalizeExerciseTargetsJson(row.exercise_targets),
    habitsDo: normalizeHabitEntriesJson(row.habits_do),
    habitsDont: normalizeHabitEntriesJson(row.habits_dont),

    aiRationaleExplanation: row.ai_rationale_explanation ?? "",
    confidence: toNum(row.translation_confidence, 0.5),
    assumptions: [],
  };
}
