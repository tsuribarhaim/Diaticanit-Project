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
  extraMetrics: DailyReportChartExtraMetric[];
  showWeightTrend: boolean;
};

export function normalizeDailyReportChartPreferences(value: unknown): DailyReportChartPreferences {
  const record = (value ?? {}) as Record<string, unknown>;
  const extraMetrics = Array.isArray(record.extraMetrics)
    ? record.extraMetrics.filter((id): id is DailyReportChartExtraMetric =>
        CHART_EXTRA_METRIC_IDS.includes(id as DailyReportChartExtraMetric),
      )
    : [];

  return {
    extraMetrics,
    showWeightTrend: Boolean(record.showWeightTrend),
  };
}
