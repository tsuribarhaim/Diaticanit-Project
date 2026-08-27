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

function LockSubmitButton({ locale, disabled }: { locale: AppLocale; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;

  return (
    <button
      type="submit"
      disabled={isDisabled}
      title={disabled ? tr(locale, "No changes to save yet.", "אין שינויים לשמירה כרגע.") : undefined}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed ${
        disabled && !pending ? "bg-slate-300 text-slate-500" : "bg-emerald-700 hover:bg-emerald-800 disabled:opacity-70"
      }`}
    >
      {pending ? tr(locale, "Locking in...", "נועל...") : tr(locale, "Approve & Lock Daily Targets", "אישור ונעילת היעדים היומיים")}
    </button>
  );
}

type MetricDiffRow = { labelEn: string; labelHe: string; before: string; after: string };

const NUTRIENT_DIFF_FIELDS: Array<{
  labelEn: string;
  labelHe: string;
  minKey: keyof TargetGenerationPayload;
  maxKey: keyof TargetGenerationPayload;
  unit: string;
}> = [
  { labelEn: "Calories", labelHe: "קלוריות", minKey: "caloriesMin", maxKey: "caloriesMax", unit: "kcal" },
  { labelEn: "Protein", labelHe: "חלבון", minKey: "proteinMinG", maxKey: "proteinMaxG", unit: "g" },
  { labelEn: "Carbohydrates", labelHe: "פחמימות", minKey: "carbsMinG", maxKey: "carbsMaxG", unit: "g" },
  { labelEn: "Fats", labelHe: "שומנים", minKey: "fatsMinG", maxKey: "fatsMaxG", unit: "g" },
  { labelEn: "Dietary Fiber", labelHe: "סיבים תזונתיים", minKey: "fiberMinG", maxKey: "fiberMaxG", unit: "g" },
  { labelEn: "Sodium", labelHe: "נתרן", minKey: "sodiumMinMg", maxKey: "sodiumMaxMg", unit: "mg" },
  { labelEn: "Added Sugars", labelHe: "סוכרים מוספים", minKey: "addedSugarMinG", maxKey: "addedSugarMaxG", unit: "g" },
  { labelEn: "Fluid / Water", labelHe: "נוזלים", minKey: "waterMinMl", maxKey: "waterMaxMl", unit: "ml" },
  { labelEn: "Potassium", labelHe: "אשלגן", minKey: "potassiumMinMg", maxKey: "potassiumMaxMg", unit: "mg" },
  { labelEn: "Magnesium", labelHe: "מגנזיום", minKey: "magnesiumMinMg", maxKey: "magnesiumMaxMg", unit: "mg" },
  { labelEn: "Calcium", labelHe: "סידן", minKey: "calciumMinMg", maxKey: "calciumMaxMg", unit: "mg" },
  { labelEn: "Iron", labelHe: "ברזל", minKey: "ironMinMg", maxKey: "ironMaxMg", unit: "mg" },
  { labelEn: "Zinc", labelHe: "אבץ", minKey: "zincMinMg", maxKey: "zincMaxMg", unit: "mg" },
  { labelEn: "Vitamin C", labelHe: "ויטמין C", minKey: "vitCMinMg", maxKey: "vitCMaxMg", unit: "mg" },
  { labelEn: "Vitamin B12", labelHe: "ויטמין B12", minKey: "vitB12MinMcg", maxKey: "vitB12MaxMcg", unit: "mcg" },
  { labelEn: "Vitamin D", labelHe: "ויטמין D", minKey: "vitDMinMcg", maxKey: "vitDMaxMcg", unit: "mcg" },
  { labelEn: "Saturated Fat", labelHe: "שומן רווי", minKey: "satFatMinG", maxKey: "satFatMaxG", unit: "g" },
  { labelEn: "Omega-3", labelHe: "אומגה 3", minKey: "omega3MinG", maxKey: "omega3MaxG", unit: "g" },
];

function exerciseSummary(payload: TargetGenerationPayload): string {
  return payload.exerciseTargets
    .map((entry) => `${entry.modality} ${entry.frequencyPerWeek}x/${entry.durationMinutesPerSession}min`)
    .sort()
    .join(", ");
}

function habitsSummary(payload: TargetGenerationPayload): string {
  return [...payload.habitsDo, ...payload.habitsDont]
    .map((habit) => habit.habitInstruction)
    .sort()
    .join(" | ");
}

/** Compares every quantifiable field (all nutrient ranges, exercise plan,
 * habits, goal metadata) between two target payloads - deliberately excludes
 * free-text fields that can vary cosmetically (aiRationaleExplanation,
 * confidence, assumptions) even when the actual targets are unchanged. */
function computeTargetsDiff(before: TargetGenerationPayload, after: TargetGenerationPayload, locale: AppLocale): MetricDiffRow[] {
  const rows: MetricDiffRow[] = [];
  const n = (value: number) => formatNumberForLocale(value, locale, { maximumFractionDigits: 1 });

  for (const field of NUTRIENT_DIFF_FIELDS) {
    const beforeMin = before[field.minKey] as number;
    const beforeMax = before[field.maxKey] as number;
    const afterMin = after[field.minKey] as number;
    const afterMax = after[field.maxKey] as number;
    if (beforeMin === afterMin && beforeMax === afterMax) continue;
    rows.push({
      labelEn: field.labelEn,
      labelHe: field.labelHe,
      before: `${n(beforeMin)}–${n(beforeMax)} ${field.unit}`,
      after: `${n(afterMin)}–${n(afterMax)} ${field.unit}`,
    });
  }

  const beforeExercise = exerciseSummary(before);
  const afterExercise = exerciseSummary(after);
  if (beforeExercise !== afterExercise) {
    rows.push({ labelEn: "Exercise plan", labelHe: "תכנית פעילות", before: beforeExercise, after: afterExercise });
  }

  const beforeHabits = habitsSummary(before);
  const afterHabits = habitsSummary(after);
  if (beforeHabits !== afterHabits) {
    rows.push({
      labelEn: "Habits",
      labelHe: "הרגלים",
      before: tr(locale, `${before.habitsDo.length + before.habitsDont.length} habits`, `${before.habitsDo.length + before.habitsDont.length} הרגלים`),
      after: tr(locale, `${after.habitsDo.length + after.habitsDont.length} habits (changed)`, `${after.habitsDo.length + after.habitsDont.length} הרגלים (השתנו)`),
    });
  }

  if (before.goalType !== after.goalType) {
    rows.push({ labelEn: "Goal type", labelHe: "סוג מטרה", before: before.goalType, after: after.goalType });
  }
  if (before.targetWeightKg !== after.targetWeightKg) {
    rows.push({
      labelEn: "Target weight",
      labelHe: "משקל יעד",
      before: before.targetWeightKg === null ? tr(locale, "None", "ללא") : `${n(before.targetWeightKg)} kg`,
      after: after.targetWeightKg === null ? tr(locale, "None", "ללא") : `${n(after.targetWeightKg)} kg`,
    });
  }
  if (before.durationDays !== after.durationDays) {
    rows.push({
      labelEn: "Duration",
      labelHe: "משך",
      before: before.durationDays === null ? tr(locale, "None", "ללא") : `${before.durationDays} ${tr(locale, "days", "ימים")}`,
      after: after.durationDays === null ? tr(locale, "None", "ללא") : `${after.durationDays} ${tr(locale, "days", "ימים")}`,
    });
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
  const diffRows = mode === "adjust" && pendingPreview && currentPayload ? computeTargetsDiff(currentPayload, pendingPreview.payload, locale) : [];
  const isAdjustWithNoChanges = mode === "adjust" && Boolean(pendingPreview) && Boolean(currentPayload) && diffRows.length === 0;

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

            {mode === "adjust" && pendingPreview ? (
              diffRows.length ? (
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
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {tr(
                    locale,
                    "This recalculation didn't change anything measurable in your targets — nothing new to lock in.",
                    "החישוב מחדש לא שינה דבר מדיד ביעדים שלך — אין מה לנעול מחדש.",
                  )}
                </p>
              )
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

                <LockSubmitButton locale={locale} disabled={isAdjustWithNoChanges} />
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
