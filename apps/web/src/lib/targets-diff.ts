import { formatGoalType, formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";

export type MetricDiffRow = { labelEn: string; labelHe: string; before: string; after: string };

export type NutrientFieldInfo = {
  labelEn: string;
  labelHe: string;
  minKey: keyof TargetGenerationPayload;
  maxKey: keyof TargetGenerationPayload;
  unit: string;
  /** Matches an id in lib/nutrient-reference.ts, for callers that want to
   * show that nutrient's own role/food-examples info popover (see
   * targets-plan-editor.tsx) alongside its min/max range - not read by
   * this file's own diffing logic. */
  id: string;
};

/** Exported for the onboarding Targets step's own nutrient table
 * (onboarding-targets-step.tsx), which needs the same field/label/unit
 * mapping to display a single value per nutrient - not just this file's
 * own diff-only use. Order here doesn't matter for diffing; that
 * component re-sorts by the user's own chosen display order. */
export const NUTRIENT_DIFF_FIELDS: NutrientFieldInfo[] = [
  { id: "calories", labelEn: "Calories", labelHe: "קלוריות", minKey: "caloriesMin", maxKey: "caloriesMax", unit: "kcal" },
  { id: "protein", labelEn: "Protein", labelHe: "חלבון", minKey: "proteinMinG", maxKey: "proteinMaxG", unit: "g" },
  { id: "carbs", labelEn: "Carbohydrates", labelHe: "פחמימות", minKey: "carbsMinG", maxKey: "carbsMaxG", unit: "g" },
  { id: "fats", labelEn: "Fats", labelHe: "שומנים", minKey: "fatsMinG", maxKey: "fatsMaxG", unit: "g" },
  { id: "fiber", labelEn: "Dietary Fiber", labelHe: "סיבים תזונתיים", minKey: "fiberMinG", maxKey: "fiberMaxG", unit: "g" },
  { id: "sodium", labelEn: "Sodium", labelHe: "נתרן", minKey: "sodiumMinMg", maxKey: "sodiumMaxMg", unit: "mg" },
  { id: "added_sugar", labelEn: "Added Sugars", labelHe: "סוכרים מוספים", minKey: "addedSugarMinG", maxKey: "addedSugarMaxG", unit: "g" },
  { id: "water", labelEn: "Fluid / Water", labelHe: "נוזלים", minKey: "waterMinMl", maxKey: "waterMaxMl", unit: "ml" },
  { id: "potassium", labelEn: "Potassium", labelHe: "אשלגן", minKey: "potassiumMinMg", maxKey: "potassiumMaxMg", unit: "mg" },
  { id: "magnesium", labelEn: "Magnesium", labelHe: "מגנזיום", minKey: "magnesiumMinMg", maxKey: "magnesiumMaxMg", unit: "mg" },
  { id: "calcium", labelEn: "Calcium", labelHe: "סידן", minKey: "calciumMinMg", maxKey: "calciumMaxMg", unit: "mg" },
  { id: "iron", labelEn: "Iron", labelHe: "ברזל", minKey: "ironMinMg", maxKey: "ironMaxMg", unit: "mg" },
  { id: "zinc", labelEn: "Zinc", labelHe: "אבץ", minKey: "zincMinMg", maxKey: "zincMaxMg", unit: "mg" },
  { id: "vit_c", labelEn: "Vitamin C", labelHe: "ויטמין C", minKey: "vitCMinMg", maxKey: "vitCMaxMg", unit: "mg" },
  { id: "vit_b12", labelEn: "Vitamin B12", labelHe: "ויטמין B12", minKey: "vitB12MinMcg", maxKey: "vitB12MaxMcg", unit: "mcg" },
  { id: "vit_d", labelEn: "Vitamin D", labelHe: "ויטמין D", minKey: "vitDMinMcg", maxKey: "vitDMaxMcg", unit: "mcg" },
  { id: "sat_fat", labelEn: "Saturated Fat", labelHe: "שומן רווי", minKey: "satFatMinG", maxKey: "satFatMaxG", unit: "g" },
  { id: "omega3", labelEn: "Omega-3", labelHe: "אומגה 3", minKey: "omega3MinG", maxKey: "omega3MaxG", unit: "g" },
  { id: "cholesterol", labelEn: "Cholesterol", labelHe: "כולסטרול", minKey: "cholesterolMinMg", maxKey: "cholesterolMaxMg", unit: "mg" },
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

/** One row per userTargets entry that actually changed (matched by id,
 * falling back to label for older entries saved without one), each shown
 * in plain "value unit" form using the entry's own human label - not the
 * single giant `id|label: value (min-max unit)` blob this used to compare
 * as one string. That blob leaked straight into the AI chat's diff
 * summary as literal, unreadable text (confirmed live: a user saw
 * "daily_steps|Daily steps: 7500 steps (7000-8000 steps) | ..." after
 * asking about an unrelated calorie change) and, since it compared the
 * WHOLE set as one string, a change to any single entry - or even the
 * model just reformatting text without changing a value - showed as a
 * "changed" diff for every entry, not just the one that actually moved. */
function userTargetsDiffRows(before: TargetGenerationPayload, after: TargetGenerationPayload, locale: AppLocale): MetricDiffRow[] {
  const rows: MetricDiffRow[] = [];
  const key = (entry: TargetGenerationPayload["userTargets"][number]) => entry.id ?? entry.label;
  const beforeByKey = new Map(before.userTargets.map((entry) => [key(entry), entry]));
  const afterByKey = new Map(after.userTargets.map((entry) => [key(entry), entry]));
  const allKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);

  const display = (entry: TargetGenerationPayload["userTargets"][number] | undefined) =>
    entry ? `${entry.value}${entry.unit ? ` ${formatMeasurementUnit(entry.unit, locale)}` : ""}` : tr(locale, "Not set", "לא מוגדר");

  for (const entryKey of allKeys) {
    const beforeEntry = beforeByKey.get(entryKey);
    const afterEntry = afterByKey.get(entryKey);
    const beforeText = display(beforeEntry);
    const afterText = display(afterEntry);
    if (beforeText === afterText) continue;
    const label = afterEntry?.label ?? beforeEntry?.label ?? entryKey;
    rows.push({ labelEn: label, labelHe: label, before: beforeText, after: afterText });
  }

  return rows;
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
      before: `${n(beforeMin)}–${n(beforeMax)} ${formatMeasurementUnit(field.unit, locale)}`,
      after: `${n(afterMin)}–${n(afterMax)} ${formatMeasurementUnit(field.unit, locale)}`,
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

  rows.push(...userTargetsDiffRows(before, after, locale));

  if (before.goalType !== after.goalType) {
    rows.push({
      labelEn: "Goal type",
      labelHe: "סוג מטרה",
      before: formatGoalType(before.goalType, locale),
      after: formatGoalType(after.goalType, locale),
    });
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
