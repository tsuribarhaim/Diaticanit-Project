import type { RingMetric } from "@/components/daily-report-progress-rings";
import { generateHomeCoachNarrative } from "@/lib/ai/home-coach";
import type { AiExtractionConfig } from "@/lib/ai/env";
import {
  getCustomTargetValueTotals,
  getLoggedDaysAverageDailyReportTotals,
  getTodaysDailyReportTotals,
  getWeeklyExerciseSessionDayCount,
} from "@/lib/daily-report";
import { tr, type AppLocale } from "@/lib/locale";
import { normalizeUserTargetsJson } from "@/lib/targets";
import type { createClient } from "@/lib/supabase/server";

/**
 * The "Today's/Your Progress" rings + duration selector, Weekly Exercise
 * Consistency, and AI Coach narrative - originally the Home dashboard's own
 * page, factored out here so the Targets page's new Overview view (see
 * TargetsSectionTabs) can show the exact same thing without duplicating
 * ~300 lines of chart-data computation. Both callers pass their own
 * `activeTargetProfile` row (a superset/subset of the same columns works
 * fine - only the specific fields below are ever read from it) and get back
 * everything their own JSX needs to render, with no rendering logic living
 * in here itself.
 */

export const RANGE_VALUES = ["today", "7", "30", "90"] as const;
export type HomeRange = (typeof RANGE_VALUES)[number];

export function parseRangeParam(value: string | undefined): HomeRange {
  return (RANGE_VALUES as readonly string[]).includes(value ?? "") ? (value as HomeRange) : "today";
}

export const rangeLabels: Record<HomeRange, { en: string; he: string }> = {
  today: { en: "Today", he: "היום" },
  "7": { en: "7 Days", he: "7 ימים" },
  "30": { en: "30 Days", he: "30 יום" },
  "90": { en: "90 Days", he: "90 יום" },
};

/** A period needs at least this share of its days logged before the
 * period's averages are treated as representative rather than a guess
 * extrapolated from a handful of days. */
const REPORTING_CONSISTENCY_THRESHOLD_PERCENT = 80;

export type ActiveTargetProfileForOverview = {
  calories_min: number | string | null;
  calories_max: number | string | null;
  protein_min_g: number | string | null;
  protein_max_g: number | string | null;
  exercise_targets: unknown;
  goal_type: string | null;
  user_targets?: unknown;
} | null;

export type HomeOverviewData = {
  ringMetrics: RingMetric[];
  loggedDaysCaption: string | null;
  confidenceCaption: string | null;
  exerciseRingMetric: RingMetric;
  weeklyExerciseTarget: number;
  weeklyExerciseSessionDays: number;
  coachNarrative: string | null;
  /** Whether the AI provider is configured at all in this environment -
   * distinguishes "AI Coach is not available here" from "it tried and
   * couldn't generate anything this time" in the caller's own empty state. */
  aiCoachConfigured: boolean;
};

export async function getHomeOverviewData({
  supabase,
  userId,
  locale,
  range,
  activeTargetProfile,
  aiConfig,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  locale: AppLocale;
  range: HomeRange;
  activeTargetProfile: ActiveTargetProfileForOverview;
  aiConfig: AiExtractionConfig | null;
}): Promise<HomeOverviewData> {
  // Only entries with a full id/unit/targetMin/targetMax set are loggable -
  // see DailyReportForm's customTargets prop for the matching Daily Report
  // side of this.
  const loggableCustomTargets = normalizeUserTargetsJson(activeTargetProfile?.user_targets).filter(
    (entry) => entry.id && entry.unit && entry.targetMin !== undefined && entry.targetMax !== undefined,
  );

  // Same "sum of each planned modality's frequency" convention already used
  // on the Targets page (see evaluateEnergyImbalanceRisk's
  // totalWeeklyExerciseFrequency) - a plan with walking 3x/week + strength
  // 2x/week has a 5-session weekly target.
  const weeklyExerciseTarget = Array.isArray(activeTargetProfile?.exercise_targets)
    ? activeTargetProfile.exercise_targets.reduce((sum: number, entry: unknown) => {
        const record = (entry ?? {}) as { frequency_per_week?: number | string | null };
        const freq = Number(record.frequency_per_week ?? 0);
        return sum + (Number.isFinite(freq) ? freq : 0);
      }, 0)
    : 0;
  const weeklyExerciseSessionDays = await getWeeklyExerciseSessionDayCount({ supabase, userId });

  let caloriesKcal: number;
  let proteinG: number;
  let estimatedBurnKcal: number;
  let loggedDaysCaption: string | null = null;
  let confidenceCaption: string | null = null;
  let reportingConsistencyRingMetric: RingMetric | null = null;
  let reportingConsistencyPercent: number | null = null;

  let customTargetTotals: Record<string, number> = {};

  if (range === "today") {
    const now = new Date();
    const todayStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const todayEndIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

    const todaysTotals = await getTodaysDailyReportTotals({ supabase, userId });
    caloriesKcal = todaysTotals.caloriesKcal;
    proteinG = todaysTotals.proteinG;
    estimatedBurnKcal = todaysTotals.estimatedBurnKcal;

    if (loggableCustomTargets.length) {
      customTargetTotals = await getCustomTargetValueTotals({
        supabase,
        userId,
        rangeStartIso: todayStartIso,
        rangeEndIso: todayEndIso,
      });
    }
  } else {
    const rangeDays = Number(range);
    const now = new Date();
    const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const rangeStartIso = new Date(todayStartMs - (rangeDays - 1) * 24 * 60 * 60 * 1000).toISOString();
    const rangeEndIso = new Date(todayStartMs + 24 * 60 * 60 * 1000).toISOString();

    if (loggableCustomTargets.length) {
      customTargetTotals = await getCustomTargetValueTotals({ supabase, userId, rangeStartIso, rangeEndIso });
    }

    const { averages, loggedDayCount, totalDayCount } = await getLoggedDaysAverageDailyReportTotals({
      supabase,
      userId,
      rangeStartIso,
      rangeEndIso,
    });
    caloriesKcal = averages.caloriesKcal;
    proteinG = averages.proteinG;
    estimatedBurnKcal = averages.estimatedBurnKcal;
    loggedDaysCaption = tr(
      locale,
      `Daily average, based on ${loggedDayCount} of ${totalDayCount} days logged.`,
      `ממוצע יומי, מבוסס על ${loggedDayCount} מתוך ${totalDayCount} ימים שדווחו.`,
    );

    // The daily average above is already an extrapolation - it assumes
    // unlogged days looked like the logged ones. Below the consistency
    // threshold that assumption rests on too little data to trust, so the
    // confidence label warns the average may not reflect the full period
    // rather than silently presenting a guess as a firm number.
    reportingConsistencyPercent = totalDayCount > 0 ? (loggedDayCount / totalDayCount) * 100 : 0;
    confidenceCaption =
      reportingConsistencyPercent >= REPORTING_CONSISTENCY_THRESHOLD_PERCENT
        ? tr(locale, "High confidence - you logged most days in this period.", "רמת ביטחון גבוהה - דיווחת ברוב הימים בתקופה זו.")
        : tr(
            locale,
            "Low confidence - based on limited logging, this average may not reflect your full period.",
            "רמת ביטחון נמוכה - בהתבסס על דיווח מוגבל, הממוצע עשוי שלא לשקף את התקופה המלאה.",
          );

    reportingConsistencyRingMetric = {
      id: "reportingConsistency",
      labelEn: "Reporting Consistency",
      labelHe: "עקביות דיווח",
      total: loggedDayCount,
      min: Math.ceil(totalDayCount * (REPORTING_CONSISTENCY_THRESHOLD_PERCENT / 100)),
      max: totalDayCount,
      unit: "days",
      neverOverLimit: true,
    };
  }

  // Same net-vs-gross calorie treatment as the Daily Report page: exercise
  // burn offsets calories gained from food/drink, and can legitimately push
  // net below zero on a heavy-exercise, light-intake day.
  const netCaloriesKcal = Math.round(caloriesKcal - estimatedBurnKcal);

  const ringMetrics: RingMetric[] = [
    {
      id: "calories",
      labelEn: "Calories",
      labelHe: "קלוריות",
      total: netCaloriesKcal,
      ...(estimatedBurnKcal > 0 ? { grossTotal: Math.round(caloriesKcal) } : {}),
      min: Number(activeTargetProfile?.calories_min ?? 0),
      max: Number(activeTargetProfile?.calories_max ?? 0),
      unit: "kcal",
    },
    {
      id: "protein",
      labelEn: "Protein",
      labelHe: "חלבון",
      total: proteinG,
      min: Number(activeTargetProfile?.protein_min_g ?? 0),
      max: Number(activeTargetProfile?.protein_max_g ?? 0),
      unit: "g",
    },
    ...(reportingConsistencyRingMetric ? [reportingConsistencyRingMetric] : []),
    // Custom targets from the Targets chat (e.g. "Sleep duration") that
    // carry a unit/range - labelEn/labelHe both get the same string since
    // the AI already generates it in the user's own locale, not two
    // separate translations.
    ...loggableCustomTargets.map(
      (entry): RingMetric => ({
        id: `customTarget_${entry.id}`,
        labelEn: entry.label,
        labelHe: entry.label,
        total: customTargetTotals[entry.id!] ?? 0,
        min: entry.targetMin!,
        max: entry.targetMax!,
        unit: entry.unit!,
      }),
    ),
  ];

  const exerciseRingMetric: RingMetric = {
    id: "exerciseConsistency",
    labelEn: "Exercise Sessions",
    labelHe: "אימונים",
    total: weeklyExerciseSessionDays,
    min: 0,
    max: weeklyExerciseTarget,
    unit: "days",
    neverOverLimit: true,
  };

  // Layer C ("milestone celebrations") only fires when there's an actual
  // weight shift to celebrate - "today" has no meaningful shift within a
  // single day, and a period with fewer than two weigh-ins can't establish
  // one either, so weightShiftKg stays null in both cases and the prompt
  // is told to skip celebration language entirely.
  let weightShiftKg: number | null = null;
  if (range !== "today") {
    const rangeDays = Number(range);
    const now = new Date();
    const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const rangeStartIso = new Date(todayStartMs - (rangeDays - 1) * 24 * 60 * 60 * 1000).toISOString();
    const rangeEndIso = new Date(todayStartMs + 24 * 60 * 60 * 1000).toISOString();

    const { data: weightRows } = await supabase
      .from("user_daily_reports")
      .select("report_at, reported_weight_kg")
      .eq("user_id", userId)
      .not("reported_weight_kg", "is", null)
      .gte("report_at", rangeStartIso)
      .lt("report_at", rangeEndIso)
      .order("report_at", { ascending: true });

    const weighIns = (weightRows ?? []).filter((row) => row.reported_weight_kg !== null);
    if (weighIns.length >= 2) {
      const first = Number(weighIns[0].reported_weight_kg);
      const last = Number(weighIns[weighIns.length - 1].reported_weight_kg);
      weightShiftKg = last - first;
    }
  }

  // AI Coach card (Release 6, Layers B+C only - Layer A's missing-log
  // nudges are explicitly deferred). Generated at most once per UTC
  // calendar day per user/range/locale and cached in
  // user_home_coach_narratives, so a normal page load reads the cache
  // instead of calling the AI provider every time.
  let coachNarrative: string | null = null;

  if (aiConfig && activeTargetProfile) {
    const todayDateString = new Date().toISOString().slice(0, 10);
    const { data: cachedNarrative } = await supabase
      .from("user_home_coach_narratives")
      .select("narrative_text, generated_for_date")
      .eq("user_id", userId)
      .eq("range", range)
      .eq("locale", locale)
      .maybeSingle();

    if (cachedNarrative && cachedNarrative.generated_for_date === todayDateString) {
      coachNarrative = cachedNarrative.narrative_text;
    } else {
      try {
        coachNarrative = await generateHomeCoachNarrative({
          config: aiConfig,
          inputs: {
            locale,
            range,
            caloriesAvg: caloriesKcal,
            caloriesMin: Number(activeTargetProfile.calories_min ?? 0),
            caloriesMax: Number(activeTargetProfile.calories_max ?? 0),
            proteinAvg: proteinG,
            proteinMinG: Number(activeTargetProfile.protein_min_g ?? 0),
            proteinMaxG: Number(activeTargetProfile.protein_max_g ?? 0),
            reportingConsistencyPercent,
            exerciseSessionDays: weeklyExerciseSessionDays,
            exerciseWeeklyTarget: weeklyExerciseTarget,
            goalType: activeTargetProfile.goal_type ?? "general",
            weightShiftKg,
          },
        });
        await supabase.from("user_home_coach_narratives").upsert(
          {
            user_id: userId,
            range,
            locale,
            narrative_text: coachNarrative,
            generated_for_date: todayDateString,
          },
          { onConflict: "user_id,range,locale" },
        );
      } catch {
        coachNarrative = null;
      }
    }
  }

  return {
    ringMetrics,
    loggedDaysCaption,
    confidenceCaption,
    exerciseRingMetric,
    weeklyExerciseTarget,
    weeklyExerciseSessionDays,
    coachNarrative,
    aiCoachConfigured: Boolean(aiConfig),
  };
}
