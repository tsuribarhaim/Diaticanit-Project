"use client";

import { useEffect, useRef, useState } from "react";

import { tr, type AppLocale } from "@/lib/locale";

/**
 * A day/month/year field group that always displays in the order the app's
 * own locale dictates (dd/mm/yyyy for Hebrew, mm/dd/yyyy for English) -
 * unlike a native `<input type="date">`, whose displayed format is chosen
 * by the browser's own UI-language setting, not the page's `lang`
 * attribute. Chrome in particular ignores `lang` here entirely, which is
 * why a Hebrew-locale page can still show mm/dd/yyyy to a user whose
 * browser itself is set to English. Produces/accepts the same
 * `yyyy-mm-dd` ISO string a date input would, so callers (and any server
 * action reading `formData.get(name)`) don't need to change.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function splitIso(iso: string): { day: string; month: string; year: string } {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) return { day: "", month: "", year: "" };
  return { year: match[1], month: match[2], day: match[3] };
}

function combineIso(day: string, month: string, year: string): string {
  if (day.length === 2 && month.length === 2 && year.length === 4) {
    return `${year}-${month}-${day}`;
  }
  return "";
}

function onlyDigits(raw: string, maxLen: number): string {
  return raw.replace(/[^0-9]/g, "").slice(0, maxLen);
}

export function LocalizedDateInput({
  locale,
  value,
  onChange,
  name,
  required,
  min,
  max,
  className,
  ariaLabel,
  compact = false,
}: {
  locale: AppLocale;
  /** Current value as an ISO `yyyy-mm-dd` string, or "" when empty/incomplete. */
  value: string;
  /** Called with the combined ISO string once all three fields are filled;
   * called with "" while incomplete, mirroring a native date input's value
   * during editing. Optional: a caller that only needs the plain-HTML-form
   * submission behavior (via `name`, e.g. inside a Server Component's GET
   * form) doesn't need to lift the value into its own state at all - the
   * hidden input's DOM value already stays current on its own. */
  onChange?: (isoValue: string) => void;
  /** When set, renders a hidden input with this name/value so a plain HTML
   * form submission (no onChange handler needed by the caller) still works
   * exactly like a native date input would. */
  name?: string;
  required?: boolean;
  /** ISO `yyyy-mm-dd` bounds - safe to compare as plain strings since the
   * format is fixed-width and zero-padded. */
  min?: string;
  max?: string;
  className?: string;
  ariaLabel?: string;
  /** Smaller fields with no per-field border, meant to be nested inside a
   * caller-provided single bordered group (see LocalizedDateTimeInput's own
   * compact mode) instead of each day/month/year field looking like its own
   * separate box - used where the default sizing was too bulky to fit a
   * date next to a time on one line (daily report's date & time row).
   * Defaults to false so every other existing call site (onboarding/profile
   * date of birth, the daily-report page's own date picker) is unaffected. */
  compact?: boolean;
}) {
  const initial = splitIso(value);
  const [day, setDay] = useState(initial.day);
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);

  // Re-sync from the parent when `value` changes externally (e.g. a form
  // reset after save) - not on every local keystroke, which already flows
  // the other way via onChange.
  useEffect(() => {
    const next = splitIso(value);
    setDay(next.day);
    setMonth(next.month);
    setYear(next.year);
  }, [value]);

  const dayRef = useRef<HTMLInputElement | null>(null);
  const monthRef = useRef<HTMLInputElement | null>(null);
  const yearRef = useRef<HTMLInputElement | null>(null);

  const combined = combineIso(day, month, year);
  const outOfRange = Boolean(combined && ((min && combined < min) || (max && combined > max)));

  function commit(nextDay: string, nextMonth: string, nextYear: string) {
    onChange?.(combineIso(nextDay, nextMonth, nextYear));
  }

  const fieldClass = compact
    ? "bg-transparent px-0.5 py-1 text-center text-sm outline-none rounded focus:bg-slate-100 dark:focus:bg-slate-800"
    : "rounded-lg border border-slate-300 bg-white px-2 py-2 text-center text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900";
  const dayMonthWidth = compact ? "w-7" : "w-12";
  const yearWidth = compact ? "w-10" : "w-16";

  const dayField = (
    <input
      key="day"
      ref={dayRef}
      type="text"
      inputMode="numeric"
      maxLength={2}
      value={day}
      placeholder={tr(locale, "DD", "יי")}
      aria-label={tr(locale, "Day", "יום")}
      onChange={(event) => {
        const next = onlyDigits(event.target.value, 2);
        setDay(next);
        commit(next, month, year);
        if (next.length === 2) monthRef.current?.focus();
      }}
      className={`${dayMonthWidth} ${fieldClass}`}
    />
  );

  const monthField = (
    <input
      key="month"
      ref={monthRef}
      type="text"
      inputMode="numeric"
      maxLength={2}
      value={month}
      placeholder={tr(locale, "MM", "חח")}
      aria-label={tr(locale, "Month", "חודש")}
      onChange={(event) => {
        const next = onlyDigits(event.target.value, 2);
        setMonth(next);
        commit(day, next, year);
        if (next.length === 2) yearRef.current?.focus();
      }}
      className={`${dayMonthWidth} ${fieldClass}`}
    />
  );

  const yearField = (
    <input
      key="year"
      ref={yearRef}
      type="text"
      inputMode="numeric"
      maxLength={4}
      value={year}
      placeholder={tr(locale, "YYYY", "שששש")}
      aria-label={tr(locale, "Year", "שנה")}
      onChange={(event) => {
        const next = onlyDigits(event.target.value, 4);
        setYear(next);
        commit(day, month, next);
      }}
      className={`${yearWidth} ${fieldClass}`}
    />
  );

  // The only thing that changes between locales: which field reads first,
  // left to right. Kept explicitly ltr below regardless of page direction -
  // digit sequences read left-to-right the same way a phone number would,
  // even inside an RTL page.
  const orderedFields = locale === "he" ? [dayField, monthField, yearField] : [monthField, dayField, yearField];

  const slashClass = compact ? "text-xs text-slate-400 dark:text-slate-600" : "text-slate-400 dark:text-slate-600";

  return (
    <div>
      <div className={`flex items-center ${compact ? "gap-0.5" : "gap-1"}`} dir="ltr" role="group" aria-label={ariaLabel}>
        {orderedFields[0]}
        <span className={slashClass}>/</span>
        {orderedFields[1]}
        <span className={slashClass}>/</span>
        {orderedFields[2]}
      </div>
      {name ? <input type="hidden" name={name} value={combined} required={required} /> : null}
      {outOfRange ? (
        <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
          {min && combined < min
            ? tr(locale, "Date is too early.", "התאריך מוקדם מדי.")
            : tr(locale, "Date can't be in the future.", "התאריך לא יכול להיות בעתיד.")}
        </p>
      ) : null}
    </div>
  );
}

/** Same problem, extended to a naive local datetime string
 * (`yyyy-mm-ddTHH:mm`, exactly what a native `datetime-local` input
 * produces) - composes LocalizedDateInput for the date portion with two
 * more digit fields for the time, always in 24-hour HH:mm regardless of
 * locale (sidesteps AM/PM locale formatting entirely, which has the same
 * browser-ignores-lang problem). */
export function LocalizedDateTimeInput({
  locale,
  value,
  onChange,
  className,
  ariaLabel,
  compact = false,
}: {
  locale: AppLocale;
  /** Naive local datetime as `yyyy-mm-ddTHH:mm`, or "". */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  /** Renders date and time as one small borderless field group inside a
   * single shared border, instead of each of the two field clusters having
   * its own full-size bordered box - the default rendering was too wide to
   * fit date + time on one line in a narrow column (e.g. the daily report
   * form's date/time field next to the weight field), forcing time onto its
   * own second row. Defaults to false so other call sites are unaffected. */
  compact?: boolean;
}) {
  function splitValue(raw: string): { date: string; hour: string; minute: string } {
    const [datePart, timePart] = raw.includes("T") ? raw.split("T") : ["", ""];
    return { date: datePart ?? "", hour: (timePart ?? "").slice(0, 2), minute: (timePart ?? "").slice(3, 5) };
  }

  const initial = splitValue(value);
  const [datePart, setDatePart] = useState(initial.date);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);

  useEffect(() => {
    const next = splitValue(value);
    setDatePart(next.date);
    setHour(next.hour);
    setMinute(next.minute);
  }, [value]);

  function commit(nextDate: string, nextHour: string, nextMinute: string) {
    if (nextDate && nextHour.length === 2 && nextMinute.length === 2) {
      onChange(`${nextDate}T${nextHour}:${nextMinute}`);
    } else {
      onChange("");
    }
  }

  const timeFieldClass = compact
    ? "w-6 bg-transparent px-0 py-1 text-center text-sm outline-none rounded focus:bg-slate-100 dark:focus:bg-slate-800"
    : "w-10 rounded-lg border border-slate-300 bg-white px-2 py-2 text-center text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900";

  const timeGroup = (
    <div className={`flex items-center ${compact ? "gap-0.5" : "gap-1"}`} dir="ltr">
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={hour}
        placeholder={tr(locale, "HH", "שש")}
        aria-label={tr(locale, "Hour", "שעה")}
        onChange={(event) => {
          const next = onlyDigits(event.target.value, 2);
          setHour(next);
          commit(datePart, next, minute);
        }}
        className={timeFieldClass}
      />
      <span className={compact ? "text-xs text-slate-400 dark:text-slate-600" : "text-slate-400 dark:text-slate-600"}>:</span>
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={minute}
        placeholder={tr(locale, "MM", "דד")}
        aria-label={tr(locale, "Minute", "דקה")}
        onChange={(event) => {
          const next = onlyDigits(event.target.value, 2);
          setMinute(next);
          commit(datePart, hour, next);
        }}
        className={timeFieldClass}
      />
    </div>
  );

  if (compact) {
    // One shared border around date + time together (instead of each field
    // cluster carrying its own box) so the whole group reads as a single
    // compact control that comfortably fits on one line. dir="ltr" here
    // (not just on the inner field groups, as the non-compact layout relies
    // on) matters specifically because this whole group is one flex row:
    // without it, an RTL ancestor visually reverses date and time to
    // opposite ends of the pill - so a page in Hebrew showed HH:MM on the
    // left and dd/mm/yyyy on the right, i.e. time read before date, which
    // is what compact was actually fixing here.
    return (
      <div
        dir="ltr"
        className={`inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900 ${className ?? ""}`}
      >
        <LocalizedDateInput
          locale={locale}
          value={datePart}
          onChange={(nextDate) => {
            setDatePart(nextDate);
            commit(nextDate, hour, minute);
          }}
          ariaLabel={ariaLabel}
          compact
        />
        <span className="text-slate-300 dark:text-slate-700">|</span>
        {timeGroup}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <LocalizedDateInput
        locale={locale}
        value={datePart}
        onChange={(nextDate) => {
          setDatePart(nextDate);
          commit(nextDate, hour, minute);
        }}
        ariaLabel={ariaLabel}
      />
      {timeGroup}
    </div>
  );
}
