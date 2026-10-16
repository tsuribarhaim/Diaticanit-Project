"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  CHART_METRIC_IDS,
  DAILY_REPORT_METRIC_FIELD_INFO,
  dedupeChartMetricGroups,
  isDailyReportChartMetric,
  type DailyReportChartMetric,
} from "@/lib/daily-report-chart-preferences";
import { tr, trGendered, type AppLocale } from "@/lib/locale";

type MetricId = DailyReportChartMetric;
type Zone = "primary" | "additional" | "untracked";

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

function buildInitialOrder(coreMetrics: DailyReportChartMetric[], extraMetrics: DailyReportChartMetric[]): Row[] {
  // TCK-137: unknown ids and a second copy of an id would render as broken
  // or duplicate-key rows, so they're dropped here.
  const { coreMetrics: core, extraMetrics: extra } = dedupeChartMetricGroups(
    coreMetrics.filter(isDailyReportChartMetric),
    extraMetrics.filter(isDailyReportChartMetric),
  );
  const tracked = new Set<string>([...core, ...extra]);
  const untracked = CHART_METRIC_IDS.filter((id) => !tracked.has(id));
  return [...core, DIVIDER_PRIMARY, ...extra, DIVIDER_UNTRACKED, ...untracked];
}

function labelFor(id: MetricId, locale: AppLocale): string {
  const info = DAILY_REPORT_METRIC_FIELD_INFO[id];
  return tr(locale, info.labelEn, info.labelHe);
}

function GroupIcon({ zone }: { zone: Zone }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (zone === "primary") {
    return (
      <svg {...common}>
        <path d="M12 17v5" />
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
      </svg>
    );
  }
  if (zone === "additional") {
    return (
      <svg {...common}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/** TCK-151: icon, title, one-line subtitle and a live item count per group. */
function GroupHeader({ zone, count, locale }: { zone: Zone; count: number; locale: AppLocale }) {
  const tileClass =
    zone === "primary"
      ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400"
      : zone === "additional"
        ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
        : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500";
  const title =
    zone === "primary"
      ? tr(locale, "Always on screen", "תמיד על המסך")
      : zone === "additional"
        ? tr(locale, "In full detail", "בפירוט מלא")
        : tr(locale, "Not shown", "לא מוצג");
  const subtitle =
    zone === "primary"
      ? tr(locale, "Shown at the top of the daily report", "מופיע בראש הדיווח היומי")
      : zone === "additional"
        ? tr(locale, "Shown only after \"Show full detail\"", "מופיע רק אחרי \"הצג פירוט מלא\"")
        : tr(locale, "Not shown in the daily report", "לא מופיע בדיווח היומי");

  return (
    <div className="flex items-center gap-2 px-1 pb-0.5">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tileClass}`}>
        <GroupIcon zone={zone} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</div>
      </div>
      <span
        aria-label={tr(locale, `${count} values`, `${count} ערכים`)}
        className="inline-flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
      >
        {count}
      </span>
    </div>
  );
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
 *
 * TCK-137: any metric can go in any group (the server used to silently drop
 * e.g. magnesium dragged into primary, so the selection looked unsaved). The
 * drag also keeps the row under the finger after each swap (its offset is
 * corrected by how far its natural position moved), picks the drop spot
 * from the other rows only, draws above its neighbours, and cleans up on
 * pointercancel as well as pointerup.
 *
 * TCK-151: every group has a header (icon, title, subtitle, count) instead of
 * per-row badges. The two dividers double as the headers of the group that
 * follows them, so the drag maths is unchanged; the primary header sits in a
 * non-row wrapper above everything. An empty group shows a dashed drop zone
 * (inside its divider's row, or in that top wrapper) so it can be refilled.
 */
export function DailyReportMetricOrderEditor({
  locale,
  userGender,
  coreMetrics,
  extraMetrics,
}: {
  locale: AppLocale;
  userGender?: "male" | "female" | null;
  coreMetrics: DailyReportChartMetric[];
  extraMetrics: DailyReportChartMetric[];
}) {
  const [order, setOrder] = useState<Row[]>(() => buildInitialOrder(coreMetrics, extraMetrics));
  const listRef = useRef<HTMLDivElement | null>(null);
  const [draggingId, setDraggingId] = useState<Row | null>(null);

  const primaryDivIdx = order.indexOf(DIVIDER_PRIMARY);
  const untrackedDivIdx = order.indexOf(DIVIDER_UNTRACKED);

  const primaryCount = primaryDivIdx;
  const additionalCount = untrackedDivIdx - primaryDivIdx - 1;
  const untrackedCount = order.length - untrackedDivIdx - 1;

  const emptyDropZone = (
    <div className="rounded-lg border-2 border-dashed border-slate-300 px-3 py-3 text-center text-xs text-slate-400 dark:border-slate-600 dark:text-slate-500">
      {trGendered(locale, userGender, "Drag a value here", "גרור לכאן ערך", "גררי לכאן ערך")}
    </div>
  );


  function rowNodes(): HTMLElement[] {
    const container = listRef.current;
    if (!container) return [];
    return [...container.querySelectorAll<HTMLElement>(":scope > [data-row]")];
  }

  function startDrag(event: React.PointerEvent, id: Row) {
    event.preventDefault();
    const rowEl = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!rowEl) return;
    const pointerId = event.pointerId;
    rowEl.setPointerCapture?.(pointerId);
    setDraggingId(id);

    const liveRow = () => listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(String(id))}"]`) ?? null;

    let currentOrder = order;
    let pointerY = event.clientY;
    // transform = pointerY - grabY. grabY moves by however far the row's
    // natural (untransformed) top moves after each reorder, so the row stays
    // exactly under the finger instead of jumping.
    let grabY = event.clientY;
    let naturalTop = rowEl.getBoundingClientRect().top;
    // Midpoints of the OTHER rows only, in order - the dragged row's own
    // shifted box never affects where it drops.
    let otherMidpoints: number[] = [];
    let measuring = false;
    let frame: number | null = null;
    let active = true;

    function applyTransform() {
      const row = liveRow();
      if (row) row.style.transform = `translateY(${pointerY - grabY}px)`;
    }

    function measure() {
      const row = liveRow();
      if (row) {
        row.style.transform = "";
        const top = row.getBoundingClientRect().top;
        grabY += top - naturalTop;
        naturalTop = top;
      }
      otherMidpoints = rowNodes()
        .filter((el) => el !== row)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return r.top + r.height / 2;
        });
      applyTransform();
    }

    measure();

    function onMove(ev: PointerEvent) {
      if (!active) return;
      pointerY = ev.clientY;
      applyTransform();
      if (measuring) return;

      const fromIdx = currentOrder.indexOf(id);
      const toIdx = otherMidpoints.filter((mid) => pointerY > mid).length;
      if (toIdx === fromIdx) return;

      const next = currentOrder.filter((row) => row !== id);
      next.splice(toIdx, 0, id);
      currentOrder = next;
      // Committed synchronously so the measure below sees the new layout.
      flushSync(() => setOrder(next));
      measuring = true;
      frame = requestAnimationFrame(() => {
        frame = null;
        measuring = false;
        if (active) measure();
      });
    }

    function cleanup() {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      const row = liveRow();
      if (row) {
        row.style.transform = "";
        if (row.hasPointerCapture?.(pointerId)) row.releasePointerCapture(pointerId);
      }
      setDraggingId(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  return (
    <div>
      <div ref={listRef} className="space-y-1.5">
        {/* Not a data-row: rowNodes() skips it, and a pointer over it is above
            DIVIDER_PRIMARY's midpoint, so a drop here lands at index 0. */}
        <div className="space-y-1.5">
          <GroupHeader zone="primary" count={primaryCount} locale={locale} />
          {primaryCount === 0 ? emptyDropZone : null}
        </div>
        {order.map((row) => {
          if (row === DIVIDER_PRIMARY || row === DIVIDER_UNTRACKED) {
            // One data-row per divider, so the drop zone sits in its lower
            // half and a drop there lands right after it - in that group.
            const isPrimaryDivider = row === DIVIDER_PRIMARY;
            const groupEmpty = isPrimaryDivider ? additionalCount === 0 : untrackedCount === 0;
            return (
              <div key={row} data-row data-row-id={row} className="space-y-1.5 pt-3">
                <GroupHeader
                  zone={isPrimaryDivider ? "additional" : "untracked"}
                  count={isPrimaryDivider ? additionalCount : untrackedCount}
                  locale={locale}
                />
                {groupEmpty ? emptyDropZone : null}
              </div>
            );
          }

          return (
            <div
              key={row}
              data-row
              data-row-id={row}
              className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-sm transition-colors ${
                draggingId === row
                  ? "relative z-10 border-teal-400 bg-teal-50 shadow-lg dark:border-teal-600 dark:bg-slate-800"
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
              <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{labelFor(row, locale)}</span>            </div>
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
