import { formatDateForLocale, formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";

export type WeightPoint = { date: string; weightKg: number };

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 80;

/**
 * Weight is opt-in and shown as a trend line rather than a same-day progress
 * ring, since it isn't a daily min/max range like the other metrics - it's a
 * value tracked over time.
 */
export function DailyReportWeightTrend({ locale, points }: { locale: AppLocale; points: WeightPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-xs text-slate-500">
        {tr(
          locale,
          "Log your weight at least twice (via the daily report form) to see a trend line here.",
          "יש לתעד משקל לפחות פעמיים (דרך טופס הדיווח היומי) כדי לראות כאן קו מגמה.",
        )}
      </p>
    );
  }

  const weights = points.map((point) => point.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = Math.max(0.1, max - min);

  const coords = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * CHART_WIDTH;
      const y = CHART_HEIGHT - ((point.weightKg - min) / range) * CHART_HEIGHT;
      return `${x},${y}`;
    })
    .join(" ");

  const first = points[0];
  const latest = points[points.length - 1];
  const delta = round(latest.weightKg - first.weightKg);

  return (
    <div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="h-20 w-full text-teal-600">
        <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-600">
        <span>
          {formatDateForLocale(first.date, locale)}:{" "}
          {formatNumberForLocale(first.weightKg, locale, { maximumFractionDigits: 1 })} {formatMeasurementUnit("kg", locale)}
        </span>
        <span className={`font-semibold ${delta <= 0 ? "text-emerald-700" : "text-amber-700"}`}>
          {delta > 0 ? "+" : ""}
          {formatNumberForLocale(delta, locale, { maximumFractionDigits: 1 })} {formatMeasurementUnit("kg", locale)}
        </span>
        <span>
          {formatDateForLocale(latest.date, locale)}:{" "}
          {formatNumberForLocale(latest.weightKg, locale, { maximumFractionDigits: 1 })} {formatMeasurementUnit("kg", locale)}
        </span>
      </div>
    </div>
  );
}
