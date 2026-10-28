"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  updateAllergiesAction,
  updateDietaryPreferencesAction,
  updateExercisePreferencesAction,
  updateHabitsAction,
  updateHealthGoalsAction,
  updateMedicalConditionsAction,
  updateMedicationsAction,
  type QuickEditState,
} from "@/app/app/profile/actions";
import {
  alcoholWeeklyFrequencyLabels,
  caffeineCupsLabels,
  lifestyleHabitLabel,
  LifestyleHabitsFields,
  type LifestyleHabitsValues,
  smokingCigarettesRangeLabels,
  smokingStatusLabels,
} from "@/components/lifestyle-habits-fields";
import { ProfileRow, QuickEditSheet, SheetActions, useQuickEditSuccessEffect } from "@/components/profile-quick-edit";
import {
  dietaryPreferenceOptions,
  healthGoalOptions,
  medicalConditionOptions,
  normalizeDietaryPreferences,
  preferredExerciseActivityKeys,
  type PreferredExerciseActivityKey,
} from "@/lib/profile";
import {
  formatDietaryPreference,
  formatExerciseModality,
  formatHabit,
  formatHealthGoal,
  formatMedicalCondition,
  formatPreferredExerciseActivity,
  matchPreferredExerciseActivity,
  tr,
  type AppLocale,
} from "@/lib/locale";

const fieldInputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const LEGACY_EXERCISE_MODALITIES = ["endurance_cardio", "martial_arts"] as const;
/** exerciseOtherActivitiesSchema's own max. */
const MAX_OTHER_ACTIVITIES = 10;
const ACTIVITY_REMOVED_TOAST_MS = 2500;

type ExerciseActivityRow = {
  id: string;
  kind: "default" | "legacy" | "custom";
  key?: PreferredExerciseActivityKey;
  legacyModality?: (typeof LEGACY_EXERCISE_MODALITIES)[number];
  name: string;
  days: string;
  minutes: string;
};

function parseBoundedInt(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

const parseActivityDays = (value: string) => parseBoundedInt(value, 1, 14);
const parseActivityMinutes = (value: string) => parseBoundedInt(value, 1, 600);

/** Stored as a named exercise_other_activities entry (everything but strength and the legacy modalities). */
function isStoredAsOther(row: ExerciseActivityRow): boolean {
  return row.kind === "custom" || (row.kind === "default" && row.key !== "strength");
}

function ExercisePreferencesFooter({
  locale,
  canSave,
  hasRows,
  totalDays,
  totalMinutes,
  toast,
  onCancel,
}: {
  locale: AppLocale;
  canSave: boolean;
  hasRows: boolean;
  totalDays: number;
  totalMinutes: number;
  toast: string | null;
  onCancel: () => void;
}) {
  const { pending } = useFormStatus();
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

  return (
    <div className="sticky bottom-0 -mx-5 -mb-5 space-y-3 border-t border-slate-200 bg-white px-5 pb-5 pt-3 dark:border-slate-700 dark:bg-slate-900 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-6">
      {toast ? (
        <div className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center">
          <p role="status" className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
            {toast}
          </p>
        </div>
      ) : null}
      {!canSave ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">
          {tr(locale, "Fill in times per week and minutes for every activity", "יש למלא מספר פעמים בשבוע ודקות לכל פעילות")}
        </p>
      ) : null}
      {hasRows ? (
        <p className="rounded-xl bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900 dark:bg-teal-900/50 dark:text-teal-100">
          {totalText}
          {hoursText ? <span className="font-normal text-teal-700 dark:text-teal-300">{` · ${hoursText}`}</span> : null}
        </p>
      ) : (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {tr(locale, "No activities selected", "לא נבחרו פעילויות")}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {tr(locale, "Cancel", "ביטול")}
        </button>
        <button
          type="submit"
          disabled={pending || !canSave}
          className="flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"
        >
          {pending ? tr(locale, "Saving…", "שומר…") : tr(locale, "Save", "שמירה")}
        </button>
      </div>
    </div>
  );
}

function pillButtonClass(active: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-semibold ${
    active ? "bg-teal-700 text-white dark:bg-teal-600" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
  }`;
}

export function AllergiesFieldRow({ locale, allergies }: { locale: AppLocale; allergies: string[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(allergies.join(", "));
  const [state, formAction] = useActionState(updateAllergiesAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  return (
    <>
      <ProfileRow
        label={tr(locale, "Allergies", "אלרגיות")}
        value={allergies.length ? allergies.join(", ") : tr(locale, "No", "לא")}
        onClick={() => {
          setDraft(allergies.join(", "));
          setIsOpen(true);
        }}
      />
      <QuickEditSheet
        locale={locale}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={tr(locale, "Allergies", "אלרגיות")}
        helpText={tr(locale, "Separate multiple allergies with commas.", "יש להפריד בין מספר אלרגיות בפסיקים.")}
      >
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="preferred_language" value={locale} />
          <textarea
            name="allergies"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder={tr(locale, "e.g. Peanuts, Shellfish", "לדוגמה: בוטנים, פירות ים")}
            className={`${fieldInputClass} resize-none`}
          />
          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}

export function ExercisePreferencesRow({
  locale,
  modalities,
  otherActivities,
  scheduleByModality,
}: {
  locale: AppLocale;
  modalities: string[];
  otherActivities: Array<{ name: string; days_per_week: number; minutes_per_session: number }>;
  scheduleByModality: Record<string, { days_per_week: number; minutes_per_session: number }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<ExerciseActivityRow[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [state, formAction] = useActionState(updateExercisePreferencesAction, {} as QuickEditState);
  const nextRowIdRef = useRef(0);
  const focusRowIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function newRowId(): string {
    nextRowIdRef.current += 1;
    return `row-${nextRowIdRef.current}`;
  }

  function openSheet() {
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
    setRows(initial);
    setToast(null);
    setIsOpen(true);
  }

  function updateRow(id: string, patch: Partial<Pick<ExerciseActivityRow, "name" | "days" | "minutes">>) {
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addDefaultRow(key: PreferredExerciseActivityKey) {
    setRows((previous) => [...previous, { id: newRowId(), kind: "default", key, name: formatPreferredExerciseActivity(key, locale), days: "", minutes: "" }]);
  }

  function addCustomRow() {
    const id = newRowId();
    focusRowIdRef.current = id;
    setRows((previous) => [...previous, { id, kind: "custom", name: "", days: "", minutes: "" }]);
  }

  function removeRow(id: string) {
    setRows((previous) => previous.filter((row) => row.id !== id));
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(tr(locale, "Activity removed", "הפעילות בוטלה"));
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, ACTIVITY_REMOVED_TOAST_MS);
  }

  const usedKeys = new Set(rows.map((row) => row.key).filter((key): key is PreferredExerciseActivityKey => Boolean(key)));
  const chipKeys = preferredExerciseActivityKeys.filter((key) => !usedKeys.has(key));
  const storedAsOtherCount = rows.filter(isStoredAsOther).length;

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

  const submittedModalities: string[] = [];
  if (rows.some((row) => row.key === "strength")) submittedModalities.push("resistance_hypertrophy");
  for (const modality of LEGACY_EXERCISE_MODALITIES) {
    if (rows.some((row) => row.legacyModality === modality)) submittedModalities.push(modality);
  }
  if (storedAsOtherCount > 0) submittedModalities.push("other");
  if (submittedModalities.length === 0) submittedModalities.push("none");

  const scheduleJson = JSON.stringify(
    Object.fromEntries(
      rows
        .filter((row) => row.key === "strength" || row.kind === "legacy")
        .map((row) => [
          row.key === "strength" ? "resistance_hypertrophy" : row.legacyModality,
          { days_per_week: Number(row.days || 0), minutes_per_session: Number(row.minutes || 0) },
        ]),
    ),
  );
  const othersJson = JSON.stringify(
    rows.filter(isStoredAsOther).map((row) => ({
      name: row.kind === "default" && row.key ? formatPreferredExerciseActivity(row.key, locale) : row.name.trim(),
      days_per_week: Number(row.days || 0),
      minutes_per_session: Number(row.minutes || 0),
    })),
  );

  const summaryValue =
    modalities.length === 0 || modalities.includes("none")
      ? tr(locale, "No", "לא")
      : modalities
          .filter((modality) => modality !== "other")
          .map((modality) =>
            modality === "resistance_hypertrophy" ? formatPreferredExerciseActivity("strength", locale) : formatExerciseModality(modality, locale),
          )
          .concat(
            otherActivities
              .map((activity) => {
                const key = matchPreferredExerciseActivity(activity.name);
                return key ? formatPreferredExerciseActivity(key, locale) : activity.name;
              })
              .filter(Boolean),
          )
          .join(", ") || tr(locale, "No", "לא");

  // `!` because globals.css's unlayered input color/background defaults
  // otherwise outrank Tailwind's layered utilities (the fields stayed white in dark mode).
  const numberInputClass = (valid: boolean) =>
    `h-9 w-14 shrink-0 rounded-lg border bg-white! px-1 text-center text-sm font-bold text-slate-900! outline-none ring-teal-600 focus:ring-2 dark:bg-slate-950! dark:text-slate-100! ${
      valid ? "border-slate-300 dark:border-slate-700" : "border-rose-400 dark:border-rose-500"
    }`;

  return (
    <>
      <ProfileRow label={tr(locale, "Preferred exercise types", "סוגי אימון מועדפים")} value={summaryValue} onClick={openSheet} />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Preferred exercise types", "סוגי אימון מועדפים")}>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="preferred_language" value={locale} />
          {submittedModalities.map((modality) => (
            <input key={modality} type="hidden" name="exercise_modalities" value={modality} />
          ))}
          <input type="hidden" name="exercise_schedule_by_modality" value={scheduleJson} />
          <input type="hidden" name="exercise_other_activities" value={othersJson} />

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

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <ExercisePreferencesFooter
            locale={locale}
            canSave={canSave}
            hasRows={rows.length > 0}
            totalDays={totalDays}
            totalMinutes={totalMinutes}
            toast={toast}
            onCancel={() => setIsOpen(false)}
          />
        </form>
      </QuickEditSheet>
    </>
  );
}

export function MedicalConditionsRow({
  locale,
  hasMedicalConditions,
  medicalConditions,
  medicalConditionsDetails,
}: {
  locale: AppLocale;
  hasMedicalConditions: boolean;
  medicalConditions: string[];
  medicalConditionsDetails: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasConditions, setHasConditions] = useState(hasMedicalConditions);
  const [selected, setSelected] = useState<string[]>(medicalConditions);
  const [details, setDetails] = useState(medicalConditionsDetails);
  const [state, formAction] = useActionState(updateMedicalConditionsAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  function openSheet() {
    setHasConditions(hasMedicalConditions);
    setSelected(medicalConditions);
    setDetails(medicalConditionsDetails);
    setIsOpen(true);
  }

  function toggleCondition(condition: string) {
    setSelected((previous) => {
      if (condition === "prefer_not_to_disclose") return previous.includes(condition) ? [] : [condition];
      const withoutPreferNot = previous.filter((entry) => entry !== "prefer_not_to_disclose");
      return withoutPreferNot.includes(condition) ? withoutPreferNot.filter((entry) => entry !== condition) : [...withoutPreferNot, condition];
    });
  }

  const summary = !hasMedicalConditions
    ? tr(locale, "No", "לא")
    : medicalConditions.includes("other") && medicalConditionsDetails
      ? medicalConditionsDetails
      : medicalConditions.map((condition) => formatMedicalCondition(condition, locale)).join(", ") || tr(locale, "Yes", "כן");

  return (
    <>
      <ProfileRow label={tr(locale, "Medical conditions", "מצבים רפואיים")} value={summary} onClick={openSheet} />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Medical conditions", "מצבים רפואיים")}>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="preferred_language" value={locale} />
          <input type="hidden" name="has_medical_conditions" value={hasConditions ? "yes" : "no"} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setHasConditions(false)} className={pillButtonClass(!hasConditions)}>
              {tr(locale, "No", "לא")}
            </button>
            <button type="button" onClick={() => setHasConditions(true)} className={pillButtonClass(hasConditions)}>
              {tr(locale, "Yes", "כן")}
            </button>
          </div>

          {hasConditions ? (
            <>
              <div className="space-y-1.5">
                {medicalConditionOptions.map((condition) => (
                  <label key={condition} className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      name="medical_conditions"
                      value={condition}
                      checked={selected.includes(condition)}
                      onChange={() => toggleCondition(condition)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                    />
                    {formatMedicalCondition(condition, locale)}
                  </label>
                ))}
              </div>
              {selected.includes("other") ? (
                <textarea
                  name="medical_conditions_details"
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={3}
                  maxLength={250}
                  placeholder={tr(locale, "Describe the condition", "יש לתאר את המצב")}
                  className={`${fieldInputClass} resize-none`}
                />
              ) : null}
            </>
          ) : null}

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}

export function MedicationsRow({
  locale,
  hasRegularMedications,
  regularMedicationsDetails,
}: {
  locale: AppLocale;
  hasRegularMedications: boolean;
  regularMedicationsDetails: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasMeds, setHasMeds] = useState(hasRegularMedications);
  const [details, setDetails] = useState(regularMedicationsDetails);
  const [state, formAction] = useActionState(updateMedicationsAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  return (
    <>
      <ProfileRow
        label={tr(locale, "Regular medications", "תרופות קבועות")}
        value={hasRegularMedications ? regularMedicationsDetails || tr(locale, "Yes", "כן") : tr(locale, "No", "לא")}
        onClick={() => {
          setHasMeds(hasRegularMedications);
          setDetails(regularMedicationsDetails);
          setIsOpen(true);
        }}
      />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Regular medications", "תרופות קבועות")}>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="preferred_language" value={locale} />
          <input type="hidden" name="has_regular_medications" value={hasMeds ? "yes" : "no"} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setHasMeds(false)} className={pillButtonClass(!hasMeds)}>
              {tr(locale, "No", "לא")}
            </button>
            <button type="button" onClick={() => setHasMeds(true)} className={pillButtonClass(hasMeds)}>
              {tr(locale, "Yes", "כן")}
            </button>
          </div>
          {hasMeds ? (
            <textarea
              name="regular_medications_details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={tr(locale, "Medication name, dosage, frequency", "שם התרופה, מינון, תדירות")}
              className={`${fieldInputClass} resize-none`}
            />
          ) : null}
          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}

export function HabitsRow({
  locale,
  habits,
  biologicalSex,
  lifestyleHabits,
}: {
  locale: AppLocale;
  habits: string[];
  biologicalSex: string | null;
  lifestyleHabits: LifestyleHabitsValues;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<LifestyleHabitsValues>(lifestyleHabits);
  const [state, formAction] = useActionState(updateHabitsAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  function openSheet() {
    setValues(lifestyleHabits);
    setIsOpen(true);
  }

  // TCK-119: once any questionnaire answer exists the row summarizes the
  // answers; until then it keeps the legacy habits summary.
  const answeredParts: string[] = [];
  const alcoholLabel = lifestyleHabitLabel(alcoholWeeklyFrequencyLabels, lifestyleHabits.alcohol_weekly_frequency, locale, biologicalSex);
  if (alcoholLabel) answeredParts.push(`${tr(locale, "Alcohol: ", "אלכוהול: ")}${alcoholLabel}`);
  const smokingLabel = lifestyleHabitLabel(smokingStatusLabels, lifestyleHabits.smoking_status, locale, biologicalSex);
  if (smokingLabel) {
    const rangeLabel =
      lifestyleHabits.smoking_status === "daily"
        ? lifestyleHabitLabel(smokingCigarettesRangeLabels, lifestyleHabits.smoking_cigarettes_range, locale, biologicalSex)
        : null;
    answeredParts.push(`${tr(locale, "Smoking: ", "עישון: ")}${smokingLabel}${rangeLabel ? ` (${rangeLabel})` : ""}`);
  }
  const caffeineLabel = lifestyleHabitLabel(caffeineCupsLabels, lifestyleHabits.caffeine_cups_per_day, locale, biologicalSex);
  if (caffeineLabel) answeredParts.push(tr(locale, `Caffeine: ${caffeineLabel}/day`, `קפאין: ${caffeineLabel} ביום`));

  const summary =
    answeredParts.length > 0
      ? answeredParts.join(" · ")
      : habits.length === 0 || habits.includes("none")
        ? tr(locale, "No", "לא")
        : habits.map((habit) => formatHabit(habit, locale)).join(", ");

  return (
    <>
      <ProfileRow label={tr(locale, "Lifestyle habits", "הרגלי חיים")} value={summary} onClick={openSheet} />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Lifestyle habits", "הרגלי חיים")}>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="preferred_language" value={locale} />
          <LifestyleHabitsFields locale={locale} biologicalSex={biologicalSex} values={values} onChange={setValues} hideTitle />

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}

export function HealthGoalsRow({
  locale,
  healthGoals,
  markersDetails,
  otherDetails,
}: {
  locale: AppLocale;
  healthGoals: string[];
  markersDetails: string;
  otherDetails: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(healthGoals);
  const [markers, setMarkers] = useState(markersDetails);
  const [other, setOther] = useState(otherDetails);
  const [state, formAction] = useActionState(updateHealthGoalsAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  function openSheet() {
    setSelected(healthGoals);
    setMarkers(markersDetails);
    setOther(otherDetails);
    setIsOpen(true);
  }

  function toggleGoal(goal: string) {
    if (selected.includes(goal)) {
      setSelected(selected.filter((entry) => entry !== goal));
      if (goal === "abnormal_markers") setMarkers("");
      if (goal === "other") setOther("");
    } else {
      setSelected([...selected, goal]);
    }
  }

  const summary = healthGoals.length
    ? healthGoals.map((goal) => formatHealthGoal(goal, locale)).join(", ")
    : tr(locale, "Not set", "לא הוגדר");

  return (
    <>
      <ProfileRow label={tr(locale, "Nutritional goal", "מטרה תזונתית")} value={summary} onClick={openSheet} />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Nutritional goal", "מטרה תזונתית")}>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="preferred_language" value={locale} />
          <div className="space-y-1.5">
            {healthGoalOptions.map((goal) => (
              <label key={goal} className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  name="health_goals"
                  value={goal}
                  checked={selected.includes(goal)}
                  onChange={() => toggleGoal(goal)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                />
                {formatHealthGoal(goal, locale)}
              </label>
            ))}
          </div>
          {selected.includes("abnormal_markers") ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                {tr(locale, "Which markers need improvement?", "אילו מדדים צריכים שיפור?")}
              </span>
              <textarea
                name="health_goals_markers_details"
                value={markers}
                onChange={(event) => setMarkers(event.target.value)}
                rows={2}
                maxLength={250}
                placeholder={tr(locale, "e.g. high LDL cholesterol, low vitamin D, low iron", "לדוגמה: כולסטרול LDL גבוה, ויטמין D נמוך, ברזל נמוך")}
                className={`${fieldInputClass} resize-none`}
              />
            </label>
          ) : null}
          {selected.includes("other") ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                {tr(locale, "Describe your goal", "תארו את המטרה")}
              </span>
              <input
                type="text"
                name="health_goals_other_details"
                value={other}
                onChange={(event) => setOther(event.target.value)}
                maxLength={250}
                placeholder={tr(locale, "e.g. improving energy levels", "לדוגמה: שיפור רמות האנרגיה")}
                className={fieldInputClass}
              />
            </label>
          ) : null}

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}

/** Multi-select dietary preference (TCK-165). Any combination, or none, can be saved. */
export function DietaryPreferencesRow({ locale, dietaryPreferences }: { locale: AppLocale; dietaryPreferences: string[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(dietaryPreferences);
  const [state, formAction] = useActionState(updateDietaryPreferencesAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  function openSheet() {
    setSelected(dietaryPreferences);
    setIsOpen(true);
  }

  function togglePreference(value: string) {
    setSelected(
      selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : dietaryPreferenceOptions.filter((option) => option === value || selected.includes(option)),
    );
  }

  const ordered = normalizeDietaryPreferences(dietaryPreferences);
  const summary = ordered.length
    ? ordered.map((value) => formatDietaryPreference(value, locale)).join(", ")
    : tr(locale, "Not set", "לא הוגדר");

  return (
    <>
      <ProfileRow label={tr(locale, "Dietary preference", "העדפה תזונתית")} value={summary} onClick={openSheet} />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Dietary preference", "העדפה תזונתית")}>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="preferred_language" value={locale} />
          <div className="space-y-1.5">
            {dietaryPreferenceOptions.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  name="dietary_preferences"
                  value={value}
                  checked={selected.includes(value)}
                  onChange={() => togglePreference(value)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                />
                {formatDietaryPreference(value, locale)}
              </label>
            ))}
          </div>

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}
