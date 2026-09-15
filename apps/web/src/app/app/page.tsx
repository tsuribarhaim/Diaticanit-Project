import Link from "next/link";
import { redirect } from "next/navigation";

import { DailyReportProgressRings, type RingMetric } from "@/components/daily-report-progress-rings";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { generateHomeCoachNarrative } from "@/lib/ai/home-coach";
import {
  getCustomTargetValueTotals,
  getLoggedDaysAverageDailyReportTotals,
  getTodaysDailyReportTotals,
  getWeeklyExerciseSessionDayCount,
} from "@/lib/daily-report";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { normalizeUserTargetsJson } from "@/lib/targets";

export const dynamic = "force-dynamic";

const RANGE_VALUES = ["today", "7", "30", "90"] as const;
type HomeRange = (typeof RANGE_VALUES)[number];

function parseRangeParam(value: string | undefined): HomeRange {
  return (RANGE_VALUES as readonly string[]).includes(value ?? "") ? (value as HomeRange) : "today";
}

const rangeLabels: Record<HomeRange, { en: string; he: string }> = {
  today: { en: "Today", he: "היום" },
  "7": { en: "7 Days", he: "7 ימים" },
  "30": { en: "30 Days", he: "30 יום" },
  "90": { en: "90 Days", he: "90 יום" },
};

/** A period needs at least this share of its days logged before the
 * period's averages are treated as representative rather than a guess
 * extrapolated from a handful of days. */
const REPORTING_CONSISTENCY_THRESHOLD_PERCENT = 80;

/**
 * Home dashboard: Today/7/30/90-day time-lapse control (Release 3) over
 * Calories/Protein rings (Release 2) and a Weekly Exercise Consistency ring
 * (Release 4). Multi-day ranges average only over logged days (see
 * getLoggedDaysAverageDailyReportTotals) - that average is itself an
 * extrapolation onto the unlogged days, so Release 5 adds a Reporting
 * Consistency ring plus a confidence label warning when logging coverage
 * is too thin (below REPORTING_CONSISTENCY_THRESHOLD_PERCENT) to trust it.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const range = parseRangeParam(resolvedSearchParams.range);

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profile } = await supabase
    .from("user_profile")
    .select("preferred_language")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/app/onboarding");
  }

  const locale = normalizeLocale(profile.preferred_language);

  const { data: activeTargetProfile } = await supabase
    .from("user_target_profiles")
    .select("calories_min, calories_max, protein_min_g, protein_max_g, exercise_targets, goal_type, user_targets")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  // Only entries with a full id/unit/targetMin/targetMax set are loggable -
  // see DailyReportForm's customTargets prop for the matching Daily Report
  // side of this.
  const loggableCustomTargets = normalizeUserTargetsJson(activeTargetProfile?.user_targets).filter(
    (entry) => entry.id && entry.unit && entry.targetMin !== undefined && entry.targetMax !== undefined,
  );

  // Same "sum of each planned modality's frequency" convention already used
  // on the Targets page (see target-profile-view.tsx's
  // totalWeeklyExerciseFrequency) - a plan with walking 3x/week + strength
  // 2x/week has a 5-session weekly target.
  const weeklyExerciseTarget = Array.isArray(activeTargetProfile?.exercise_targets)
    ? activeTargetProfile.exercise_targets.reduce((sum: number, entry: unknown) => {
        const record = (entry ?? {}) as { frequency_per_week?: number | string | null };
        const freq = Number(record.frequency_per_week ?? 0);
        return sum + (Number.isFinite(freq) ? freq : 0);
      }, 0)
    : 0;
  const weeklyExerciseSessionDays = await getWeeklyExerciseSessionDayCount({ supabase, userId: user.id });

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

    const todaysTotals = await getTodaysDailyReportTotals({ supabase, userId: user.id });
    caloriesKcal = todaysTotals.caloriesKcal;
    proteinG = todaysTotals.proteinG;
    estimatedBurnKcal = todaysTotals.estimatedBurnKcal;

    if (loggableCustomTargets.length) {
      customTargetTotals = await getCustomTargetValueTotals({
        supabase,
        userId: user.id,
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
      customTargetTotals = await getCustomTargetValueTotals({ supabase, userId: user.id, rangeStartIso, rangeEndIso });
    }

    const { averages, loggedDayCount, totalDayCount } = await getLoggedDaysAverageDailyReportTotals({
      supabase,
      userId: user.id,
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
      .eq("user_id", user.id)
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
  const aiConfig = getAiExtractionConfig();
  let coachNarrative: string | null = null;

  if (aiConfig && activeTargetProfile) {
    const todayDateString = new Date().toISOString().slice(0, 10);
    const { data: cachedNarrative } = await supabase
      .from("user_home_coach_narratives")
      .select("narrative_text, generated_for_date")
      .eq("user_id", user.id)
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
            user_id: user.id,
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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {range === "today" ? tr(locale, "Today's Progress", "ההתקדמות של היום") : tr(locale, "Your Progress", "ההתקדמות שלך")}
          </h2>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {RANGE_VALUES.map((value) => (
              <Link
                key={value}
                href={value === "today" ? "/app" : `/app?range=${value}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  range === value ? "bg-teal-700 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {tr(locale, rangeLabels[value].en, rangeLabels[value].he)}
              </Link>
            ))}
          </div>
        </div>

        {activeTargetProfile ? (
          <div className="mt-4">
            <DailyReportProgressRings locale={locale} metrics={ringMetrics} />
            {loggedDaysCaption ? <p className="mt-3 text-xs text-slate-500">{loggedDaysCaption}</p> : null}
            {confidenceCaption ? <p className="mt-1 text-xs text-slate-500">{confidenceCaption}</p> : null}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            {tr(
              locale,
              "Lock in your daily targets first to see today's progress here.",
              "יש לנעול את היעדים היומיים שלך תחילה כדי לראות כאן את ההתקדמות של היום.",
            )}
          </p>
        )}
      </section>

      {activeTargetProfile ? (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {tr(locale, "Weekly Exercise Consistency", "עקביות פעילות שבועית")}
          </h2>

          {weeklyExerciseTarget > 0 ? (
            <div className="mt-4">
              <DailyReportProgressRings locale={locale} metrics={[exerciseRingMetric]} />
              <p className="mt-3 text-xs text-slate-500">
                {tr(
                  locale,
                  `This week: ${weeklyExerciseSessionDays} of ${weeklyExerciseTarget} planned sessions logged. Any day with exercise logged counts as a session.`,
                  `השבוע: נרשמו ${weeklyExerciseSessionDays} מתוך ${weeklyExerciseTarget} אימונים מתוכננים. כל יום שבו נרשמה פעילות נחשב לאימון.`,
                )}
              </p>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
              {tr(
                locale,
                "No weekly exercise target set in your plan.",
                "לא הוגדר יעד פעילות שבועי בתכנית שלך.",
              )}
            </p>
          )}
        </section>
      ) : null}

      {activeTargetProfile ? (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "✨ AI Coach", "✨ מאמן AI")}</h2>

          {coachNarrative ? (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">{coachNarrative}</p>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
              {!aiConfig
                ? tr(locale, "AI Coach is not available in this environment.", "מאמן ה-AI אינו זמין בסביבה זו.")
                : tr(locale, "The AI Coach couldn't generate a summary right now. Try again later.", "מאמן ה-AI לא הצליח ליצור סיכום כרגע. נסו שוב מאוחר יותר.")}
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}
