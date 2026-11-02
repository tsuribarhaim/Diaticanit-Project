"use client";

import { useRef } from "react";

import { preferredExerciseActivityKeys, type PreferredExerciseActivityKey } from "@/lib/profile";
import {
  formatExerciseModality,
  formatPreferredExerciseActivity,
  matchPreferredExerciseActivity,
  tr,
  type AppLocale,
} from "@/lib/locale";

export const LEGACY_EXERCISE_MODALITIES = ["endurance_cardio", "martial_arts"] as const;
/** exerciseOtherActivitiesSchema's own max. */
export const MAX_OTHER_ACTIVITIES = 10;

export type ExerciseActivityRow = {
  id: string;
  kind: "default" | "legacy" | "custom";
  key?: PreferredExerciseActivityKey;
  legacyModality?: (typeof LEGACY_EXERCISE_MODALITIES)[number];
  name: string;
  days: string;
  minutes: string;
};

type ExerciseScheduleEntry = { days_per_week: number; minutes_per_session: number };
type ExerciseOtherActivityEntry = { name: string; days_per_week: number; minutes_per_session: number };

export function parseBoundedInt(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

export const parseActivityDays = (value: string) => parseBoundedInt(value, 1, 14);
export const parseActivityMinutes = (value: string) => parseBoundedInt(value, 1, 600);

/** Stored as a named exercise_other_activities entry (everything but strength and the legacy modalities). */
export function isStoredAsOther(row: ExerciseActivityRow): boolean {
  return row.kind === "custom" || (row.kind === "default" && row.key !== "strength");
}

/** Turns the stored exercise fields into editor rows (profile sheet and sign-up step 2). */
export function buildExerciseRows(
  modalities: string[],
  otherActivities: ExerciseOtherActivityEntry[],
  scheduleByModality: Partial<Record<string, ExerciseScheduleEntry>>,
  locale: AppLocale,
  newRowId: () => string,
): ExerciseActivityRow[] {
  const initial: ExerciseActivityRow[] = [];
  const usedKeys = new Set<PreferredExerciseActivityKey>();
  if (!modalities.includes("none")) {
    if (modalities.includes("resistance_hypertrophy")) {
      const entry = scheduleByModality.resistance_hypertrophy;
      usedKeys.add("strength");
      initial.push({
        id: newRowId(),
        kind: "default",
        key: "strength",
        name: formatPreferredExerciseActivity("strength", locale),
        days: entry ? String(entry.days_per_week) : "",
        minutes: entry ? String(entry.minutes_per_session) : "",
      });
    }
    for (const modality of LEGACY_EXERCISE_MODALITIES) {
      if (!modalities.includes(modality)) continue;
      const entry = scheduleByModality[modality];
      initial.push({
        id: newRowId(),
        kind: "legacy",
        legacyModality: modality,
        name: formatExerciseModality(modality, locale),
        days: entry ? String(entry.days_per_week) : "",
        minutes: entry ? String(entry.minutes_per_session) : "",
      });
    }
    for (const activity of otherActivities) {
      const key = matchPreferredExerciseActivity(activity.name);
      const days = String(activity.days_per_week);
      const minutes = String(activity.minutes_per_session);
      if (key && !usedKeys.has(key)) {
        usedKeys.add(key);
        initial.push({ id: newRowId(), kind: "default", key, name: formatPreferredExerciseActivity(key, locale), days, minutes });
      } else {
        initial.push({ id: newRowId(), kind: "custom", name: activity.name, days, minutes });
      }
    }
  }
  return initial;
}

/** The exercise_* form fields the server actions expect, built from the editor rows ('none' when there are no rows). */
export function buildExerciseSubmission(
  rows: ExerciseActivityRow[],
  locale: AppLocale,
): {
  modalities: string[];
  scheduleByModality: Record<string, ExerciseScheduleEntry>;
  otherActivities: ExerciseOtherActivityEntry[];
} {
  const modalities: string[] = [];
  if (rows.some((row) => row.key === "strength")) modalities.push("resistance_hypertrophy");
  for (const modality of LEGACY_EXERCISE_MODALITIES) {
    if (rows.some((row) => row.legacyModality === modality)) modalities.push(modality);
  }
  if (rows.some(isStoredAsOther)) modalities.push("other");
  if (modalities.length === 0) modalities.push("none");

  const scheduleByModality: Record<string, ExerciseScheduleEntry> = Object.fromEntries(
    rows
      .filter((row) => row.key === "strength" || row.kind === "legacy")
      .map((row) => [
        row.key === "strength" ? "resistance_hypertrophy" : row.legacyModality,
        { days_per_week: Number(row.days || 0), minutes_per_session: Number(row.minutes || 0) },
      ]),
  );
  const otherActivities = rows.filter(isStoredAsOther).map((row) => ({
    name: row.kind === "default" && row.key ? formatPreferredExerciseActivity(row.key, locale) : row.name.trim(),
    days_per_week: Number(row.days || 0),
    minutes_per_session: Number(row.minutes || 0),
  }));

  return { modalities, scheduleByModality, otherActivities };
}

export function computeExerciseTotals(rows: ExerciseActivityRow[]): { totalDays: number; totalMinutes: number; canSave: boolean } {
  let totalDays = 0;
  let totalMinutes = 0;
  for (const row of rows) {
    const days = parseActivityDays(row.days);
    const minutes = parseActivityMinutes(row.minutes);
    if (days !== null) totalDays += days;
    if (days !== null && minutes !== null) totalMinutes += days * minutes;
  }
  const canSave = rows.every(
    (row) => parseActivityDays(row.days) !== null && parseActivityMinutes(row.minutes) !== null && (row.kind !== "custom" || row.name.trim() !== ""),
  );
  return { totalDays, totalMinutes, canSave };
}

export function ExerciseTotalsLine({
  locale,
  hasRows,
  totalDays,
  totalMinutes,
}: {
  locale: AppLocale;
  hasRows: boolean;
  totalDays: number;
  totalMinutes: number;
}) {
  const hours = Math.round(totalMinutes / 60);
  const hoursText =
    totalMinutes <= 0
      ? null
      : hours >= 2
        ? tr(locale, `~${hours} hours`, `כ-${hours} שעות`)
        : hours === 1
          ? tr(locale, "~1 hour", "כשעה")
          : tr(locale, `~${totalMinutes} min`, `כ-${totalMinutes} דקות`);
  const totalText =
    totalDays === 1
      ? tr(locale, "Total 1 workout per week", "סה\"כ אימון אחד בשבוע")
      : tr(locale, `Total ${totalDays} workouts per week`, `סה"כ ${totalDays} אימונים בשבוע`);

  return hasRows ? (
    <p className="rounded-xl bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900 dark:bg-teal-900/50 dark:text-teal-100">
      {totalText}
      {hoursText ? <span className="font-normal text-teal-700 dark:text-teal-300">{` · ${hoursText}`}</span> : null}
    </p>
  ) : (
    <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {tr(locale, "No activities selected", "לא נבחרו פעילויות")}
    </p>
  );
}

// `!` because globals.css's unlayered input color/background defaults
// otherwise outrank Tailwind's layered utilities (the fields stayed white in dark mode).
const numberInputClass = (valid: boolean) =>
  `h-9 w-14 shrink-0 rounded-lg border bg-white! px-1 text-center text-sm font-bold text-slate-900! outline-none ring-teal-600 focus:ring-2 dark:bg-slate-950! dark:text-slate-100! ${
    valid ? "border-slate-300 dark:border-slate-700" : "border-rose-400 dark:border-rose-500"
  }`;

/** The "Regular workouts" activity rows plus the "To add" chips - shared by the profile sheet and sign-up step 2. */
export function ExerciseActivitiesEditor({
  locale,
  rows,
  onChange,
  onRemove,
  newRowId,
}: {
  locale: AppLocale;
  rows: ExerciseActivityRow[];
  onChange: (rows: ExerciseActivityRow[]) => void;
  onRemove?: (id: string) => void;
  newRowId: () => string;
}) {
  const focusRowIdRef = useRef<string | null>(null);

  function updateRow(id: string, patch: Partial<Pick<ExerciseActivityRow, "name" | "days" | "minutes">>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addDefaultRow(key: PreferredExerciseActivityKey) {
    onChange([...rows, { id: newRowId(), kind: "default", key, name: formatPreferredExerciseActivity(key, locale), days: "", minutes: "" }]);
  }

  function addCustomRow() {
    const id = newRowId();
    focusRowIdRef.current = id;
    onChange([...rows, { id, kind: "custom", name: "", days: "", minutes: "" }]);
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
    onRemove?.(id);
  }

  const usedKeys = new Set(rows.map((row) => row.key).filter((key): key is PreferredExerciseActivityKey => Boolean(key)));
  const chipKeys = preferredExerciseActivityKeys.filter((key) => !usedKeys.has(key));
  const storedAsOtherCount = rows.filter(isStoredAsOther).length;

  return (
    <>
      {rows.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-end gap-2 px-3 text-center text-[10px] leading-tight text-slate-500 dark:text-slate-400">
            <span className="flex-1" />
            <span className="w-14 shrink-0">{tr(locale, "Times / week", "מס' פעמים בשבוע")}</span>
            <span className="w-14 shrink-0">{tr(locale, "Min / session", "דקות באימון")}</span>
          </div>
          {rows.map((row) => {
            const daysValid = parseActivityDays(row.days) !== null;
            const minutesValid = parseActivityMinutes(row.minutes) !== null;
            return (
              <div key={row.id} className="flex h-[52px] items-center gap-2 rounded-xl border border-teal-300/60 px-3 dark:border-teal-700">
                <input
                  type="checkbox"
                  checked
                  onChange={() => removeRow(row.id)}
                  aria-label={tr(locale, "Remove activity", "הסרת פעילות")}
                  className="h-5 w-5 shrink-0 accent-teal-600"
                />
                {row.kind === "custom" ? (
                  <input
                    ref={(element) => {
                      if (element && focusRowIdRef.current === row.id) {
                        focusRowIdRef.current = null;
                        element.focus();
                      }
                    }}
                    type="text"
                    value={row.name}
                    maxLength={80}
                    onChange={(event) => updateRow(row.id, { name: event.target.value })}
                    placeholder={tr(locale, "Activity name", "שם הפעילות")}
                    className={`h-9 min-w-0 flex-1 rounded-lg border bg-white! px-2 text-sm text-slate-900! outline-none ring-teal-600 focus:ring-2 dark:bg-slate-950! dark:text-slate-100! ${
                      row.name.trim() ? "border-slate-300 dark:border-slate-700" : "border-rose-400 dark:border-rose-500"
                    }`}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {row.kind === "default" && row.key ? formatPreferredExerciseActivity(row.key, locale) : row.name}
                  </span>
                )}
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={14}
                  value={row.days}
                  onChange={(event) => updateRow(row.id, { days: event.target.value })}
                  aria-label={tr(locale, "Times / week", "מס' פעמים בשבוע")}
                  className={numberInputClass(daysValid)}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  value={row.minutes}
                  onChange={(event) => updateRow(row.id, { minutes: event.target.value })}
                  aria-label={tr(locale, "Min / session", "דקות באימון")}
                  className={numberInputClass(minutesValid)}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{tr(locale, "To add", "להוספה")}</p>
        <div className="flex flex-wrap gap-2">
          {chipKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => addDefaultRow(key)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {`+ ${formatPreferredExerciseActivity(key, locale)}`}
            </button>
          ))}
          {storedAsOtherCount < MAX_OTHER_ACTIVITIES ? (
            <button
              type="button"
              onClick={addCustomRow}
              className="rounded-lg border border-dashed border-teal-500 px-3 py-1.5 text-sm text-teal-700 hover:bg-teal-50 dark:border-teal-600 dark:text-teal-300 dark:hover:bg-teal-900/30"
            >
              {tr(locale, "+ Other", "+ אחר")}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
