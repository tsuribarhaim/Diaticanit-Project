"use client";

import { useState } from "react";

import { GuardedLink } from "@/components/unsaved-preview-context";
import { formatExerciseModality, formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import { getNutrientReference } from "@/lib/nutrient-reference";
import type { TargetGenerationPayload } from "@/lib/targets";

type MetricRow = { id: string; min: number; max: number };

type TabId = "history" | "explained" | "primary" | "exercise" | "suggestions";

export type TargetsHistoryInfo = {
  rawGoalText: string;
  lockedAtLabel: string;
  analysisSource: "ai" | "heuristic";
};

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

/**
 * The underlying min/max range is still generated and stored in full (and
 * shown here on hover) - but a range reads as two numbers to hit, which is
 * one too many for an at-a-glance daily target. A single representative
 * value is more correct only when it's derived the right way per metric:
 * - added_sugar and sat_fat are always generated with min=0 by design (see
 *   generateHeuristicTargetProfile/the AI prompt's DRI-style rules) -
 *   they're pure ceilings ("stay under"), not a band to aim for the middle
 *   of, so the max is shown as a limit rather than averaging it with 0.
 * - Every other metric has a genuine, meaningful non-zero floor (e.g.
 *   fiber's 28g minimum, sodium's 1200-1500mg baseline), so the midpoint is
 *   a fair single "aim for this" number.
 */
function singleTargetValue(row: MetricRow, locale: AppLocale): string {
  const unitLabel = formatMeasurementUnit(getNutrientReference(row.id)?.unit ?? "", locale);

  if (row.min === 0) {
    return `${tr(locale, "Up to", "עד")} ${formatNumberForLocale(row.max, locale, { maximumFractionDigits: 1 })} ${unitLabel}`;
  }

  const midpoint = (row.min + row.max) / 2;
  return `${formatNumberForLocale(midpoint, locale, { maximumFractionDigits: 1 })} ${unitLabel}`;
}

function MetricRowView({ row, locale }: { row: MetricRow; locale: AppLocale }) {
  const reference = getNutrientReference(row.id);
  if (!reference) return null;

  const unitLabel = formatMeasurementUnit(reference.unit, locale);
  const fullRangeText = `${formatNumberForLocale(row.min, locale, { maximumFractionDigits: 1 })}–${formatNumberForLocale(row.max, locale, { maximumFractionDigits: 1 })} ${unitLabel}`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">{reference.nameLabel[locale]}</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">{singleTargetValue(row, locale)}</p>
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
          <p className="font-semibold text-amber-900">{tr(locale, "Full daily range", "טווח יומי מלא")}</p>
          <p className="mt-1">{fullRangeText}</p>
          <p className="mt-2 font-semibold text-amber-900">{tr(locale, "Role", "תפקיד")}</p>
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
        active ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Section-tabs presentation for a targets payload: a single row of toggle
 * buttons and one shared detail panel below them (internal scroll, fixed
 * max height) so opening a section never pushes the chat panel further and
 * further down the page. Clicking the active tab again closes the panel,
 * leaving just the tab row. Warnings (profile discrepancy) and the risk
 * badge stay outside the tab system since they're safety-relevant and
 * shouldn't require a click to notice.
 */
export function TargetsSectionTabs({
  payload,
  locale,
  maintenanceCalories,
  firstName,
  history,
}: {
  payload: TargetGenerationPayload;
  locale: AppLocale;
  maintenanceCalories: number;
  firstName?: string | null;
  history?: TargetsHistoryInfo | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId | null>(null);

  const riskAlert = evaluateEnergyImbalanceRisk({ payload, maintenanceCalories, locale });
  const userTargetsTitle = firstName
    ? tr(locale, `${firstName}'s Targets`, `היעדים של ${firstName}`)
    : tr(locale, "User Targets", "יעדי המשתמש");
  const additionalSuggestionsTitle = firstName
    ? tr(locale, `Additional Suggestions for ${firstName}`, `הצעות נוספות עבור ${firstName}`)
    : tr(locale, "Additional Suggestions", "הצעות נוספות");

  const tabs: { id: TabId; label: string }[] = [
    ...(history ? [{ id: "history" as const, label: tr(locale, "Targets History", "היסטוריית יעדים") }] : []),
    ...(payload.aiRationaleExplanation
      ? [{ id: "explained" as const, label: tr(locale, "Targets Explained", "הסבר על היעדים") }]
      : []),
    { id: "primary" as const, label: tr(locale, "Primary Targets", "יעדים עיקריים") },
    { id: "exercise" as const, label: tr(locale, "Exercise Plan", "תכנית פעילות") },
    { id: "suggestions" as const, label: tr(locale, "Suggestions", "הצעות") },
  ];

  function toggleTab(id: TabId) {
    setActiveTab((previous) => (previous === id ? null : id));
  }

  return (
    <div className="space-y-4">
      {payload.profileDiscrepancyMessage ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">{tr(locale, "Discrepancy noticed", "אי-התאמה שזוהתה")}</p>
          <p className="mt-1">{payload.profileDiscrepancyMessage}</p>
          <GuardedLink
            href="/app/profile/edit"
            confirmMessage={tr(
              locale,
              "You have an unsaved conversation or generated target plan on the Targets page that hasn't been locked in yet. Leave this page anyway?",
              "יש לך שיחה או תכנית יעדים שנוצרה בדף היעדים שטרם ננעלה. לעזוב את הדף בכל זאת?",
            )}
            className="mt-2 inline-block font-semibold text-amber-900 underline hover:text-amber-700"
          >
            {tr(locale, "Update your profile", "עדכון הפרופיל שלך")}
          </GuardedLink>
        </div>
      ) : null}

      <div
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${alertBadgeClasses(riskAlert.type)}`}
      >
        <span aria-hidden="true">{riskAlert.type === "risk" ? "⚠" : "✓"}</span>
        <span>{riskAlert.text}</span>
      </div>

      <div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={tr(locale, "Target details", "פרטי היעדים")}>
          {tabs.map((tab) => (
            <TabButton key={tab.id} active={activeTab === tab.id} onClick={() => toggleTab(tab.id)}>
              {tab.label}
            </TabButton>
          ))}
        </div>

        {activeTab ? (
          <div className="mt-3 max-h-[420px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
            {activeTab === "history" && history ? (
              <div className="text-sm text-slate-700">
                <p>
                  <span className="font-semibold text-slate-900">{tr(locale, "Original request", "בקשה מקורית")}:</span>{" "}
                  <span className="italic text-slate-600">{history.rawGoalText}</span>
                </p>
                <p className="mt-1">
                  <span className="font-semibold text-slate-900">{tr(locale, "Locked at", "ננעל בתאריך")}:</span>{" "}
                  {history.lockedAtLabel}
                </p>
                <p className="mt-1">
                  <span className="font-semibold text-slate-900">{tr(locale, "Analysis source", "מקור ניתוח")}:</span>{" "}
                  {history.analysisSource === "ai" ? "AI" : tr(locale, "Heuristic", "יוריסטי")}
                </p>
              </div>
            ) : null}

            {activeTab === "explained" ? <p className="text-sm text-slate-700">{payload.aiRationaleExplanation}</p> : null}

            {activeTab === "primary" ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {metricRowsFromPayload(payload, primaryMetricIds).map((row) => (
                    <MetricRowView key={row.id} row={row} locale={locale} />
                  ))}
                </div>

                <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-teal-700">
                    {tr(locale, "View Full Micronutrients Breakdown", "הצגת פירוט מלא של מיקרו-נוטריאנטים")}
                  </summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {metricRowsFromPayload(payload, secondaryMetricIds).map((row) => (
                      <MetricRowView key={row.id} row={row} locale={locale} />
                    ))}
                  </div>
                </details>

                {payload.userTargets.length ? (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{userTargetsTitle}</h3>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {payload.userTargets.map((entry, index) => {
                        const isTracked =
                          Boolean(entry.unit) && entry.targetMin !== undefined && entry.targetMax !== undefined;
                        const rangeText = isTracked
                          ? entry.targetMin === entry.targetMax
                            ? `${formatNumberForLocale(entry.targetMin!, locale, { maximumFractionDigits: 1 })} ${entry.unit}`
                            : `${formatNumberForLocale(entry.targetMin!, locale, { maximumFractionDigits: 1 })}–${formatNumberForLocale(entry.targetMax!, locale, { maximumFractionDigits: 1 })} ${entry.unit}`
                          : entry.value;

                        return (
                          <div
                            key={`${entry.id ?? entry.label}-${index}`}
                            className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-3"
                          >
                            <div>
                              <p className="text-sm font-medium text-teal-900">{entry.label}</p>
                              {isTracked ? (
                                <p className="mt-0.5 text-xs text-teal-700">
                                  {tr(locale, "Tracked in your Daily Report", "נעקב בדיווח היומי שלך")}
                                </p>
                              ) : null}
                            </div>
                            <p className="text-sm font-semibold text-teal-900">{rangeText}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === "exercise" ? (
              payload.exerciseTargets.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
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
                <p className="text-sm text-slate-600">{tr(locale, "No exercise plan entries yet.", "עדיין אין פריטי תכנית פעילות.")}</p>
              )
            ) : null}

            {activeTab === "suggestions" ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{additionalSuggestionsTitle}</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">{tr(locale, "Do", "לעשות")}</h4>
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
                    <h4 className="text-sm font-semibold uppercase tracking-wide text-rose-700">{tr(locale, "Don't do", "להימנע")}</h4>
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
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
