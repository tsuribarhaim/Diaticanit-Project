import { formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";
import { NUTRIENT_DIFF_FIELDS } from "@/lib/targets-diff";

/** The order requested for the review table - NUTRIENT_DIFF_FIELDS itself
 * (lib/targets-diff.ts) is in a different, older order used for diffing
 * elsewhere, where order doesn't matter; this re-sorts it by label rather
 * than duplicating the field/unit mapping a second time. */
const NUTRIENT_DISPLAY_ORDER = [
  "Calories",
  "Cholesterol",
  "Protein",
  "Fats",
  "Saturated Fat",
  "Dietary Fiber",
  "Added Sugars",
  "Magnesium",
  "Calcium",
  "Iron",
  "Carbohydrates",
  "Sodium",
  "Fluid / Water",
  "Potassium",
  "Zinc",
  "Vitamin C",
  "Vitamin B12",
  "Vitamin D",
  "Omega-3",
];

export const ORDERED_NUTRIENT_FIELDS = NUTRIENT_DISPLAY_ORDER.map((label) =>
  NUTRIENT_DIFF_FIELDS.find((field) => field.labelEn === label),
).filter((field): field is (typeof NUTRIENT_DIFF_FIELDS)[number] => field != null);

/**
 * The read-only "here's the plan" display - standing targets (weight/sleep/
 * steps), the nutrient table, any other custom targets, and the suggested
 * exercise plan. Shared by the onboarding Targets step (a not-yet-locked
 * preview) and the standalone /app/targets page (the live, locked-in plan) -
 * both show the exact same shape of data, just sourced differently and
 * wrapped in different surrounding chrome (a "Complete onboarding" button
 * on one, inline editing on the other).
 */
export function TargetsPlanView({ payload, locale }: { payload: TargetGenerationPayload; locale: AppLocale }) {
  const weightEntry = payload.userTargets.find((entry) => entry.id === "target_weight");
  const sleepEntry = payload.userTargets.find((entry) => entry.id === "sleep_hours");
  const stepsEntry = payload.userTargets.find((entry) => entry.id === "daily_steps");
  const otherEntries = payload.userTargets.filter(
    (entry) => entry.id !== "target_weight" && entry.id !== "sleep_hours" && entry.id !== "daily_steps",
  );
  const standingEntries = [weightEntry, sleepEntry, stepsEntry].filter((entry): entry is NonNullable<typeof entry> => entry != null);

  return (
    <div className="space-y-5">
      {standingEntries.length > 0 ? (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {standingEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl border border-teal-200 bg-teal-50 p-3 dark:border-teal-800 dark:bg-teal-950/30"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-300">{entry.label}</p>
              <p className="mt-1 text-lg font-bold text-teal-900 dark:text-teal-200">{entry.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {tr(locale, "Daily nutrition targets", "יעדי תזונה יומיים")}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th className="px-4 py-2">{tr(locale, "Nutrient", "רכיב תזונתי")}</th>
              <th className="px-4 py-2 text-end">{tr(locale, "Target", "יעד")}</th>
            </tr>
          </thead>
          <tbody>
            {ORDERED_NUTRIENT_FIELDS.map((field) => {
              const min = payload[field.minKey] as number;
              const max = payload[field.maxKey] as number;
              const singleValue = Math.round((min + max) / 2);
              return (
                <tr key={field.labelEn} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">{tr(locale, field.labelEn, field.labelHe)}</td>
                  <td className="px-4 py-2 text-end font-bold text-teal-800 dark:text-teal-300">
                    {formatNumberForLocale(singleValue, locale)}{" "}
                    <span className="text-xs font-normal text-slate-500">{formatMeasurementUnit(field.unit, locale)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {otherEntries.length > 0 ? (
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {tr(locale, "Also tracking", "עוקבים גם אחרי")}
          </p>
          <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            {otherEntries.map((entry) => (
              <p key={entry.id ?? entry.label}>
                <span className="font-medium">{entry.label}:</span> {entry.value}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {payload.exerciseTargets.length > 0 ? (
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {tr(locale, "Suggested exercise plan", "תכנית פעילות מוצעת")}
          </p>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
            {payload.exerciseTargets.map((entry, index) => (
              <div
                key={`${entry.modality}-${index}`}
                className="flex min-h-[80px] flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60"
              >
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{entry.modality}</p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {entry.frequencyPerWeek}x/{tr(locale, "week", "שבוע")} · {entry.durationMinutesPerSession} {tr(locale, "min", "דק'")}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
