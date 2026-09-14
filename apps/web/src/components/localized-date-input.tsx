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

  const fieldClass =
    "rounded-lg border border-slate-300 bg-white px-2 py-2 text-center text-sm outline-none ring-teal-600 focus:ring-2";

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
      className={`w-12 ${fieldClass}`}
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
      className={`w-12 ${fieldClass}`}
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
      className={`w-16 ${fieldClass}`}
    />
  );

  // The only thing that changes between locales: which field reads first,
  // left to right. Kept explicitly ltr below regardless of page direction -
  // digit sequences read left-to-right the same way a phone number would,
  // even inside an RTL page.
  const orderedFields = locale === "he" ? [dayField, monthField, yearField] : [monthField, dayField, yearField];

  return (
    <div>
      <div className="flex items-center gap-1" dir="ltr" role="group" aria-label={ariaLabel}>
        {orderedFields[0]}
        <span className="text-slate-400">/</span>
        {orderedFields[1]}
        <span className="text-slate-400">/</span>
        {orderedFields[2]}
      </div>
      {name ? <input type="hidden" name={name} value={combined} required={required} /> : null}
      {outOfRange ? (
        <p className="mt-1 text-xs text-rose-600">
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
}: {
  locale: AppLocale;
  /** Naive local datetime as `yyyy-mm-ddTHH:mm`, or "". */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
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

  const timeFieldClass =
    "w-10 rounded-lg border border-slate-300 bg-white px-2 py-2 text-center text-sm outline-none ring-teal-600 focus:ring-2";

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
      <div className="flex items-center gap-1" dir="ltr">
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
        <span className="text-slate-400">:</span>
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
    </div>
  );
}
