"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { generateTargetsAction, lockTargetsAction, type TargetsActionState } from "@/app/app/targets/actions";
import { TargetProfileView } from "@/components/target-profile-view";
import { tr, type AppLocale } from "@/lib/locale";

const initialState: TargetsActionState = {};

function GenerateSubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? tr(locale, "Generating...", "מייצר...") : tr(locale, "Generate my targets", "יצירת היעדים שלי")}
    </button>
  );
}

function LockSubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-emerald-800"
    >
      {pending ? tr(locale, "Locking in...", "נועל...") : tr(locale, "Approve & Lock Daily Targets", "אישור ונעילת היעדים היומיים")}
    </button>
  );
}

export function TargetsGenerateForm({ locale, maintenanceCalories }: { locale: AppLocale; maintenanceCalories: number }) {
  const router = useRouter();
  const [generateState, generateFormAction] = useActionState(generateTargetsAction, initialState);
  const [lockState, lockFormAction] = useActionState(lockTargetsAction, initialState);

  useEffect(() => {
    if (lockState.success) {
      router.refresh();
    }
  }, [lockState.success, router]);

  return (
    <div className="mt-5 space-y-6">
      <form action={generateFormAction} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Your goal (free text)", "המטרה שלך (טקסט חופשי)")}</span>
          <textarea
            name="goal_text"
            required
            minLength={8}
            maxLength={500}
            rows={4}
            placeholder={tr(
              locale,
              "Example: I want to lose 5 kg in 2 months.",
              "דוגמה: אני רוצה לרדת 5 ק\"ג בחודשיים.",
            )}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
          />
        </label>

        {generateState.error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{generateState.error}</p>
        ) : null}
        {generateState.warning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{generateState.warning}</p>
        ) : null}

        <GenerateSubmitButton locale={locale} />
      </form>

      {generateState.preview ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{tr(locale, "Preview", "תצוגה מקדימה")}</p>
            <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
              {generateState.preview.source === "ai" ? "AI" : tr(locale, "Heuristic fallback", "גיבוי יוריסטי")}
            </span>
          </div>

          <TargetProfileView payload={generateState.preview.payload} locale={locale} maintenanceCalories={maintenanceCalories} />

          <form action={lockFormAction} className="space-y-2">
            <input type="hidden" name="goal_text" value={generateState.preview.goalText} />
            <input type="hidden" name="source" value={generateState.preview.source} />
            <input type="hidden" name="payload_json" value={JSON.stringify(generateState.preview.payload)} />

            {lockState.error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{lockState.error}</p>
            ) : null}

            <LockSubmitButton locale={locale} />
          </form>
        </div>
      ) : null}
    </div>
  );
}
