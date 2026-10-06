/**
 * TCK-104: the single place that decides which color a Daily Report /
 * Targets metric reads as - shared by the progress rings
 * (daily-report-progress-rings.tsx) and the goal bars
 * (daily-report-goal-bars.tsx) so the same nutrient reads the same color
 * everywhere.
 *
 * - lowerIsBetter metrics (sodium, added sugar, saturated fat, cholesterol)
 *   reward staying low: blue near zero, light green up to the limit, rose
 *   once over it.
 * - goalProgress metrics (the built-in nutrients with a real minimum) show
 *   progress toward that minimum: orange -> amber -> lime -> emerald, then
 *   blue once past max. Never red - red stays reserved for "over your limit".
 * - Everything else (calories, custom targets, exercise, day counts) keeps
 *   the original under/met/exceeded logic unchanged.
 */
export type MetricTone =
  | "excellent"
  | "good"
  | "over"
  | "low"
  | "building"
  | "close"
  | "met"
  | "exceeded"
  | "under";

export type MetricToneInput = {
  total: number;
  min: number;
  max: number;
  neverOverLimit?: boolean;
  exceedingIsPositive?: boolean;
  lowerIsBetter?: boolean;
  goalProgress?: boolean;
};

function legacyTone(metric: MetricToneInput): MetricTone {
  const { total, min, max } = metric;
  if (max > 0 && total > max) {
    if (metric.neverOverLimit) return "met";
    return metric.exceedingIsPositive ? "exceeded" : "over";
  }
  if (metric.neverOverLimit && max > 0 && total >= max) return "met";
  if (min > 0 && total >= min) return "met";
  return "under";
}

export function getMetricTone(metric: MetricToneInput): MetricTone {
  const { total, min, max } = metric;

  // A limit of 0 means there's no real limit to measure against - falls
  // back to the original logic rather than dividing by zero.
  if (metric.lowerIsBetter && max > 0) {
    const ratio = total / max;
    if (ratio <= 0.25) return "excellent";
    if (ratio <= 1) return "good";
    return "over";
  }

  // Same for a goal with no minimum. Going past max ("exceeded") takes
  // priority over "met", so that case also goes through the original logic.
  if (metric.goalProgress && min > 0 && !(max > 0 && total > max)) {
    if (total >= min) return "met";
    const progress = total / min;
    if (progress < 0.33) return "low";
    if (progress < 0.66) return "building";
    return "close";
  }

  return legacyTone(metric);
}

/** Ring arc stroke (via currentColor). */
export const RING_STROKE_CLASS: Record<MetricTone, string> = {
  excellent: "text-blue-500 dark:text-blue-400",
  good: "text-emerald-400 dark:text-emerald-300",
  over: "text-rose-500 dark:text-rose-400",
  low: "text-orange-500 dark:text-orange-400",
  building: "text-amber-500 dark:text-amber-400",
  close: "text-lime-500 dark:text-lime-400",
  met: "text-emerald-500 dark:text-emerald-400",
  exceeded: "text-blue-500 dark:text-blue-400",
  under: "text-teal-500 dark:text-teal-400",
};

/** Percent label in the middle of the ring. */
export const RING_TEXT_CLASS: Record<MetricTone, string> = {
  excellent: "text-blue-700 dark:text-blue-400",
  good: "text-emerald-600 dark:text-emerald-300",
  over: "text-rose-700 dark:text-rose-400",
  low: "text-orange-700 dark:text-orange-400",
  building: "text-amber-700 dark:text-amber-400",
  close: "text-lime-700 dark:text-lime-400",
  met: "text-emerald-700 dark:text-emerald-400",
  exceeded: "text-blue-700 dark:text-blue-400",
  under: "text-teal-700 dark:text-teal-400",
};

/** Goal bar fill. */
export const BAR_BG_CLASS: Record<MetricTone, string> = {
  excellent: "bg-blue-600 dark:bg-blue-500",
  good: "bg-emerald-500 dark:bg-emerald-400",
  over: "bg-rose-600 dark:bg-rose-500",
  low: "bg-orange-500 dark:bg-orange-400",
  building: "bg-amber-500 dark:bg-amber-400",
  close: "bg-lime-500 dark:bg-lime-400",
  met: "bg-emerald-600 dark:bg-emerald-500",
  exceeded: "bg-blue-600 dark:bg-blue-500",
  under: "bg-teal-600 dark:bg-teal-500",
};

/** Goal bar "total / target" value text - "under" stays plain slate. */
export const BAR_TEXT_CLASS: Record<MetricTone, string> = {
  excellent: "text-blue-700 dark:text-blue-400",
  good: "text-emerald-600 dark:text-emerald-300",
  over: "text-rose-700 dark:text-rose-400",
  low: "text-orange-700 dark:text-orange-400",
  building: "text-amber-700 dark:text-amber-400",
  close: "text-lime-700 dark:text-lime-400",
  met: "text-emerald-700 dark:text-emerald-400",
  exceeded: "text-blue-700 dark:text-blue-400",
  under: "text-slate-900 dark:text-slate-100",
};
