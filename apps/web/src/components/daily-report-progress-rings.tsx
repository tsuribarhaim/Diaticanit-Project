import { formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";

export type RingMetric = {
  id: string;
  labelEn: string;
  labelHe: string;
  total: number;
  min: number;
  max: number;
  unit: string;
  /**
   * Only set for calories, and only when the user has logged exercise
   * today: `total` is the NET value (gross intake minus estimated exercise
   * burn - can go negative if burn exceeds intake), while `grossTotal` is
   * the raw pre-exercise intake. The ring then visualizes both - the net
   * portion in the normal status color, the burned-back portion (gross
   * minus net) as a lighter tint of the same color - and the numbers below
   * spell out the full gained/burned/net breakdown instead of one figure.
   */
  grossTotal?: number;
  /**
   * For metrics where "more" is never a bad thing (e.g. a weekly exercise
   * session count against its target) rather than a ceiling to stay under
   * (nutrients) - exceeding max still reads as goal met/exceeded (emerald),
   * never as an over-target warning, and the metric is left out of the
   * red "Over today's target" list below.
   */
  neverOverLimit?: boolean;
};

/**
 * Progress percent is measured against the range's max (the "ceiling"),
 * consistent with how a value over max is always flagged as over-target
 * regardless of which nutrient it is - unless the metric opts out via
 * neverOverLimit.
 */
function ringColorClass(total: number, min: number, max: number, neverOverLimit?: boolean): string {
  if (!neverOverLimit && max > 0 && total > max) return "text-rose-500";
  if (neverOverLimit && max > 0 && total >= max) return "text-emerald-500";
  if (min > 0 && total >= min) return "text-emerald-500";
  return "text-teal-500";
}

function textColorClass(total: number, min: number, max: number, neverOverLimit?: boolean): string {
  if (!neverOverLimit && max > 0 && total > max) return "text-rose-700";
  if (neverOverLimit && max > 0 && total >= max) return "text-emerald-700";
  if (min > 0 && total >= min) return "text-emerald-700";
  return "text-teal-700";
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function Ring({ percent, colorClass, grossPercent }: { percent: number; colorClass: string; grossPercent?: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const clampedNet = clampPercent(percent);
  const netOffset = circumference * (1 - clampedNet / 100);
  const hasBurnBack = grossPercent !== undefined && grossPercent > percent;
  const clampedGross = hasBurnBack ? clampPercent(grossPercent) : 0;
  const grossOffset = circumference * (1 - clampedGross / 100);

  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
      <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="10" stroke="currentColor" className="text-slate-200" />
      {hasBurnBack ? (
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="10"
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={grossOffset}
          className={`${colorClass} opacity-30`}
        />
      ) : null}
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        strokeWidth="10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={netOffset}
        className={colorClass}
      />
    </svg>
  );
}

/**
 * Phase 1 of the Daily Report redesign: today's aggregate totals for the
 * user's selected primary/extra metrics, shown as progress rings against
 * the active target range, plus a red-zone list for anything over today's
 * target ceiling.
 */
export function DailyReportProgressRings({ locale, metrics }: { locale: AppLocale; metrics: RingMetric[] }) {
  const overLimit = metrics.filter((metric) => !metric.neverOverLimit && metric.max > 0 && metric.total > metric.max);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((metric) => {
          const percent = metric.max > 0 ? (metric.total / metric.max) * 100 : 0;
          const grossPercent =
            metric.grossTotal !== undefined && metric.max > 0 ? (metric.grossTotal / metric.max) * 100 : undefined;
          const ringColor = ringColorClass(metric.total, metric.min, metric.max, metric.neverOverLimit);
          const labelColor = textColorClass(metric.total, metric.min, metric.max, metric.neverOverLimit);
          const burnedAmount =
            metric.grossTotal !== undefined && metric.grossTotal !== metric.total
              ? metric.grossTotal - metric.total
              : null;

          return (
            <div key={metric.id} className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-3">
              <div className="relative flex h-24 w-24 items-center justify-center">
                <Ring percent={percent} colorClass={ringColor} grossPercent={grossPercent} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-sm font-bold ${labelColor}`}>{Math.max(0, Math.round(percent))}%</span>
                </div>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-800">{tr(locale, metric.labelEn, metric.labelHe)}</p>
              {/* A bare numeric ratio like "188 / 2,200" is two LTR number
                  runs joined by a neutral "/" - inside an RTL page, the
                  Unicode bidi algorithm can visually swap which number
                  appears first even though the source order here is already
                  correct (total, then max). Locking direction is the same
                  fix already used for the BMI scale elsewhere on Profile. */}
              <p dir="ltr" className="text-center text-[11px] text-slate-500">
                {formatNumberForLocale(metric.total, locale, { maximumFractionDigits: 0 })}
                {" / "}
                {formatNumberForLocale(metric.max, locale, { maximumFractionDigits: 0 })}{" "}
                {formatMeasurementUnit(metric.unit, locale)}
              </p>
              {burnedAmount !== null ? (
                <p dir="ltr" className="text-center text-[10px] text-slate-400">
                  {formatNumberForLocale(metric.grossTotal!, locale, { maximumFractionDigits: 0 })}{" "}
                  {tr(locale, "gained", "התקבלו")} − {formatNumberForLocale(burnedAmount, locale, { maximumFractionDigits: 0 })}{" "}
                  {tr(locale, "burned", "נשרפו")}
                </p>
              ) : null}
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
                <span dir="ltr">
                  {formatNumberForLocale(metric.total, locale, { maximumFractionDigits: 0 })} {formatMeasurementUnit(metric.unit, locale)}
                  {" "}
                  ({tr(locale, "limit", "מגבלה")} {formatNumberForLocale(metric.max, locale, { maximumFractionDigits: 0 })})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
