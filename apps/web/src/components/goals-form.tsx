"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveGoalAction,
  type GoalsActionState,
} from "@/app/app/goals/actions";
import type { AppLocale } from "@/lib/locale";
import { tr } from "@/lib/locale";

const initialState: GoalsActionState = {};
const GOALS_DRAFT_KEY = "phc_goals_form_draft";

function SubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="submit"
        name="intent"
        value="analyze"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-xl border border-teal-300 px-4 py-2.5 text-sm font-semibold text-teal-700 disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-50"
      >
        {pending ? tr(locale, "Working...", "מעבד...") : tr(locale, "Analyze with AI", "ניתוח עם AI")}
      </button>

      <button
        type="submit"
        name="intent"
        value="save"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
      >
        {pending ? tr(locale, "Saving goal...", "שומר מטרה...") : tr(locale, "Save translated targets", "שמירת יעדים מתורגמים")}
      </button>
    </div>
  );
}

export function GoalsForm({
  defaultText,
  locale,
}: {
  defaultText?: string | null;
  locale: AppLocale;
}) {
  const [state, formAction] = useActionState(saveGoalAction, initialState);
  const [goalText, setGoalText] = useState(() => {
    const initial = defaultText ?? "";
    if (typeof window === "undefined") {
      return initial;
    }

    try {
      const saved = window.sessionStorage.getItem(GOALS_DRAFT_KEY);
      return saved ?? initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(GOALS_DRAFT_KEY, goalText);
    } catch {
      // Ignore blocked storage writes.
    }
  }, [goalText]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    const intent = submitter?.name === "intent" ? submitter.value : "save";
    if (intent !== "save") {
      return;
    }

    try {
      window.sessionStorage.removeItem(GOALS_DRAFT_KEY);
    } catch {
      // Ignore blocked storage writes.
    }
  };

  return (
    <form action={formAction} onSubmit={handleSubmit} className="mt-5 space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Your goal (free text)", "המטרה שלך (טקסט חופשי)")}</span>
        <textarea
          name="goal_text"
          required
          minLength={8}
          maxLength={500}
          rows={4}
          value={goalText}
          onChange={(event) => setGoalText(event.target.value)}
          placeholder={tr(locale, "Example: I want to lose 3 kg in 2 months and improve my energy.", "דוגמה: אני רוצה לרדת 3 ק\"ג בחודשיים ולשפר את רמת האנרגיה שלי.")}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
        />
      </label>

      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.success}
        </p>
      ) : null}
      {state.warning ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {state.warning}
        </p>
      ) : null}

      {state.preview ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">{tr(locale, "Suggested target plan", "תכנית יעדים מוצעת")}</p>
          <p className="mt-1">
            <span className="font-medium">{tr(locale, "Analysis source", "מקור ניתוח")}:</span>{" "}
            {state.preview.source === "ai" ? "AI" : tr(locale, "Heuristic fallback", "גיבוי יוריסטי")}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Goal type", "סוג יעד")}:</span> {state.preview.goalType}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Duration (days)", "משך (ימים)")}:</span> {state.preview.durationDays}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Target delta (kg)", "שינוי יעד (ק\"ג)")}:</span> {state.preview.targetDeltaKg}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Target weight (kg)", "משקל יעד (ק\"ג)")}:</span> {state.preview.targetWeightKg}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Daily calories delta", "שינוי קלוריות יומי")}:</span> {state.preview.dailyCalorieDelta}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Protein target (g)", "יעד חלבון (גרם)")}:</span> {state.preview.proteinTargetG}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Hydration target (L)", "יעד נוזלים (ליטר)")}:</span> {state.preview.hydrationTargetL}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Steps target", "יעד צעדים")}:</span> {state.preview.stepsTarget}
          </p>
          <p>
            <span className="font-medium">{tr(locale, "Confidence", "רמת ביטחון")}:</span> {state.preview.confidence}
          </p>
          {state.preview.detectedGoals.length ? (
            <div className="mt-2">
              <p className="font-medium">{tr(locale, "Detected goals", "מטרות שזוהו")}</p>
              <ul className="mt-1 list-disc space-y-1 ps-6">
                {state.preview.detectedGoals.map((goal) => (
                  <li key={goal}>{goal}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {(state.preview.bloodBalanceFocus || state.preview.sleepFocus) ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {state.preview.bloodBalanceFocus ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  {tr(locale, "Blood markers focus", "מיקוד במדדי דם")}
                </span>
              ) : null}
              {state.preview.sleepFocus ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                  {tr(locale, "Sleep quality focus", "מיקוד באיכות שינה")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <SubmitButton locale={locale} />
    </form>
  );
}
