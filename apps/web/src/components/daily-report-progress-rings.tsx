import { formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";

export type RingMetric = {
  id: string;
  labelEn: string;
  labelHe: string;
  total: number;
  min: number;
  max: number;
  unit: string;
};

/**
 * Progress percent is measured against the range's max (the "ceiling"),
 * consistent with how a value over max is always flagged as over-target
 * regardless of which nutrient it is.
 */
function ringColorClass(total: number, min: number, max: number): string {
  if (max > 0 && total > max) return "text-rose-500";
  if (min > 0 && total >= min) return "text-emerald-500";
  return "text-teal-500";
}

function textColorClass(total: number, min: number, max: number): string {
  if (max > 0 && total > max) return "text-rose-700";
  if (min > 0 && total >= min) return "text-emerald-700";
  return "text-teal-700";
}

function Ring({ percent, colorClass }: { percent: number; colorClass: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = circumference * (1 - clamped / 100);

  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
      <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="10" stroke="currentColor" className="text-slate-200" />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        strokeWidth="10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={colorClass}
      />
    </svg>
  );
}

/**
 * Phase 1 of the Daily Report redesign: today's aggregate totals for the 5
 * default metrics (Calories, Protein, Fats, Fiber, Water), shown as progress
 * rings against the active target range, plus a red-zone list for anything
 * over today's target ceiling.
 */
export function DailyReportProgressRings({ locale, metrics }: { locale: AppLocale; metrics: RingMetric[] }) {
  const overLimit = metrics.filter((metric) => metric.max > 0 && metric.total > metric.max);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((metric) => {
          const percent = metric.max > 0 ? (metric.total / metric.max) * 100 : 0;
          const ringColor = ringColorClass(metric.total, metric.min, metric.max);
          const labelColor = textColorClass(metric.total, metric.min, metric.max);

          return (
            <div key={metric.id} className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-3">
              <div className="relative flex h-24 w-24 items-center justify-center">
                <Ring percent={percent} colorClass={ringColor} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-sm font-bold ${labelColor}`}>{Math.round(percent)}%</span>
                </div>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-800">{tr(locale, metric.labelEn, metric.labelHe)}</p>
              <p className="text-center text-[11px] text-slate-500">
                {formatNumberForLocale(metric.total, locale, { maximumFractionDigits: 0 })}
                {" / "}
                {formatNumberForLocale(metric.max, locale, { maximumFractionDigits: 0 })}{" "}
                {formatMeasurementUnit(metric.unit, locale)}
              </p>
            </div>
          );
        })}
      </div>

      {overLimit.length ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-semibold text-rose-800">{tr(locale, "Over today's target", "מעל היעד להיום")}</p>
          <ul className="mt-1 space-y-1 text-xs text-rose-700">
            {overLimit.map((metric) => (
              <li key={metric.id}>
                {tr(locale, metric.labelEn, metric.labelHe)}:{" "}
                {formatNumberForLocale(metric.total, locale, { maximumFractionDigits: 0 })} {formatMeasurementUnit(metric.unit, locale)}
                {" "}
                ({tr(locale, "limit", "מגבלה")} {formatNumberForLocale(metric.max, locale, { maximumFractionDigits: 0 })})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
