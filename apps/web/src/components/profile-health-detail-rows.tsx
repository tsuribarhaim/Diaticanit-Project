"use client";

import { useActionState, useState } from "react";

import {
  updateAllergiesAction,
  updateExercisePreferencesAction,
  updateHabitsAction,
  updateMedicalConditionsAction,
  updateMedicationsAction,
  type QuickEditState,
} from "@/app/app/profile/actions";
import { ProfileRow, QuickEditSheet, SheetActions, useQuickEditSuccessEffect } from "@/components/profile-quick-edit";
import {
  exerciseModalityOptions,
  habitOptions,
  medicalConditionOptions,
  modalityRequiresSchedule,
  type ExerciseScheduleModalityOption,
} from "@/lib/profile";
import { formatExerciseModality, formatHabit, formatMedicalCondition, tr, type AppLocale } from "@/lib/locale";

const CIGARETTES_PER_PACK = 20;
const SCHEDULE_MODALITIES: ExerciseScheduleModalityOption[] = ["resistance_hypertrophy", "endurance_cardio", "martial_arts"];

const fieldInputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const smallFieldInputClass =
  "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function buildScheduleDraft(
  scheduleByModality: Record<string, { days_per_week: number; minutes_per_session: number }>,
): Record<string, { days: string; minutes: string }> {
  return Object.fromEntries(
    Object.entries(scheduleByModality).map(([key, value]) => [key, { days: String(value.days_per_week), minutes: String(value.minutes_per_session) }]),
  );
}

function buildOthersDraft(
  otherActivities: Array<{ name: string; days_per_week: number; minutes_per_session: number }>,
): Array<{ id: string; name: string; days: string; minutes: string }> {
  return otherActivities.map((activity, index) => ({
    id: `existing-${index}`,
    name: activity.name,
    days: String(activity.days_per_week),
    minutes: String(activity.minutes_per_session),
  }));
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
        value={allergies.length ? allergies.join(", ") : tr(locale, "None", "ללא")}
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
  const [selected, setSelected] = useState<string[]>(modalities);
  const [schedule, setSchedule] = useState<Record<string, { days: string; minutes: string }>>(() => buildScheduleDraft(scheduleByModality));
  const [others, setOthers] = useState<Array<{ id: string; name: string; days: string; minutes: string }>>(() => buildOthersDraft(otherActivities));
  const [state, formAction] = useActionState(updateExercisePreferencesAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  function openSheet() {
    setSelected(modalities);
    setSchedule(buildScheduleDraft(scheduleByModality));
    setOthers(buildOthersDraft(otherActivities));
    setIsOpen(true);
  }

  function toggleModality(modality: string) {
    setSelected((previous) => {
      if (modality === "none") return previous.includes("none") ? [] : ["none"];
      const withoutNone = previous.filter((entry) => entry !== "none");
      return withoutNone.includes(modality) ? withoutNone.filter((entry) => entry !== modality) : [...withoutNone, modality];
    });
  }

  function addOtherActivity() {
    setOthers((previous) => [...previous, { id: `new-${Date.now()}`, name: "", days: "3", minutes: "30" }]);
  }
  function removeOtherActivity(id: string) {
    setOthers((previous) => previous.filter((activity) => activity.id !== id));
  }

  const scheduleJson = JSON.stringify(
    Object.fromEntries(
      SCHEDULE_MODALITIES.filter((modality) => selected.includes(modality)).map((modality) => [
        modality,
        { days_per_week: Number(schedule[modality]?.days || 0), minutes_per_session: Number(schedule[modality]?.minutes || 0) },
      ]),
    ),
  );
  const othersJson = JSON.stringify(
    others.map((activity) => ({
      name: activity.name.trim(),
      days_per_week: Number(activity.days || 0),
      minutes_per_session: Number(activity.minutes || 0),
    })),
  );

  const summaryValue =
    selected.length === 0 || selected.includes("none")
      ? tr(locale, "None", "ללא")
      : selected
          .filter((modality) => modality !== "other")
          .map((modality) => formatExerciseModality(modality, locale))
          .concat(others.map((activity) => activity.name).filter(Boolean))
          .join(", ") || tr(locale, "None", "ללא");

  return (
    <>
      <ProfileRow label={tr(locale, "Preferred exercise types", "סוגי אימון מועדפים")} value={summaryValue} onClick={openSheet} />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Preferred exercise types", "סוגי אימון מועדפים")}>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="preferred_language" value={locale} />
          <input type="hidden" name="exercise_schedule_by_modality" value={scheduleJson} />
          <input type="hidden" name="exercise_other_activities" value={othersJson} />

          <div className="space-y-2">
            {exerciseModalityOptions.map((modality) => (
              <div key={modality}>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <input
                    type="checkbox"
                    name="exercise_modalities"
                    value={modality}
                    checked={selected.includes(modality)}
                    onChange={() => toggleModality(modality)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                  />
                  {modality === "none" ? tr(locale, "None", "ללא") : modality === "other" ? tr(locale, "Other", "אחר") : formatExerciseModality(modality, locale)}
                </label>
                {modalityRequiresSchedule(modality) && selected.includes(modality) ? (
                  <div className="mt-1.5 flex items-center gap-2 ps-6">
                    <input
                      type="number"
                      min={1}
                      max={14}
                      value={schedule[modality]?.days ?? ""}
                      onChange={(event) =>
                        setSchedule((previous) => ({ ...previous, [modality]: { days: event.target.value, minutes: previous[modality]?.minutes ?? "" } }))
                      }
                      placeholder={tr(locale, "Days/wk", "ימים/שבוע")}
                      className={`w-20 ${smallFieldInputClass}`}
                    />
                    <input
                      type="number"
                      min={1}
                      max={600}
                      value={schedule[modality]?.minutes ?? ""}
                      onChange={(event) =>
                        setSchedule((previous) => ({ ...previous, [modality]: { days: previous[modality]?.days ?? "", minutes: event.target.value } }))
                      }
                      placeholder={tr(locale, "Minutes", "דקות")}
                      className={`w-20 ${smallFieldInputClass}`}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {selected.includes("other") ? (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tr(locale, "Other activities", "פעילויות אחרות")}</p>
              {others.map((activity) => (
                <div key={activity.id} className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="text"
                    value={activity.name}
                    onChange={(event) => setOthers((previous) => previous.map((entry) => (entry.id === activity.id ? { ...entry, name: event.target.value } : entry)))}
                    placeholder={tr(locale, "Activity name", "שם הפעילות")}
                    className={`min-w-0 flex-1 ${smallFieldInputClass}`}
                  />
                  <input
                    type="number"
                    min={1}
                    max={14}
                    value={activity.days}
                    onChange={(event) => setOthers((previous) => previous.map((entry) => (entry.id === activity.id ? { ...entry, days: event.target.value } : entry)))}
                    placeholder={tr(locale, "Days/wk", "ימים/שבוע")}
                    className={`w-16 ${smallFieldInputClass}`}
                  />
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={activity.minutes}
                    onChange={(event) =>
                      setOthers((previous) => previous.map((entry) => (entry.id === activity.id ? { ...entry, minutes: event.target.value } : entry)))
                    }
                    placeholder={tr(locale, "Minutes", "דקות")}
                    className={`w-16 ${smallFieldInputClass}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeOtherActivity(activity.id)}
                    className="shrink-0 text-rose-500 hover:text-rose-700"
                    aria-label={tr(locale, "Remove", "הסרה")}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" onClick={addOtherActivity} className="text-xs font-semibold text-teal-700 hover:text-teal-800 dark:text-teal-400">
                + {tr(locale, "Add activity", "הוספת פעילות")}
              </button>
            </div>
          ) : null}

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
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
  alcoholConsumptionLevel,
  smokingPacksPerDay,
}: {
  locale: AppLocale;
  habits: string[];
  alcoholConsumptionLevel: "low" | "high" | null;
  smokingPacksPerDay: number | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(habits);
  const [alcoholLevel, setAlcoholLevel] = useState<"low" | "high" | "">(alcoholConsumptionLevel ?? "");
  const [cigarettes, setCigarettes] = useState(smokingPacksPerDay != null ? String(Math.round(smokingPacksPerDay * CIGARETTES_PER_PACK)) : "");
  const [state, formAction] = useActionState(updateHabitsAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  function openSheet() {
    setSelected(habits);
    setAlcoholLevel(alcoholConsumptionLevel ?? "");
    setCigarettes(smokingPacksPerDay != null ? String(Math.round(smokingPacksPerDay * CIGARETTES_PER_PACK)) : "");
    setIsOpen(true);
  }

  function toggleHabit(habit: string) {
    setSelected((previous) => {
      if (habit === "none") return previous.includes("none") ? [] : ["none"];
      const withoutNone = previous.filter((entry) => entry !== "none");
      return withoutNone.includes(habit) ? withoutNone.filter((entry) => entry !== habit) : [...withoutNone, habit];
    });
  }

  const packsPerDay = cigarettes.trim() === "" ? "" : String(Number(cigarettes) / CIGARETTES_PER_PACK);
  const summary =
    selected.length === 0 || selected.includes("none") ? tr(locale, "None", "ללא") : selected.map((habit) => formatHabit(habit, locale)).join(", ");

  return (
    <>
      <ProfileRow label={tr(locale, "Habits", "הרגלים")} value={summary} onClick={openSheet} />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Habits", "הרגלים")}>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="preferred_language" value={locale} />
          <input type="hidden" name="alcohol_consumption_level" value={alcoholLevel} />
          <input type="hidden" name="smoking_packs_per_day" value={packsPerDay} />
          <div className="space-y-1.5">
            {habitOptions.map((habit) => (
              <label key={habit} className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  name="habits"
                  value={habit}
                  checked={selected.includes(habit)}
                  onChange={() => toggleHabit(habit)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                />
                {formatHabit(habit, locale)}
              </label>
            ))}
          </div>

          {selected.includes("alcohol") ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">{tr(locale, "Alcohol consumption", "צריכת אלכוהול")}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAlcoholLevel("low")} className={pillButtonClass(alcoholLevel === "low")}>
                  {tr(locale, "Low", "נמוכה")}
                </button>
                <button type="button" onClick={() => setAlcoholLevel("high")} className={pillButtonClass(alcoholLevel === "high")}>
                  {tr(locale, "High", "גבוהה")}
                </button>
              </div>
            </div>
          ) : null}

          {selected.includes("smoking_or_vaping") ? (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">{tr(locale, "Cigarettes per day", "סיגריות ליום")}</label>
              <input
                type="number"
                min={0}
                value={cigarettes}
                onChange={(event) => setCigarettes(event.target.value)}
                className={fieldInputClass}
              />
            </div>
          ) : null}

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}
