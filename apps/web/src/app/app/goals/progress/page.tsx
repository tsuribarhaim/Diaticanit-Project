import Link from "next/link";
import { redirect } from "next/navigation";

import { formatDateTimeForLocale, formatMeasurementUnit, formatNumberForLocale, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function isMissingReportedWeightColumn(errorMessage: string): boolean {
  return errorMessage.includes("reported_weight_kg") && errorMessage.includes("does not exist");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatGoalType(value: string | null, locale: AppLocale): string {
  if (value === "weight_loss") return tr(locale, "Weight loss", "הורדת משקל");
  if (value === "weight_gain") return tr(locale, "Weight gain", "העלאת משקל");
  if (value === "maintain") return tr(locale, "Maintain", "שמירה על המשקל");
  if (value === "general") return tr(locale, "General", "כללי");
  return tr(locale, "Unknown", "לא ידוע");
}

function formatDecimal(value: number, locale: AppLocale, digits = 2): string {
  return formatNumberForLocale(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default async function GoalsProgressPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = normalizeLocale(
    (
      await supabase
        .from("user_profile")
        .select("preferred_language")
        .eq("user_id", user.id)
        .maybeSingle()
    ).data?.preferred_language,
  );

  const { data: activeGoal, error } = await supabase
    .from("user_goals")
    .select(
      "id, goal_type, target_delta_kg, duration_days, target_weight_kg, translated_at, created_at, raw_goal_text",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  let weightHistory: Array<{ report_at: string; reported_weight_kg: number | null }> | null = null;

  if (activeGoal) {
    const weightHistoryResult = await supabase
      .from("user_daily_reports")
      .select("report_at, reported_weight_kg")
      .eq("user_id", user.id)
      .eq("goal_id", activeGoal.id)
      .in("status", ["confirmed", "needs_confirmation", "parsed"])
      .not("reported_weight_kg", "is", null)
      .order("report_at", { ascending: true })
      .limit(365);

    if (weightHistoryResult.error && isMissingReportedWeightColumn(weightHistoryResult.error.message)) {
      weightHistory = [];
    } else if (weightHistoryResult.error) {
      throw new Error(weightHistoryResult.error.message);
    } else {
      weightHistory = weightHistoryResult.data;
    }
  }

  const now = new Date();

  let startDate: Date | null = null;
  let endDate: Date | null = null;
  let elapsedRatio: number | null = null;

  if (activeGoal) {
    startDate = new Date(activeGoal.translated_at ?? activeGoal.created_at);

    if (activeGoal.duration_days && Number.isFinite(activeGoal.duration_days)) {
      endDate = new Date(startDate.getTime() + Number(activeGoal.duration_days) * 24 * 60 * 60 * 1000);
      const totalMs = endDate.getTime() - startDate.getTime();
      const elapsedMs = now.getTime() - startDate.getTime();
      elapsedRatio = totalMs > 0 ? clamp(elapsedMs / totalMs, 0, 1) : 1;
    }
  }

  const elapsedPercent = elapsedRatio !== null ? Math.round(elapsedRatio * 100) : null;

  let expectedDeltaTodayKg: number | null = null;
  let inferredStartWeightKg: number | null = null;
  let expectedWeightTodayKg: number | null = null;
  let actualWeightNowKg: number | null = null;
  let actualWeightStartKg: number | null = null;
  let actualWeightDeltaKg: number | null = null;
  let actualVsExpectedKg: number | null = null;
  let targetProgressPercent: number | null = null;

  if (
    activeGoal &&
    elapsedRatio !== null &&
    typeof activeGoal.target_delta_kg === "number" &&
    typeof activeGoal.target_weight_kg === "number"
  ) {
    const goalType = String(activeGoal.goal_type ?? "");
    const targetDelta = Number(activeGoal.target_delta_kg);
    const targetWeight = Number(activeGoal.target_weight_kg);

    if (goalType === "weight_loss") {
      inferredStartWeightKg = targetWeight + targetDelta;
      expectedDeltaTodayKg = -(targetDelta * elapsedRatio);
    } else if (goalType === "weight_gain") {
      inferredStartWeightKg = targetWeight - targetDelta;
      expectedDeltaTodayKg = targetDelta * elapsedRatio;
    } else if (goalType === "maintain") {
      inferredStartWeightKg = targetWeight;
      expectedDeltaTodayKg = 0;
    }

    if (
      inferredStartWeightKg !== null &&
      expectedDeltaTodayKg !== null
    ) {
      expectedWeightTodayKg = inferredStartWeightKg + expectedDeltaTodayKg;
    }

    const usableWeightHistory = (weightHistory ?? []).filter((row) => typeof row.reported_weight_kg === "number");
    if (usableWeightHistory.length > 0) {
      actualWeightStartKg = Number(usableWeightHistory[0].reported_weight_kg);
      actualWeightNowKg = Number(usableWeightHistory[usableWeightHistory.length - 1].reported_weight_kg);
      actualWeightDeltaKg = actualWeightNowKg - actualWeightStartKg;

      if (expectedWeightTodayKg !== null) {
        actualVsExpectedKg = actualWeightNowKg - expectedWeightTodayKg;
      }

      const totalPlannedDelta = targetWeight - inferredStartWeightKg;
      const actualDeltaFromInferredStart = actualWeightNowKg - inferredStartWeightKg;
      if (Math.abs(totalPlannedDelta) > 0.0001) {
        targetProgressPercent = (actualDeltaFromInferredStart / totalPlannedDelta) * 100;
      }
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Progress vs plan", "התקדמות מול תכנית")}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {tr(
                locale,
                "Timeline view of your active target plan with start, end, and elapsed progress.",
                "תצוגת ציר זמן של תכנית היעד הפעילה עם תאריך התחלה, סיום והתקדמות עד כה.",
              )}
            </p>
          </div>

          <Link
            href="/app/goals"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Back to goals", "חזרה למטרות")}
          </Link>
        </div>
        <div className="mt-3">
          <Link
            href="/app/daily-report"
            className="rounded-lg border border-teal-300 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"
          >
            {tr(locale, "Add daily report entry", "הוספת רשומת דיווח יומי")}
          </Link>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        {!activeGoal ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            {tr(locale, "No active goal available. Add a goal first to see timeline progress.", "אין מטרה פעילה זמינה. הוסיפו קודם מטרה כדי לראות התקדמות בציר הזמן.")}
          </p>
        ) : (
          <div className="space-y-5 text-sm text-slate-700">
            <div className="rounded-lg bg-slate-50 p-4">
              <p>
                <span className="font-semibold text-slate-900">{tr(locale, "Goal request", "בקשת יעד")}:</span>{" "}
                {activeGoal.raw_goal_text}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Goal type", "סוג יעד")}:</span>{" "}
                {formatGoalType(activeGoal.goal_type, locale)}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Start date", "תאריך התחלה")}:</span>{" "}
                {startDate ? formatDateTimeForLocale(startDate, locale) : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "End date", "תאריך סיום")}:</span>{" "}
                {endDate ? formatDateTimeForLocale(endDate, locale) : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Progress to date", "התקדמות עד כה")}:</span>{" "}
                {elapsedPercent !== null ? `${formatNumberForLocale(elapsedPercent, locale)}%` : tr(locale, "n/a", "לא זמין")}
              </p>
            </div>

            {elapsedPercent !== null ? (
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>{tr(locale, "Start", "התחלה")}</span>
                  <span>{tr(locale, "Today", "היום")}: {formatNumberForLocale(elapsedPercent, locale)}%</span>
                  <span>{tr(locale, "End", "סיום")}</span>
                </div>
                <div className="h-3 w-full rounded-full bg-slate-200">
                  <div
                    className="h-3 rounded-full bg-teal-600"
                    style={{ width: `${elapsedPercent}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Target delta", "שינוי יעד")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.target_delta_kg !== null ? formatDecimal(Number(activeGoal.target_delta_kg), locale) : tr(locale, "n/a", "לא זמין")} {formatMeasurementUnit("kg", locale)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Duration", "משך זמן")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.duration_days !== null ? formatNumberForLocale(Number(activeGoal.duration_days), locale) : tr(locale, "n/a", "לא זמין")} {tr(locale, "days", "ימים")}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Target weight", "משקל יעד")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.target_weight_kg !== null ? formatDecimal(Number(activeGoal.target_weight_kg), locale) : tr(locale, "n/a", "לא זמין")} {formatMeasurementUnit("kg", locale)}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{tr(locale, "Planned trajectory at today", "מסלול מתוכנן להיום")}</p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Expected delta by now", "שינוי צפוי עד עכשיו")}:</span>{" "}
                {expectedDeltaTodayKg !== null ? `${formatDecimal(expectedDeltaTodayKg, locale)} ${formatMeasurementUnit("kg", locale)}` : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Expected weight by now", "משקל צפוי עד עכשיו")}:</span>{" "}
                {expectedWeightTodayKg !== null ? `${formatDecimal(expectedWeightTodayKg, locale)} ${formatMeasurementUnit("kg", locale)}` : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                {tr(
                  locale,
                  "Planned values are shown against your target timeline. When you report body weight in daily reports, this page also shows actual trend and target progress.",
                  "הערכים המתוכננים מוצגים מול ציר הזמן של היעד. כאשר מדווחים משקל גוף בדיווחים היומיים, עמוד זה מציג גם מגמת ביצוע בפועל והתקדמות אל היעד.",
                )}
              </p>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{tr(locale, "Actual weight trend", "מגמת משקל בפועל")}</p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "First reported weight", "משקל ראשון שדווח")}:</span>{" "}
                {actualWeightStartKg !== null ? `${formatDecimal(actualWeightStartKg, locale)} ${formatMeasurementUnit("kg", locale)}` : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Latest reported weight", "משקל אחרון שדווח")}:</span>{" "}
                {actualWeightNowKg !== null ? `${formatDecimal(actualWeightNowKg, locale)} ${formatMeasurementUnit("kg", locale)}` : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Actual trend delta", "שינוי מגמה בפועל")}:</span>{" "}
                {actualWeightDeltaKg !== null ? `${formatDecimal(actualWeightDeltaKg, locale)} ${formatMeasurementUnit("kg", locale)}` : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Actual vs expected today", "בפועל מול צפוי היום")}:</span>{" "}
                {actualVsExpectedKg !== null ? `${formatDecimal(actualVsExpectedKg, locale)} ${formatMeasurementUnit("kg", locale)}` : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Progress toward target", "התקדמות אל היעד")}:</span>{" "}
                {targetProgressPercent !== null ? `${formatDecimal(targetProgressPercent, locale, 1)}%` : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                {tr(locale, "Trend history uses all daily reports with reported body weight values, including pending confirmations.", "היסטוריית המגמה מבוססת על כל הדיווחים היומיים הכוללים ערך משקל מדווח, כולל דיווחים שממתינים לאישור.")}
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
