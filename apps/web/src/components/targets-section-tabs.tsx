"use client";

import { useState, useTransition } from "react";

import { DailyReportProgressRings } from "@/components/daily-report-progress-rings";
import { GuardedLink } from "@/components/unsaved-preview-context";
import { InfoPopoverButton } from "@/components/info-popover";
import { LocalDateTime } from "@/components/local-time";
import { RangeSelector } from "@/components/range-selector";
import { Spinner } from "@/components/spinner";
import type { HomeOverviewData, HomeRange } from "@/lib/home-overview";
import { formatExerciseModality, formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import { getNutrientReference } from "@/lib/nutrient-reference";
import type { TargetGenerationPayload } from "@/lib/targets";

type MetricRow = { id: string; min: number; max: number };

type TabId = "overview" | "nutrients" | "exercise" | "suggestions" | "information";

export type TargetsHistoryInfo = {
  rawGoalText: string;
  /** Raw timestamp, not a pre-formatted string - formatted at render time
   * below via LocalDateTime, so it shows in the visitor's own timezone
   * instead of whatever timezone the server happened to render in (see
   * local-time.tsx's own comment on why that distinction matters). */
  lockedAt: string;
  analysisSource: "ai" | "heuristic";
};

function alertBadgeClasses(type: "good" | "warning" | "risk"): string {
  if (type === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400";
  if (type === "warning") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400";
  return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400";
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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{reference.nameLabel[locale]}</p>
        <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{singleTargetValue(row, locale)}</p>
      </div>
      <InfoPopoverButton
        ariaLabel={tr(locale, "More information", "מידע נוסף")}
        title={reference.nameLabel[locale]}
        triggerClassName="flex h-7 w-7 cursor-help items-center justify-center rounded-full border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        panelWidthClassName="sm:w-64"
      >
        <p className="font-semibold text-amber-900 dark:text-amber-400">{tr(locale, "Full daily range", "טווח יומי מלא")}</p>
        <p className="mt-1">{fullRangeText}</p>
        <p className="mt-2 font-semibold text-amber-900 dark:text-amber-400">{tr(locale, "Role", "תפקיד")}</p>
        <p className="mt-1">{reference.roleDescription[locale]}</p>
        <p className="mt-2 font-semibold text-amber-900 dark:text-amber-400">{tr(locale, "Food examples", "דוגמאות מזון")}</p>
        <p className="mt-1">{reference.foodExamples[locale]}</p>
      </InfoPopoverButton>
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
  "cholesterol",
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
    cholesterol: { id: "cholesterol", min: payload.cholesterolMinMg, max: payload.cholesterolMaxMg },
  };

  return ids.map((id) => byId[id]);
}

function TabButton({
  active,
  pending,
  onClick,
  children,
}: {
  active: boolean;
  /** True while this specific tab's content is being rendered inside a
   * startTransition (see TargetsSectionTabs' own selectTab) - shows a
   * spinner in place of the label so a tap always gets an immediate visual
   * acknowledgment, the same concern the range selector's own per-link
   * pending state addresses for the Today/7/30/90 switcher. */
  pending?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "border-teal-700 bg-teal-700 text-white dark:border-teal-600 dark:bg-teal-600"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {pending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

/**
 * The Overview view - the exact same Progress rings/duration selector,
 * Weekly Exercise Consistency, and AI Coach narrative the Home page shows,
 * reusing lib/home-overview.ts's shared data-fetching so both pages render
 * from the same computation (see that file's own comment). The duration
 * selector is a plain Link to `?range=...` (a full page reload), the same
 * mechanism Home already uses - simpler and far cheaper than fetching all
 * four ranges' worth of data (including a real AI Coach call) on every
 * single page load just to allow a client-side toggle.
 */
function OverviewView({ locale, range, overview }: { locale: AppLocale; range: HomeRange; overview: HomeOverviewData }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {range === "today" ? tr(locale, "Today's Progress", "ההתקדמות של היום") : tr(locale, "Your Progress", "ההתקדמות שלך")}
          </p>
          <RangeSelector locale={locale} range={range} basePath="/app/targets" size="sm" />
        </div>
        <div className="mt-4">
          <DailyReportProgressRings locale={locale} metrics={overview.ringMetrics} />
          {overview.loggedDaysCaption ? <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{overview.loggedDaysCaption}</p> : null}
          {overview.confidenceCaption ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{overview.confidenceCaption}</p> : null}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{overview.exerciseHeading}</p>
        {overview.exerciseTargetAmount > 0 ? (
          <div className="mt-4">
            <DailyReportProgressRings locale={locale} metrics={[overview.exerciseRingMetric]} />
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{overview.exerciseCaption}</p>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {tr(locale, "No exercise target set in your plan.", "לא הוגדר יעד פעילות בתכנית שלך.")}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "✨ AI Coach", "✨ מאמן AI")}</p>
        {overview.coachNarrative ? (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">{overview.coachNarrative}</p>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {!overview.aiCoachConfigured
              ? tr(locale, "AI Coach is not available in this environment.", "מאמן ה-AI אינו זמין בסביבה זו.")
              : tr(locale, "The AI Coach couldn't generate a summary right now. Try again later.", "מאמן ה-AI לא הצליח ליצור סיכום כרגע. נסו שוב מאוחר יותר.")}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Overview/Nutrients/Exercise nav pills plus a "…" menu for Suggestions and
 * Information (Targets History + Targets Explained, combined into one
 * view) - keeps the always-visible pill row to three plus the menu trigger,
 * short enough to never need its own horizontal scrollbar on a phone.
 * Overview is the default landing view. Warnings (profile discrepancy) and
 * the risk badge stay outside the tab system, above the nav, since they're
 * safety-relevant and shouldn't require a click to notice.
 */
export function TargetsSectionTabs({
  payload,
  locale,
  maintenanceCalories,
  firstName,
  history,
  overview,
  range,
}: {
  payload: TargetGenerationPayload;
  locale: AppLocale;
  maintenanceCalories: number;
  firstName?: string | null;
  history?: TargetsHistoryInfo | null;
  /** Only provided by the AI-chat-enabled experience (TargetsChatWorkspace)
   * - the no-AI-consent fallback page (TargetsWorkspace) doesn't fetch this
   * data at all, so the Overview pill/view simply isn't offered there and
   * this defaults straight to Nutrients instead. Not a permanent gap - see
   * this app's own decision to redesign the AI-enabled experience first and
   * revisit the fallback page separately. */
  overview?: HomeOverviewData;
  range?: HomeRange;
}) {
  const [activeTab, setActiveTab] = useState<TabId>(overview ? "overview" : "nutrients");
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  // startTransition here isn't about slow async work (every tab's content is
  // already in hand via props/local state) - it gives an immediate, guaranteed
  // pending signal for the one render frame the switch takes, so a tap always
  // gets visible feedback instead of leaving the user unsure it registered,
  // even though the switch itself is normally instant.
  const [isTabPending, startTabTransition] = useTransition();
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);

  const riskAlert = evaluateEnergyImbalanceRisk({ payload, maintenanceCalories, locale });
  const userTargetsTitle = firstName
    ? tr(locale, `${firstName}'s Targets`, `היעדים של ${firstName}`)
    : tr(locale, "User Targets", "יעדי המשתמש");
  const additionalSuggestionsTitle = firstName
    ? tr(locale, `Additional Suggestions for ${firstName}`, `הצעות נוספות עבור ${firstName}`)
    : tr(locale, "Additional Suggestions", "הצעות נוספות");

  const isMoreActive = activeTab === "suggestions" || activeTab === "information";

  function selectTab(id: TabId) {
    setPendingTab(id);
    startTabTransition(() => {
      setActiveTab(id);
    });
  }

  function selectFromMoreMenu(id: "suggestions" | "information") {
    selectTab(id);
    setIsMoreMenuOpen(false);
  }

  return (
    <div className="space-y-4">
      {payload.profileDiscrepancyMessage ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-semibold">{tr(locale, "Discrepancy noticed", "אי-התאמה שזוהתה")}</p>
          <p className="mt-1">{payload.profileDiscrepancyMessage}</p>
          <GuardedLink
            href="/app/profile/edit"
            confirmMessage={tr(
              locale,
              "You have an unsaved conversation or generated target plan on the Targets page that hasn't been locked in yet. Leave this page anyway?",
              "יש לך שיחה או תכנית יעדים שנוצרה בדף היעדים שטרם ננעלה. לעזוב את הדף בכל זאת?",
            )}
            className="mt-2 inline-block font-semibold text-amber-900 underline hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-400"
          >
            {tr(locale, "Update your profile", "עדכון הפרופיל שלך")}
          </GuardedLink>
        </div>
      ) : null}

      <div className="flex justify-center">
        <div
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${alertBadgeClasses(riskAlert.type)}`}
        >
          <span aria-hidden="true">{riskAlert.type === "risk" ? "⚠" : "✓"}</span>
          <span>{riskAlert.text}</span>
        </div>
      </div>

      {/* The scrollable tab strip and the "more" button+dropdown are
          siblings, not parent/child - a dropdown positioned `absolute`
          inside an `overflow-x-auto` ancestor gets clipped by it (per the
          CSS overflow spec, setting only overflow-x to a non-visible value
          forces the other axis to compute as `auto` too, not `visible`),
          which is why it wasn't appearing at all. Keeping the menu outside
          that scrolling element avoids the clip entirely. */}
      <div className="flex items-center gap-1.5" role="tablist" aria-label={tr(locale, "Target details", "פרטי היעדים")}>
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-1">
          {overview ? (
            <TabButton active={activeTab === "overview"} pending={isTabPending && pendingTab === "overview"} onClick={() => selectTab("overview")}>
              {tr(locale, "Overview", "סקירה")}
            </TabButton>
          ) : null}
          <TabButton active={activeTab === "nutrients"} pending={isTabPending && pendingTab === "nutrients"} onClick={() => selectTab("nutrients")}>
            {tr(locale, "Nutrients", "נוטריאנטים")}
          </TabButton>
          <TabButton active={activeTab === "exercise"} pending={isTabPending && pendingTab === "exercise"} onClick={() => selectTab("exercise")}>
            {tr(locale, "Exercise", "פעילות")}
          </TabButton>
        </div>
        <div className="relative shrink-0">
          <TabButton active={isMoreActive} pending={isTabPending && (pendingTab === "suggestions" || pendingTab === "information")} onClick={() => setIsMoreMenuOpen((previous) => !previous)}>
            {"•••"}
          </TabButton>
          {isMoreMenuOpen ? (
            <>
              <div role="presentation" onClick={() => setIsMoreMenuOpen(false)} className="fixed inset-0 z-30" />
              <div className="absolute end-0 top-full z-40 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => selectFromMoreMenu("suggestions")}
                  className="w-full rounded-lg px-3 py-2 text-start text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {tr(locale, "Suggestions", "הצעות")}
                </button>
                <button
                  type="button"
                  onClick={() => selectFromMoreMenu("information")}
                  className="w-full rounded-lg px-3 py-2 text-start text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {tr(locale, "Information", "מידע")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div>
        {activeTab === "overview" && overview && range ? <OverviewView locale={locale} range={range} overview={overview} /> : null}

        {activeTab === "nutrients" ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {metricRowsFromPayload(payload, primaryMetricIds).map((row) => (
                <MetricRowView key={row.id} row={row} locale={locale} />
              ))}
            </div>

            <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
              <summary className="cursor-pointer text-xs font-semibold text-teal-700 dark:text-teal-400">
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
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{userTargetsTitle}</h3>
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
                        className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-3 dark:border-teal-800 dark:bg-teal-950/30"
                      >
                        <div>
                          <p className="text-sm font-medium text-teal-900 dark:text-teal-300">{entry.label}</p>
                          {isTracked ? (
                            <p className="mt-0.5 text-xs text-teal-700 dark:text-teal-400">
                              {tr(locale, "Tracked in your Daily Report", "נעקב בדיווח היומי שלך")}
                            </p>
                          ) : null}
                        </div>
                        <p className="text-sm font-semibold text-teal-900 dark:text-teal-300">{rangeText}</p>
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
                <div key={`${entry.modality}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{formatExerciseModality(entry.modality, locale)}</p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                    {tr(locale, "Frequency", "תדירות")}: {entry.frequencyPerWeek} {tr(locale, "times/week", "פעמים בשבוע")}
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {tr(locale, "Duration", "משך")}: {entry.durationMinutesPerSession} {formatMeasurementUnit("minutes", locale)}
                  </p>
                  {entry.aiAdjustmentNote ? <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{entry.aiAdjustmentNote}</p> : null}
                  {entry.searchKeywords.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {entry.searchKeywords.map((keywords) => (
                        <a
                          key={keywords}
                          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(keywords)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400 dark:hover:bg-sky-950/50"
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
            <p className="text-sm text-slate-600 dark:text-slate-400">{tr(locale, "No exercise plan entries yet.", "עדיין אין פריטי תכנית פעילות.")}</p>
          )
        ) : null}

        {activeTab === "suggestions" ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{additionalSuggestionsTitle}</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{tr(locale, "Do", "לעשות")}</h4>
                <div className="mt-3 space-y-3">
                  {payload.habitsDo.map((habit) => (
                    <div key={habit.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                      <p className="text-sm font-medium text-emerald-900 dark:text-emerald-300">{habit.habitInstruction}</p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-emerald-700 dark:text-emerald-400">{tr(locale, "Why?", "למה?")}</summary>
                        <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-400">{habit.rationale}</p>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">{tr(locale, "Don't do", "להימנע")}</h4>
                <div className="mt-3 space-y-3">
                  {payload.habitsDont.map((habit) => (
                    <div key={habit.id} className="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/30">
                      <p className="text-sm font-medium text-rose-900 dark:text-rose-300">{habit.habitInstruction}</p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-rose-700 dark:text-rose-400">{tr(locale, "Why?", "למה?")}</summary>
                        <p className="mt-1 text-xs text-rose-800 dark:text-rose-400">{habit.rationale}</p>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "information" ? (
          <div className="space-y-4">
            {history ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Targets History", "היסטוריית יעדים")}</h3>
                <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                  <p>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Original request", "בקשה מקורית")}:</span>{" "}
                    <span className="italic text-slate-600 dark:text-slate-400">{history.rawGoalText}</span>
                  </p>
                  <p className="mt-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Locked at", "ננעל בתאריך")}:</span>{" "}
                    <LocalDateTime value={history.lockedAt} locale={locale} />
                  </p>
                  <p className="mt-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Analysis source", "מקור ניתוח")}:</span>{" "}
                    {history.analysisSource === "ai" ? "AI" : tr(locale, "Heuristic", "יוריסטי")}
                  </p>
                </div>
              </div>
            ) : null}

            {payload.aiRationaleExplanation ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Targets Explained", "הסבר על היעדים")}</h3>
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{payload.aiRationaleExplanation}</p>
              </div>
            ) : null}

            {!history && !payload.aiRationaleExplanation ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">{tr(locale, "Nothing here yet.", "אין כאן עדיין דבר.")}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
