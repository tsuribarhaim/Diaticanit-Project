import { formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import type { RingMetric } from "@/components/daily-report-progress-rings";

export type { RingMetric };

/**
 * The Daily Report V2 redesign's replacement for DailyReportProgressRings'
 * ring gauges - a flat list of horizontal bars instead (see the Daily
 * Reporting Stage V2 spec and the combined mockup). The Home page dashboard
 * keeps its own rings unchanged (out of this redesign's scope); this is a
 * new, separate component rather than a modification of the shared one.
 *
 * `coreMetrics` render as bars, always visible. `extraMetrics` render as
 * compact rows behind a "show full detail" accordion - the same
 * progressive-disclosure split the spec calls for, using the exact same
 * core/extra metric split the chart-preferences feature already tracks.
 */
function isOverLimit(metric: RingMetric): boolean {
  return !metric.neverOverLimit && metric.max > 0 && metric.total > metric.max;
}

function barColorClass(metric: RingMetric): string {
  if (isOverLimit(metric)) return "bg-rose-600";
  if (metric.neverOverLimit && metric.max > 0 && metric.total >= metric.max) return "bg-emerald-600";
  if (metric.min > 0 && metric.total >= metric.min) return "bg-emerald-600";
  return "bg-teal-600";
}

function valueColorClass(metric: RingMetric): string {
  if (isOverLimit(metric)) return "text-rose-700";
  if (metric.neverOverLimit && metric.max > 0 && metric.total >= metric.max) return "text-emerald-700";
  if (metric.min > 0 && metric.total >= metric.min) return "text-emerald-700";
  return "text-slate-900";
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function GoalBarRow({ locale, metric }: { locale: AppLocale; metric: RingMetric }) {
  const percent = metric.max > 0 ? clampPercent((metric.total / metric.max) * 100) : 0;
  const burnedAmount =
    metric.grossTotal !== undefined && metric.grossTotal !== metric.total ? metric.grossTotal - metric.total : null;

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className={`flex-1 text-[13px] font-medium ${isOverLimit(metric) ? "text-rose-700" : "text-slate-800"}`}>
          {tr(locale, metric.labelEn, metric.labelHe)}
        </span>
        <span dir="ltr" className={`text-[13px] font-semibold tabular-nums ${valueColorClass(metric)}`}>
          {formatNumberForLocale(metric.total, locale, { maximumFractionDigits: 0 })}
          {" / "}
          {formatNumberForLocale(metric.max, locale, { maximumFractionDigits: 0 })} {formatMeasurementUnit(metric.unit, locale)}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barColorClass(metric)}`} style={{ width: `${percent}%` }} />
      </div>
      {burnedAmount !== null ? (
        // "eaten"/"burned"/"net" (not the earlier "gross"/"burned"/"net") -
        // "gross" reads as generic accounting jargon that doesn't obviously
        // mean "what you ate" in a nutrition context, which was part of why
        // this line didn't clearly explain the row's own (always net) main
        // number - reported as "mismatch between wording and the real
        // relevant number".
        //
        // Laid out as separate flex items (one per "808 eaten"-style pair),
        // not one continuous dir="ltr" text run - a single run mixing three
        // Hebrew words with three numbers kept reordering under the
        // browser's own bidi algorithm regardless of dir or even <bdi>
        // isolation on the numbers alone (reported as "808 is on the wrong
        // side"), because the whole line was still one bidi paragraph for
        // the numbers to get swept around in. Flex item position is decided
        // by flex-direction/DOM order, which bidi text reordering cannot
        // touch - each pair is its own box, immune by construction, the
        // same reasoning the label/value row above already relies on
        // (separate elements, not one intermixed sentence).
        <div dir="ltr" className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-slate-500">
          <span>
            {formatNumberForLocale(metric.grossTotal!, locale, { maximumFractionDigits: 0 })} {tr(locale, "eaten", "נאכל")}
          </span>
          <span aria-hidden="true">−</span>
          <span>
            {formatNumberForLocale(burnedAmount, locale, { maximumFractionDigits: 0 })} {tr(locale, "burned", "נשרף")}
          </span>
          <span aria-hidden="true">=</span>
          <span>
            {formatNumberForLocale(metric.total, locale, { maximumFractionDigits: 0 })} {tr(locale, "net", "נטו")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function DailyReportGoalBars({
  locale,
  coreMetrics,
  extraMetrics,
}: {
  locale: AppLocale;
  coreMetrics: RingMetric[];
  extraMetrics: RingMetric[];
}) {
  const overLimit = [...coreMetrics, ...extraMetrics].filter(isOverLimit);

  return (
    <div>
      {overLimit.length ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-rose-600" aria-hidden="true">
            <path d="M12 3 2 20h20L12 3Z" />
            <path d="M12 10v4M12 17h.01" />
          </svg>
          <p className="text-sm font-medium text-rose-800">
            {tr(
              locale,
              `${overLimit.length} over today's target: `,
              `${formatNumberForLocale(overLimit.length, locale)} חריגות היום מהיעד: `,
            )}
            {overLimit.map((metric) => tr(locale, metric.labelEn, metric.labelHe)).join(tr(locale, ", ", ", "))}
          </p>
        </div>
      ) : null}

      {coreMetrics.length ? (
        <div className="space-y-3">
          {coreMetrics.map((metric) => (
            <GoalBarRow key={metric.id} locale={locale} metric={metric} />
          ))}
        </div>
      ) : null}

      {extraMetrics.length ? (
        <details className="mt-4 group">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 text-xs font-semibold text-teal-700 [&::-webkit-details-marker]:hidden">
            {tr(locale, "Show full detail", "הצג פירוט מלא")}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-open:rotate-180" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <div className="mt-3 space-y-3">
            {extraMetrics.map((metric) => (
              <GoalBarRow key={metric.id} locale={locale} metric={metric} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
