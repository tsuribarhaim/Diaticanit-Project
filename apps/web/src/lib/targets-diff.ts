import { formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";

export type MetricDiffRow = { labelEn: string; labelHe: string; before: string; after: string };

const NUTRIENT_DIFF_FIELDS: Array<{
  labelEn: string;
  labelHe: string;
  minKey: keyof TargetGenerationPayload;
  maxKey: keyof TargetGenerationPayload;
  unit: string;
}> = [
  { labelEn: "Calories", labelHe: "קלוריות", minKey: "caloriesMin", maxKey: "caloriesMax", unit: "kcal" },
  { labelEn: "Protein", labelHe: "חלבון", minKey: "proteinMinG", maxKey: "proteinMaxG", unit: "g" },
  { labelEn: "Carbohydrates", labelHe: "פחמימות", minKey: "carbsMinG", maxKey: "carbsMaxG", unit: "g" },
  { labelEn: "Fats", labelHe: "שומנים", minKey: "fatsMinG", maxKey: "fatsMaxG", unit: "g" },
  { labelEn: "Dietary Fiber", labelHe: "סיבים תזונתיים", minKey: "fiberMinG", maxKey: "fiberMaxG", unit: "g" },
  { labelEn: "Sodium", labelHe: "נתרן", minKey: "sodiumMinMg", maxKey: "sodiumMaxMg", unit: "mg" },
  { labelEn: "Added Sugars", labelHe: "סוכרים מוספים", minKey: "addedSugarMinG", maxKey: "addedSugarMaxG", unit: "g" },
  { labelEn: "Fluid / Water", labelHe: "נוזלים", minKey: "waterMinMl", maxKey: "waterMaxMl", unit: "ml" },
  { labelEn: "Potassium", labelHe: "אשלגן", minKey: "potassiumMinMg", maxKey: "potassiumMaxMg", unit: "mg" },
  { labelEn: "Magnesium", labelHe: "מגנזיום", minKey: "magnesiumMinMg", maxKey: "magnesiumMaxMg", unit: "mg" },
  { labelEn: "Calcium", labelHe: "סידן", minKey: "calciumMinMg", maxKey: "calciumMaxMg", unit: "mg" },
  { labelEn: "Iron", labelHe: "ברזל", minKey: "ironMinMg", maxKey: "ironMaxMg", unit: "mg" },
  { labelEn: "Zinc", labelHe: "אבץ", minKey: "zincMinMg", maxKey: "zincMaxMg", unit: "mg" },
  { labelEn: "Vitamin C", labelHe: "ויטמין C", minKey: "vitCMinMg", maxKey: "vitCMaxMg", unit: "mg" },
  { labelEn: "Vitamin B12", labelHe: "ויטמין B12", minKey: "vitB12MinMcg", maxKey: "vitB12MaxMcg", unit: "mcg" },
  { labelEn: "Vitamin D", labelHe: "ויטמין D", minKey: "vitDMinMcg", maxKey: "vitDMaxMcg", unit: "mcg" },
  { labelEn: "Saturated Fat", labelHe: "שומן רווי", minKey: "satFatMinG", maxKey: "satFatMaxG", unit: "g" },
  { labelEn: "Omega-3", labelHe: "אומגה 3", minKey: "omega3MinG", maxKey: "omega3MaxG", unit: "g" },
];

function exerciseSummary(payload: TargetGenerationPayload): string {
  return payload.exerciseTargets
    .map((entry) => `${entry.modality} ${entry.frequencyPerWeek}x/${entry.durationMinutesPerSession}min`)
    .sort()
    .join(", ");
}

function habitsSummary(payload: TargetGenerationPayload): string {
  return [...payload.habitsDo, ...payload.habitsDont]
    .map((habit) => habit.habitInstruction)
    .sort()
    .join(" | ");
}

function userTargetsSummary(payload: TargetGenerationPayload): string {
  return payload.userTargets
    .map((entry) => `${entry.label}: ${entry.value}`)
    .sort()
    .join(" | ");
}

/** Compares every quantifiable field (all nutrient ranges, exercise plan,
 * habits, goal metadata) between two target payloads - deliberately excludes
 * free-text fields that can vary cosmetically (aiRationaleExplanation,
 * confidence, assumptions) even when the actual targets are unchanged. */
export function computeTargetsDiff(before: TargetGenerationPayload, after: TargetGenerationPayload, locale: AppLocale): MetricDiffRow[] {
  const rows: MetricDiffRow[] = [];
  const n = (value: number) => formatNumberForLocale(value, locale, { maximumFractionDigits: 1 });

  for (const field of NUTRIENT_DIFF_FIELDS) {
    const beforeMin = before[field.minKey] as number;
    const beforeMax = before[field.maxKey] as number;
    const afterMin = after[field.minKey] as number;
    const afterMax = after[field.maxKey] as number;
    if (beforeMin === afterMin && beforeMax === afterMax) continue;
    rows.push({
      labelEn: field.labelEn,
      labelHe: field.labelHe,
      before: `${n(beforeMin)}–${n(beforeMax)} ${field.unit}`,
      after: `${n(afterMin)}–${n(afterMax)} ${field.unit}`,
    });
  }

  const beforeExercise = exerciseSummary(before);
  const afterExercise = exerciseSummary(after);
  if (beforeExercise !== afterExercise) {
    rows.push({ labelEn: "Exercise plan", labelHe: "תכנית פעילות", before: beforeExercise, after: afterExercise });
  }

  const beforeHabits = habitsSummary(before);
  const afterHabits = habitsSummary(after);
  if (beforeHabits !== afterHabits) {
    rows.push({
      labelEn: "Habits",
      labelHe: "הרגלים",
      before: tr(locale, `${before.habitsDo.length + before.habitsDont.length} habits`, `${before.habitsDo.length + before.habitsDont.length} הרגלים`),
      after: tr(locale, `${after.habitsDo.length + after.habitsDont.length} habits (changed)`, `${after.habitsDo.length + after.habitsDont.length} הרגלים (השתנו)`),
    });
  }

  const beforeUserTargets = userTargetsSummary(before);
  const afterUserTargets = userTargetsSummary(after);
  if (beforeUserTargets !== afterUserTargets) {
    rows.push({
      labelEn: "User Targets",
      labelHe: "יעדי המשתמש",
      before: beforeUserTargets || tr(locale, "None", "ללא"),
      after: afterUserTargets || tr(locale, "None", "ללא"),
    });
  }

  if (before.goalType !== after.goalType) {
    rows.push({ labelEn: "Goal type", labelHe: "סוג מטרה", before: before.goalType, after: after.goalType });
  }
  if (before.targetWeightKg !== after.targetWeightKg) {
    rows.push({
      labelEn: "Target weight",
      labelHe: "משקל יעד",
      before: before.targetWeightKg === null ? tr(locale, "None", "ללא") : `${n(before.targetWeightKg)} kg`,
      after: after.targetWeightKg === null ? tr(locale, "None", "ללא") : `${n(after.targetWeightKg)} kg`,
    });
  }
  if (before.durationDays !== after.durationDays) {
    rows.push({
      labelEn: "Duration",
      labelHe: "משך",
      before: before.durationDays === null ? tr(locale, "None", "ללא") : `${before.durationDays} ${tr(locale, "days", "ימים")}`,
      after: after.durationDays === null ? tr(locale, "None", "ללא") : `${after.durationDays} ${tr(locale, "days", "ימים")}`,
    });
  }

  return rows;
}
