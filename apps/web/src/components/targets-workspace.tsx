"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { dismissProfileChangeAction, generateTargetsAction, lockTargetsAction, type TargetsActionState } from "@/app/app/targets/actions";
import { TargetsSectionTabs, type TargetsHistoryInfo } from "@/components/targets-section-tabs";
import { TargetsDiffTable } from "@/components/targets-diff-table";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import { tr, type AppLocale } from "@/lib/locale";
import { computeTargetsDiff } from "@/lib/targets-diff";
import type { ProfileDiffRow, TargetGenerationPayload } from "@/lib/targets";

const GENERATE_FORM_ID = "targets-generate-form";

function GenerateSubmitButton({ locale, mode }: { locale: AppLocale; mode: "initial" | "adjust" }) {
  const { pending } = useFormStatus();
  const idleLabel =
    mode === "initial" ? tr(locale, "Generate my targets", "יצירת היעדים שלי") : tr(locale, "Update my targets", "עדכון היעדים שלי");
  const pendingLabel = mode === "initial" ? tr(locale, "Generating...", "מייצר...") : tr(locale, "Updating...", "מעדכן...");

  return (
    <button
      type="submit"
      form={GENERATE_FORM_ID}
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

export function LockSubmitButton({
  locale,
  disabled,
  disabledReason,
}: {
  locale: AppLocale;
  disabled?: boolean;
  /** Why the button is disabled, when it's not for the default "no changes"
   * reason - e.g. a new preview is still generating, so locking now would
   * save the stale preview shown underneath instead of the one being
   * computed. */
  disabledReason?: "generating";
}) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;

  return (
    <button
      type="submit"
      disabled={isDisabled}
      title={
        disabled
          ? disabledReason === "generating"
            ? tr(locale, "Please wait for the update to finish before saving.", "יש להמתין לסיום העדכון לפני השמירה.")
            : tr(locale, "No changes to save yet.", "אין שינויים לשמירה כרגע.")
          : undefined
      }
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed ${
        disabled && !pending
          ? "bg-slate-300 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
          : "bg-emerald-700 hover:bg-emerald-800 disabled:opacity-70 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      }`}
    >
      {pending ? tr(locale, "Locking in...", "נועל...") : tr(locale, "Approve & Lock Daily Targets", "אישור ונעילת היעדים היומיים")}
    </button>
  );
}

export function TargetsWorkspace({
  locale,
  maintenanceCalories,
  mode,
  initialPreview,
  initialWarning,
  currentPayload,
  profileChanges,
  bmiWarning,
  firstName,
  history,
}: {
  locale: AppLocale;
  maintenanceCalories: number;
  mode: "initial" | "adjust";
  initialPreview?: { goalText: string; source: "ai" | "heuristic"; payload: TargetGenerationPayload };
  initialWarning?: string;
  currentPayload?: TargetGenerationPayload;
  profileChanges?: ProfileDiffRow[];
  /** Deterministic BMI safety message (lib/bmi.ts) - see TargetsChatWorkspace. */
  bmiWarning?: string;
  firstName?: string | null;
  history?: TargetsHistoryInfo | null;
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
  const [generateState, generateFormAction, isGeneratePending] = useActionState(generateTargetsAction, initialGenerateState);
  const [lockState, lockFormAction] = useActionState(lockTargetsAction, {} as TargetsActionState);
  const [isDismissingProfileChange, setIsDismissingProfileChange] = useState(false);
  const { setHasUnsavedPreview } = useUnsavedPreview();

  async function handleSkipProfileChange() {
    if (isDismissingProfileChange) return;
    setIsDismissingProfileChange(true);
    await dismissProfileChangeAction();
    setIsDismissingProfileChange(false);
    router.refresh();
  }

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

  const pendingPreview = generateState.preview && !lockState.success ? generateState.preview : null;
  const displayedPayload = pendingPreview?.payload ?? currentPayload ?? null;
  const diffRows = mode === "adjust" && pendingPreview && currentPayload ? computeTargetsDiff(currentPayload, pendingPreview.payload, locale) : [];
  const isAdjustWithNoChanges = mode === "adjust" && Boolean(pendingPreview) && Boolean(currentPayload) && diffRows.length === 0;

  return (
    <div className="space-y-4">
      {bmiWarning ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/30">
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-400">
            {tr(locale, "Your new weight is outside the healthy BMI range", "המשקל החדש שלך מחוץ לטווח ה-BMI הבריא")}
          </p>
          <p className="mt-2 text-sm text-rose-800 dark:text-rose-400">{bmiWarning}</p>
        </div>
      ) : null}
      {profileChanges?.length ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-400">
            {tr(locale, "Your profile has changed since these targets were set", "הפרופיל שלך השתנה מאז נקבעו היעדים הללו")}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-400">
            {profileChanges.map((row) => (
              <li key={row.labelEn}>
                <span className="font-medium">{tr(locale, row.labelEn, row.labelHe)}:</span> {row.before} → {row.after}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              form={GENERATE_FORM_ID}
              disabled={isDismissingProfileChange}
              className="inline-flex items-center justify-center rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500"
            >
              {tr(locale, "Recalculate now", "לחישוב מחדש")}
            </button>
            <button
              type="button"
              onClick={handleSkipProfileChange}
              disabled={isDismissingProfileChange}
              className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-70 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-400 dark:hover:bg-amber-950/40"
            >
              {isDismissingProfileChange ? tr(locale, "Skipping...", "מדלג...") : tr(locale, "Skip", "דילוג")}
            </button>
          </div>
        </div>
      ) : null}

      {displayedPayload ? (
        <div className="space-y-4">
          {pendingPreview ? (
            <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4 dark:border-teal-800 dark:bg-teal-950/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-teal-900 dark:text-teal-300">{tr(locale, "Preview", "תצוגה מקדימה")}</p>
                <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  {pendingPreview.source === "ai" ? "AI" : tr(locale, "Heuristic fallback", "גיבוי יוריסטי")}
                </span>
              </div>

              {mode === "adjust" ? (
                diffRows.length ? (
                  <TargetsDiffTable rows={diffRows} locale={locale} />
                ) : (
                  <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    {tr(
                      locale,
                      "This recalculation didn't change anything measurable in your targets — nothing new to lock in.",
                      "החישוב מחדש לא שינה דבר מדיד ביעדים שלך — אין מה לנעול מחדש.",
                    )}
                  </p>
                )
              ) : null}

              <form action={lockFormAction} className="space-y-2">
                <input type="hidden" name="goal_text" value={pendingPreview.goalText} />
                <input type="hidden" name="source" value={pendingPreview.source} />
                <input type="hidden" name="payload_json" value={JSON.stringify(pendingPreview.payload)} />

                {lockState.error ? (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">{lockState.error}</p>
                ) : null}

                <LockSubmitButton
                  locale={locale}
                  disabled={isAdjustWithNoChanges || isGeneratePending}
                  disabledReason={isGeneratePending ? "generating" : undefined}
                />
              </form>
            </div>
          ) : null}

          <TargetsSectionTabs
            payload={displayedPayload}
            locale={locale}
            maintenanceCalories={maintenanceCalories}
            firstName={firstName}
            history={history}
          />
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {mode === "initial" ? tr(locale, "Your goal (optional)", "המטרה שלך (אופציונלי)") : tr(locale, "Request an adjustment", "בקשת שינוי")}
        </h3>
        <form id={GENERATE_FORM_ID} action={generateFormAction} className="mt-2 space-y-3">
          <textarea
            name="goal_text"
            maxLength={500}
            rows={mode === "initial" ? 4 : 3}
            defaultValue={initialPreview?.goalText ?? ""}
            placeholder={
              mode === "initial"
                ? tr(
                    locale,
                    "Optional. Example: I want to lose 5 kg in 2 months. Leave empty to keep the general baseline plan.",
                    "אופציונלי. דוגמה: אני רוצה לרדת 5 ק\"ג בחודשיים. ניתן להשאיר ריק לשמירה על תכנית הבסיס הכללית.",
                  )
                : tr(locale, "Example: reduce my workout days to 2 times a week.", "דוגמה: להפחית את ימי האימון שלי לפעמיים בשבוע.")
            }
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />

          {generateState.error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">{generateState.error}</p>
          ) : null}
          {generateState.warning ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">{generateState.warning}</p>
          ) : null}

          <GenerateSubmitButton locale={locale} mode={mode} />
        </form>
      </div>
    </div>
  );
}
