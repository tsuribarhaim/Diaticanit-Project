"use client";

import { useRef, useState } from "react";

import {
  CHART_CORE_METRIC_IDS,
  CHART_EXTRA_METRIC_IDS,
  DAILY_REPORT_METRIC_FIELD_INFO,
  type DailyReportChartCoreMetric,
  type DailyReportChartExtraMetric,
} from "@/lib/daily-report-chart-preferences";
import { tr, type AppLocale } from "@/lib/locale";

type MetricId = DailyReportChartCoreMetric | DailyReportChartExtraMetric;

/**
 * TCK-16: two sentinels, not a separate "how many are primary" count - they
 * live right in the same ordered list as the metrics themselves, so
 * dragging an item across one is just a normal reorder instead of a
 * special case the drag logic has to know about. Three zones result:
 * before the first sentinel is "always shown" (the goal bars), between the
 * two is "additional" (behind Show full detail), after the second is "not
 * tracked at all" - preserving the one thing the old checkbox grid could
 * do that a plain two-zone list can't (leaving a metric out of both
 * groups entirely).
 */
const DIVIDER_PRIMARY = "__divider_primary__";
const DIVIDER_UNTRACKED = "__divider_untracked__";
type Row = MetricId | typeof DIVIDER_PRIMARY | typeof DIVIDER_UNTRACKED;

function buildInitialOrder(coreMetrics: DailyReportChartCoreMetric[], extraMetrics: DailyReportChartExtraMetric[]): Row[] {
  const allIds: MetricId[] = [...CHART_CORE_METRIC_IDS, ...CHART_EXTRA_METRIC_IDS];
  const tracked = new Set<string>([...coreMetrics, ...extraMetrics]);
  const untracked = allIds.filter((id) => !tracked.has(id));
  return [...coreMetrics, DIVIDER_PRIMARY, ...extraMetrics, DIVIDER_UNTRACKED, ...untracked];
}

function labelFor(id: MetricId, locale: AppLocale): string {
  const info = DAILY_REPORT_METRIC_FIELD_INFO[id];
  return tr(locale, info.labelEn, info.labelHe);
}

/**
 * Drag-to-reorder replacement for the old flat checkbox grid - lets the
 * user set both WHICH metrics show as the always-visible goal bars
 * ("primary") vs. behind "Show full detail" ("additional") vs. not tracked
 * at all, AND the exact order within each group, by dragging - the same
 * interaction Google Maps uses to reorder stops on a route. Renders hidden
 * inputs (core_metric / extra_metric, one per tracked id, in the user's
 * own chosen order) for the surrounding <form action={
 * updateDailyReportChartPreferencesAction}> to submit - that action
 * already reads these two field names via formData.getAll(), which
 * preserves DOCUMENT order, so no server-side change was needed to make
 * the saved order match what's dragged here.
 */
export function DailyReportMetricOrderEditor({
  locale,
  coreMetrics,
  extraMetrics,
}: {
  locale: AppLocale;
  coreMetrics: DailyReportChartCoreMetric[];
  extraMetrics: DailyReportChartExtraMetric[];
}) {
  const [order, setOrder] = useState<Row[]>(() => buildInitialOrder(coreMetrics, extraMetrics));
  const listRef = useRef<HTMLDivElement | null>(null);
  const [draggingId, setDraggingId] = useState<Row | null>(null);

  const primaryDivIdx = order.indexOf(DIVIDER_PRIMARY);
  const untrackedDivIdx = order.indexOf(DIVIDER_UNTRACKED);

  function zoneFor(index: number): "primary" | "additional" | "untracked" {
    if (index < primaryDivIdx) return "primary";
    if (index < untrackedDivIdx) return "additional";
    return "untracked";
  }

  function rowNodes(): HTMLElement[] {
    const container = listRef.current;
    if (!container) return [];
    return [...container.querySelectorAll<HTMLElement>(":scope > [data-row]")];
  }

  function startDrag(event: React.PointerEvent, id: Row) {
    event.preventDefault();
    const rowEl = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!rowEl) return;
    rowEl.setPointerCapture?.(event.pointerId);
    setDraggingId(id);

    let currentOrder = order;
    let rects = rowNodes().map((el) => el.getBoundingClientRect());
    let startY = event.clientY;

    function onMove(ev: PointerEvent) {
      const liveRow = listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(String(id))}"]`);
      if (liveRow) {
        liveRow.style.transform = `translateY(${ev.clientY - startY}px)`;
      }

      let targetIdx = rects.findIndex((r) => ev.clientY < r.top + r.height / 2);
      if (targetIdx === -1) targetIdx = rects.length;
      const fromIdx = currentOrder.indexOf(id);
      let toIdx = targetIdx;
      if (fromIdx < toIdx) toIdx -= 1;
      toIdx = Math.max(0, Math.min(currentOrder.length - 1, toIdx));

      if (toIdx !== fromIdx) {
        const next = [...currentOrder];
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, id);
        currentOrder = next;
        setOrder(next);
        // Re-measure against the just-re-rendered rows for the next move.
        requestAnimationFrame(() => {
          rects = rowNodes().map((el) => el.getBoundingClientRect());
          startY = ev.clientY;
          const freshRow = listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(String(id))}"]`);
          if (freshRow) freshRow.style.transform = "translateY(0px)";
        });
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDraggingId(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div>
      <div ref={listRef} className="space-y-1.5">
        {order.map((row, index) => {
          if (row === DIVIDER_PRIMARY || row === DIVIDER_UNTRACKED) {
            return (
              <div
                key={row}
                data-row
                data-row-id={row}
                className="my-1 rounded-lg border border-dashed border-teal-300 bg-teal-50 px-3 py-1.5 text-center text-[11px] font-semibold text-teal-700 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-400"
              >
                {row === DIVIDER_PRIMARY
                  ? tr(locale, "— always shown above —", "— מוצג תמיד למעלה —")
                  : tr(locale, "— not tracked —", "— לא במעקב —")}
              </div>
            );
          }

          const zone = zoneFor(index);
          const badgeClass =
            zone === "primary"
              ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400"
              : zone === "additional"
                ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500";
          const badgeLabel =
            zone === "primary" ? tr(locale, "Primary", "עיקרי") : zone === "additional" ? tr(locale, "Additional", "נוסף") : tr(locale, "Hidden", "מוסתר");

          return (
            <div
              key={row}
              data-row
              data-row-id={row}
              className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-sm transition-colors ${
                draggingId === row
                  ? "border-teal-400 bg-teal-50 shadow-lg dark:border-teal-600 dark:bg-slate-800"
                  : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
              }`}
              style={{ touchAction: "none" }}
            >
              <button
                type="button"
                onPointerDown={(event) => startDrag(event, row)}
                aria-label={tr(locale, `Drag to reorder ${labelFor(row, locale)}`, `גרירה לשינוי מיקום ${labelFor(row, locale)}`)}
                className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-slate-400 hover:bg-slate-100 active:cursor-grabbing dark:text-slate-500 dark:hover:bg-slate-800"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.6" />
                  <circle cx="15" cy="6" r="1.6" />
                  <circle cx="9" cy="12" r="1.6" />
                  <circle cx="15" cy="12" r="1.6" />
                  <circle cx="9" cy="18" r="1.6" />
                  <circle cx="15" cy="18" r="1.6" />
                </svg>
              </button>
              <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{labelFor(row, locale)}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>{badgeLabel}</span>
            </div>
          );
        })}
      </div>

      {/* Hidden inputs, one per tracked id, rendered in DOCUMENT order -
          updateDailyReportChartPreferencesAction reads these two field
          names via formData.getAll(), which preserves that order, so the
          saved arrays end up in exactly the order dragged here with no
          server-side change needed. Anything past the second divider
          (untracked) simply gets no input at all, same as leaving both
          checkboxes unchecked used to mean. */}
      {order.slice(0, primaryDivIdx).map((id) => (
        <input key={id} type="hidden" name="core_metric" value={id} />
      ))}
      {order.slice(primaryDivIdx + 1, untrackedDivIdx).map((id) => (
        <input key={id} type="hidden" name="extra_metric" value={id} />
      ))}
    </div>
  );
}
