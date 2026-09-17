"use client";

import Link from "next/link";

import { tr, type AppLocale } from "@/lib/locale";

/**
 * The "Jump to a date" calendar control on the Daily Report page - a client
 * component only because a native date input needs an onChange handler to
 * navigate immediately on selection (no separate "View" button to press),
 * which a plain Server Component can't wire up. Submitting via
 * requestSubmit() (not a manual href build) keeps this a real GET form
 * submission, identical to what pressing Enter or a submit button would
 * have produced, so the server still receives a normal ?date=... navigation.
 */
export function DailyReportDateJumpForm({
  locale,
  selectedDate,
  todayDateString,
}: {
  locale: AppLocale;
  selectedDate: string;
  todayDateString: string;
}) {
  return (
    <form method="GET" className="mt-2 flex items-center justify-center gap-2">
      {/* Native date input, not LocalizedDateInput (used everywhere else in
          the app for typed entry, e.g. birthdate) - deliberately different
          here: this field is pure browsing (tap a day on a calendar face,
          never read or type the raw digits), so LocalizedDateInput's whole
          reason to exist - keeping the DISPLAYED digit order tied to the
          page's own locale rather than the browser's language - doesn't
          apply. A native input gets a real calendar picker (month grid,
          prev/next navigation) on every platform for free instead of three
          plain digit boxes with no picker UI at all. */}
      <input
        type="date"
        name="date"
        defaultValue={selectedDate}
        max={todayDateString}
        aria-label={tr(locale, "View date", "תאריך לצפייה")}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none ring-teal-600 focus:ring-2"
      />
      {/* No visible submit button - selecting a date above navigates
          immediately via onChange. Kept as a screen-reader-only control
          rather than removed outright: it's still what makes Enter-to-submit
          work for a keyboard/assistive-tech user who tabs into the field
          without triggering a change event via a pointer. */}
      <button type="submit" className="sr-only">
        {tr(locale, "View", "הצגה")}
      </button>
      {/* Only shown while actually browsing a past day - lets the user jump
          straight back to today without having to open the calendar face
          and tap today's cell themselves. Plain link to the bare route (no
          `date`/`edit` params) so it resets the whole page - list, graphs,
          and the compose form above - back to today's own data, not just
          the date shown in this picker. */}
      {selectedDate !== todayDateString ? (
        <Link
          href="/app/daily-report"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          {tr(locale, "Today", "היום")}
        </Link>
      ) : null}
    </form>
  );
}
