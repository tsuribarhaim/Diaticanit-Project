"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveOnboardingProfileAction,
  type OnboardingActionState,
} from "@/app/app/onboarding/actions";
import { activityLevelOptions } from "@/lib/profile";
import type { AppLocale } from "@/lib/locale";
import { formatActivityLevel, tr } from "@/lib/locale";

type OnboardingProfileFormProps = {
  defaults?: {
    age?: number;
    gender?: string;
    height_cm?: number;
    weight_kg?: number;
    activity_level?: (typeof activityLevelOptions)[number];
    preferred_language?: "en" | "he";
    allergies?: string[];
    medical_conditions?: string[];
  };
  locale?: AppLocale;
};

const initialState: OnboardingActionState = {};
const ONBOARDING_DRAFT_KEY = "phc_onboarding_profile_draft";

type OnboardingFormDraft = {
  age: string;
  gender: string;
  height_cm: string;
  weight_kg: string;
  activity_level: (typeof activityLevelOptions)[number];
  preferred_language: "en" | "he";
  allergies: string;
  medical_conditions: string;
  accept_ai_extraction: boolean;
};

function createInitialDraft(
  defaults: OnboardingProfileFormProps["defaults"],
  locale: AppLocale,
): OnboardingFormDraft {
  return {
    age: defaults?.age != null ? String(defaults.age) : "",
    gender: defaults?.gender ?? "",
    height_cm: defaults?.height_cm != null ? String(defaults.height_cm) : "",
    weight_kg: defaults?.weight_kg != null ? String(defaults.weight_kg) : "",
    activity_level: defaults?.activity_level ?? "moderate",
    preferred_language: defaults?.preferred_language ?? locale,
    allergies: defaults?.allergies?.join(", ") ?? "",
    medical_conditions: defaults?.medical_conditions?.join(", ") ?? "",
    accept_ai_extraction: false,
  };
}

function isValidDraft(value: unknown): value is OnboardingFormDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OnboardingFormDraft>;
  return (
    typeof candidate.age === "string" &&
    typeof candidate.gender === "string" &&
    typeof candidate.height_cm === "string" &&
    typeof candidate.weight_kg === "string" &&
    typeof candidate.activity_level === "string" &&
    activityLevelOptions.includes(candidate.activity_level as (typeof activityLevelOptions)[number]) &&
    (candidate.preferred_language === "en" || candidate.preferred_language === "he") &&
    typeof candidate.allergies === "string" &&
    typeof candidate.medical_conditions === "string" &&
    typeof candidate.accept_ai_extraction === "boolean"
  );
}

function SubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? tr(locale, "Saving profile...", "שומר פרופיל...") : tr(locale, "Save profile", "שמירת פרופיל")}
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
      return isValidDraft(parsed) ? parsed : initialDraft;
    } catch {
      // Ignore invalid or blocked storage reads.
      return initialDraft;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore blocked storage writes.
    }
  }, [draft]);

  const persistDraft = (next: OnboardingFormDraft) => {
    setDraft(next);
    try {
      window.sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(next));
    } catch {
      // Ignore blocked storage writes.
    }
  };

  const updateDraft = (patch: Partial<OnboardingFormDraft>) => {
    persistDraft({ ...draft, ...patch });
  };

  const onSubmit = () => {
    try {
      window.sessionStorage.removeItem(ONBOARDING_DRAFT_KEY);
    } catch {
      // Ignore blocked storage writes.
    }
  };

  return (
    <form action={formAction} onSubmit={onSubmit} className="mt-6 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Age", "גיל")}</span>
          <input
            type="number"
            name="age"
            required
            min={10}
            max={120}
            value={draft.age}
            onChange={(event) => updateDraft({ age: event.target.value })}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Gender", "מגדר")}</span>
          <input
            type="text"
            name="gender"
            required
            maxLength={30}
            value={draft.gender}
            onChange={(event) => updateDraft({ gender: event.target.value })}
            placeholder={tr(locale, "e.g. female, male", "לדוגמה: זכר, נקבה")}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {tr(locale, "Height (cm)", "גובה (ס\"מ)")}
          </span>
          <input
            type="number"
            name="height_cm"
            required
            min={80}
            max={250}
            step="0.01"
            value={draft.height_cm}
            onChange={(event) => updateDraft({ height_cm: event.target.value })}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {tr(locale, "Weight (kg)", "משקל (ק\"ג)")}
          </span>
          <input
            type="number"
            name="weight_kg"
            required
            min={20}
            max={400}
            step="0.01"
            value={draft.weight_kg}
            onChange={(event) => updateDraft({ weight_kg: event.target.value })}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {tr(locale, "Activity level", "רמת פעילות")}
        </span>
        <select
          name="activity_level"
          required
          value={draft.activity_level}
          onChange={(event) =>
            updateDraft({
              activity_level: event.target.value as (typeof activityLevelOptions)[number],
            })
          }
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
        >
            {activityLevelOptions.map((option) => (
              <option key={option} value={option}>
                {formatActivityLevel(option, locale)}
              </option>
            ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {tr(locale, "Language", "שפה")}
        </span>
        <select
          name="preferred_language"
          required
          value={draft.preferred_language}
          onChange={(event) =>
            updateDraft({ preferred_language: event.target.value as "en" | "he" })
          }
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
        >
          <option value="en">English</option>
          <option value="he">עברית</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {tr(locale, "Allergies (comma separated)", "אלרגיות (מופרדות בפסיקים)")}
        </span>
        <input
          type="text"
          name="allergies"
          value={draft.allergies}
          onChange={(event) => updateDraft({ allergies: event.target.value })}
          placeholder={tr(locale, "e.g. peanuts, shellfish", "לדוגמה: בוטנים, רכיכות")}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {tr(locale, "Medical condition (comma separated)", "מצב רפואי (מופרד בפסיקים)")}
        </span>
        <input
          type="text"
          name="medical_conditions"
          value={draft.medical_conditions}
          onChange={(event) => updateDraft({ medical_conditions: event.target.value })}
          placeholder={tr(locale, "e.g. hypertension", "לדוגמה: יתר לחץ דם")}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
        />
      </label>

      <label className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
        <input
          type="checkbox"
          name="accept_ai_extraction"
          value="yes"
          checked={draft.accept_ai_extraction}
          onChange={(event) =>
            updateDraft({ accept_ai_extraction: event.target.checked })
          }
          className="mt-0.5"
        />
        <span>
          {tr(
            locale,
            "I agree that my extracted health text can be sent to the configured AI provider for analysis.",
            "אני מסכים/ה שטקסט בריאות שחולץ יכול להישלח לספק ה-AI שהוגדר לצורך ניתוח.",
          )}
        </span>
      </label>

      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <SubmitButton locale={locale} />
    </form>
  );
}
