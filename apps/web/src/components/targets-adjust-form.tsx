"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { generateTargetsAction, lockTargetsAction, type TargetsActionState } from "@/app/app/targets/actions";
import { TargetProfileView } from "@/components/target-profile-view";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import { formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";

function AdjustSubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? tr(locale, "Updating...", "מעדכן...") : tr(locale, "Update my targets", "עדכון היעדים שלי")}
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

type DiffRow = { labelEn: string; labelHe: string; before: string; after: string };

function totalWeeklyFrequency(payload: TargetGenerationPayload): number {
  return payload.exerciseTargets.reduce((sum, entry) => sum + entry.frequencyPerWeek, 0);
}

function computeHeadlineDiff(before: TargetGenerationPayload, after: TargetGenerationPayload, locale: AppLocale): DiffRow[] {
  const rows: DiffRow[] = [];
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

export function TargetsAdjustForm({
  locale,
  maintenanceCalories,
  currentPayload,
}: {
  locale: AppLocale;
  maintenanceCalories: number;
  currentPayload: TargetGenerationPayload;
}) {
  const router = useRouter();
  const [generateState, generateFormAction] = useActionState(generateTargetsAction, {} as TargetsActionState);
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

  const diffRows = generateState.preview ? computeHeadlineDiff(currentPayload, generateState.preview.payload, locale) : [];

  return (
    <div className="mt-6 space-y-4 border-t border-slate-200 pt-6">
      {generateState.preview ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{tr(locale, "Updated preview", "תצוגה מקדימה מעודכנת")}</p>
            <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
              {generateState.preview.source === "ai" ? "AI" : tr(locale, "Heuristic fallback", "גיבוי יוריסטי")}
            </span>
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
          ) : (
            <p className="text-sm text-slate-600">
              {tr(locale, "No meaningful change was detected in the headline metrics.", "לא זוהה שינוי משמעותי במדדים המרכזיים.")}
            </p>
          )}

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

      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {tr(locale, "Request an adjustment", "בקשת שינוי")}
      </h3>
      <form action={generateFormAction} className="space-y-3">
        <textarea
          name="goal_text"
          maxLength={500}
          rows={3}
          placeholder={tr(
            locale,
            "Example: reduce my workout days to 2 times a week.",
            "דוגמה: להפחית את ימי האימון שלי לפעמיים בשבוע.",
          )}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
        />

        {generateState.error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{generateState.error}</p>
        ) : null}
        {generateState.warning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{generateState.warning}</p>
        ) : null}

        <AdjustSubmitButton locale={locale} />
      </form>
    </div>
  );
}
