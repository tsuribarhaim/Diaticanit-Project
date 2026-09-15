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

  const positions = points.map((point, index) => ({
    point,
    xPercent: (index / (points.length - 1)) * 100,
    yPercent: 100 - ((point.weightKg - min) / range) * 100,
  }));

  const coords = positions.map(({ xPercent, yPercent }) => `${(xPercent / 100) * CHART_WIDTH},${(yPercent / 100) * CHART_HEIGHT}`).join(" ");

  const first = points[0];
  const latest = points[points.length - 1];
  const delta = round(latest.weightKg - first.weightKg);

  // Only worth calling out the extremes as their own labeled points once
  // there's a shape to the line beyond "start" and "end" - with exactly two
  // points those two values are already fully covered by the summary row
  // below, so a third and fourth label on top would just repeat them.
  const peakIndex = points.length > 2 ? weights.indexOf(max) : -1;
  const troughIndex = points.length > 2 ? weights.indexOf(min) : -1;
  const markers = [
    peakIndex >= 0 ? { key: "peak", ...positions[peakIndex], labelBelow: true } : null,
    troughIndex >= 0 && troughIndex !== peakIndex ? { key: "trough", ...positions[troughIndex], labelBelow: false } : null,
  ].filter((marker): marker is NonNullable<typeof marker> => marker !== null);

  return (
    <div>
      <div className="relative h-20 w-full">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full text-teal-600"
        >
          {/* Recessive reference lines so the eye has a scale to read the
              line's shape against - the actual numbers ride on the peak and
              trough labels below, rather than a separate axis, to avoid
              showing the same value twice. */}
          <line x1="0" y1="0" x2={CHART_WIDTH} y2="0" stroke="currentColor" strokeWidth="1" className="text-slate-200" />
          <line x1="0" y1={CHART_HEIGHT / 2} x2={CHART_WIDTH} y2={CHART_HEIGHT / 2} stroke="currentColor" strokeWidth="1" className="text-slate-200" />
          <line x1="0" y1={CHART_HEIGHT} x2={CHART_WIDTH} y2={CHART_HEIGHT} stroke="currentColor" strokeWidth="1" className="text-slate-200" />
          <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <div className="pointer-events-none absolute inset-0">
          {markers.map((marker) => (
            <div key={marker.key} className="absolute" style={{ left: `${marker.xPercent}%`, top: `${marker.yPercent}%` }}>
              <span className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-600 ring-2 ring-white" />
              <span
                className={`absolute -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-slate-700 ${
                  marker.labelBelow ? "top-1.5" : "bottom-1.5"
                }`}
              >
                {formatNumberForLocale(marker.point.weightKg, locale, { maximumFractionDigits: 1 })}
              </span>
            </div>
          ))}
        </div>
      </div>
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
