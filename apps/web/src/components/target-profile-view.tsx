import { formatExerciseModality, formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import { getNutrientReference } from "@/lib/nutrient-reference";
import type { TargetGenerationPayload } from "@/lib/targets";

type MetricRow = { id: string; min: number; max: number };

function alertBadgeClasses(type: "good" | "warning" | "risk"): string {
  if (type === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (type === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

/**
 * Simple, explicitly-documented risk heuristic for Phase 1 (no daily-log
 * driven progress bars yet, per the design brief). Flags the specific
 * known-risky combination: no planned exercise at all, while calories are
 * not reduced below a reasonable maintenance-level estimate.
 */
function evaluateEnergyImbalanceRisk({
  payload,
  maintenanceCalories,
  locale,
}: {
  payload: TargetGenerationPayload;
  maintenanceCalories: number;
  locale: AppLocale;
}): { type: "good" | "risk"; text: string } {
  const totalWeeklyExerciseFrequency = payload.exerciseTargets.reduce((sum, entry) => sum + entry.frequencyPerWeek, 0);
  const noPlannedExercise = totalWeeklyExerciseFrequency <= 0;
  const caloriesNotReduced = payload.caloriesMax >= maintenanceCalories;

  if (noPlannedExercise && caloriesNotReduced) {
    return {
      type: "risk",
      text: tr(
        locale,
        "Lowering your training frequency while maintaining your current calorie baseline creates an energy imbalance, risking unwanted fat gain.",
        "הפחתת תדירות האימונים תוך שמירה על בסיס הקלוריות הנוכחי יוצרת חוסר איזון אנרגטי, העלול להוביל לעלייה לא רצויה בשומן.",
      ),
    };
  }

  return {
    type: "good",
    text: tr(locale, "This plan's exercise and calorie ranges look balanced together.", "טווחי הפעילות והקלוריות בתכנית זו נראים מאוזנים יחד."),
  };
}

function MetricRowView({ row, locale }: { row: MetricRow; locale: AppLocale }) {
  const reference = getNutrientReference(row.id);
  if (!reference) return null;

  const unitLabel = formatMeasurementUnit(reference.unit, locale);
  const rangeText = `${formatNumberForLocale(row.min, locale, { maximumFractionDigits: 1 })}–${formatNumberForLocale(row.max, locale, { maximumFractionDigits: 1 })} ${unitLabel}`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">{reference.nameLabel[locale]}</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">{rangeText}</p>
      </div>
      <div className="group relative">
        <span
          tabIndex={0}
          role="button"
          aria-label={tr(locale, "More information", "מידע נוסף")}
          className="flex h-7 w-7 cursor-help items-center justify-center rounded-full border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          ?
        </span>
        <div className="invisible absolute end-0 z-10 mt-2 w-64 rounded-xl border border-amber-300 bg-amber-50 p-3 text-start text-xs text-amber-900 opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          <p className="font-semibold text-amber-900">{tr(locale, "Role", "תפקיד")}</p>
          <p className="mt-1">{reference.roleDescription[locale]}</p>
          <p className="mt-2 font-semibold text-amber-900">{tr(locale, "Food examples", "דוגמאות מזון")}</p>
          <p className="mt-1">{reference.foodExamples[locale]}</p>
        </div>
      </div>
    </div>
  );
}

const primaryMetricIds = ["calories", "protein", "carbs", "fats", "fiber", "sodium", "added_sugar", "water"];
const secondaryMetricIds = [
  "potassium",
  "magnesium",
  "calcium",
  "iron",
  "zinc",
  "vit_c",
  "vit_b12",
  "vit_d",
  "sat_fat",
  "omega3",
];

function metricRowsFromPayload(payload: TargetGenerationPayload, ids: string[]): MetricRow[] {
  const byId: Record<string, MetricRow> = {
    calories: { id: "calories", min: payload.caloriesMin, max: payload.caloriesMax },
    protein: { id: "protein", min: payload.proteinMinG, max: payload.proteinMaxG },
    carbs: { id: "carbs", min: payload.carbsMinG, max: payload.carbsMaxG },
    fats: { id: "fats", min: payload.fatsMinG, max: payload.fatsMaxG },
    fiber: { id: "fiber", min: payload.fiberMinG, max: payload.fiberMaxG },
    sodium: { id: "sodium", min: payload.sodiumMinMg, max: payload.sodiumMaxMg },
    added_sugar: { id: "added_sugar", min: payload.addedSugarMinG, max: payload.addedSugarMaxG },
    water: { id: "water", min: payload.waterMinMl, max: payload.waterMaxMl },
    potassium: { id: "potassium", min: payload.potassiumMinMg, max: payload.potassiumMaxMg },
    magnesium: { id: "magnesium", min: payload.magnesiumMinMg, max: payload.magnesiumMaxMg },
    calcium: { id: "calcium", min: payload.calciumMinMg, max: payload.calciumMaxMg },
    iron: { id: "iron", min: payload.ironMinMg, max: payload.ironMaxMg },
    zinc: { id: "zinc", min: payload.zincMinMg, max: payload.zincMaxMg },
    vit_c: { id: "vit_c", min: payload.vitCMinMg, max: payload.vitCMaxMg },
    vit_b12: { id: "vit_b12", min: payload.vitB12MinMcg, max: payload.vitB12MaxMcg },
    vit_d: { id: "vit_d", min: payload.vitDMinMcg, max: payload.vitDMaxMcg },
    sat_fat: { id: "sat_fat", min: payload.satFatMinG, max: payload.satFatMaxG },
    omega3: { id: "omega3", min: payload.omega3MinG, max: payload.omega3MaxG },
  };

  return ids.map((id) => byId[id]);
}

export function TargetProfileView({
  payload,
  locale,
  maintenanceCalories,
  firstName,
}: {
  payload: TargetGenerationPayload;
  locale: AppLocale;
  maintenanceCalories: number;
  firstName?: string | null;
}) {
  const riskAlert = evaluateEnergyImbalanceRisk({ payload, maintenanceCalories, locale });
  const userTargetsTitle = firstName
    ? tr(locale, `${firstName}'s Targets`, `היעדים של ${firstName}`)
    : tr(locale, "User Targets", "יעדי המשתמש");
  const additionalSuggestionsTitle = firstName
    ? tr(locale, `Additional Suggestions for ${firstName}`, `הצעות נוספות עבור ${firstName}`)
    : tr(locale, "Additional Suggestions", "הצעות נוספות");

  return (
    <div className="space-y-6">
      {payload.aiRationaleExplanation ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
          <p className="font-semibold">{tr(locale, "Description", "הסבר")}</p>
          <p className="mt-1">{payload.aiRationaleExplanation}</p>
        </div>
      ) : null}

      <div className={`rounded-xl border p-4 text-sm ${alertBadgeClasses(riskAlert.type)}`}>{riskAlert.text}</div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {tr(locale, "Primary targets", "יעדים עיקריים")}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {metricRowsFromPayload(payload, primaryMetricIds).map((row) => (
            <MetricRowView key={row.id} row={row} locale={locale} />
          ))}
        </div>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-teal-700">
          {tr(locale, "View Full Micronutrients Breakdown", "הצגת פירוט מלא של מיקרו-נוטריאנטים")}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {metricRowsFromPayload(payload, secondaryMetricIds).map((row) => (
            <MetricRowView key={row.id} row={row} locale={locale} />
          ))}
        </div>
      </details>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tr(locale, "Exercise plan", "תכנית פעילות")}</h3>
        {payload.exerciseTargets.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {payload.exerciseTargets.map((entry, index) => (
              <div key={`${entry.modality}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-semibold text-slate-900">{formatExerciseModality(entry.modality, locale)}</p>
                <p className="mt-1 text-sm text-slate-700">
                  {tr(locale, "Frequency", "תדירות")}: {entry.frequencyPerWeek} {tr(locale, "times/week", "פעמים בשבוע")}
                </p>
                <p className="text-sm text-slate-700">
                  {tr(locale, "Duration", "משך")}: {entry.durationMinutesPerSession} {formatMeasurementUnit("minutes", locale)}
                </p>
                {entry.aiAdjustmentNote ? <p className="mt-2 text-xs text-slate-600">{entry.aiAdjustmentNote}</p> : null}
                {entry.searchKeywords.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.searchKeywords.map((keywords) => (
                      <a
                        key={keywords}
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(keywords)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
                      >
                        {"🔍 "}
                        {tr(locale, "Search", "חיפוש")}: {keywords}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">{tr(locale, "No exercise plan entries yet.", "עדיין אין פריטי תכנית פעילות.")}</p>
        )}
      </div>

      {payload.userTargets.length ? (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{userTargetsTitle}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {payload.userTargets.map((entry, index) => (
              <div
                key={`${entry.label}-${index}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-3"
              >
                <p className="text-sm font-medium text-teal-900">{entry.label}</p>
                <p className="text-sm font-semibold text-teal-900">{entry.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-teal-700">{additionalSuggestionsTitle}</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">{tr(locale, "Do", "לעשות")}</h3>
            <div className="mt-3 space-y-3">
              {payload.habitsDo.map((habit) => (
                <div key={habit.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm font-medium text-emerald-900">{habit.habitInstruction}</p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-emerald-700">{tr(locale, "Why?", "למה?")}</summary>
                    <p className="mt-1 text-xs text-emerald-800">{habit.rationale}</p>
                  </details>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-rose-700">{tr(locale, "Don't do", "להימנע")}</h3>
            <div className="mt-3 space-y-3">
              {payload.habitsDont.map((habit) => (
                <div key={habit.id} className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-sm font-medium text-rose-900">{habit.habitInstruction}</p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-rose-700">{tr(locale, "Why?", "למה?")}</summary>
                    <p className="mt-1 text-xs text-rose-800">{habit.rationale}</p>
                  </details>
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
