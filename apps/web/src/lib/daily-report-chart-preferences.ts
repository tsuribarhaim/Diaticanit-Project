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
] as const;
export type DailyReportChartExtraMetric = (typeof CHART_EXTRA_METRIC_IDS)[number];

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
