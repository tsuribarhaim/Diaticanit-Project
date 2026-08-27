"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { generateTargetsAction, lockTargetsAction, type TargetsActionState } from "@/app/app/targets/actions";
import { TargetProfileView } from "@/components/target-profile-view";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import { formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
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
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? pendingLabel : idleLabel}
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

type MetricDiffRow = { labelEn: string; labelHe: string; before: string; after: string };

function totalWeeklyFrequency(payload: TargetGenerationPayload): number {
  return payload.exerciseTargets.reduce((sum, entry) => sum + entry.frequencyPerWeek, 0);
}

function computeHeadlineDiff(before: TargetGenerationPayload, after: TargetGenerationPayload, locale: AppLocale): MetricDiffRow[] {
  const rows: MetricDiffRow[] = [];
  const n = (value: number) => formatNumberForLocale(value, locale, { maximumFractionDigits: 1 });

  function addRangeRow(labelEn: string, labelHe: string, beforeMin: number, beforeMax: number, afterMin: number, afterMax: number, unit: string) {
    if (beforeMin === afterMin && beforeMax === afterMax) return;
    rows.push({
      labelEn,
      labelHe,
      before: `${n(beforeMin)}–${n(beforeMax)} ${unit}`,
      after: `${n(afterMin)}–${n(afterMax)} ${unit}`,
    });
  }

  addRangeRow("Calories", "קלוריות", before.caloriesMin, before.caloriesMax, after.caloriesMin, after.caloriesMax, "kcal");
  addRangeRow("Protein", "חלבון", before.proteinMinG, before.proteinMaxG, after.proteinMinG, after.proteinMaxG, "g");
  addRangeRow("Carbohydrates", "פחמימות", before.carbsMinG, before.carbsMaxG, after.carbsMinG, after.carbsMaxG, "g");
  addRangeRow("Fats", "שומנים", before.fatsMinG, before.fatsMaxG, after.fatsMinG, after.fatsMaxG, "g");
  addRangeRow("Fluid / Water", "נוזלים", before.waterMinMl, before.waterMaxMl, after.waterMinMl, after.waterMaxMl, "ml");

  const beforeFrequency = totalWeeklyFrequency(before);
  const afterFrequency = totalWeeklyFrequency(after);
  if (beforeFrequency !== afterFrequency) {
    rows.push({
      labelEn: "Total weekly exercise frequency",
      labelHe: "תדירות פעילות שבועית כוללת",
      before: `${beforeFrequency}x`,
      after: `${afterFrequency}x`,
    });
  }

  if (before.goalType !== after.goalType) {
    rows.push({ labelEn: "Goal type", labelHe: "סוג מטרה", before: before.goalType, after: after.goalType });
  }

  return rows;
}

export function TargetsWorkspace({
  locale,
  maintenanceCalories,
  mode,
  initialPreview,
  initialWarning,
  currentPayload,
  profileChanges,
}: {
  locale: AppLocale;
  maintenanceCalories: number;
  mode: "initial" | "adjust";
  initialPreview?: { goalText: string; source: "ai" | "heuristic"; payload: TargetGenerationPayload };
  initialWarning?: string;
  currentPayload?: TargetGenerationPayload;
  profileChanges?: ProfileDiffRow[];
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
  const [lockState, lockFormAction] = useActionState(lockTargetsAction, {} as TargetsActionState);
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

  const pendingPreview = generateState.preview && !lockState.success ? generateState.preview : null;
  const displayedPayload = pendingPreview?.payload ?? currentPayload ?? null;
  const diffRows = mode === "adjust" && pendingPreview && currentPayload ? computeHeadlineDiff(currentPayload, pendingPreview.payload, locale) : [];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
      <div className="space-y-4">
        {displayedPayload ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                {pendingPreview ? tr(locale, "Preview", "תצוגה מקדימה") : tr(locale, "Current targets", "היעדים הנוכחיים")}
              </p>
              {pendingPreview ? (
                <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {pendingPreview.source === "ai" ? "AI" : tr(locale, "Heuristic fallback", "גיבוי יוריסטי")}
                </span>
              ) : null}
            </div>

            {diffRows.length ? (
              <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">{tr(locale, "What changed", "מה השתנה")}</p>
                <ul className="mt-2 space-y-1 text-sm text-teal-900">
                  {diffRows.map((row) => (
                    <li key={row.labelEn}>
                      <span className="font-medium">{tr(locale, row.labelEn, row.labelHe)}:</span> {row.before} → {row.after}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <TargetProfileView payload={displayedPayload} locale={locale} maintenanceCalories={maintenanceCalories} />

            {pendingPreview ? (
              <form action={lockFormAction} className="space-y-2">
                <input type="hidden" name="goal_text" value={pendingPreview.goalText} />
                <input type="hidden" name="source" value={pendingPreview.source} />
                <input type="hidden" name="payload_json" value={JSON.stringify(pendingPreview.payload)} />

                {lockState.error ? (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{lockState.error}</p>
                ) : null}

                <LockSubmitButton locale={locale} />
              </form>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="space-y-4 md:sticky md:top-6">
        {profileChanges?.length ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              {tr(locale, "Your profile has changed since these targets were set", "הפרופיל שלך השתנה מאז נקבעו היעדים הללו")}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-amber-800">
              {profileChanges.map((row) => (
                <li key={row.labelEn}>
                  <span className="font-medium">{tr(locale, row.labelEn, row.labelHe)}:</span> {row.before} → {row.after}
                </li>
              ))}
            </ul>
            <button
              type="submit"
              form={GENERATE_FORM_ID}
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
            >
              {tr(locale, "Recalculate now", "לחישוב מחדש")}
            </button>
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
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
            />

            {generateState.error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{generateState.error}</p>
            ) : null}
            {generateState.warning ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{generateState.warning}</p>
            ) : null}

            <GenerateSubmitButton locale={locale} mode={mode} />
          </form>
        </div>
      </div>
    </div>
  );
}
