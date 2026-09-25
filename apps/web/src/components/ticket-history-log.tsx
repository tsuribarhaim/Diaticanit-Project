"use client";

import { LocalDateTime } from "@/components/local-time";
import { tr, type AppLocale } from "@/lib/locale";
import type { TicketDescriptionEntry } from "@/lib/tickets";

/**
 * Renders a ticket's description as a dated, newest-first history log
 * instead of one static paragraph - see parseTicketDescriptionLog's own
 * comment on the append-only format this reads. The original submission
 * (isOriginal) is visually distinct (italic, tagged) since it's the one
 * entry that predates this whole feature and has no change-summary line
 * of its own.
 */
export function TicketHistoryLog({ locale, entries }: { locale: AppLocale; entries: TicketDescriptionEntry[] }) {
  return (
    <div className="space-y-4">
      {entries.map((entry, index) => (
        <div
          key={index}
          className={`relative border-s-2 ps-4 ${index === 0 ? "border-teal-300 dark:border-teal-700" : "border-slate-200 dark:border-slate-800"}`}
        >
          <span
            className={`absolute -start-[5px] top-1 h-2 w-2 rounded-full ${index === 0 ? "bg-teal-600 dark:bg-teal-400" : "bg-slate-300 dark:bg-slate-700"}`}
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            <LocalDateTime value={entry.date} locale={locale} />
            {entry.isOriginal ? (
              <span className="ms-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {tr(locale, "original", "מקורי")}
              </span>
            ) : null}
            {entry.authoredBySupport ? (
              <span className="ms-2 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0 text-[10px] font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-400">
                {tr(locale, "Support", "תמיכה")}
              </span>
            ) : null}
          </p>
          {entry.changeSummary ? (
            <p
              className={`mt-1 inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${
                entry.changeKind === "status"
                  ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-400"
                  : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
              }`}
            >
              {entry.changeSummary}
            </p>
          ) : null}
          {entry.note ? (
            <p className={`mt-1.5 whitespace-pre-wrap text-sm ${entry.isOriginal ? "italic text-slate-700 dark:text-slate-300" : "text-slate-800 dark:text-slate-200"}`}>
              {entry.note}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
