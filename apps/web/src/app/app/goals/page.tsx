import Link from "next/link";
import { redirect } from "next/navigation";

import {
  addDetectedGoalAction,
  deleteDetectedGoalAction,
  updateDetectedGoalAction,
} from "@/app/app/goals/actions";
import { GoalsForm } from "@/components/goals-form";
import { formatDateTimeForLocale, formatMeasurementUnit, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function alertBadgeClasses(type: "good" | "warning" | "risk"): string {
  if (type === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (type === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function formatGoalType(value: string | null, locale: AppLocale): string {
  if (value === "weight_loss") return tr(locale, "Weight loss", "הורדת משקל");
  if (value === "weight_gain") return tr(locale, "Weight gain", "העלאת משקל");
  if (value === "maintain") return tr(locale, "Maintain", "שמירה על המשקל");
  if (value === "general") return tr(locale, "General", "כללי");
  return tr(locale, "Unknown", "לא ידוע");
}

function formatDetectedGoalText(value: string, locale: AppLocale): string {
  const token = value.trim().toLowerCase();
  if (token === "weight loss") return tr(locale, "Weight loss", "הורדת משקל");
  if (token === "weight gain") return tr(locale, "Weight gain", "העלאת משקל");
  if (token === "maintain" || token === "maintain weight") {
    return tr(locale, "Maintain weight", "שמירה על המשקל");
  }
  if (token === "general" || token === "general health") {
    return tr(locale, "General health", "בריאות כללית");
  }
  if (token === "blood test balance") {
    return tr(locale, "Blood test balance", "איזון בדיקות דם");
  }
  if (token === "sleep improvement") {
    return tr(locale, "Sleep improvement", "שיפור שינה");
  }
  return value;
}

function formatAssumptionText(value: string, locale: AppLocale): string {
  const token = value.trim();
  if (token === "Calorie deficit was safety-bounded to a practical range.") {
    return tr(locale, token, "הגרעון הקלורי הוגבל לטווח בטוח ומעשי.");
  }
  if (token === "Blood markers focus enabled: protein target raised by 10% to support nutrition quality.") {
    return tr(locale, token, "מיקוד במדדי דם הופעל: יעד החלבון הועלה ב-10% לתמיכה באיכות התזונה.");
  }
  if (token === "Sleep quality focus enabled: activity target reduced by 1,000 steps to support recovery.") {
    return tr(locale, token, "מיקוד באיכות שינה הופעל: יעד הפעילות הופחת ב-1,000 צעדים לתמיכה בהתאוששות.");
  }
  return value;
}

export default async function GoalsPage() {
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
      "id, raw_goal_text, goal_type, target_delta_kg, duration_days, target_weight_kg, daily_calorie_delta, protein_target_g, hydration_target_l, steps_target, translation_confidence, assumptions, detected_goals, blood_balance_focus, sleep_focus, analysis_source, translated_at",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const { data: latestConfirmedDailyReport } = activeGoal
    ? await supabase
        .from("user_daily_reports")
        .select(
          "id, report_at, calories_kcal, protein_g, water_ml",
        )
        .eq("user_id", user.id)
        .eq("goal_id", activeGoal.id)
        .eq("status", "confirmed")
        .order("report_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const goalAlerts: Array<{ text: string; type: "good" | "warning" | "risk" }> = [];
  if (activeGoal && latestConfirmedDailyReport) {
    const protein = Number(latestConfirmedDailyReport.protein_g ?? 0);
    const proteinTarget = Number(activeGoal.protein_target_g ?? 0);
    if (proteinTarget > 0) {
      const proteinRatio = protein / proteinTarget;
      if (proteinRatio >= 1) {
        goalAlerts.push({ text: tr(locale, "Protein target met in latest confirmed report.", "יעד החלבון הושג בדיווח המאושר האחרון."), type: "good" });
      } else if (proteinRatio >= 0.7) {
        goalAlerts.push({ text: tr(locale, "Protein target is partially met in latest confirmed report.", "יעד החלבון הושג חלקית בדיווח המאושר האחרון."), type: "warning" });
      } else {
        goalAlerts.push({ text: tr(locale, "Protein target is below plan in latest confirmed report.", "יעד החלבון נמוך מהתכנית בדיווח המאושר האחרון."), type: "risk" });
      }
    }

    const hydrationMl = Number(latestConfirmedDailyReport.water_ml ?? 0);
    const hydrationTargetMl = Number(activeGoal.hydration_target_l ?? 0) * 1000;
    if (hydrationTargetMl > 0) {
      const hydrationRatio = hydrationMl / hydrationTargetMl;
      if (hydrationRatio >= 1) {
        goalAlerts.push({ text: tr(locale, "Hydration target met in latest confirmed report.", "יעד הנוזלים הושג בדיווח המאושר האחרון."), type: "good" });
      } else if (hydrationRatio >= 0.7) {
        goalAlerts.push({ text: tr(locale, "Hydration target is partially met in latest confirmed report.", "יעד הנוזלים הושג חלקית בדיווח המאושר האחרון."), type: "warning" });
      } else {
        goalAlerts.push({ text: tr(locale, "Hydration target is below plan in latest confirmed report.", "יעד הנוזלים נמוך מהתכנית בדיווח המאושר האחרון."), type: "risk" });
      }
    }

    const calories = Number(latestConfirmedDailyReport.calories_kcal ?? 0);
    if (activeGoal.goal_type === "weight_loss" && calories > 2200) {
      goalAlerts.push({ text: tr(locale, "You exceeded a conservative calories threshold for weight-loss mode.", "עברת סף קלוריות שמרני למצב ירידה במשקל."), type: "risk" });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Goals", "מטרות")}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {tr(locale, "Add your free-text goal and get AI-assisted, safety-bounded daily targets.", "הוסיפו מטרה בטקסט חופשי וקבלו יעדים יומיים בסיוע AI ובגבולות בטיחות.")}
            </p>
          </div>

          <Link
            href="/app"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Back to dashboard", "חזרה ללוח הבקרה")}
          </Link>
        </div>

        <GoalsForm defaultText={activeGoal?.raw_goal_text ?? null} locale={locale} />
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "Current target plan", "תכנית היעד הנוכחית")}</h2>
          <Link
            href="/app/goals/progress"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Progress vs plan", "התקדמות מול תכנית")}
          </Link>
        </div>

        {!activeGoal ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            {tr(locale, "No active goal yet. Submit your goal text above to generate targets.", "עדיין אין מטרה פעילה. הזינו מטרה למעלה כדי ליצור יעדים.")}
          </p>
        ) : (
          <div className="mt-4 space-y-4 text-sm text-slate-700">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Original request", "בקשה מקורית")}:</span>{" "}
                {activeGoal.raw_goal_text}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Translated at", "תורגם בתאריך")}:</span>{" "}
                {activeGoal.translated_at
                  ? formatDateTimeForLocale(activeGoal.translated_at, locale)
                  : tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Goal type", "סוג יעד")}:</span>{" "}
                {formatGoalType(activeGoal.goal_type, locale)}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Confidence", "רמת ביטחון")}:</span>{" "}
                {activeGoal.translation_confidence ?? tr(locale, "n/a", "לא זמין")}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Analysis source", "מקור ניתוח")}:</span>{" "}
                {activeGoal.analysis_source === "ai"
                  ? "AI"
                  : tr(locale, "Heuristic", "יוריסטי")}
              </p>
              {latestConfirmedDailyReport ? (
                <p className="mt-1">
                  <span className="font-semibold text-slate-900">{tr(locale, "Latest confirmed daily report", "הדיווח המאושר האחרון")}:</span>{" "}
                  {formatDateTimeForLocale(String(latestConfirmedDailyReport.report_at), locale)}
                </p>
              ) : null}
            </div>

            {goalAlerts.length ? (
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="font-semibold text-slate-900">{tr(locale, "Plan alerts", "התראות תכנית")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {goalAlerts.map((alert) => (
                    <span
                      key={alert.text}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${alertBadgeClasses(alert.type)}`}
                    >
                      {alert.text}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{tr(locale, "Detected goals", "מטרות שזוהו")}</p>
              {Array.isArray(activeGoal.detected_goals) && activeGoal.detected_goals.length ? (
                <div className="mt-3 space-y-3">
                  {activeGoal.detected_goals.map((item: string, index: number) => (
                    <div
                      key={`${index}-${item}`}
                      className="rounded-lg border border-slate-200 bg-white p-3"
                    >
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {tr(locale, "Goal", "מטרה")} {index + 1}
                      </p>
                      <p className="rounded-md bg-slate-50 px-2 py-1 text-sm text-slate-800">{formatDetectedGoalText(item, locale)}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <details>
                          <summary className="cursor-pointer rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50">
                            {tr(locale, "Edit", "עריכה")}
                          </summary>
                          <form action={updateDetectedGoalAction} className="mt-2 flex flex-wrap items-center gap-2">
                            <input type="hidden" name="report_id" value={activeGoal.id} />
                            <input type="hidden" name="goal_index" value={String(index)} />
                            <input
                              type="text"
                              name="goal_text"
                              defaultValue={formatDetectedGoalText(item, locale)}
                              className="w-full min-w-56 grow rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            <button
                              type="submit"
                              className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                            >
                              {tr(locale, "Save", "שמירה")}
                            </button>
                          </form>
                        </details>
                        <form action={deleteDetectedGoalAction}>
                          <input type="hidden" name="report_id" value={activeGoal.id} />
                          <input type="hidden" name="goal_index" value={String(index)} />
                          <button
                            type="submit"
                            className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            {tr(locale, "Delete", "מחיקה")}
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-600">{tr(locale, "No explicit goal list was detected.", "לא זוהתה רשימת מטרות מפורשת.")}</p>
              )}

              <form action={addDetectedGoalAction} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="report_id" value={activeGoal.id} />
                <input
                  type="text"
                  name="goal_text"
                  required
                  maxLength={120}
                  placeholder={tr(locale, "Add a new goal item", "הוספת פריט מטרה חדש")}
                  className="w-full min-w-56 grow rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  {tr(locale, "Add", "הוספה")}
                </button>
              </form>

              <div className="mt-3 flex flex-wrap gap-2">
                {activeGoal.blood_balance_focus ? (
                  <a
                    href="#focus-blood"
                    className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                  >
                    {tr(locale, "Blood markers focus", "מיקוד במדדי דם")}
                  </a>
                ) : null}
                {activeGoal.sleep_focus ? (
                  <a
                    href="#focus-sleep"
                    className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
                  >
                    {tr(locale, "Sleep quality focus", "מיקוד באיכות שינה")}
                  </a>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div id="focus-blood" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="font-semibold text-amber-900">{tr(locale, "Blood markers focus role", "תפקיד מיקוד במדדי דם")}</p>
                <p className="mt-1 text-sm text-amber-800">
                  {tr(locale, "This focus boosts protein target by 10% to support nutrition quality and marker recovery planning.", "מיקוד זה מעלה את יעד החלבון ב-10% כדי לתמוך באיכות תזונתית ובתכנון התאוששות.")}
                </p>
              </div>
              <div id="focus-sleep" className="rounded-lg border border-sky-200 bg-sky-50 p-4">
                <p className="font-semibold text-sky-900">{tr(locale, "Sleep quality focus role", "תפקיד מיקוד באיכות שינה")}</p>
                <p className="mt-1 text-sm text-sky-800">
                  {tr(locale, "This focus reduces activity target by 1,000 steps (minimum 7,000/day) to prioritize recovery.", "מיקוד זה מפחית את יעד הפעילות ב-1,000 צעדים (מינימום 7,000 ביום) לטובת התאוששות.")}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Target weight change", "שינוי יעד במשקל")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.target_delta_kg ?? tr(locale, "n/a", "לא זמין")} {formatMeasurementUnit("kg", locale)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Timeline", "ציר זמן")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.duration_days ?? tr(locale, "n/a", "לא זמין")} {tr(locale, "days", "ימים")}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Target weight", "משקל יעד")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.target_weight_kg ?? tr(locale, "n/a", "לא זמין")} {formatMeasurementUnit("kg", locale)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Daily calorie delta", "שינוי קלורי יומי")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.daily_calorie_delta > 0 ? "+" : ""}
                  {activeGoal.daily_calorie_delta} {tr(locale, "kcal/day", "קק\"ל ליום")}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Protein target", "יעד חלבון")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.protein_target_g} {tr(locale, "g/day", "גרם ליום")}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Hydration target", "יעד נוזלים")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.hydration_target_l} {tr(locale, "L/day", "ליטר ליום")}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 p-3 sm:col-span-2 lg:col-span-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{tr(locale, "Activity target", "יעד פעילות")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {activeGoal.steps_target} {tr(locale, "steps/day", "צעדים ליום")}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{tr(locale, "Assumptions and safety notes", "הנחות והערות בטיחות")}</p>
              {Array.isArray(activeGoal.assumptions) && activeGoal.assumptions.length ? (
                <ul className="mt-2 list-disc pl-5">
                  {activeGoal.assumptions.map((item: string) => (
                    <li key={item}>{formatAssumptionText(item, locale)}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-600">{tr(locale, "No extra assumptions were needed.", "לא נדרשו הנחות נוספות.")}</p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                {tr(locale, "Informational support only. Check with a qualified healthcare professional for medical decisions.", "למטרות מידע בלבד. להחלטות רפואיות יש להתייעץ עם איש מקצוע מוסמך.")}
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
