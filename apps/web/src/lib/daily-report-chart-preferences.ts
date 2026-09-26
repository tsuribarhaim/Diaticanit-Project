export const CHART_CORE_METRIC_IDS = ["calories", "protein", "carbs", "fats", "fiber", "water"] as const;
export type DailyReportChartCoreMetric = (typeof CHART_CORE_METRIC_IDS)[number];

export const CHART_EXTRA_METRIC_IDS = [
  "magnesium",
  "potassium",
  "iron",
  "zinc",
  "sodium",
  "addedSugar",
  "calcium",
  "vitC",
  "vitB12",
  "vitD",
  "satFat",
  "omega3",
  "cholesterol",
] as const;
export type DailyReportChartExtraMetric = (typeof CHART_EXTRA_METRIC_IDS)[number];

/**
 * Where each chart-preference metric id actually lives on a single
 * user_daily_reports row, plus its matching camelCase key on
 * sumFoodTotals/sumExerciseTotals's own return shape (actions.ts) and its
 * display label/unit - one shared source of truth for every place that
 * needs "given this metric id, where's its value and what do I call it":
 * the day-total bars (page.tsx), the per-entry detail grid and its
 * "Edit" form (same file), and which fields that Edit form is allowed to
 * override (actions.ts's OVERRIDABLE_NUTRIENT_FIELDS). Confirmed live via
 * TCK-44 that the per-entry grid and its Edit form used to hardcode a
 * fixed 8-field subset independent of this, so a user who customized
 * their charts to track e.g. sodium or vitamin C instead of the defaults
 * never saw those reflected in the report breakdown - this mapping is
 * what lets every one of those call sites derive its own field list from
 * the same chartPreferences.coreMetrics/extraMetrics the bars already
 * respect, instead of three independent hardcoded lists drifting apart.
 */
export const DAILY_REPORT_METRIC_FIELD_INFO: Record<
  DailyReportChartCoreMetric | DailyReportChartExtraMetric,
  { dbColumn: string; autoKey: string; labelEn: string; labelHe: string; unit: string; decimals: number }
> = {
  calories: { dbColumn: "calories_kcal", autoKey: "caloriesKcal", labelEn: "Calories", labelHe: "קלוריות", unit: "kcal", decimals: 0 },
  protein: { dbColumn: "protein_g", autoKey: "proteinG", labelEn: "Protein", labelHe: "חלבון", unit: "g", decimals: 1 },
  carbs: { dbColumn: "carbs_g", autoKey: "carbsG", labelEn: "Carbs", labelHe: "פחמימות", unit: "g", decimals: 1 },
  fats: { dbColumn: "fat_g", autoKey: "fatG", labelEn: "Fats", labelHe: "שומנים", unit: "g", decimals: 1 },
  fiber: { dbColumn: "fiber_g", autoKey: "fiberG", labelEn: "Dietary Fiber", labelHe: "סיבים תזונתיים", unit: "g", decimals: 1 },
  water: { dbColumn: "water_ml", autoKey: "waterMl", labelEn: "Fluid / Water", labelHe: "נוזלים / מים", unit: "ml", decimals: 0 },
  magnesium: { dbColumn: "magnesium_mg", autoKey: "magnesiumMg", labelEn: "Magnesium", labelHe: "מגנזיום", unit: "mg", decimals: 1 },
  potassium: { dbColumn: "potassium_mg", autoKey: "potassiumMg", labelEn: "Potassium", labelHe: "אשלגן", unit: "mg", decimals: 1 },
  iron: { dbColumn: "iron_mg", autoKey: "ironMg", labelEn: "Iron", labelHe: "ברזל", unit: "mg", decimals: 2 },
  zinc: { dbColumn: "zinc_mg", autoKey: "zincMg", labelEn: "Zinc", labelHe: "אבץ", unit: "mg", decimals: 2 },
  sodium: { dbColumn: "sodium_mg", autoKey: "sodiumMg", labelEn: "Sodium", labelHe: "נתרן", unit: "mg", decimals: 0 },
  addedSugar: { dbColumn: "added_sugar_g", autoKey: "addedSugarG", labelEn: "Added Sugar", labelHe: "סוכר מוסף", unit: "g", decimals: 1 },
  calcium: { dbColumn: "calcium_mg", autoKey: "calciumMg", labelEn: "Calcium", labelHe: "סידן", unit: "mg", decimals: 0 },
  vitC: { dbColumn: "vit_c_mg", autoKey: "vitCMg", labelEn: "Vitamin C", labelHe: "ויטמין C", unit: "mg", decimals: 1 },
  vitB12: { dbColumn: "vit_b12_mcg", autoKey: "vitB12Mcg", labelEn: "Vitamin B12", labelHe: "ויטמין B12", unit: "mcg", decimals: 1 },
  vitD: { dbColumn: "vit_d_mcg", autoKey: "vitDMcg", labelEn: "Vitamin D", labelHe: "ויטמין D", unit: "mcg", decimals: 1 },
  satFat: { dbColumn: "sat_fat_g", autoKey: "satFatG", labelEn: "Saturated Fat", labelHe: "שומן רווי", unit: "g", decimals: 1 },
  omega3: { dbColumn: "omega3_g", autoKey: "omega3G", labelEn: "Omega-3", labelHe: "אומגה 3", unit: "g", decimals: 1 },
  cholesterol: { dbColumn: "cholesterol_mg", autoKey: "cholesterolMg", labelEn: "Cholesterol", labelHe: "כולסטרול", unit: "mg", decimals: 0 },
};

export type DailyReportChartPreferences = {
  coreMetrics: DailyReportChartCoreMetric[];
  extraMetrics: DailyReportChartExtraMetric[];
  showWeightTrend: boolean;
};

const DEFAULT_PREFERENCES: DailyReportChartPreferences = {
  coreMetrics: [...CHART_CORE_METRIC_IDS],
  extraMetrics: [],
  showWeightTrend: false,
};

/**
 * A user's very first visit has no saved preferences at all - the
 * daily_report_chart_preferences column defaults to an empty JSONB object
 * for every row, which is indistinguishable from "the user explicitly
 * unchecked everything" unless we mark the difference explicitly. The
 * `customized` flag is written (by updateDailyReportChartPreferencesAction)
 * the first time the user actually saves the customize-charts form, so a
 * pristine `{}` row falls back to a sensible starting selection (all core
 * nutrient rings, no extras, no weight trend), while any saved selection -
 * including a deliberately empty one - is respected exactly from then on.
 */
export function normalizeDailyReportChartPreferences(value: unknown): DailyReportChartPreferences {
  const record = (value ?? {}) as Record<string, unknown>;

  if (record.customized !== true) {
    return DEFAULT_PREFERENCES;
  }

  const coreMetrics = Array.isArray(record.coreMetrics)
    ? record.coreMetrics.filter((id): id is DailyReportChartCoreMetric =>
        CHART_CORE_METRIC_IDS.includes(id as DailyReportChartCoreMetric),
      )
    : [];
  const extraMetrics = Array.isArray(record.extraMetrics)
    ? record.extraMetrics.filter((id): id is DailyReportChartExtraMetric =>
        CHART_EXTRA_METRIC_IDS.includes(id as DailyReportChartExtraMetric),
      )
    : [];

  return {
    coreMetrics,
    extraMetrics,
    showWeightTrend: Boolean(record.showWeightTrend),
  };
}
