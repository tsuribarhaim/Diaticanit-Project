import Link from "next/link";
import { redirect } from "next/navigation";

import { DailyReportProgressRings } from "@/components/daily-report-progress-rings";
import { PasskeyEnrollPrompt } from "@/components/passkey-enroll-prompt";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { getHomeOverviewData, parseRangeParam, rangeLabels, RANGE_VALUES } from "@/lib/home-overview";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Home dashboard: Today/7/30/90-day time-lapse control (Release 3) over
 * Calories/Protein rings (Release 2), a Weekly Exercise Consistency ring
 * (Release 4), and an AI Coach card (Release 6) - all the actual chart-data
 * computation now lives in lib/home-overview.ts (see its own comment),
 * shared with the Targets page's own Overview view so both show the exact
 * same thing without duplicating that logic.
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
    .select("preferred_language, passkey_offer_dismissed")
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

  const aiConfig = getAiExtractionConfig();
  const overview = await getHomeOverviewData({
    supabase,
    userId: user.id,
    locale,
    range,
    activeTargetProfile,
    aiConfig,
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <PasskeyEnrollPrompt locale={locale} passkeyOfferDismissed={Boolean(profile.passkey_offer_dismissed)} />
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {range === "today" ? tr(locale, "Today's Progress", "ההתקדמות של היום") : tr(locale, "Your Progress", "ההתקדמות שלך")}
          </h2>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-800/60">
            {RANGE_VALUES.map((value) => (
              <Link
                key={value}
                href={value === "today" ? "/app" : `/app?range=${value}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  range === value ? "bg-teal-700 text-white dark:bg-teal-600" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {tr(locale, rangeLabels[value].en, rangeLabels[value].he)}
              </Link>
            ))}
          </div>
        </div>

        {activeTargetProfile ? (
          <div className="mt-4">
            <DailyReportProgressRings locale={locale} metrics={overview.ringMetrics} />
            {overview.loggedDaysCaption ? <p className="mt-3 text-xs text-slate-500">{overview.loggedDaysCaption}</p> : null}
            {overview.confidenceCaption ? <p className="mt-1 text-xs text-slate-500">{overview.confidenceCaption}</p> : null}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {tr(
              locale,
              "Lock in your daily targets first to see today's progress here.",
              "יש לנעול את היעדים היומיים שלך תחילה כדי לראות כאן את ההתקדמות של היום.",
            )}
          </p>
        )}
      </section>

      {activeTargetProfile ? (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {tr(locale, "Weekly Exercise Consistency", "עקביות פעילות שבועית")}
          </h2>

          {overview.weeklyExerciseTarget > 0 ? (
            <div className="mt-4">
              <DailyReportProgressRings locale={locale} metrics={[overview.exerciseRingMetric]} />
              <p className="mt-3 text-xs text-slate-500">
                {tr(
                  locale,
                  `This week: ${overview.weeklyExerciseSessionDays} of ${overview.weeklyExerciseTarget} planned sessions logged. Any day with exercise logged counts as a session.`,
                  `השבוע: נרשמו ${overview.weeklyExerciseSessionDays} מתוך ${overview.weeklyExerciseTarget} אימונים מתוכננים. כל יום שבו נרשמה פעילות נחשב לאימון.`,
                )}
              </p>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
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
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "✨ AI Coach", "✨ מאמן AI")}</h2>

          {overview.coachNarrative ? (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">{overview.coachNarrative}</p>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
              {!overview.aiCoachConfigured
                ? tr(locale, "AI Coach is not available in this environment.", "מאמן ה-AI אינו זמין בסביבה זו.")
                : tr(locale, "The AI Coach couldn't generate a summary right now. Try again later.", "מאמן ה-AI לא הצליח ליצור סיכום כרגע. נסו שוב מאוחר יותר.")}
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}
