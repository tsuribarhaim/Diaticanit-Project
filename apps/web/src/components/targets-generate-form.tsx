"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { generateTargetsAction, lockTargetsAction, type TargetsActionState } from "@/app/app/targets/actions";
import { TargetProfileView } from "@/components/target-profile-view";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import { tr, type AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";

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

export function TargetsGenerateForm({
  locale,
  maintenanceCalories,
  initialPreview,
  initialWarning,
}: {
  locale: AppLocale;
  maintenanceCalories: number;
  initialPreview?: { goalText: string; source: "ai" | "heuristic"; payload: TargetGenerationPayload };
  initialWarning?: string;
}) {
  const router = useRouter();
  const initialGenerateState: TargetsActionState = initialPreview
    ? {
        success: tr(
          locale,
          "A baseline plan was generated from your profile. Review it below before locking it in.",
          "תכנית בסיס נוצרה מתוך הפרופיל שלך. יש לבדוק אותה למטה לפני נעילתה.",
        ),
        warning: initialWarning,
        preview: initialPreview,
      }
    : {};
  const [generateState, generateFormAction] = useActionState(generateTargetsAction, initialGenerateState);
  const [lockState, lockFormAction] = useActionState(lockTargetsAction, {});
  const { setHasUnsavedPreview } = useUnsavedPreview();

  useEffect(() => {
    if (lockState.success) {
      router.refresh();
    }
  }, [lockState.success, router]);

  useEffect(() => {
    setHasUnsavedPreview(Boolean(generateState.preview) && !lockState.success);
  }, [generateState.preview, lockState.success, setHasUnsavedPreview]);

  useEffect(() => {
    return () => setHasUnsavedPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-5 space-y-6">
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

      <form action={generateFormAction} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {tr(locale, "Your goal (optional)", "המטרה שלך (אופציונלי)")}
          </span>
          <textarea
            name="goal_text"
            maxLength={500}
            rows={4}
            defaultValue={initialPreview?.goalText ?? ""}
            placeholder={tr(
              locale,
              "Optional. Example: I want to lose 5 kg in 2 months. Leave empty to keep the general baseline plan.",
              "אופציונלי. דוגמה: אני רוצה לרדת 5 ק\"ג בחודשיים. ניתן להשאיר ריק לשמירה על תכנית הבסיס הכללית.",
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
    </div>
  );
}
