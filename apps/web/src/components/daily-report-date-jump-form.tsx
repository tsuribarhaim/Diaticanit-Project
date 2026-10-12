"use client";

import { NavLink as Link } from "@/components/nav-link";

import { formatDateForLocale, tr, type AppLocale } from "@/lib/locale";

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
          the app for typed entry, e.g. birthdate): a native input gets a real
          calendar picker (month grid, prev/next navigation) on every platform,
          which LocalizedDateInput's plain digit boxes don't have. But the
          browser draws that input's digits in ITS OWN order (e.g. mm/dd on an
          en-US phone), which didn't match the header above it (TCK-146). So
          the input sits invisible on top of the field - a tap still opens the
          system calendar - and the visible text is formatDateForLocale, the
          same formatter as the header. The bare YYYY-MM-DD is parsed as a
          local date there, so it can't shift a day in the browser's timezone.
          min-w keeps the field (and so the invisible input) a real tap target:
          an iOS date input with no size of its own can shrink to nothing. */}
      <span className="relative inline-flex min-w-[9.5rem] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm ring-teal-600 focus-within:ring-2 dark:border-slate-700 dark:bg-slate-900">
        <span aria-hidden="true" className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          <span dir="ltr">{formatDateForLocale(selectedDate, locale)}</span>
        </span>
        <input
          type="date"
          name="date"
          defaultValue={selectedDate}
          max={todayDateString}
          aria-label={tr(locale, "View date", "תאריך לצפייה")}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          onClick={(event) => {
            // With a mouse, a click on the (invisible) digits only focuses them - open the calendar instead. Phones open
            // their own picker on tap, so this is skipped there (a second open could flicker or throw).
            if (!window.matchMedia("(pointer: fine)").matches) return;
            try {
              event.currentTarget.showPicker?.();
            } catch {
              // Not allowed here (e.g. inside a cross-origin frame): the focused field still works with the keyboard.
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {tr(locale, "Today", "היום")}
        </Link>
      ) : null}
    </form>
  );
}
