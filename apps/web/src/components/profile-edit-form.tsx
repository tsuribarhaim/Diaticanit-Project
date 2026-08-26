"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  updateProfileAction,
  type ProfileUpdateActionState,
} from "@/app/app/profile/actions";
import {
  activityLevelOptions,
  dietaryPreferenceOptions,
  type ExerciseScheduleByModality,
  type ExerciseScheduleModalityOption,
  exerciseModalityOptions,
  habitOptions,
  medicalConditionOptions,
  modalityRequiresSchedule,
  nutritionalGoalOptions,
  validateAllergyEntry,
  validateExerciseOtherDetails,
  validateFreeTextDetails,
} from "@/lib/profile";
import type { AppLocale } from "@/lib/locale";
import { formatActivityLevel, formatDateForLocale, formatNumberForLocale, localeTag, tr } from "@/lib/locale";

type ProfileEditFormProps = {
  defaults: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    biological_sex: "male" | "female";
    height_cm: number;
    weight_kg: number;
    activity_level: (typeof activityLevelOptions)[number];
    exercise_modalities: Array<(typeof exerciseModalityOptions)[number]>;
    exercise_modality_other_details?: string;
    exercise_schedule_by_modality?: ExerciseScheduleByModality;
    exercise_frequency_days_per_week: number;
    exercise_duration_minutes: number;
    nutritional_goal: (typeof nutritionalGoalOptions)[number];
    pregnancy_lactation_status: "none" | "pregnant" | "lactating";
    has_medical_conditions: boolean;
    medical_conditions?: string[];
    medical_conditions_details: string;
    has_regular_medications: boolean;
    regular_medications_details: string;
    hot_climate_or_heavy_sweating: boolean;
    habits: string[];
    alcohol_times_per_week: number | null;
    smoking_packs_per_day: number | null;
    dietary_preference: (typeof dietaryPreferenceOptions)[number];
    additional_information: string;
    preferred_language: "en" | "he";
    allergies: string[];
    ai_extraction_consent: boolean;
    profile_updated_at?: string | null;
  };
  locale: AppLocale;
  maxDateOfBirth: string;
};

const initialState: ProfileUpdateActionState = {};
const PROFILE_EDIT_DRAFT_KEY = "phc_profile_edit_draft";
const CIGARETTES_PER_PACK = 20;

const EXERCISE_MODALITY_LABELS: Record<ExerciseScheduleModalityOption, { en: string; he: string }> = {
  resistance_hypertrophy: { en: "Resistance / Hypertrophy", he: "התנגדות / היפרטרופיה" },
  endurance_cardio: { en: "Endurance / Cardio", he: "סבולת / אירובי" },
  martial_arts: { en: "Martial Arts", he: "אומנויות לחימה" },
  other: { en: "Other", he: "אחר" },
};

type MedicalConditionOption = (typeof medicalConditionOptions)[number];

const MEDICAL_CONDITION_LABELS: Record<MedicalConditionOption, { en: string; he: string }> = {
  celiac_disease: { en: "Celiac Disease", he: "צליאק" },
  hypertension: { en: "Hypertension (High Blood Pressure)", he: "יתר לחץ דם" },
  kidney_renal_failure: { en: "Kidney / Renal Failure", he: "אי ספיקת כליות" },
  diabetes: { en: "Diabetes", he: "סוכרת" },
  other: { en: "Others (Please specify)", he: "אחר (נא לפרט)" },
  prefer_not_to_disclose: { en: "Prefer not to disclose", he: "מעדיפ/ה לא לשתף" },
};

type ProfileEditDraft = {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  date_of_birth_display: string;
  biological_sex: "male" | "female";
  height_cm: string;
  weight_kg: string;
  activity_level: (typeof activityLevelOptions)[number];
  exercise_modalities: Array<(typeof exerciseModalityOptions)[number]>;
  exercise_modality_other_details: string;
  exercise_schedule_by_modality: Partial<
    Record<ExerciseScheduleModalityOption, { days_per_week: string; minutes_per_session: string }>
  >;
  exercise_frequency_days_per_week: string;
  exercise_duration_minutes: string;
  nutritional_goal: (typeof nutritionalGoalOptions)[number];
  pregnancy_lactation_status: "none" | "pregnant" | "lactating";
  has_medical_conditions: "yes" | "no";
  medical_conditions: MedicalConditionOption[];
  medical_conditions_details: string;
  has_regular_medications: "yes" | "no";
  regular_medications_details: string;
  hot_climate_or_heavy_sweating: "yes" | "no";
  habits: string[];
  alcohol_times_per_week: string;
  smoking_packs_per_day: string;
  dietary_preference: (typeof dietaryPreferenceOptions)[number];
  additional_information: string;
  preferred_language: "en" | "he";
  allergies: string;
  accept_ai_extraction: boolean;
};

type PersistedProfileEditDraft = {
  profileUpdatedAt: string | null;
  draft: ProfileEditDraft;
};

function exerciseModalityLabel(modality: ExerciseScheduleModalityOption, locale: AppLocale): string {
  const labels = EXERCISE_MODALITY_LABELS[modality];
  return locale === "he" ? labels.he : labels.en;
}

function medicalConditionLabel(condition: MedicalConditionOption, locale: AppLocale): string {
  const labels = MEDICAL_CONDITION_LABELS[condition];
  return locale === "he" ? labels.he : labels.en;
}

function parseMedicalConditionOption(value: string): MedicalConditionOption | null {
  const normalized = value.trim().toLowerCase();
  if (medicalConditionOptions.includes(normalized as MedicalConditionOption)) {
    return normalized as MedicalConditionOption;
  }

  if (normalized.includes("celiac") || normalized.includes("צליאק")) return "celiac_disease";
  if (
    normalized.includes("hypertension")
    || normalized.includes("high blood pressure")
    || normalized.includes("יתר לחץ דם")
  ) return "hypertension";
  if (
    normalized.includes("kidney")
    || normalized.includes("renal")
    || normalized.includes("כליות")
  ) return "kidney_renal_failure";
  if (normalized.includes("diabetes") || normalized.includes("סוכרת")) return "diabetes";
  if (
    normalized.includes("prefer")
    || normalized.includes("disclose")
    || normalized.includes("לא לשתף")
  ) return "prefer_not_to_disclose";
  if (normalized === "other" || normalized.includes("אחר")) return "other";

  return null;
}

function parseInitialMedicalConditionState(defaults: ProfileEditFormProps["defaults"]): {
  selected: MedicalConditionOption[];
  otherDetails: string;
} {
  const rawConditions = defaults.medical_conditions ?? [];
  const selectedSet = new Set<MedicalConditionOption>();
  const unmappedConditions: string[] = [];

  rawConditions.forEach((condition) => {
    const mapped = parseMedicalConditionOption(condition);
    if (mapped) {
      selectedSet.add(mapped);
    } else if (condition.trim()) {
      unmappedConditions.push(condition.trim());
    }
  });

  if (unmappedConditions.length > 0) {
    selectedSet.add("other");
  }

  const detailsFromDefaults = defaults.medical_conditions_details.trim();
  const otherDetails = detailsFromDefaults || unmappedConditions.join(", ");

  if (defaults.has_medical_conditions && selectedSet.size === 0 && otherDetails) {
    selectedSet.add("other");
  }

  if (selectedSet.has("prefer_not_to_disclose")) {
    return {
      selected: ["prefer_not_to_disclose"],
      otherDetails: "",
    };
  }

  return {
    selected: Array.from(selectedSet),
    otherDetails,
  };
}

function getScheduledModalities(
  modalities: Array<(typeof exerciseModalityOptions)[number]>,
): ExerciseScheduleModalityOption[] {
  return modalities.filter(modalityRequiresSchedule);
}

function parseScheduleNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeExerciseScheduleByModality(
  schedule: ProfileEditDraft["exercise_schedule_by_modality"],
  selectedModalities: ExerciseScheduleModalityOption[],
): ProfileEditDraft["exercise_schedule_by_modality"] {
  const next: ProfileEditDraft["exercise_schedule_by_modality"] = {};

  selectedModalities.forEach((modality) => {
    const existing = schedule[modality];
    next[modality] = {
      days_per_week: existing?.days_per_week ?? "",
      minutes_per_session: existing?.minutes_per_session ?? "",
    };
  });

  return next;
}

function buildInitialExerciseSchedule(
  defaults: ProfileEditFormProps["defaults"],
  modalities: ExerciseScheduleModalityOption[],
): ProfileEditDraft["exercise_schedule_by_modality"] {
  const next: ProfileEditDraft["exercise_schedule_by_modality"] = {};
  const scheduleDefaults = defaults.exercise_schedule_by_modality ?? {};
  const fallbackDays = String(defaults.exercise_frequency_days_per_week);
  const fallbackMinutes = String(defaults.exercise_duration_minutes);

  modalities.forEach((modality) => {
    const fromSchedule = scheduleDefaults[modality];
    next[modality] = {
      days_per_week:
        fromSchedule?.days_per_week != null
          ? String(fromSchedule.days_per_week)
          : fallbackDays,
      minutes_per_session:
        fromSchedule?.minutes_per_session != null
          ? String(fromSchedule.minutes_per_session)
          : fallbackMinutes,
    };
  });

  return next;
}

function computeExerciseSummaryFromDraft(
  selectedModalities: ExerciseScheduleModalityOption[],
  schedule: ProfileEditDraft["exercise_schedule_by_modality"],
): { frequency: string; duration: string } {
  if (selectedModalities.length === 0) {
    return { frequency: "0", duration: "0" };
  }

  const rows = selectedModalities
    .map((modality) => schedule[modality])
    .filter((entry) => {
      const days = parseScheduleNumber(entry?.days_per_week ?? "");
      const minutes = parseScheduleNumber(entry?.minutes_per_session ?? "");
      return days != null && minutes != null && days > 0 && minutes > 0;
    })
    .map((entry) => ({
      days: Number(entry?.days_per_week ?? "0"),
      minutes: Number(entry?.minutes_per_session ?? "0"),
    }));

  if (rows.length === 0) {
    return { frequency: "", duration: "" };
  }

  const totalDays = rows.reduce((sum, row) => sum + row.days, 0);
  const weightedMinutes = rows.reduce((sum, row) => sum + (row.days * row.minutes), 0);

  return {
    frequency: String(Math.min(14, Math.round(totalDays))),
    duration: String(Math.round(weightedMinutes / totalDays)),
  };
}

function packsPerDayToCigarettesString(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Math.round(value * CIGARETTES_PER_PACK));
}

function cigarettesPerDayToPacksString(value: string): string {
  if (value.trim() === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return String(numeric / CIGARETTES_PER_PACK);
}

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth();
  const dayDelta = now.getUTCDate() - dob.getUTCDate();
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    years -= 1;
  }

  return years < 0 ? null : years;
}

function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || heightCm <= 0) {
    return null;
  }
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  return Number.isFinite(bmi) ? bmi : null;
}

function createInitialDraft(defaults: ProfileEditFormProps["defaults"]): ProfileEditDraft {
  const initialExerciseModalities = defaults.exercise_modalities
    .filter((value): value is (typeof exerciseModalityOptions)[number] =>
      exerciseModalityOptions.includes(value as (typeof exerciseModalityOptions)[number]),
    );
  const scheduledModalities = getScheduledModalities(initialExerciseModalities);
  const exerciseScheduleByModality = buildInitialExerciseSchedule(defaults, scheduledModalities);
  const summaryFromSchedule = computeExerciseSummaryFromDraft(
    scheduledModalities,
    exerciseScheduleByModality,
  );
  const initialMedicalConditions = parseInitialMedicalConditionState(defaults);

  return {
    first_name: defaults.first_name,
    last_name: defaults.last_name,
    date_of_birth: defaults.date_of_birth,
    date_of_birth_display: defaults.date_of_birth,
    biological_sex: defaults.biological_sex,
    height_cm: String(defaults.height_cm),
    weight_kg: String(defaults.weight_kg),
    activity_level: defaults.activity_level,
    exercise_modalities: initialExerciseModalities,
    exercise_modality_other_details: defaults.exercise_modality_other_details ?? "",
    exercise_schedule_by_modality: exerciseScheduleByModality,
    exercise_frequency_days_per_week: summaryFromSchedule.frequency,
    exercise_duration_minutes: summaryFromSchedule.duration,
    nutritional_goal: defaults.nutritional_goal,
    pregnancy_lactation_status: defaults.pregnancy_lactation_status,
    has_medical_conditions: defaults.has_medical_conditions ? "yes" : "no",
    medical_conditions: initialMedicalConditions.selected,
    medical_conditions_details: initialMedicalConditions.otherDetails,
    has_regular_medications: defaults.has_regular_medications ? "yes" : "no",
    regular_medications_details: defaults.regular_medications_details,
    hot_climate_or_heavy_sweating: defaults.hot_climate_or_heavy_sweating ? "yes" : "no",
    habits: defaults.habits,
    alcohol_times_per_week:
      defaults.alcohol_times_per_week == null ? "" : String(defaults.alcohol_times_per_week),
    smoking_packs_per_day: packsPerDayToCigarettesString(defaults.smoking_packs_per_day),
    dietary_preference: defaults.dietary_preference,
    additional_information: defaults.additional_information,
    preferred_language: defaults.preferred_language,
    allergies: defaults.allergies.join(", "),
    accept_ai_extraction: defaults.ai_extraction_consent,
  };
}

function SaveButton({ locale, canSubmit }: { locale: AppLocale; canSubmit: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || !canSubmit}
      className="inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? tr(locale, "Saving changes...", "שומר שינויים...") : tr(locale, "Save changes", "שמירת שינויים")}
    </button>
  );
}

export function ProfileEditForm({ defaults, locale, maxDateOfBirth }: ProfileEditFormProps) {
  const [state, formAction] = useActionState(updateProfileAction, initialState);
  const [clientError, setClientError] = useState<string | null>(null);
  const [allergyError, setAllergyError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<ProfileEditDraft>(() => createInitialDraft(defaults));
  const selectedExerciseModalities = getScheduledModalities(draft.exercise_modalities);
  const hasClientBlockingError = Boolean(clientError || allergyError || consentError);
  const exerciseSummary = computeExerciseSummaryFromDraft(
    selectedExerciseModalities,
    draft.exercise_schedule_by_modality,
  );

  useEffect(() => {
    const payload: PersistedProfileEditDraft = {
      profileUpdatedAt: defaults.profile_updated_at ?? null,
      draft,
    };
    try {
      window.sessionStorage.setItem(PROFILE_EDIT_DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // Ignore blocked storage writes.
    }
  }, [draft, defaults.profile_updated_at]);

  useEffect(() => {
    if (!state.fieldErrors || state.fieldErrors.length === 0) {
      return;
    }

    const mappedErrors: Record<string, string> = {};
    for (const issue of state.fieldErrors) {
      if (!mappedErrors[issue.field]) {
        mappedErrors[issue.field] = issue.message;
      }
    }

    setTimeout(() => {
      setErrors(mappedErrors);
    }, 0);

    const firstField = Object.keys(mappedErrors)[0];
    const element = document.querySelector<HTMLElement>(`[data-field='${firstField}']`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [state.fieldErrors]);

  const persistDraft = (next: ProfileEditDraft) => {
    setDraft(next);
    const payload: PersistedProfileEditDraft = {
      profileUpdatedAt: defaults.profile_updated_at ?? null,
      draft: next,
    };
    try {
      window.sessionStorage.setItem(PROFILE_EDIT_DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // Ignore blocked storage writes.
    }
  };

  const updateDraft = (patch: Partial<ProfileEditDraft>) => {
    const changedKeys = Object.keys(patch);
    const changedNonConsentField = changedKeys.some((key) => key !== "accept_ai_extraction");

    if (clientError) {
      setClientError(null);
    }
    if (allergyError) {
      setAllergyError(null);
    }
    if (consentError && patch.accept_ai_extraction) {
      setConsentError(null);
    }
    const clearedFields = Object.keys(patch).filter((key) => key in errors);
    if (clearedFields.length > 0) {
      setErrors((prev) => {
        const next = { ...prev };
        clearedFields.forEach((key) => delete next[key]);
        return next;
      });
    }

    const nextDraft: ProfileEditDraft = {
      ...draft,
      ...patch,
    };

    const normalizedSchedule = normalizeExerciseScheduleByModality(
      nextDraft.exercise_schedule_by_modality,
      getScheduledModalities(nextDraft.exercise_modalities),
    );
    const summary = computeExerciseSummaryFromDraft(
      getScheduledModalities(nextDraft.exercise_modalities),
      normalizedSchedule,
    );

    nextDraft.exercise_schedule_by_modality = normalizedSchedule;
    nextDraft.exercise_frequency_days_per_week = summary.frequency;
    nextDraft.exercise_duration_minutes = summary.duration;

    if (changedNonConsentField && draft.accept_ai_extraction && patch.accept_ai_extraction === undefined) {
      nextDraft.accept_ai_extraction = false;
    }

    persistDraft(nextDraft);
  };

  const toggleListValue = (
    key: "exercise_modalities" | "habits",
    value: (typeof exerciseModalityOptions)[number] | (typeof habitOptions)[number],
  ) => {
    const set = new Set(draft[key]);
    if (set.has(value)) {
      set.delete(value);
    } else {
      if (key === "exercise_modalities" && value === "none") {
        set.clear();
      }
      if (key === "exercise_modalities" && value !== "none") {
        set.delete("none");
      }
      if (key === "habits" && value === "none") {
        set.clear();
      }
      if (key === "habits" && value !== "none") {
        set.delete("none");
      }
      set.add(value);
    }

    const nextValues = Array.from(set);
    const patch: Partial<ProfileEditDraft> = { [key]: nextValues } as Partial<ProfileEditDraft>;

    if (key === "habits") {
      if (!nextValues.includes("alcohol")) {
        patch.alcohol_times_per_week = "";
      }
      if (!nextValues.includes("smoking_or_vaping")) {
        patch.smoking_packs_per_day = "";
      }
    }

    if (key === "exercise_modalities" && !nextValues.includes("other")) {
      patch.exercise_modality_other_details = "";
    }

    if (key === "exercise_modalities") {
      patch.exercise_schedule_by_modality = normalizeExerciseScheduleByModality(
        draft.exercise_schedule_by_modality,
        getScheduledModalities(nextValues as Array<(typeof exerciseModalityOptions)[number]>),
      );
    }

    updateDraft(patch);
  };

  const setYesNo = (
    key: "has_medical_conditions" | "has_regular_medications" | "hot_climate_or_heavy_sweating",
    value: "yes" | "no",
  ) => {
    if (key === "has_medical_conditions" && value === "no") {
      updateDraft({
        has_medical_conditions: "no",
        medical_conditions: [],
        medical_conditions_details: "",
      });
      return;
    }

    updateDraft({ [key]: value } as Partial<ProfileEditDraft>);
  };

  const toggleMedicalCondition = (value: MedicalConditionOption) => {
    const current = new Set(draft.medical_conditions);

    if (current.has(value)) {
      current.delete(value);
    } else if (value === "prefer_not_to_disclose") {
      current.clear();
      current.add("prefer_not_to_disclose");
    } else {
      current.delete("prefer_not_to_disclose");
      current.add(value);
    }

    const nextConditions = Array.from(current);
    const patch: Partial<ProfileEditDraft> = {
      medical_conditions: nextConditions,
    };

    if (!nextConditions.includes("other")) {
      patch.medical_conditions_details = "";
    }

    updateDraft(patch);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!draft.accept_ai_extraction) {
      setConsentError(
        tr(
          locale,
          "Consent is required before saving changes.",
          "נדרשת הסכמה לפני שמירת שינויים.",
        ),
      );
      event.preventDefault();
      return;
    }

    if (draft.exercise_modalities.includes("other")) {
      const validationResult = validateExerciseOtherDetails(draft.exercise_modality_other_details);
      if (!validationResult.isMeaningful) {
        const suggestionText = validationResult.suggestions.join(", ");
        setClientError(
          suggestionText
            ? tr(
              locale,
              `Please enter a meaningful exercise type. Maybe: ${suggestionText}`,
              `יש להזין סוג אימון משמעותי. אולי התכוונת ל: ${suggestionText}`,
            )
            : tr(
              locale,
              "Please enter a meaningful exercise type related to training.",
              "יש להזין סוג אימון משמעותי שקשור לאימון.",
            ),
        );
        event.preventDefault();
        return;
      }
    }

    const invalidSchedule = selectedExerciseModalities.some((modality) => {
      const schedule = draft.exercise_schedule_by_modality[modality];
      const days = parseScheduleNumber(schedule?.days_per_week ?? "");
      const minutes = parseScheduleNumber(schedule?.minutes_per_session ?? "");
      return (
        days == null
        || !Number.isInteger(days)
        || days < 1
        || days > 14
        || minutes == null
        || !Number.isInteger(minutes)
        || minutes < 1
        || minutes > 600
      );
    });

    if (invalidSchedule) {
      setClientError(
        tr(
          locale,
          "Set valid frequency and duration for each selected exercise type.",
          "יש להגדיר תדירות ומשך תקינים לכל סוג אימון שנבחר.",
        ),
      );
      event.preventDefault();
      return;
    }

    const allergyEntries = draft.allergies
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const invalidAllergy = allergyEntries.find((entry) => !validateAllergyEntry(entry).isMeaningful);
    if (invalidAllergy) {
      const suggestionText = validateAllergyEntry(invalidAllergy).suggestions.join(", ");
      setAllergyError(
        suggestionText
          ? tr(
            locale,
            `Please enter a meaningful allergy. Maybe: ${suggestionText}`,
            `יש להזין אלרגיה משמעותית. אולי התכוונת ל: ${suggestionText}`,
          )
          : tr(
            locale,
            "Please enter a meaningful allergy description.",
            "יש להזין תיאור אלרגיה משמעותי.",
          ),
      );
      event.preventDefault();
      return;
    }

    if (draft.has_medical_conditions === "yes") {
      if (draft.medical_conditions.length === 0) {
        setClientError(
          tr(
            locale,
            "Select at least one medical condition option.",
            "יש לבחור לפחות אפשרות אחת במצבים רפואיים.",
          ),
        );
        event.preventDefault();
        return;
      }

      if (draft.medical_conditions.includes("other")) {
        if (draft.medical_conditions_details.trim().length < 3) {
          setClientError(
            tr(
              locale,
              "Please describe a diagnosed condition (name, symptom, or diagnosis) or uncheck 'Others'.",
              "אנא תאר מצב רפואי מאובחן (שם, תסמין או אבחנה) או הסר את הסימון מ'אחר'.",
            ),
          );
          event.preventDefault();
          return;
        }
      }
    }

    if (draft.has_regular_medications === "yes") {
      if (draft.regular_medications_details.trim().length < 3) {
        setClientError(
          tr(
            locale,
            "Please include medication name and/or dosage/frequency (e.g., Metformin 500mg twice daily).",
            "יש לכלול שם תרופה ו/או מינון ותדירות (לדוגמה: Metformin 500mg twice daily).",
          ),
        );
        event.preventDefault();
        return;
      }
    }

    if (draft.additional_information.trim()) {
      const additionalInfoValidation = validateFreeTextDetails(draft.additional_information, 5);
      if (!additionalInfoValidation.isMeaningful) {
        setClientError(
          tr(
            locale,
            "Enter meaningful additional information or leave it empty.",
            "יש להזין מידע נוסף משמעותי או להשאיר ריק.",
          ),
        );
        event.preventDefault();
        return;
      }
    }

  };

  const normalizedDateOfBirth = draft.date_of_birth;

  const age = calculateAge(normalizedDateOfBirth);
  const bmi = calculateBmi(Number(draft.weight_kg), Number(draft.height_cm));

  const renderFieldError = (key: string) => {
    const message = errors[key];
    if (!message) return null;
    return <p className="mt-1 text-xs text-rose-700">{message}</p>;
  };

  const inputErrorClass = (key: string): string => {
    return errors[key] ? "border-rose-700" : "border-slate-300";
  };

  return (
    <form action={formAction} onSubmit={onSubmit} className="mt-6 space-y-4">
      <input type="hidden" name="biological_sex" value={draft.biological_sex} />
      <input type="hidden" name="nutritional_goal" value={draft.nutritional_goal} />
      <input type="hidden" name="dietary_preference" value={draft.dietary_preference} />
      <input type="hidden" name="exercise_modality_other_details" value={draft.exercise_modality_other_details} />
      <input
        type="hidden"
        name="exercise_schedule_by_modality"
        value={JSON.stringify(draft.exercise_schedule_by_modality)}
      />
      <input
        type="hidden"
        name="exercise_frequency_days_per_week"
        value={exerciseSummary.frequency}
      />
      <input
        type="hidden"
        name="exercise_duration_minutes"
        value={exerciseSummary.duration}
      />
      <input
        type="hidden"
        name="medical_conditions"
        value={draft.has_medical_conditions === "yes" ? draft.medical_conditions.join(",") : ""}
      />
      <input type="hidden" name="alcohol_times_per_week" value={draft.alcohol_times_per_week} />
      <input type="hidden" name="smoking_packs_per_day" value={cigarettesPerDayToPacksString(draft.smoking_packs_per_day)} />

      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="text-base font-semibold text-slate-900">{tr(locale, "Step 1 - Identity & Vital Statistics", "שלב 1 - זהות ומדדים")}</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block" data-field="first_name">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "First name", "שם פרטי")}</span>
            <input type="text" name="first_name" required value={draft.first_name} onChange={(event) => updateDraft({ first_name: event.target.value })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("first_name")}`} />
            {renderFieldError("first_name")}
          </label>
          <label className="block" data-field="last_name">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Last name", "שם משפחה")}</span>
            <input type="text" name="last_name" required value={draft.last_name} onChange={(event) => updateDraft({ last_name: event.target.value })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("last_name")}`} />
            {renderFieldError("last_name")}
          </label>
          <label className="block" data-field="date_of_birth">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Date of birth", "תאריך לידה")}</span>
            {/* Native date input format follows the browser/OS locale, not `lang`, so we overlay a locale-formatted display and keep the input transparent for the calendar picker only. */}
            <div className="relative">
              <input
                type="date"
                name="date_of_birth"
                required
                max={maxDateOfBirth}
                value={draft.date_of_birth}
                onChange={(event) => updateDraft({ date_of_birth: event.target.value, date_of_birth_display: event.target.value })}
                onClick={(event) => {
                  try {
                    event.currentTarget.showPicker?.();
                  } catch {
                    // picker may already be open; ignore
                  }
                }}
                lang={localeTag(locale)}
                className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              />
              <div
                aria-hidden="true"
                className={`pointer-events-none flex w-full items-center rounded-xl border px-3 py-2.5 text-sm peer-focus:ring-2 peer-focus:ring-teal-600 ${inputErrorClass("date_of_birth")}`}
              >
                {draft.date_of_birth ? formatDateForLocale(draft.date_of_birth, locale) : tr(locale, "Select a date", "יש לבחור תאריך")}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">{tr(locale, "Pick the date from the calendar.", "יש לבחור תאריך מהיומן.")}</p>
            {renderFieldError("date_of_birth")}
          </label>
          <div className="block" data-field="biological_sex">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Biological sex", "מין ביולוגי")}</span>
            <div className={`grid grid-cols-2 overflow-hidden rounded-xl border ${inputErrorClass("biological_sex")}`}>
              <button type="button" onClick={() => updateDraft({ biological_sex: "male", pregnancy_lactation_status: "none" })} className={`px-3 py-2 text-sm ${draft.biological_sex === "male" ? "bg-teal-700 text-white" : "bg-white text-slate-700"}`}>{tr(locale, "Male", "זכר")}</button>
              <button type="button" onClick={() => updateDraft({ biological_sex: "female" })} className={`px-3 py-2 text-sm ${draft.biological_sex === "female" ? "bg-teal-700 text-white" : "bg-white text-slate-700"}`}>{tr(locale, "Female", "נקבה")}</button>
            </div>
            {renderFieldError("biological_sex")}
          </div>
          <label className="block" data-field="height_cm">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Height (cm)", "גובה (ס\"מ)")}</span>
            <input type="number" name="height_cm" required min={80} max={250} step="0.01" value={draft.height_cm} onChange={(event) => updateDraft({ height_cm: event.target.value })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("height_cm")}`} />
            {renderFieldError("height_cm")}
          </label>
          <label className="block" data-field="weight_kg">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Weight (kg)", "משקל (ק\"ג)")}</span>
            <input type="number" name="weight_kg" required min={20} max={400} step="0.01" value={draft.weight_kg} onChange={(event) => updateDraft({ weight_kg: event.target.value })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("weight_kg")}`} />
            {renderFieldError("weight_kg")}
          </label>
        </div>
        <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          <p>{tr(locale, "Calculated age", "גיל מחושב")}: {age ?? tr(locale, "n/a", "לא זמין")}</p>
          <p>BMI: {bmi != null ? formatNumberForLocale(bmi, locale, { maximumFractionDigits: 2 }) : tr(locale, "n/a", "לא זמין")}</p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="text-base font-semibold text-slate-900">{tr(locale, "Step 2 - Lifestyle & Activity", "שלב 2 - אורח חיים ופעילות")}</h2>
        <div className="mt-3 space-y-4">
          <label className="block" data-field="activity_level">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Activity level", "רמת פעילות")}</span>
            <select name="activity_level" value={draft.activity_level} onChange={(event) => updateDraft({ activity_level: event.target.value as (typeof activityLevelOptions)[number] })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("activity_level")}`}>
              {activityLevelOptions.map((option) => <option key={option} value={option}>{formatActivityLevel(option, locale)}</option>)}
            </select>
            {renderFieldError("activity_level")}
          </label>
          <div data-field="exercise_modalities">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Exercise modality", "סוג אימון")}</span>
            <div className="flex flex-wrap gap-2">
              {exerciseModalityOptions.map((value) => {
                const label = value === "resistance_hypertrophy" ? tr(locale, "Resistance / Hypertrophy", "התנגדות / היפרטרופיה") : value === "endurance_cardio" ? tr(locale, "Endurance / Cardio", "סבולת / אירובי") : value === "martial_arts" ? tr(locale, "Martial Arts", "אומנויות לחימה") : value === "none" ? tr(locale, "None", "ללא") : tr(locale, "Other", "אחר");
                const selected = draft.exercise_modalities.includes(value);
                return <button key={value} type="button" onClick={() => toggleListValue("exercise_modalities", value)} className={`rounded-full border px-3 py-1.5 text-xs ${selected ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{label}</button>;
              })}
            </div>
            {draft.exercise_modalities.includes("other") ? (
              <label className="mt-3 block" data-field="exercise_modality_other_details">
                <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Other exercise type", "סוג אימון אחר")}</span>
                <input
                  type="text"
                  maxLength={80}
                  value={draft.exercise_modality_other_details}
                  onChange={(event) => updateDraft({ exercise_modality_other_details: event.target.value })}
                  placeholder={tr(locale, "e.g. Pilates, spinning, climbing", "לדוגמה: פילאטיס, ספינינג, טיפוס")}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("exercise_modality_other_details")}`}
                />
                <p className="mt-1 text-xs text-slate-500">
                  {tr(
                    locale,
                    "Use a real exercise term. Typos are okay, random text is not.",
                    "יש להזין שם אמיתי של פעילות גופנית. שגיאות כתיב נסבלות, טקסט אקראי לא.",
                  )}
                </p>
                {renderFieldError("exercise_modality_other_details")}
              </label>
            ) : null}
            {draft.exercise_modalities.map((value) => <input key={value} type="hidden" name="exercise_modalities" value={value} />)}
            {renderFieldError("exercise_modalities")}
          </div>
          {selectedExerciseModalities.length > 0 ? (
            <div className="space-y-3" data-field="exercise_schedule_by_modality">
              <p className="text-sm font-medium text-slate-700">
                {tr(
                  locale,
                  "Set frequency and duration for each selected exercise type",
                  "יש להגדיר תדירות ומשך לכל סוג אימון שנבחר",
                )}
              </p>
              <div className="grid gap-3">
                {selectedExerciseModalities.map((modality) => {
                  const schedule = draft.exercise_schedule_by_modality[modality] ?? {
                    days_per_week: "",
                    minutes_per_session: "",
                  };

                  return (
                    <div key={modality} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">{exerciseModalityLabel(modality, locale)}</p>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-700">{tr(locale, "Frequency (days/week)", "תדירות (ימים/שבוע)")}</span>
                          <input
                            type="number"
                            min={1}
                            max={14}
                            value={schedule.days_per_week}
                            onChange={(event) => {
                              updateDraft({
                                exercise_schedule_by_modality: {
                                  ...draft.exercise_schedule_by_modality,
                                  [modality]: {
                                    ...schedule,
                                    days_per_week: event.target.value,
                                  },
                                },
                              });
                            }}
                            className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("exercise_schedule_by_modality")}`}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-700">{tr(locale, "Duration (minutes/session)", "משך (דקות לאימון)")}</span>
                          <input
                            type="number"
                            min={1}
                            max={600}
                            value={schedule.minutes_per_session}
                            onChange={(event) => {
                              updateDraft({
                                exercise_schedule_by_modality: {
                                  ...draft.exercise_schedule_by_modality,
                                  [modality]: {
                                    ...schedule,
                                    minutes_per_session: event.target.value,
                                  },
                                },
                              });
                            }}
                            className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("exercise_schedule_by_modality")}`}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              {renderFieldError("exercise_schedule_by_modality")}
            </div>
          ) : null}
          <div data-field="nutritional_goal">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Nutritional goal", "מטרה תזונתית")}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {nutritionalGoalOptions.map((goal) => {
                const label = goal === "maintenance" ? tr(locale, "Maintenance", "שימור") : goal === "weight_loss" ? tr(locale, "Weight Loss", "ירידה במשקל") : goal === "muscle_hypertrophy" ? tr(locale, "Muscle Hypertrophy", "היפרטרופיה") : goal === "body_recomposition" ? tr(locale, "Body Recomposition", "הרכב גוף") : tr(locale, "Athletic Performance", "ביצועים אתלטיים");
                const selected = draft.nutritional_goal === goal;
                return <button key={goal} type="button" onClick={() => updateDraft({ nutritional_goal: goal })} className={`rounded-xl border px-3 py-2 text-sm ${selected ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700"}`}>{label}</button>;
              })}
            </div>
            {renderFieldError("nutritional_goal")}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="text-base font-semibold text-slate-900">{tr(locale, "Step 3 - Medical & Physiology", "שלב 3 - רפואי ופיזיולוגי")}</h2>
        <div className="mt-3 space-y-4">
          {draft.biological_sex === "female" ? (
            <label className="block" data-field="pregnancy_lactation_status">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Pregnancy / lactation", "הריון / הנקה")}</span>
              <select name="pregnancy_lactation_status" value={draft.pregnancy_lactation_status} onChange={(event) => updateDraft({ pregnancy_lactation_status: event.target.value as "none" | "pregnant" | "lactating" })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("pregnancy_lactation_status")}`}>
                <option value="none">{tr(locale, "No", "לא")}</option>
                <option value="pregnant">{tr(locale, "Pregnant", "בהריון")}</option>
                <option value="lactating">{tr(locale, "Lactating", "מניקה")}</option>
              </select>
              {renderFieldError("pregnancy_lactation_status")}
            </label>
          ) : <input type="hidden" name="pregnancy_lactation_status" value="none" />}

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "🩺 Medical conditions", "🩺 מצבים רפואיים")}</span>
            <div className="flex gap-3 text-sm" data-field="has_medical_conditions"><label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.has_medical_conditions === "yes" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="has_medical_conditions" value="yes" checked={draft.has_medical_conditions === "yes"} onChange={() => setYesNo("has_medical_conditions", "yes")} /> {tr(locale, "Yes", "כן")}</label><label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.has_medical_conditions === "no" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="has_medical_conditions" value="no" checked={draft.has_medical_conditions === "no"} onChange={() => setYesNo("has_medical_conditions", "no")} /> {tr(locale, "No", "לא")}</label></div>
            {renderFieldError("has_medical_conditions")}
            <div
              className={`overflow-hidden transition-all duration-300 ${draft.has_medical_conditions === "yes" ? "mt-3 max-h-[700px] opacity-100" : "max-h-0 opacity-0"}`}
            >
              <div className="grid gap-2 sm:grid-cols-2" data-field="medical_conditions">
                {medicalConditionOptions.map((condition) => {
                  const selected = draft.medical_conditions.includes(condition);
                  return (
                    <button
                      key={condition}
                      type="button"
                      onClick={() => toggleMedicalCondition(condition)}
                      className={`rounded-xl border px-3 py-2 text-left text-xs font-medium ${selected ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700"}`}
                    >
                      {medicalConditionLabel(condition, locale)}
                    </button>
                  );
                })}
              </div>
              {renderFieldError("medical_conditions")}

              {draft.medical_conditions.includes("other") ? (
                <label className="mt-3 block" data-field="medical_conditions_details">
                  <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Other diagnosed conditions", "מצבים רפואיים נוספים")}</span>
                  <textarea
                    name="medical_conditions_details"
                    value={draft.medical_conditions_details}
                    onChange={(event) => updateDraft({ medical_conditions_details: event.target.value })}
                    placeholder={tr(locale, "Enter any other diagnosed medical conditions (e.g., Anemia, Gout, Sleep Apnea).", "יש להזין מצבים רפואיים מאובחנים נוספים (לדוגמה: אנמיה, גאוט, דום נשימה בשינה).")}
                    className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("medical_conditions_details")}`}
                    rows={3}
                    minLength={3}
                    maxLength={250}
                  />
                  {renderFieldError("medical_conditions_details")}
                </label>
              ) : <input type="hidden" name="medical_conditions_details" value="" />}
            </div>
          </div>

          <div data-field="has_regular_medications">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Regular medications", "תרופות קבועות")}</span>
            <div className="flex gap-3 text-sm"><label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.has_regular_medications === "yes" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="has_regular_medications" value="yes" checked={draft.has_regular_medications === "yes"} onChange={() => setYesNo("has_regular_medications", "yes")} /> {tr(locale, "Yes", "כן")}</label><label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.has_regular_medications === "no" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="has_regular_medications" value="no" checked={draft.has_regular_medications === "no"} onChange={() => setYesNo("has_regular_medications", "no")} /> {tr(locale, "No", "לא")}</label></div>
            {renderFieldError("has_regular_medications")}
            {draft.has_regular_medications === "yes" ? (
              <div data-field="regular_medications_details">
                <textarea name="regular_medications_details" rows={3} value={draft.regular_medications_details} onChange={(event) => updateDraft({ regular_medications_details: event.target.value })} placeholder={tr(locale, "e.g., Metformin 500mg twice daily", "לדוגמה: Metformin 500mg פעמיים ביום")} className={`mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("regular_medications_details")}`} />
                <p className="mt-1 text-xs text-slate-500">
                  {tr(
                    locale,
                    "Tip: include medication name and dosage/frequency. Typos are okay, unrelated text is not.",
                    "טיפ: יש לכלול שם תרופה ומינון/תדירות. שגיאות כתיב נסבלות, טקסט לא קשור לא.",
                  )}
                </p>
                {renderFieldError("regular_medications_details")}
              </div>
            ) : <input type="hidden" name="regular_medications_details" value="" />}
          </div>

          <div data-field="hot_climate_or_heavy_sweating">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Heavy sweating / hot climate", "הזעה מרובה / אקלים חם")}</span>
            <div className="flex gap-3 text-sm"><label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.hot_climate_or_heavy_sweating === "yes" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="hot_climate_or_heavy_sweating" value="yes" checked={draft.hot_climate_or_heavy_sweating === "yes"} onChange={() => setYesNo("hot_climate_or_heavy_sweating", "yes")} /> {tr(locale, "Yes", "כן")}</label><label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.hot_climate_or_heavy_sweating === "no" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="hot_climate_or_heavy_sweating" value="no" checked={draft.hot_climate_or_heavy_sweating === "no"} onChange={() => setYesNo("hot_climate_or_heavy_sweating", "no")} /> {tr(locale, "No", "לא")}</label></div>
            {renderFieldError("hot_climate_or_heavy_sweating")}
          </div>

          <div data-field="habits">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Habits", "הרגלים")}</span>
            <div className="flex flex-wrap gap-2">
              {habitOptions.map((value) => {
                const label = value === "smoking_or_vaping" ? tr(locale, "Smoking", "עישון") : value === "alcohol" ? tr(locale, "Regular Alcohol", "אלכוהול קבוע") : tr(locale, "None", "ללא");
                const selected = draft.habits.includes(value);
                return <button key={value} type="button" onClick={() => toggleListValue("habits", value)} className={`rounded-full border px-3 py-1.5 text-xs ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{label}</button>;
              })}
            </div>
            {draft.habits.includes("alcohol") ? (
              <label className="mt-2 block" data-field="alcohol_times_per_week">
                <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Alcohol frequency (times/week)", "תדירות אלכוהול (פעמים בשבוע)")}</span>
                <input type="number" min={0} step="0.1" value={draft.alcohol_times_per_week} onChange={(event) => updateDraft({ alcohol_times_per_week: event.target.value })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("alcohol_times_per_week")}`} />
                {renderFieldError("alcohol_times_per_week")}
              </label>
            ) : null}
            {draft.habits.includes("smoking_or_vaping") ? (
              <label className="mt-2 block" data-field="smoking_packs_per_day">
                <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Smoking amount (cigarettes/day)", "כמות עישון (סיגריות ביום)")}</span>
                <input type="number" min={0} step="1" value={draft.smoking_packs_per_day} onChange={(event) => updateDraft({ smoking_packs_per_day: event.target.value })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("smoking_packs_per_day")}`} />
                {renderFieldError("smoking_packs_per_day")}
              </label>
            ) : null}
            {draft.habits.map((value) => <input key={value} type="hidden" name="habits" value={value} />)}
            {renderFieldError("habits")}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="text-base font-semibold text-slate-900">{tr(locale, "Step 4 - Dietary Profile & Context", "שלב 4 - פרופיל תזונתי")}</h2>
        <div className="mt-3 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Language", "שפה")}</span>
            <select name="preferred_language" value={draft.preferred_language} onChange={(event) => updateDraft({ preferred_language: event.target.value as "en" | "he" })} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"><option value="en">English</option><option value="he">עברית</option></select>
          </label>

          <div data-field="dietary_preference">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Dietary preference", "העדפה תזונתית")}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {dietaryPreferenceOptions.map((value) => {
                const label = value === "standard" ? tr(locale, "Standard Diet", "תזונה רגילה") : value === "vegetarian" ? tr(locale, "Vegetarian", "צמחוני") : value === "vegan" ? tr(locale, "Vegan", "טבעוני") : tr(locale, "Low-Carb / Keto", "דל פחמימה / קטו");
                const selected = draft.dietary_preference === value;
                return <button key={value} type="button" onClick={() => updateDraft({ dietary_preference: value })} className={`rounded-xl border px-3 py-2 text-sm ${selected ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700"}`}>{label}</button>;
              })}
            </div>
            {renderFieldError("dietary_preference")}
          </div>

          <label className="block" data-field="allergies">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Allergies (comma separated)", "אלרגיות (מופרדות בפסיקים)")}</span>
            <input type="text" name="allergies" value={draft.allergies} onChange={(event) => updateDraft({ allergies: event.target.value })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("allergies")}`} />
            <p className="mt-1 text-xs text-slate-500">{tr(locale, "Use real allergy names. Typos are okay, random text is not.", "יש להזין שמות אלרגיה אמיתיים. שגיאות כתיב נסבלות, טקסט אקראי לא.")}</p>
            {allergyError ? <p className="mt-1 text-xs text-rose-700">{allergyError}</p> : null}
            {renderFieldError("allergies")}
          </label>

          <label className="block" data-field="additional_information">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Additional information", "מידע נוסף")}</span>
            <textarea name="additional_information" rows={4} maxLength={1000} value={draft.additional_information} onChange={(event) => updateDraft({ additional_information: event.target.value })} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("additional_information")}`} />
            <p className="mt-1 text-right text-xs text-slate-500">{draft.additional_information.length} / 1000</p>
            {renderFieldError("additional_information")}
          </label>

          <label className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900" data-field="accept_ai_extraction">
            <input type="checkbox" name="accept_ai_extraction" value="yes" checked={draft.accept_ai_extraction} onChange={(event) => updateDraft({ accept_ai_extraction: event.target.checked })} className="mt-0.5" />
            <span>{tr(locale, "I agree to the transfer and storage of my health data with the AI provider for analysis purposes", "אני מסכים/ה לשליחת נתוני הבריאות והתזונה לספק ה-AI ולשמירתם לצורך ניתוח ושיפור השירות.")}</span>
          </label>
          {consentError ? <p className="mt-1 text-xs text-rose-700">{consentError}</p> : null}
          {renderFieldError("accept_ai_extraction")}
        </div>
      </section>

      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {clientError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {clientError}
        </p>
      ) : null}
      {state.success && !hasClientBlockingError ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.success}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <SaveButton locale={locale} canSubmit={draft.accept_ai_extraction} />
        <Link
          href="/app/profile"
          className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          {tr(locale, "Back to profile", "חזרה לפרופיל")}
        </Link>
      </div>
    </form>
  );
}
