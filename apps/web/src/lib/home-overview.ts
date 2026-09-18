import type { RingMetric } from "@/components/daily-report-progress-rings";
import { generateHomeCoachNarrative, type HomeCoachInputs } from "@/lib/ai/home-coach";
import type { AiExtractionConfig } from "@/lib/ai/env";
import {
  getCustomTargetValueTotals,
  getExerciseSessionDayCount,
  getLoggedDaysAverageDailyReportTotals,
  getTodaysDailyReportTotals,
} from "@/lib/daily-report";
import { tr, type AppLocale } from "@/lib/locale";
import { normalizeUserTargetsJson } from "@/lib/targets";
import type { createClient } from "@/lib/supabase/server";

/** A short deterministic digest of exactly the rounded numbers
 * buildUserPrompt (lib/ai/home-coach.ts) actually turns into prompt text -
 * rounded the same way the prompt itself rounds them, so this changes if
 * and only if the narrative the AI would generate could plausibly change
 * too. Used to decide whether a cached narrative is still trustworthy (see
 * this file's own caching comment below), not just whether it's from
 * earlier today. */
function buildCoachInputsFingerprint(inputs: HomeCoachInputs): string {
  return [
    Math.round(inputs.caloriesAvg),
    inputs.caloriesMin,
    inputs.caloriesMax,
    Math.round(inputs.proteinAvg),
    inputs.proteinMinG,
    inputs.proteinMaxG,
    inputs.reportingConsistencyPercent === null ? "null" : Math.round(inputs.reportingConsistencyPercent),
    inputs.exerciseSessionDays,
    inputs.exerciseWeeklyTarget,
    inputs.goalType,
    inputs.weightShiftKg === null ? "null" : inputs.weightShiftKg.toFixed(1),
    inputs.userGender ?? "null",
    inputs.userFirstName?.trim() || "null",
  ].join("|");
}

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
  /** The exercise ring's own max/total - named range-neutrally (not
   * "weekly") since what they represent now tracks the selected duration:
   * for "today" both are exercise MINUTES (today's total vs. the plan's
   * daily-equivalent), for every other range both are a count of DAYS with
   * any exercise logged vs. the plan's weekly session target scaled to
   * that many days. See exerciseRingMetric's own comment for why "today"
   * specifically switches units instead of just using a 1-day version of
   * the session-count framing. */
  exerciseTargetAmount: number;
  exerciseLoggedAmount: number;
  /** Full "X of Y ..." detail line for the exercise card, already worded
   * for the selected range and unit - built once here so the Home page and
   * Targets Overview don't each duplicate this range-aware branching. */
  exerciseCaption: string;
  /** Heading text for the exercise card (e.g. "Exercise Today" / "Exercise
   * Consistency - Last 30 Days"), for the same reason. */
  exerciseHeading: string;
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
  userGender,
  userFirstName,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  locale: AppLocale;
  range: HomeRange;
  activeTargetProfile: ActiveTargetProfileForOverview;
  aiConfig: AiExtractionConfig | null;
  /** For the AI Coach narrative's own gendered-addressing rule (see
   * generateHomeCoachNarrative) - resolveUserGenderForAddressing's return
   * value, same as the Daily Report/Targets chats already compute. */
  userGender?: "male" | "female" | null;
  userFirstName?: string | null;
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
  // Same modalities, but total planned MINUTES per week (frequency x
  // duration per modality, summed) - only used for "today"'s own version of
  // the exercise ring below, spread evenly across 7 days as a rough daily
  // target.
  const plannedWeeklyExerciseMinutes = Array.isArray(activeTargetProfile?.exercise_targets)
    ? activeTargetProfile.exercise_targets.reduce((sum: number, entry: unknown) => {
        const record = (entry ?? {}) as {
          frequency_per_week?: number | string | null;
          duration_minutes_per_session?: number | string | null;
        };
        const freq = Number(record.frequency_per_week ?? 0);
        const duration = Number(record.duration_minutes_per_session ?? 0);
        return sum + (Number.isFinite(freq) && Number.isFinite(duration) ? freq * duration : 0);
      }, 0)
    : 0;

  let caloriesKcal: number;
  let proteinG: number;
  let estimatedBurnKcal: number;
  let loggedDaysCaption: string | null = null;
  let confidenceCaption: string | null = null;
  let reportingConsistencyRingMetric: RingMetric | null = null;
  let reportingConsistencyPercent: number | null = null;

  let customTargetTotals: Record<string, number> = {};

  // The exercise ring's own total/max/unit - computed inside the same
  // today-vs-range branch as everything else below, using that branch's
  // own date bounds, so exercise always reflects whatever period the
  // duration selector currently shows instead of silently staying fixed at
  // a trailing week regardless of what's selected (the bug this whole
  // branch restructure fixes).
  let exerciseTotal: number;
  let exerciseMax: number;
  let exerciseUnit: "min" | "days";

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

    // A single day has no clean "how many sessions" answer the way a
    // longer period does - a 3x/week plan doesn't imply "every single
    // day," so scaling the session COUNT down to one day would usually
    // round to a misleading 0-session target. Minutes avoids that: today's
    // logged minutes against the plan's total weekly minutes spread evenly
    // across 7 days.
    exerciseTotal = todaysTotals.exerciseMinutes;
    exerciseMax = Math.round(plannedWeeklyExerciseMinutes / 7);
    exerciseUnit = "min";
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

    // Same weekly-frequency target as before, scaled proportionally to
    // however many days are actually in the selected range - a 3x/week
    // plan implies roughly 3*(30/7)≈13 sessions across 30 days, not still
    // just 3.
    exerciseTotal = await getExerciseSessionDayCount({ supabase, userId, rangeStartIso, rangeEndIso });
    exerciseMax = Math.round(weeklyExerciseTarget * (rangeDays / 7));
    exerciseUnit = "days";
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
      // Unlike calories, going over a protein ceiling that was already
      // scaled to this profile isn't a health concern the way exceeding
      // sodium/added sugar/saturated fat/cholesterol is - shown as an
      // "ahead of target" positive rather than a warning.
      exceedingIsPositive: true,
    },
    ...(reportingConsistencyRingMetric ? [reportingConsistencyRingMetric] : []),
    // Custom targets from the Targets chat (e.g. "Sleep duration") that
    // carry a unit/range - labelEn/labelHe both get the same string since
    // the AI already generates it in the user's own locale, not two
    // separate translations.
    //
    // Always shown in the TARGET's own canonical unit (entry.unit/
    // targetMin/targetMax), never a per-log "original" unit - a target's
    // unit is the one stable reference point across every report, however
    // many different units it's actually been logged in over time (steps
    // one day, minutes another). reconcileCustomTargetValueUnits already
    // converts each logged value into this same canonical unit at save
    // time (see lib/ai/daily-report.ts), so customTargetTotals here is
    // already apples-to-apples - a display-time conversion on top of that
    // would only reintroduce the same kind of mismatch it was meant to
    // fix, now driven by whichever unit happened to be logged most
    // recently instead of the target's own definition.
    ...loggableCustomTargets.map((entry): RingMetric => ({
      id: `customTarget_${entry.id}`,
      labelEn: entry.label,
      labelHe: entry.label,
      total: customTargetTotals[entry.id!] ?? 0,
      min: entry.targetMin!,
      max: entry.targetMax!,
      unit: entry.unit!,
      // AI-determined per target at generation time (see
      // lib/ai/targets.ts's higher_is_better prompt rule) - defaults to
      // true (see UserTargetEntry's own comment) for legacy entries.
      exceedingIsPositive: entry.higherIsBetter ?? true,
    })),
  ];

  const exerciseRingMetric: RingMetric = {
    id: "exerciseConsistency",
    labelEn: range === "today" ? "Exercise" : "Exercise Sessions",
    labelHe: range === "today" ? "פעילות גופנית" : "אימונים",
    total: exerciseTotal,
    min: 0,
    max: exerciseMax,
    unit: exerciseUnit,
    neverOverLimit: true,
  };

  const exerciseHeading =
    range === "today"
      ? tr(locale, "Exercise Today", "פעילות גופנית היום")
      : tr(
          locale,
          `Exercise Consistency - ${rangeLabels[range].en}`,
          `עקביות פעילות גופנית - ${rangeLabels[range].he}`,
        );
  const exerciseCaption =
    range === "today"
      ? tr(
          locale,
          `Today: ${Math.round(exerciseTotal)} of ~${exerciseMax} planned minutes logged.`,
          `היום: נרשמו ${Math.round(exerciseTotal)} מתוך כ-${exerciseMax} דקות מתוכננות.`,
        )
      : tr(
          locale,
          `${rangeLabels[range].en}: ${exerciseTotal} of ${exerciseMax} planned sessions logged. Any day with exercise logged counts as a session.`,
          `${rangeLabels[range].he}: נרשמו ${exerciseTotal} מתוך ${exerciseMax} אימונים מתוכננים. כל יום שבו נרשמה פעילות נחשב לאימון.`,
        );

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
  // nudges are explicitly deferred). Cached in user_home_coach_narratives
  // so a normal page load reads the cache instead of calling the AI
  // provider every time - but the cache is keyed on BOTH the calendar day
  // AND a fingerprint of the actual rounded numbers the narrative's prompt
  // is built from (see buildCoachInputsFingerprint below), not the date
  // alone. A date-only cache previously let a narrative generated early in
  // the day (e.g. "your protein is very low today") sit stale for the rest
  // of the day even after new Daily Report logs pushed the (always-live)
  // progress ring well past that - a real reported mismatch between the
  // ring and the coach text. Keying on the fingerprint too means a save
  // that actually changes what the narrative would say invalidates the
  // cache on the very next page view, while a page view with nothing new
  // to say still costs no AI call.
  let coachNarrative: string | null = null;

  if (aiConfig && activeTargetProfile) {
    const todayDateString = new Date().toISOString().slice(0, 10);
    const coachInputs = {
      locale,
      range,
      caloriesAvg: caloriesKcal,
      caloriesMin: Number(activeTargetProfile.calories_min ?? 0),
      caloriesMax: Number(activeTargetProfile.calories_max ?? 0),
      proteinAvg: proteinG,
      proteinMinG: Number(activeTargetProfile.protein_min_g ?? 0),
      proteinMaxG: Number(activeTargetProfile.protein_max_g ?? 0),
      reportingConsistencyPercent,
      exerciseSessionDays: exerciseTotal,
      exerciseWeeklyTarget: exerciseMax,
      goalType: activeTargetProfile.goal_type ?? "general",
      weightShiftKg,
      userGender: userGender ?? null,
      userFirstName,
    };
    const currentFingerprint = buildCoachInputsFingerprint(coachInputs);

    const { data: cachedNarrative } = await supabase
      .from("user_home_coach_narratives")
      .select("narrative_text, generated_for_date, inputs_fingerprint")
      .eq("user_id", userId)
      .eq("range", range)
      .eq("locale", locale)
      .maybeSingle();

    if (
      cachedNarrative
      && cachedNarrative.generated_for_date === todayDateString
      && cachedNarrative.inputs_fingerprint === currentFingerprint
    ) {
      coachNarrative = cachedNarrative.narrative_text;
    } else {
      try {
        coachNarrative = await generateHomeCoachNarrative({ config: aiConfig, inputs: coachInputs });
        await supabase.from("user_home_coach_narratives").upsert(
          {
            user_id: userId,
            range,
            locale,
            narrative_text: coachNarrative,
            generated_for_date: todayDateString,
            inputs_fingerprint: currentFingerprint,
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
    exerciseTargetAmount: exerciseMax,
    exerciseLoggedAmount: exerciseTotal,
    exerciseCaption,
    exerciseHeading,
    coachNarrative,
    aiCoachConfigured: Boolean(aiConfig),
  };
}
