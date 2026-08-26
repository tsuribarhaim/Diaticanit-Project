"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveOnboardingProfileAction,
  type OnboardingActionState,
} from "@/app/app/onboarding/actions";
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

type OnboardingProfileFormProps = {
  defaults?: {
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
    biological_sex?: "male" | "female";
    height_cm?: number;
    weight_kg?: number;
    activity_level?: (typeof activityLevelOptions)[number];
    preferred_language?: "en" | "he";
    exercise_modalities?: string[];
    exercise_modality_other_details?: string;
    exercise_schedule_by_modality?: ExerciseScheduleByModality;
    exercise_frequency_days_per_week?: number;
    exercise_duration_minutes?: number;
    nutritional_goal?: (typeof nutritionalGoalOptions)[number];
    pregnancy_lactation_status?: "none" | "pregnant" | "lactating";
    has_medical_conditions?: boolean;
    medical_conditions_details?: string;
    has_regular_medications?: boolean;
    regular_medications_details?: string;
    hot_climate_or_heavy_sweating?: boolean;
    habits?: string[];
    alcohol_times_per_week?: number | null;
    smoking_packs_per_day?: number | null;
    dietary_preference?: (typeof dietaryPreferenceOptions)[number];
    additional_information?: string;
    allergies?: string[];
    medical_conditions?: string[];
    ai_extraction_consent?: boolean;
  };
  locale?: AppLocale;
};

const initialState: OnboardingActionState = {};
const ONBOARDING_DRAFT_KEY = "phc_onboarding_profile_draft";
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

type StepKey = 1 | 2 | 3 | 4;

const FIELD_TO_STEP: Record<string, StepKey> = {
  first_name: 1,
  last_name: 1,
  date_of_birth: 1,
  biological_sex: 1,
  weight: 1,
  weight_kg: 1,
  height: 1,
  height_cm: 1,
  activity_level: 2,
  exercise_modalities: 2,
  exercise_modality_other_details: 2,
  exercise_schedule_by_modality: 2,
  exercise_frequency_days_per_week: 2,
  exercise_duration_minutes: 2,
  nutritional_goal: 2,
  pregnancy_lactation_status: 3,
  has_medical_conditions: 3,
  medical_conditions: 3,
  medical_conditions_details: 3,
  has_regular_medications: 3,
  regular_medications_details: 3,
  hot_climate_or_heavy_sweating: 3,
  habits: 3,
  alcohol_times_per_week: 3,
  smoking_packs_per_day: 3,
  dietary_preference: 4,
  allergies: 4,
  additional_information: 4,
  accept_ai_extraction: 4,
};

type OnboardingFormDraft = {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  date_of_birth_display: string;
  biological_sex: "male" | "female" | "";
  weight_unit: "kg" | "lbs";
  weight_value: string;
  height_unit: "cm" | "ft_in";
  height_cm_value: string;
  height_ft_value: string;
  height_in_value: string;
  activity_level: (typeof activityLevelOptions)[number];
  exercise_modalities: Array<(typeof exerciseModalityOptions)[number]>;
  exercise_modality_other_details: string;
  exercise_schedule_by_modality: Partial<
    Record<ExerciseScheduleModalityOption, { days_per_week: string; minutes_per_session: string }>
  >;
  exercise_frequency_days_per_week: string;
  exercise_duration_minutes: string;
  nutritional_goal: (typeof nutritionalGoalOptions)[number] | "";
  pregnancy_lactation_status: "none" | "pregnant" | "lactating";
  has_medical_conditions: "yes" | "no" | "";
  medical_conditions: MedicalConditionOption[];
  medical_conditions_details: string;
  has_regular_medications: "yes" | "no" | "";
  regular_medications_details: string;
  hot_climate_or_heavy_sweating: "yes" | "no" | "";
  habits: string[];
  alcohol_times_per_week: string;
  smoking_packs_per_day: string;
  dietary_preference: (typeof dietaryPreferenceOptions)[number] | "";
  additional_information: string;
  allergies: string;
  preferred_language: "en" | "he";
  accept_ai_extraction: boolean;
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

function parseInitialMedicalConditionState(defaults: OnboardingProfileFormProps["defaults"]): {
  selected: MedicalConditionOption[];
  otherDetails: string;
} {
  const rawConditions = defaults?.medical_conditions ?? [];
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

  const detailsFromDefaults = defaults?.medical_conditions_details?.trim() ?? "";
  let otherDetails = detailsFromDefaults || unmappedConditions.join(", ");

  if ((defaults?.has_medical_conditions ?? false) && selectedSet.size === 0 && otherDetails) {
    selectedSet.add("other");
  }

  if (selectedSet.has("other") && !otherDetails) {
    otherDetails = "";
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
  schedule: OnboardingFormDraft["exercise_schedule_by_modality"],
  selectedModalities: ExerciseScheduleModalityOption[],
): OnboardingFormDraft["exercise_schedule_by_modality"] {
  const next: OnboardingFormDraft["exercise_schedule_by_modality"] = {};

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
  defaults: OnboardingProfileFormProps["defaults"],
  modalities: ExerciseScheduleModalityOption[],
): OnboardingFormDraft["exercise_schedule_by_modality"] {
  const next: OnboardingFormDraft["exercise_schedule_by_modality"] = {};
  const scheduleDefaults = defaults?.exercise_schedule_by_modality ?? {};
  const fallbackDays =
    defaults?.exercise_frequency_days_per_week != null
      ? String(defaults.exercise_frequency_days_per_week)
      : "";
  const fallbackMinutes =
    defaults?.exercise_duration_minutes != null
      ? String(defaults.exercise_duration_minutes)
      : "";

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
  schedule: OnboardingFormDraft["exercise_schedule_by_modality"],
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

function toKg(value: string, unit: "kg" | "lbs"): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return unit === "kg" ? numeric : numeric * 0.45359237;
}

function toCm(draft: OnboardingFormDraft): number | null {
  if (draft.height_unit === "cm") {
    const cm = Number(draft.height_cm_value);
    if (!Number.isFinite(cm) || cm <= 0) return null;
    return cm;
  }

  const ft = Number(draft.height_ft_value || "0");
  const inches = Number(draft.height_in_value || "0");
  if (!Number.isFinite(ft) || !Number.isFinite(inches) || ft < 0 || inches < 0) {
    return null;
  }

  const totalInches = ft * 12 + inches;
  if (totalInches <= 0) return null;
  return totalInches * 2.54;
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

  if (years < 0 || years > 120) return null;
  return years;
}

function calculateBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg == null || heightCm == null || heightCm <= 0) return null;
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  return Number.isFinite(bmi) ? bmi : null;
}

const BMI_SCALE_MIN = 12;
const BMI_SCALE_MAX = 40;
const BMI_GOOD_MIN = 18.5;
const BMI_GOOD_MAX = 24.9;

type BmiStatus = "good" | "warning" | "out_of_range";

function bmiStatus(bmi: number): BmiStatus {
  if (bmi < BMI_GOOD_MIN || bmi > BMI_GOOD_MAX) {
    return "out_of_range";
  }

  const goodRange = BMI_GOOD_MAX - BMI_GOOD_MIN;
  const warningBand = goodRange * 0.1;
  const closeToMin = bmi - BMI_GOOD_MIN <= warningBand;
  const closeToMax = BMI_GOOD_MAX - bmi <= warningBand;

  if (closeToMin || closeToMax) {
    return "warning";
  }

  return "good";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bmiPositionPercent(bmi: number): number {
  const clamped = clamp(bmi, BMI_SCALE_MIN, BMI_SCALE_MAX);
  return ((clamped - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100;
}

function goalLabel(goal: (typeof nutritionalGoalOptions)[number], locale: AppLocale): string {
  if (goal === "maintenance") return tr(locale, "Maintenance", "שימור");
  if (goal === "weight_loss") return tr(locale, "Weight Loss", "ירידה במשקל");
  if (goal === "muscle_hypertrophy") return tr(locale, "Muscle Hypertrophy", "היפרטרופיה");
  if (goal === "body_recomposition") return tr(locale, "Body Recomposition", "הרכב גוף");
  return tr(locale, "Athletic Performance", "ביצועים אתלטיים");
}

function goalEnergyTarget(goal: (typeof nutritionalGoalOptions)[number], locale: AppLocale): string {
  if (goal === "maintenance") return tr(locale, "100% of TDEE", "100% מ-TDEE");
  if (goal === "weight_loss") return tr(locale, "-15% to -25% TDEE", "15%- עד 25%- TDEE");
  if (goal === "muscle_hypertrophy") return tr(locale, "+5% to +15% TDEE", "+5% עד +15% TDEE");
  if (goal === "body_recomposition") return tr(locale, "0% to -10% TDEE", "0% עד 10%- TDEE");
  return tr(locale, "+5% to +10% TDEE", "+5% עד +10% TDEE");
}

function goalProteinRange(goal: (typeof nutritionalGoalOptions)[number]): string {
  if (goal === "maintenance") return "1.2-1.6 g/kg";
  if (goal === "weight_loss") return "1.8-2.4 g/kg";
  if (goal === "muscle_hypertrophy") return "1.6-2.2 g/kg";
  if (goal === "body_recomposition") return "2.0-2.4 g/kg";
  return "1.4-2.0 g/kg";
}

function normalizeServerField(field: string): string {
  if (field === "weight_kg") return "weight";
  if (field === "height_cm") return "height";
  if (field.startsWith("exercise_schedule_by_modality")) return "exercise_schedule_by_modality";
  return field;
}

function packsPerDayToCigarettesString(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Math.round(value * CIGARETTES_PER_PACK));
}

function cigarettesPerDayToPacksString(value: string): string {
  if (value.trim() === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const packs = numeric / CIGARETTES_PER_PACK;
  return String(packs);
}

function createInitialDraft(
  defaults: OnboardingProfileFormProps["defaults"],
  locale: AppLocale,
): OnboardingFormDraft {
  const defaultWeightUnit = locale === "he" ? "kg" : "lbs";
  const defaultsWeightKg = defaults?.weight_kg ?? null;
  const defaultWeightValue =
    defaultsWeightKg == null
      ? ""
      : (defaultWeightUnit === "kg"
        ? String(defaultsWeightKg)
        : String((defaultsWeightKg / 0.45359237).toFixed(1)));
  const initialExerciseModalities = (defaults?.exercise_modalities ?? [])
    .filter((value): value is (typeof exerciseModalityOptions)[number] =>
      exerciseModalityOptions.includes(value as (typeof exerciseModalityOptions)[number]),
    );
  const scheduledModalities = getScheduledModalities(initialExerciseModalities);
  const exerciseScheduleByModality = buildInitialExerciseSchedule(defaults, scheduledModalities);
  const summaryFromSchedule = computeExerciseSummaryFromDraft(scheduledModalities, exerciseScheduleByModality);
  const initialMedicalConditions = parseInitialMedicalConditionState(defaults);

  return {
    first_name: defaults?.first_name ?? "",
    last_name: defaults?.last_name ?? "",
    date_of_birth: defaults?.date_of_birth ?? "",
    date_of_birth_display: defaults?.date_of_birth ?? "",
    biological_sex: defaults?.biological_sex ?? "",
    weight_unit: defaultWeightUnit,
    weight_value: defaultWeightValue,
    height_unit: "cm",
    height_cm_value: defaults?.height_cm != null ? String(defaults.height_cm) : "",
    height_ft_value: "",
    height_in_value: "",
    activity_level: defaults?.activity_level ?? "moderate",
    exercise_modalities: initialExerciseModalities,
    exercise_modality_other_details: defaults?.exercise_modality_other_details ?? "",
    exercise_schedule_by_modality: exerciseScheduleByModality,
    exercise_frequency_days_per_week: summaryFromSchedule.frequency,
    exercise_duration_minutes: summaryFromSchedule.duration,
    nutritional_goal: defaults?.nutritional_goal ?? "",
    pregnancy_lactation_status: defaults?.pregnancy_lactation_status ?? "none",
    has_medical_conditions:
      defaults?.has_medical_conditions == null
        ? "no"
        : (defaults.has_medical_conditions ? "yes" : "no"),
    medical_conditions: initialMedicalConditions.selected,
    medical_conditions_details: initialMedicalConditions.otherDetails,
    has_regular_medications:
      defaults?.has_regular_medications == null
        ? ""
        : (defaults.has_regular_medications ? "yes" : "no"),
    regular_medications_details: defaults?.regular_medications_details ?? "",
    hot_climate_or_heavy_sweating:
      defaults?.hot_climate_or_heavy_sweating == null
        ? ""
        : (defaults.hot_climate_or_heavy_sweating ? "yes" : "no"),
    habits: defaults?.habits ?? [],
    alcohol_times_per_week:
      defaults?.alcohol_times_per_week == null ? "" : String(defaults.alcohol_times_per_week),
    smoking_packs_per_day: packsPerDayToCigarettesString(defaults?.smoking_packs_per_day),
    dietary_preference: defaults?.dietary_preference ?? "",
    additional_information: defaults?.additional_information ?? "",
    allergies: defaults?.allergies?.join(", ") ?? "",
    preferred_language: defaults?.preferred_language ?? locale,
    accept_ai_extraction: false,
  };
}

function isValidDraft(value: unknown): value is OnboardingFormDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OnboardingFormDraft>;
  return (
    typeof candidate.first_name === "string" &&
    typeof candidate.last_name === "string" &&
    typeof candidate.date_of_birth === "string" &&
    typeof candidate.date_of_birth_display === "string" &&
    (candidate.biological_sex === "male" || candidate.biological_sex === "female" || candidate.biological_sex === "") &&
    (candidate.weight_unit === "kg" || candidate.weight_unit === "lbs") &&
    typeof candidate.weight_value === "string" &&
    (candidate.height_unit === "cm" || candidate.height_unit === "ft_in") &&
    typeof candidate.height_cm_value === "string" &&
    typeof candidate.height_ft_value === "string" &&
    typeof candidate.height_in_value === "string" &&
    typeof candidate.activity_level === "string" &&
    activityLevelOptions.includes(candidate.activity_level as (typeof activityLevelOptions)[number]) &&
    Array.isArray(candidate.exercise_modalities) &&
    typeof candidate.exercise_modality_other_details === "string" &&
    !!candidate.exercise_schedule_by_modality &&
    !Array.isArray(candidate.exercise_schedule_by_modality) &&
    typeof candidate.exercise_schedule_by_modality === "object" &&
    typeof candidate.exercise_frequency_days_per_week === "string" &&
    typeof candidate.exercise_duration_minutes === "string" &&
    (candidate.nutritional_goal === ""
      || nutritionalGoalOptions.includes(candidate.nutritional_goal as (typeof nutritionalGoalOptions)[number])) &&
    (candidate.pregnancy_lactation_status === "none"
      || candidate.pregnancy_lactation_status === "pregnant"
      || candidate.pregnancy_lactation_status === "lactating") &&
    (candidate.has_medical_conditions === "yes" || candidate.has_medical_conditions === "no" || candidate.has_medical_conditions === "") &&
    Array.isArray(candidate.medical_conditions) &&
    typeof candidate.medical_conditions_details === "string" &&
    (candidate.has_regular_medications === "yes" || candidate.has_regular_medications === "no" || candidate.has_regular_medications === "") &&
    typeof candidate.regular_medications_details === "string" &&
    (candidate.hot_climate_or_heavy_sweating === "yes"
      || candidate.hot_climate_or_heavy_sweating === "no"
      || candidate.hot_climate_or_heavy_sweating === "") &&
    Array.isArray(candidate.habits) &&
    typeof candidate.alcohol_times_per_week === "string" &&
    typeof candidate.smoking_packs_per_day === "string" &&
    (candidate.dietary_preference === ""
      || dietaryPreferenceOptions.includes(candidate.dietary_preference as (typeof dietaryPreferenceOptions)[number])) &&
    typeof candidate.additional_information === "string" &&
    typeof candidate.allergies === "string" &&
    (candidate.preferred_language === "en" || candidate.preferred_language === "he") &&
    typeof candidate.accept_ai_extraction === "boolean"
  );
}

function SubmitButton({ locale, canSubmit }: { locale: AppLocale; canSubmit: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || !canSubmit}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? tr(locale, "Saving profile...", "שומר פרופיל...") : tr(locale, "Complete setup", "סיום הגדרה")}
    </button>
  );
}

export function OnboardingProfileForm({
  defaults,
  locale = "en",
}: OnboardingProfileFormProps) {
  const [state, formAction] = useActionState(
    saveOnboardingProfileAction,
    initialState,
  );
  const [draft, setDraft] = useState<OnboardingFormDraft>(() => {
    const initialDraft = createInitialDraft(defaults, locale);

    if (typeof window === "undefined") {
      return initialDraft;
    }

    try {
      const raw = window.sessionStorage.getItem(ONBOARDING_DRAFT_KEY);
      if (!raw) return initialDraft;
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object") {
        return initialDraft;
      }

      const merged = {
        ...initialDraft,
        ...parsed,
      };

      if (merged.has_medical_conditions === "") {
        merged.has_medical_conditions = "no";
        merged.medical_conditions = [];
        merged.medical_conditions_details = "";
      }

      merged.accept_ai_extraction = false;

      return isValidDraft(merged) ? merged : initialDraft;
    } catch {
      // Ignore invalid or blocked storage reads.
      return initialDraft;
    }
  });
  const [step, setStep] = useState<StepKey>(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const effectiveLocale = draft.preferred_language;

  const normalizedDateOfBirth = draft.date_of_birth;

  const weightKg = toKg(draft.weight_value, draft.weight_unit);
  const heightCm = toCm(draft);
  const ageYears = calculateAge(normalizedDateOfBirth);
  const bmi = calculateBmi(weightKg, heightCm);
  const isUnderweight = bmi != null && bmi < 18.5;
  const isHighBmi = bmi != null && bmi >= 35;
  const bmiState = bmi != null ? bmiStatus(bmi) : null;
  const bmiPercent = bmi != null ? bmiPositionPercent(bmi) : null;
  const selectedExerciseModalities = getScheduledModalities(draft.exercise_modalities);
  const exerciseSummary = computeExerciseSummaryFromDraft(
    selectedExerciseModalities,
    draft.exercise_schedule_by_modality,
  );

  const selectedGoal = draft.nutritional_goal || null;

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore blocked storage writes.
    }
  }, [draft]);

  useEffect(() => {
    if (!state.fieldErrors || state.fieldErrors.length === 0) {
      return;
    }

    const mappedErrors: Record<string, string> = {};
    for (const issue of state.fieldErrors) {
      const key = normalizeServerField(issue.field);
      if (!mappedErrors[key]) {
        mappedErrors[key] = issue.message;
      }
    }

    setTimeout(() => {
      setErrors(mappedErrors);
    }, 0);

    const firstField = Object.keys(mappedErrors)[0];
    const targetStep = FIELD_TO_STEP[firstField] ?? step;
    if (targetStep !== step) {
      setTimeout(() => {
        setStep(targetStep);
        const element = document.querySelector<HTMLElement>(`[data-field='${firstField}']`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 0);
      return;
    }

    const element = document.querySelector<HTMLElement>(`[data-field='${firstField}']`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [state.fieldErrors, step]);

  const persistDraft = (next: OnboardingFormDraft) => {
    setDraft(next);
    try {
      window.sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(next));
    } catch {
      // Ignore blocked storage writes.
    }
  };

  const updateDraft = (patch: Partial<OnboardingFormDraft>) => {
    const next = { ...draft, ...patch };
    const normalizedSchedule = normalizeExerciseScheduleByModality(
      next.exercise_schedule_by_modality,
      getScheduledModalities(next.exercise_modalities),
    );
    const summary = computeExerciseSummaryFromDraft(
      getScheduledModalities(next.exercise_modalities),
      normalizedSchedule,
    );

    persistDraft({
      ...next,
      exercise_schedule_by_modality: normalizedSchedule,
      exercise_frequency_days_per_week: summary.frequency,
      exercise_duration_minutes: summary.duration,
    });
    setErrors((current) => (Object.keys(current).length > 0 ? {} : current));
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
    const patch: Partial<OnboardingFormDraft> = { [key]: nextValues } as Partial<OnboardingFormDraft>;

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

    updateDraft({ [key]: value } as Partial<OnboardingFormDraft>);
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
    const patch: Partial<OnboardingFormDraft> = {
      medical_conditions: nextConditions,
    };

    if (!nextConditions.includes("other")) {
      patch.medical_conditions_details = "";
    }

    updateDraft(patch);
  };

  const validateStep = (stepToValidate: StepKey): Record<string, string> => {
    const nextErrors: Record<string, string> = {};

    if (stepToValidate === 1) {
      if (!draft.first_name.trim()) nextErrors.first_name = tr(effectiveLocale, "First name is required.", "שם פרטי חובה.");
      if (!draft.last_name.trim()) nextErrors.last_name = tr(effectiveLocale, "Last name is required.", "שם משפחה חובה.");
      if (!draft.date_of_birth) nextErrors.date_of_birth = tr(effectiveLocale, "Date of birth is required.", "תאריך לידה חובה.");
      if (ageYears == null) nextErrors.date_of_birth = tr(effectiveLocale, "Enter a valid date of birth.", "יש להזין תאריך לידה תקין.");
      if (!draft.biological_sex) nextErrors.biological_sex = tr(effectiveLocale, "Select biological sex.", "יש לבחור מין ביולוגי.");
      if (weightKg == null || weightKg < 20 || weightKg > 400) {
        nextErrors.weight = tr(effectiveLocale, "Weight must be between 20 and 400 kg.", "המשקל חייב להיות בין 20 ל-400 ק" + "ג.");
      }
      if (heightCm == null || heightCm < 80 || heightCm > 250) {
        nextErrors.height = tr(effectiveLocale, "Height must be between 80 and 250 cm.", "הגובה חייב להיות בין 80 ל-250 ס" + "מ.");
      }
    }

    if (stepToValidate === 2) {
      if (!draft.activity_level) {
        nextErrors.activity_level = tr(effectiveLocale, "Activity level is required.", "רמת פעילות חובה.");
      }
      if (draft.exercise_modalities.length === 0) {
        nextErrors.exercise_modalities = tr(effectiveLocale, "Select at least one exercise modality.", "יש לבחור לפחות סוג אימון אחד.");
      }
      if (draft.exercise_modalities.includes("other")) {
        const validationResult = validateExerciseOtherDetails(draft.exercise_modality_other_details);
        if (!validationResult.isMeaningful) {
          const suggestionText = validationResult.suggestions.join(", ");
          nextErrors.exercise_modality_other_details = suggestionText
            ? tr(
              effectiveLocale,
              `Please enter a meaningful exercise type. Maybe: ${suggestionText}`,
              `יש להזין סוג אימון משמעותי. אולי התכוונת ל: ${suggestionText}`,
            )
            : tr(
              effectiveLocale,
              "Please enter a meaningful exercise type related to training.",
              "יש להזין סוג אימון משמעותי שקשור לאימון.",
            );
        }
      }
      selectedExerciseModalities.forEach((modality) => {
        const schedule = draft.exercise_schedule_by_modality[modality];
        const days = parseScheduleNumber(schedule?.days_per_week ?? "");
        const minutes = parseScheduleNumber(schedule?.minutes_per_session ?? "");

        if (days == null || !Number.isInteger(days) || days < 1 || days > 14) {
          nextErrors.exercise_schedule_by_modality = tr(
            effectiveLocale,
            "Set valid frequency (1-14 days/week) for each selected exercise type.",
            "יש להגדיר תדירות תקינה (1-14 ימים בשבוע) לכל סוג אימון שנבחר.",
          );
        }

        if (minutes == null || !Number.isInteger(minutes) || minutes < 1 || minutes > 600) {
          nextErrors.exercise_schedule_by_modality = tr(
            effectiveLocale,
            "Set valid duration (1-600 minutes) for each selected exercise type.",
            "יש להגדיר משך תקין (1-600 דקות) לכל סוג אימון שנבחר.",
          );
        }
      });
      if (!draft.nutritional_goal) {
        nextErrors.nutritional_goal = tr(effectiveLocale, "Select a nutritional goal.", "יש לבחור מטרה תזונתית.");
      }
      if (isUnderweight && (draft.nutritional_goal === "weight_loss" || draft.nutritional_goal === "body_recomposition")) {
        nextErrors.nutritional_goal = tr(
          effectiveLocale,
          "Weight Loss and Body Recomposition are disabled for BMI below 18.5.",
          "ירידה במשקל והרכב גוף מושבתים עבור BMI מתחת ל-18.5.",
        );
      }
    }

    if (stepToValidate === 3) {
      if (draft.biological_sex === "female" && !draft.pregnancy_lactation_status) {
        nextErrors.pregnancy_lactation_status = tr(effectiveLocale, "Choose pregnancy/lactation status.", "יש לבחור סטטוס הריון/הנקה.");
      }
      if (!draft.has_medical_conditions) {
        nextErrors.has_medical_conditions = tr(effectiveLocale, "Choose Yes or No.", "יש לבחור כן או לא.");
      }
      if (draft.has_medical_conditions === "yes") {
        if (draft.medical_conditions.length === 0) {
          nextErrors.medical_conditions = tr(
            effectiveLocale,
            "Select at least one medical condition option.",
            "יש לבחור לפחות אפשרות אחת במצבים רפואיים.",
          );
        }

        const includesOthers = draft.medical_conditions.includes("other");
        if (includesOthers) {
          if (draft.medical_conditions_details.trim().length < 3) {
            nextErrors.medical_conditions_details = tr(
              effectiveLocale,
              "⚠️ Please describe a diagnosed condition (name, symptom, or diagnosis) or uncheck 'Others'.",
              "⚠️ אנא תאר מצב רפואי מאובחן (שם, תסמין או אבחנה) או הסר את הסימון מ'אחר'.",
            );
          }
        }
      }
      if (!draft.has_regular_medications) {
        nextErrors.has_regular_medications = tr(effectiveLocale, "Choose Yes or No.", "יש לבחור כן או לא.");
      }
      if (draft.has_regular_medications === "yes") {
        if (draft.regular_medications_details.trim().length < 3) {
          nextErrors.regular_medications_details = tr(
            effectiveLocale,
            "Please include medication name and/or dosage frequency (e.g., Metformin 500mg twice daily).",
            "יש לכלול שם תרופה ו/או מינון ותדירות (לדוגמה: Metformin 500mg twice daily).",
          );
        }
      }
      if (!draft.hot_climate_or_heavy_sweating) {
        nextErrors.hot_climate_or_heavy_sweating = tr(effectiveLocale, "Choose Yes or No.", "יש לבחור כן או לא.");
      }
      if (draft.habits.includes("alcohol")) {
        const alcoholPerWeek = Number(draft.alcohol_times_per_week);
        if (!Number.isFinite(alcoholPerWeek) || alcoholPerWeek <= 0) {
          nextErrors.alcohol_times_per_week = tr(effectiveLocale, "Enter alcohol times per week.", "יש להזין תדירות אלכוהול בשבוע.");
        }
      }

      if (draft.habits.includes("smoking_or_vaping")) {
        const smokingPerDay = Number(draft.smoking_packs_per_day);
        if (!Number.isFinite(smokingPerDay) || smokingPerDay <= 0) {
          nextErrors.smoking_packs_per_day = tr(effectiveLocale, "Enter cigarettes per day.", "יש להזין מספר סיגריות ביום.");
        }
      }
    }

    if (stepToValidate === 4) {
      const allergyEntries = draft.allergies
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const invalidAllergy = allergyEntries.find((entry) => !validateAllergyEntry(entry).isMeaningful);
      if (invalidAllergy) {
        const suggestionText = validateAllergyEntry(invalidAllergy).suggestions.join(", ");
        nextErrors.allergies = suggestionText
          ? tr(
            effectiveLocale,
            `Please enter a meaningful allergy. Maybe: ${suggestionText}`,
            `יש להזין אלרגיה משמעותית. אולי התכוונת ל: ${suggestionText}`,
          )
          : tr(
            effectiveLocale,
            "Please enter a meaningful allergy description.",
            "יש להזין תיאור אלרגיה משמעותי.",
          );
      }

      if (draft.additional_information.length > 1000) {
        nextErrors.additional_information = tr(effectiveLocale, "Maximum 1000 characters.", "מקסימום 1000 תווים.");
      }
      if (draft.additional_information.trim()) {
        const additionalInfoValidation = validateFreeTextDetails(draft.additional_information, 5);
        if (!additionalInfoValidation.isMeaningful) {
          nextErrors.additional_information = tr(
            effectiveLocale,
            "Enter meaningful additional information or leave it empty.",
            "יש להזין מידע נוסף משמעותי או להשאיר ריק.",
          );
        }
      }
      if (!draft.accept_ai_extraction) {
        nextErrors.accept_ai_extraction = tr(
          effectiveLocale,
          "Consent is required before completing setup.",
          "נדרשת הסכמה לפני סיום ההגדרה.",
        );
      }
    }

    return nextErrors;
  };

  const goToStep = (nextStep: StepKey) => {
    const nextErrors = validateStep(step);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstKey = Object.keys(nextErrors)[0];
      const element = document.querySelector<HTMLElement>(`[data-field='${firstKey}']`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    setErrors({});
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onSubmit = () => {
    const nextErrors = validateStep(4);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    try {
      window.sessionStorage.removeItem(ONBOARDING_DRAFT_KEY);
    } catch {
      // Ignore blocked storage writes.
    }
  };

  const isGoalDisabled = (goal: (typeof nutritionalGoalOptions)[number]): boolean => {
    return isUnderweight && (goal === "weight_loss" || goal === "body_recomposition");
  };

  const showSedentaryHint = draft.activity_level === "sedentary";

  const renderFieldError = (key: string) => {
    const message = errors[key];
    if (!message) return null;
    return <p className="mt-1 text-xs text-rose-700">{message}</p>;
  };

  const inputErrorClass = (key: string): string => {
    return errors[key] ? "border-rose-700" : "border-slate-300";
  };

  return (
    <form action={formAction} onSubmit={onSubmit} className="mt-6 space-y-5 pb-20">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-sm font-medium text-slate-700">
          {tr(effectiveLocale, `Step ${step} of 4`, `שלב ${step} מתוך 4`)}
        </div>
        <div className="flex gap-1.5" data-field="preferred_language">
          <button
            type="button"
            onClick={() => updateDraft({ preferred_language: "en", weight_unit: "lbs" })}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${draft.preferred_language === "en" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => updateDraft({ preferred_language: "he", weight_unit: "kg" })}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${draft.preferred_language === "he" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
          >
            עברית
          </button>
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-teal-600 transition-all"
          style={{ width: `${(step / 4) * 100}%` }}
        />
      </div>

      <input type="hidden" name="preferred_language" value={draft.preferred_language} />
      <input type="hidden" name="first_name" value={draft.first_name} />
      <input type="hidden" name="last_name" value={draft.last_name} />
      <input type="hidden" name="date_of_birth" value={normalizedDateOfBirth} />
      <input type="hidden" name="biological_sex" value={draft.biological_sex} />
      <input type="hidden" name="height_cm" value={heightCm != null ? String(heightCm) : ""} />
      <input type="hidden" name="weight_kg" value={weightKg != null ? String(weightKg) : ""} />
      <input type="hidden" name="activity_level" value={draft.activity_level} />
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
      <input type="hidden" name="nutritional_goal" value={draft.nutritional_goal} />
      <input
        type="hidden"
        name="pregnancy_lactation_status"
        value={draft.pregnancy_lactation_status}
      />
      <input type="hidden" name="has_medical_conditions" value={draft.has_medical_conditions} />
      <input type="hidden" name="medical_conditions_details" value={draft.medical_conditions_details} />
      <input type="hidden" name="has_regular_medications" value={draft.has_regular_medications} />
      <input
        type="hidden"
        name="regular_medications_details"
        value={draft.regular_medications_details}
      />
      <input
        type="hidden"
        name="hot_climate_or_heavy_sweating"
        value={draft.hot_climate_or_heavy_sweating}
      />
      <input type="hidden" name="alcohol_times_per_week" value={draft.alcohol_times_per_week} />
      <input type="hidden" name="smoking_packs_per_day" value={cigarettesPerDayToPacksString(draft.smoking_packs_per_day)} />
      <input type="hidden" name="dietary_preference" value={draft.dietary_preference} />
      <input type="hidden" name="allergies" value={draft.allergies} />
      <input
        type="hidden"
        name="additional_information"
        value={draft.additional_information}
      />
      <input
        type="hidden"
        name="medical_conditions"
        value={draft.has_medical_conditions === "yes" ? draft.medical_conditions.join(",") : ""}
      />
      {draft.exercise_modalities.map((value) => (
        <input key={`hidden-exercise-${value}`} type="hidden" name="exercise_modalities" value={value} />
      ))}
      {draft.habits.map((value) => (
        <input key={`hidden-habit-${value}`} type="hidden" name="habits" value={value} />
      ))}

      {step === 1 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">{tr(effectiveLocale, "Identity & Vital Statistics", "זהות ומדדים בסיסיים")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block" data-field="first_name">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "First name", "שם פרטי")}</span>
              <input
                type="text"
                name="first_name"
                required
                value={draft.first_name}
                onChange={(event) => updateDraft({ first_name: event.target.value })}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("first_name")}`}
              />
              {renderFieldError("first_name")}
            </label>

            <label className="block" data-field="last_name">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Last name", "שם משפחה")}</span>
              <input
                type="text"
                name="last_name"
                required
                value={draft.last_name}
                onChange={(event) => updateDraft({ last_name: event.target.value })}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("last_name")}`}
              />
              {renderFieldError("last_name")}
            </label>

            <label className="block" data-field="date_of_birth">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Date of birth", "תאריך לידה")}</span>
              {/* Native date input format follows the browser/OS locale, not `lang`, so we overlay a locale-formatted display and keep the input transparent for the calendar picker only. */}
              <div className="relative">
                <input
                  type="date"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  value={draft.date_of_birth}
                  onChange={(event) => updateDraft({ date_of_birth: event.target.value, date_of_birth_display: event.target.value })}
                  onClick={(event) => {
                    try {
                      event.currentTarget.showPicker?.();
                    } catch {
                      // picker may already be open; ignore
                    }
                  }}
                  lang={localeTag(effectiveLocale)}
                  className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                />
                <div
                  aria-hidden="true"
                  className={`pointer-events-none flex w-full items-center rounded-xl border px-3 py-2.5 text-sm peer-focus:ring-2 peer-focus:ring-teal-600 ${inputErrorClass("date_of_birth")}`}
                >
                  {draft.date_of_birth ? formatDateForLocale(draft.date_of_birth, effectiveLocale) : tr(effectiveLocale, "Select a date", "יש לבחור תאריך")}
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">{tr(effectiveLocale, "Pick the date from the calendar.", "יש לבחור תאריך מהיומן.")}</p>
              {renderFieldError("date_of_birth")}
            </label>

            <div className="block" data-field="biological_sex">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Biological sex", "מין ביולוגי")}</span>
              <div className={`grid grid-cols-2 overflow-hidden rounded-xl border ${inputErrorClass("biological_sex")}`}>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-medium ${draft.biological_sex === "male" ? "bg-teal-700 text-white" : "bg-white text-slate-700"}`}
                  onClick={() => updateDraft({ biological_sex: "male", pregnancy_lactation_status: "none" })}
                >
                  {tr(effectiveLocale, "Male", "זכר")}
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-medium ${draft.biological_sex === "female" ? "bg-teal-700 text-white" : "bg-white text-slate-700"}`}
                  onClick={() => updateDraft({ biological_sex: "female" })}
                >
                  {tr(effectiveLocale, "Female", "נקבה")}
                </button>
              </div>
              {renderFieldError("biological_sex")}
            </div>

            <div className="space-y-2" data-field="weight">
              <div className="flex items-center justify-between">
                <span className="block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Current weight", "משקל נוכחי")}</span>
                <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
                  <button
                    type="button"
                    onClick={() => updateDraft({ weight_unit: "kg" })}
                    className={`px-3 py-1.5 ${draft.weight_unit === "kg" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
                  >
                    kg
                  </button>
                  <button
                    type="button"
                    onClick={() => updateDraft({ weight_unit: "lbs" })}
                    className={`px-3 py-1.5 ${draft.weight_unit === "lbs" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
                  >
                    lbs
                  </button>
                </div>
              </div>
              <input
                type="number"
                min={1}
                step="0.1"
                value={draft.weight_value}
                onChange={(event) => updateDraft({ weight_value: event.target.value })}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("weight")}`}
              />
              {renderFieldError("weight")}
            </div>

            <div className="space-y-2" data-field="height">
              <div className="flex items-center justify-between">
                <span className="block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Height", "גובה")}</span>
                <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
                  <button
                    type="button"
                    onClick={() => updateDraft({ height_unit: "cm" })}
                    className={`px-3 py-1.5 ${draft.height_unit === "cm" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
                  >
                    cm
                  </button>
                  <button
                    type="button"
                    onClick={() => updateDraft({ height_unit: "ft_in" })}
                    className={`px-3 py-1.5 ${draft.height_unit === "ft_in" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
                  >
                    ft/in
                  </button>
                </div>
              </div>
              {draft.height_unit === "cm" ? (
                <input
                  type="number"
                  min={1}
                  step="0.1"
                  value={draft.height_cm_value}
                  onChange={(event) => updateDraft({ height_cm_value: event.target.value })}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("height")}`}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder={tr(effectiveLocale, "Feet", "רגל")}
                    value={draft.height_ft_value}
                    onChange={(event) => updateDraft({ height_ft_value: event.target.value })}
                    className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("height")}`}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder={tr(effectiveLocale, "Inches", "אינץ'")}
                    value={draft.height_in_value}
                    onChange={(event) => updateDraft({ height_in_value: event.target.value })}
                    className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("height")}`}
                  />
                </div>
              )}
              {renderFieldError("height")}
            </div>
          </div>

          <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
            <p>
              {tr(effectiveLocale, "Calculated age", "גיל מחושב")}: {ageYears != null ? ageYears : tr(effectiveLocale, "n/a", "לא זמין")}
            </p>
            <p>
              BMI: {bmi != null ? formatNumberForLocale(bmi, effectiveLocale, { maximumFractionDigits: 2 }) : tr(effectiveLocale, "n/a", "לא זמין")}
            </p>

            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-slate-700">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span>{tr(effectiveLocale, "BMI scale", "סקאלת BMI")}</span>
                <span>
                  {tr(effectiveLocale, "Good range", "טווח תקין")}: {BMI_GOOD_MIN}-{BMI_GOOD_MAX}
                </span>
              </div>

              <div className="mb-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <p>
                  {tr(effectiveLocale, "Scale min", "מינימום סקאלה")}: <span className="font-semibold text-slate-900">{BMI_SCALE_MIN}</span>
                </p>
                <p className="text-right">
                  {tr(effectiveLocale, "Scale max", "מקסימום סקאלה")}: <span className="font-semibold text-slate-900">{BMI_SCALE_MAX}</span>
                </p>
                <p>
                  {tr(effectiveLocale, "Healthy min", "מינימום תקין")}: <span className="font-semibold text-slate-900">{BMI_GOOD_MIN}</span>
                </p>
                <p className="text-right">
                  {tr(effectiveLocale, "Healthy max", "מקסימום תקין")}: <span className="font-semibold text-slate-900">{BMI_GOOD_MAX}</span>
                </p>
              </div>

              <div className="relative h-3 rounded-full bg-slate-200">
                <div
                  className="absolute h-full rounded-full bg-emerald-400"
                  style={{
                    left: `${((BMI_GOOD_MIN - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100}%`,
                    width: `${((BMI_GOOD_MAX - BMI_GOOD_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100}%`,
                  }}
                />
                {bmi != null && bmiPercent != null ? (
                  <div
                    className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white ${
                      bmiState === "good"
                        ? "border-emerald-600"
                        : bmiState === "warning"
                          ? "border-amber-500"
                          : "border-rose-600"
                    }`}
                    style={{ left: `${bmiPercent}%` }}
                    aria-label="bmi-marker"
                  />
                ) : null}
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>{BMI_SCALE_MIN}</span>
                <span>{BMI_SCALE_MAX}</span>
              </div>

              {bmi != null ? (
                <p
                  className={`mt-2 text-xs font-semibold ${
                    bmiState === "good"
                      ? "text-emerald-700"
                      : bmiState === "warning"
                        ? "text-amber-700"
                        : "text-rose-700"
                  }`}
                >
                  {tr(effectiveLocale, "Current BMI", "BMI נוכחי")}: {formatNumberForLocale(bmi, effectiveLocale, { maximumFractionDigits: 2 })}. {" "}
                  {bmiState === "good"
                    ? tr(effectiveLocale, "BMI is in a healthy range.", "ה-BMI בטווח תקין.")
                    : bmiState === "warning"
                      ? tr(effectiveLocale, "BMI is in range but close to a boundary.", "ה-BMI בטווח אך קרוב לקצה.")
                      : tr(effectiveLocale, "BMI is outside the recommended range.", "ה-BMI מחוץ לטווח המומלץ.")}
                </p>
              ) : (
                <p className="mt-2 text-xs font-semibold text-slate-600">
                  {tr(
                    effectiveLocale,
                    "Enter valid height and weight to place your BMI marker on the scale.",
                    "יש להזין גובה ומשקל תקינים כדי להציג את סמן ה-BMI על הסקאלה.",
                  )}
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">{tr(effectiveLocale, "Lifestyle & Physical Activity", "אורח חיים ופעילות")}</h2>

          <div data-field="activity_level">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Daily activity level", "רמת פעילות יומית")}</span>
            <select
              name="activity_level"
              value={draft.activity_level}
              onChange={(event) => updateDraft({ activity_level: event.target.value as (typeof activityLevelOptions)[number] })}
              className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("activity_level")}`}
            >
              {activityLevelOptions.map((option) => (
                <option key={option} value={option}>{formatActivityLevel(option, effectiveLocale)}</option>
              ))}
            </select>
            {renderFieldError("activity_level")}
          </div>

          <div data-field="exercise_modalities">
            <span className="mb-2 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Exercise modality", "סוג אימון")}</span>
            <div className="flex flex-wrap gap-2">
              {exerciseModalityOptions.map((value) => {
                const label =
                  value === "resistance_hypertrophy"
                    ? tr(effectiveLocale, "Resistance / Hypertrophy", "התנגדות / היפרטרופיה")
                    : value === "endurance_cardio"
                      ? tr(effectiveLocale, "Endurance / Cardio", "סבולת / אירובי")
                      : value === "martial_arts"
                        ? tr(effectiveLocale, "Martial Arts", "אומנויות לחימה")
                        : value === "none"
                          ? tr(effectiveLocale, "None", "ללא")
                        : tr(effectiveLocale, "Other", "אחר");
                const active = draft.exercise_modalities.includes(value);

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleListValue("exercise_modalities", value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${active ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {renderFieldError("exercise_modalities")}

            {draft.exercise_modalities.includes("other") ? (
              <label className="mt-3 block" data-field="exercise_modality_other_details">
                <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Other exercise type", "סוג אימון אחר")}</span>
                <input
                  type="text"
                  maxLength={80}
                  value={draft.exercise_modality_other_details}
                  onChange={(event) => updateDraft({ exercise_modality_other_details: event.target.value })}
                  placeholder={tr(effectiveLocale, "e.g. Pilates, spinning, climbing", "לדוגמה: פילאטיס, ספינינג, טיפוס")}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("exercise_modality_other_details")}`}
                />
                <p className="mt-1 text-xs text-slate-500">
                  {tr(
                    effectiveLocale,
                    "Use a real exercise term. Typos are okay, random text is not.",
                    "יש להזין שם אמיתי של פעילות גופנית. שגיאות כתיב נסבלות, טקסט אקראי לא.",
                  )}
                </p>
                {renderFieldError("exercise_modality_other_details")}
              </label>
            ) : null}
          </div>

          {selectedExerciseModalities.length > 0 ? (
            <div className="space-y-3" data-field="exercise_schedule_by_modality">
              <p className="text-sm font-medium text-slate-700">
                {tr(
                  effectiveLocale,
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
                      <p className="text-sm font-semibold text-slate-900">{exerciseModalityLabel(modality, effectiveLocale)}</p>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-700">{tr(effectiveLocale, "Frequency (days/week)", "תדירות (ימים/שבוע)")}</span>
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
                          <span className="mb-1 block text-xs font-medium text-slate-700">{tr(effectiveLocale, "Duration (minutes/session)", "משך (דקות לאימון)")}</span>
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
            <span className="mb-2 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Nutritional goal", "מטרה תזונתית")}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {nutritionalGoalOptions.map((goal) => {
                const disabled = isGoalDisabled(goal);
                const selected = draft.nutritional_goal === goal;
                return (
                  <button
                    key={goal}
                    type="button"
                    disabled={disabled}
                    onClick={() => updateDraft({ nutritional_goal: goal })}
                    className={`rounded-xl border px-3 py-2 text-left text-xs ${selected ? "border-teal-700 bg-teal-50" : "border-slate-300 bg-white"} ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-teal-400"}`}
                  >
                    <p className="font-semibold text-slate-900">{goalLabel(goal, effectiveLocale)}</p>
                    <p className="mt-1 text-slate-600">{goalEnergyTarget(goal, effectiveLocale)}</p>
                    <p className="text-slate-600">{goalProteinRange(goal)}</p>
                    {showSedentaryHint && goal === "muscle_hypertrophy" ? (
                      <p className="mt-1 text-amber-700">{tr(effectiveLocale, "Hypertrophy requires structured resistance training.", "היפרטרופיה דורשת אימון התנגדות מובנה.")}</p>
                    ) : null}
                    {showSedentaryHint && goal === "athletic_performance" ? (
                      <p className="mt-1 text-amber-700">{tr(effectiveLocale, "Athletic performance targets active training lifestyles.", "ביצועים אתלטיים מיועדים לאורח חיים פעיל.")}</p>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {renderFieldError("nutritional_goal")}

            {isUnderweight ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {tr(
                  effectiveLocale,
                  "Weight Loss and Recomposition are disabled because your calculated BMI is under 18.5. We recommend Maintenance or Hypertrophy.",
                  "ירידה במשקל והרכב גוף מושבתים כי BMI נמוך מ-18.5. מומלץ שימור או היפרטרופיה.",
                )}
              </p>
            ) : null}

            {isHighBmi && selectedGoal === "muscle_hypertrophy" ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {tr(
                  effectiveLocale,
                  "Caloric surplus may not be recommended at your current BMI. Body Recomposition or Weight Loss is typically advised.",
                  "עודף קלורי עשוי לא להתאים ל-BMI הנוכחי. בדרך כלל מומלץ הרכב גוף או ירידה במשקל.",
                )}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">{tr(effectiveLocale, "Medical & Physiological Status", "מצב רפואי ופיזיולוגי")}</h2>

          {draft.biological_sex === "female" ? (
            <div data-field="pregnancy_lactation_status">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Pregnancy / lactation", "הריון / הנקה")}</span>
              <select
                name="pregnancy_lactation_status"
                value={draft.pregnancy_lactation_status}
                onChange={(event) =>
                  updateDraft({
                    pregnancy_lactation_status: event.target.value as "none" | "pregnant" | "lactating",
                  })
                }
                className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("pregnancy_lactation_status")}`}
              >
                <option value="none">{tr(effectiveLocale, "No", "לא")}</option>
                <option value="pregnant">{tr(effectiveLocale, "Pregnant", "בהריון")}</option>
                <option value="lactating">{tr(effectiveLocale, "Lactating", "מניקה")}</option>
              </select>
              {renderFieldError("pregnancy_lactation_status")}
            </div>
          ) : (
            null
          )}

          <div data-field="has_medical_conditions">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "🩺 Medical conditions", "🩺 מצבים רפואיים")}</span>
            <div className="flex gap-3 text-sm">
              <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.has_medical_conditions === "yes" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="has_medical_conditions" value="yes" checked={draft.has_medical_conditions === "yes"} onChange={() => setYesNo("has_medical_conditions", "yes")} /> {tr(effectiveLocale, "Yes", "כן")}</label>
              <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.has_medical_conditions === "no" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="has_medical_conditions" value="no" checked={draft.has_medical_conditions === "no"} onChange={() => setYesNo("has_medical_conditions", "no")} /> {tr(effectiveLocale, "No", "לא")}</label>
            </div>
            <div
              className={`overflow-hidden transition-all duration-300 ${draft.has_medical_conditions === "yes" ? "mt-3 max-h-[700px] opacity-100" : "max-h-0 opacity-0"}`}
            >
              <div data-field="medical_conditions" className="grid gap-2 sm:grid-cols-2">
                {medicalConditionOptions.map((condition) => {
                  const selected = draft.medical_conditions.includes(condition);
                  return (
                    <button
                      key={condition}
                      type="button"
                      onClick={() => toggleMedicalCondition(condition)}
                      className={`rounded-xl border px-3 py-2 text-left text-xs font-medium ${selected ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700"}`}
                    >
                      {medicalConditionLabel(condition, effectiveLocale)}
                    </button>
                  );
                })}
              </div>
              {renderFieldError("medical_conditions")}

              {draft.medical_conditions.includes("other") ? (
                <label className="mt-3 block" data-field="medical_conditions_details">
                  <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Other diagnosed conditions", "מצבים רפואיים נוספים")}</span>
                  <textarea
                    name="medical_conditions_details"
                    value={draft.medical_conditions_details}
                    onChange={(event) => updateDraft({ medical_conditions_details: event.target.value })}
                    placeholder={tr(effectiveLocale, "Enter any other diagnosed medical conditions (e.g., Anemia, Gout, Sleep Apnea).", "יש להזין מצבים רפואיים מאובחנים נוספים (לדוגמה: אנמיה, גאוט, דום נשימה בשינה).")}
                    className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${errors.medical_conditions_details ? "border-rose-900" : "border-slate-300"}`}
                    rows={3}
                    minLength={3}
                    maxLength={250}
                  />
                  {renderFieldError("medical_conditions_details")}
                </label>
              ) : null}
            </div>
            {renderFieldError("has_medical_conditions")}
          </div>

          <div data-field="has_regular_medications">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Regular medications", "תרופות קבועות")}</span>
            <div className="flex gap-3 text-sm">
              <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.has_regular_medications === "yes" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="has_regular_medications" value="yes" checked={draft.has_regular_medications === "yes"} onChange={() => setYesNo("has_regular_medications", "yes")} /> {tr(effectiveLocale, "Yes", "כן")}</label>
              <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.has_regular_medications === "no" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="has_regular_medications" value="no" checked={draft.has_regular_medications === "no"} onChange={() => setYesNo("has_regular_medications", "no")} /> {tr(effectiveLocale, "No", "לא")}</label>
            </div>
            {draft.has_regular_medications === "yes" ? (
              <textarea
                name="regular_medications_details"
                value={draft.regular_medications_details}
                onChange={(event) => updateDraft({ regular_medications_details: event.target.value })}
                placeholder={tr(effectiveLocale, "e.g., acid reducers, diuretics, metformin", "לדוגמה: מטפורמין, משתנים")}
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
                rows={3}
              />
            ) : (
              null
            )}
            {draft.has_regular_medications === "yes" ? (
              <p className="mt-1 text-xs text-slate-500">
                {tr(
                  effectiveLocale,
                  "Tip: include medication name and dosage/frequency. Typos are okay, unrelated text is not.",
                  "טיפ: יש לכלול שם תרופה ומינון/תדירות. שגיאות כתיב נסבלות, טקסט לא קשור לא.",
                )}
              </p>
            ) : null}
            {renderFieldError("has_regular_medications")}
          </div>

          <div data-field="hot_climate_or_heavy_sweating">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Heavy sweating / hot climate exposure", "חשיפה לחום/הזעה מרובה")}</span>
            <div className="flex gap-3 text-sm">
              <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.hot_climate_or_heavy_sweating === "yes" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="hot_climate_or_heavy_sweating" value="yes" checked={draft.hot_climate_or_heavy_sweating === "yes"} onChange={() => setYesNo("hot_climate_or_heavy_sweating", "yes")} /> {tr(effectiveLocale, "Yes", "כן")}</label>
              <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${draft.hot_climate_or_heavy_sweating === "no" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-800"}`}><input className="h-4 w-4 accent-teal-700" type="radio" name="hot_climate_or_heavy_sweating" value="no" checked={draft.hot_climate_or_heavy_sweating === "no"} onChange={() => setYesNo("hot_climate_or_heavy_sweating", "no")} /> {tr(effectiveLocale, "No", "לא")}</label>
            </div>
            {renderFieldError("hot_climate_or_heavy_sweating")}
          </div>

          <div data-field="habits">
            <span className="mb-2 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Habits & substance use", "הרגלים ושימוש בחומרים")}</span>
            <div className="flex flex-wrap gap-2">
              {habitOptions.map((value) => {
                const label =
                  value === "smoking_or_vaping"
                    ? tr(effectiveLocale, "Regular Smoking", "עישון קבוע")
                    : value === "alcohol"
                      ? tr(effectiveLocale, "Regular Alcohol Consumption", "צריכת אלכוהול קבועה")
                      : tr(effectiveLocale, "None of these", "אף אחד מהבאים");
                const selected = draft.habits.includes(value);

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleListValue("habits", value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {draft.habits.includes("alcohol") ? (
              <label className="mt-2 block" data-field="alcohol_times_per_week">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  {tr(effectiveLocale, "Alcohol frequency (times/week)", "תדירות אלכוהול (פעמים בשבוע)")}
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={draft.alcohol_times_per_week}
                  onChange={(event) => updateDraft({ alcohol_times_per_week: event.target.value })}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("alcohol_times_per_week")}`}
                />
                {renderFieldError("alcohol_times_per_week")}
              </label>
            ) : null}

            {draft.habits.includes("smoking_or_vaping") ? (
              <label className="mt-2 block" data-field="smoking_packs_per_day">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  {tr(effectiveLocale, "Smoking amount (cigarettes/day)", "כמות עישון (סיגריות ביום)")}
                </span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={draft.smoking_packs_per_day}
                  onChange={(event) => updateDraft({ smoking_packs_per_day: event.target.value })}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("smoking_packs_per_day")}`}
                />
                {renderFieldError("smoking_packs_per_day")}
              </label>
            ) : null}

            {renderFieldError("habits")}
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">{tr(effectiveLocale, "Dietary Profile & Context", "פרופיל תזונתי והקשר")}</h2>

          <div data-field="dietary_preference">
            <span className="mb-2 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Dietary preference", "העדפה תזונתית")}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {dietaryPreferenceOptions.map((value) => {
                const label =
                  value === "standard"
                    ? tr(effectiveLocale, "Standard Diet", "תזונה רגילה")
                    : value === "vegetarian"
                      ? tr(effectiveLocale, "Vegetarian", "צמחוני")
                      : value === "vegan"
                        ? tr(effectiveLocale, "Vegan", "טבעוני")
                        : tr(effectiveLocale, "Low-Carb / Keto", "דל פחמימה / קטו");
                const selected = draft.dietary_preference === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateDraft({ dietary_preference: value })}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium ${selected ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {renderFieldError("dietary_preference")}
          </div>

          <label className="block" data-field="allergies">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Allergies (optional)", "אלרגיות (אופציונלי)")}</span>
            <input
              type="text"
              name="allergies"
              value={draft.allergies}
              onChange={(event) => updateDraft({ allergies: event.target.value })}
              placeholder={tr(effectiveLocale, "e.g., peanuts, shellfish", "לדוגמה: בוטנים, רכיכות")}
              className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("allergies")}`}
            />
            <p className="mt-1 text-xs text-slate-500">
              {tr(
                effectiveLocale,
                "Use real allergy names. Typos are okay, random text is not.",
                "יש להזין שמות אלרגיה אמיתיים. שגיאות כתיב נסבלות, טקסט אקראי לא.",
              )}
            </p>
            {renderFieldError("allergies")}
          </label>

          <label className="block" data-field="additional_information">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(effectiveLocale, "Additional information", "מידע נוסף")}</span>
            <textarea
              name="additional_information"
              rows={5}
              maxLength={1000}
              value={draft.additional_information}
              onChange={(event) => updateDraft({ additional_information: event.target.value })}
              placeholder={tr(
                effectiveLocale,
                "Tell us anything else your AI coach should consider (allergies, sleep, constraints).",
                "שתפו כל מידע נוסף שהמאמן הדיגיטלי צריך לדעת (אלרגיות, שינה, מגבלות).",
              )}
              className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 ${inputErrorClass("additional_information")}`}
            />
            <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
              <span>{tr(effectiveLocale, "Character count", "ספירת תווים")}</span>
              <span>{draft.additional_information.length} / 1000</span>
            </div>
            {renderFieldError("additional_information")}
          </label>

          <label className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
            <input
              type="checkbox"
              name="accept_ai_extraction"
              value="yes"
              checked={draft.accept_ai_extraction}
              onChange={(event) => updateDraft({ accept_ai_extraction: event.target.checked })}
              className="mt-0.5"
            />
            <span>
              {tr(
                effectiveLocale,
                "I agree to the transfer and storage of my health data with the AI provider for analysis purposes",
                "אני מסכים/ה לשליחת נתוני הבריאות והתזונה לספק ה-AI ולשמירתם לצורך ניתוח ושיפור השירות.",
              )}
            </span>
          </label>
          {renderFieldError("accept_ai_extraction")}
        </section>
      ) : null}

      {state.error && !state.fieldErrors?.length ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      {state.error && state.fieldErrors?.length ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {state.error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((step - 1) as StepKey)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {tr(effectiveLocale, "Back", "חזרה")}
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={() => goToStep((step + 1) as StepKey)}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
            >
              {tr(effectiveLocale, "Next", "הבא")}
            </button>
          ) : (
            <SubmitButton locale={effectiveLocale} canSubmit={draft.accept_ai_extraction} />
          )}
        </div>
      </div>
    </form>
  );
}
