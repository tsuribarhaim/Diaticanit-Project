import { redirect } from "next/navigation";

import {
  addReportToDefaultsAction,
  deleteDailyReportAction,
  updateDailyReportChartPreferencesAction,
} from "@/app/app/daily-report/actions";
import { DailyReportForm } from "@/components/daily-report-form";
import { DailyReportProgressRings, type RingMetric } from "@/components/daily-report-progress-rings";
import { DailyReportWeightTrend, type WeightPoint } from "@/components/daily-report-weight-trend";
import { CHART_EXTRA_METRIC_IDS, normalizeDailyReportChartPreferences, type DailyReportChartExtraMetric } from "@/lib/daily-report-chart-preferences";
import { getTodaysDailyReportTotals } from "@/lib/daily-report";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { formatDateTimeForLocale, formatMeasurementUnit, formatNumberForLocale, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function isMissingReportedWeightColumn(errorMessage: string): boolean {
  return errorMessage.includes("reported_weight_kg") && errorMessage.includes("does not exist");
}

function formatNumber(value: number | string | null, locale: AppLocale, digits = 0): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return formatNumberForLocale(parsed, locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatConfidence(value: number | string | null, locale: AppLocale): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0%";
  return `${formatNumberForLocale(Math.round(parsed * 100), locale)}%`;
}

type SummaryFoodItem = { name?: unknown; quantity?: unknown; unit?: unknown };
type SummaryExerciseItem = { name?: unknown; minutes?: unknown };

/**
 * The recent-entries list shows a synthesized "what was consumed" line built
 * from the already-parsed structured items, rather than the raw chat
 * transcript - a back-and-forth conversation (clarifying questions,
 * off-topic redirects, etc.) isn't a useful thing to scan in a food diary.
 * The full transcript is still available via a "View full conversation"
 * toggle for anyone who wants to double-check what was actually said.
 */
function buildEntrySummary(parsedItems: unknown, parsedExercises: unknown, locale: AppLocale): string {
  const foodParts = (Array.isArray(parsedItems) ? (parsedItems as SummaryFoodItem[]) : [])
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) return null;
      const quantity = Number(item.quantity ?? 0);
      const unit = typeof item.unit === "string" ? item.unit : "";
      return quantity > 0 && unit ? `${name} (${formatNumber(quantity, locale, 1)} ${unit})` : name;
    })
    .filter((part): part is string => Boolean(part));

  const exerciseParts = (Array.isArray(parsedExercises) ? (parsedExercises as SummaryExerciseItem[]) : [])
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) return null;
      const minutes = Number(item.minutes ?? 0);
      return minutes > 0 ? `${name} (${formatNumber(minutes, locale, 0)} ${tr(locale, "min", "דק'")})` : name;
    })
    .filter((part): part is string => Boolean(part));

  const parts = [...foodParts, ...exerciseParts];
  return parts.join(" · ");
}

function statusClasses(status: "green" | "yellow" | "red") {
  if (status === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "yellow") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

const extraMetricLabels: Record<DailyReportChartExtraMetric, { en: string; he: string }> = {
  magnesium: { en: "Magnesium", he: "מגנזיום" },
  potassium: { en: "Potassium", he: "אשלגן" },
  iron: { en: "Iron", he: "ברזל" },
  zinc: { en: "Zinc", he: "אבץ" },
  sodium: { en: "Sodium", he: "נתרן" },
  addedSugar: { en: "Added Sugar", he: "סוכר מוסף" },
  calcium: { en: "Calcium", he: "סידן" },
  vitC: { en: "Vitamin C", he: "ויטמין C" },
  vitB12: { en: "Vitamin B12", he: "ויטמין B12" },
  vitD: { en: "Vitamin D", he: "ויטמין D" },
  satFat: { en: "Saturated Fat", he: "שומן רווי" },
  omega3: { en: "Omega-3", he: "אומגה 3" },
};

function compareRatio(value: number, target: number): "green" | "yellow" | "red" {
  if (target <= 0) return "yellow";
  const ratio = value / target;
  if (ratio >= 1) return "green";
  if (ratio >= 0.7) return "yellow";
  return "red";
}

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const aiAvailable = Boolean(getAiExtractionConfig());

  const { data: profileRow } = await supabase
    .from("user_profile")
    .select("preferred_language, daily_report_chart_preferences, weight_kg")
    .eq("user_id", user.id)
    .maybeSingle();

  const locale = normalizeLocale(profileRow?.preferred_language);
  const chartPreferences = normalizeDailyReportChartPreferences(profileRow?.daily_report_chart_preferences);

  // Daily-report entries no longer compare against scalar targets; the active
  // target profile stores min/max ranges instead. We compare against the
  // minimum of each range here (protein_min_g / water_min_ml) as a reasonable
  // "did you hit at least the floor" signal for this simple status badge.
  const { data: activeTargetProfile } = await supabase
    .from("user_target_profiles")
    .select(
      "id, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, water_min_ml, water_max_ml, calories_min, calories_max, fats_min_g, fats_max_g, fiber_min_g, fiber_max_g, magnesium_min_mg, magnesium_max_mg, potassium_min_mg, potassium_max_mg, iron_min_mg, iron_max_mg, zinc_min_mg, zinc_max_mg, sodium_min_mg, sodium_max_mg, added_sugar_min_g, added_sugar_max_g, calcium_min_mg, calcium_max_mg, vit_c_min_mg, vit_c_max_mg, vit_b12_min_mcg, vit_b12_max_mcg, vit_d_min_mcg, vit_d_max_mcg, sat_fat_min_g, sat_fat_max_g, omega3_min_g, omega3_max_g",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  const now = new Date();
  const todaysTotals = await getTodaysDailyReportTotals({ supabase, userId: user.id });

  const ringMetrics: RingMetric[] = [
    {
      id: "calories",
      labelEn: "Calories",
      labelHe: "קלוריות",
      total: todaysTotals.caloriesKcal,
      min: Number(activeTargetProfile?.calories_min ?? 0),
      max: Number(activeTargetProfile?.calories_max ?? 0),
      unit: "kcal",
    },
    {
      id: "protein",
      labelEn: "Protein",
      labelHe: "חלבון",
      total: todaysTotals.proteinG,
      min: Number(activeTargetProfile?.protein_min_g ?? 0),
      max: Number(activeTargetProfile?.protein_max_g ?? 0),
      unit: "g",
    },
    {
      id: "carbs",
      labelEn: "Carbs",
      labelHe: "פחמימות",
      total: todaysTotals.carbsG,
      min: Number(activeTargetProfile?.carbs_min_g ?? 0),
      max: Number(activeTargetProfile?.carbs_max_g ?? 0),
      unit: "g",
    },
    {
      id: "fats",
      labelEn: "Fats",
      labelHe: "שומנים",
      total: todaysTotals.fatG,
      min: Number(activeTargetProfile?.fats_min_g ?? 0),
      max: Number(activeTargetProfile?.fats_max_g ?? 0),
      unit: "g",
    },
    {
      id: "fiber",
      labelEn: "Dietary Fiber",
      labelHe: "סיבים תזונתיים",
      total: todaysTotals.fiberG,
      min: Number(activeTargetProfile?.fiber_min_g ?? 0),
      max: Number(activeTargetProfile?.fiber_max_g ?? 0),
      unit: "g",
    },
    {
      id: "water",
      labelEn: "Fluid / Water",
      labelHe: "נוזלים / מים",
      total: todaysTotals.waterMl,
      min: Number(activeTargetProfile?.water_min_ml ?? 0),
      max: Number(activeTargetProfile?.water_max_ml ?? 0),
      unit: "ml",
    },
  ];

  const extraMetricDefinitions: Record<DailyReportChartExtraMetric, RingMetric> = {
    magnesium: {
      id: "magnesium",
      labelEn: "Magnesium",
      labelHe: "מגנזיום",
      total: todaysTotals.magnesiumMg,
      min: Number(activeTargetProfile?.magnesium_min_mg ?? 0),
      max: Number(activeTargetProfile?.magnesium_max_mg ?? 0),
      unit: "mg",
    },
    potassium: {
      id: "potassium",
      labelEn: "Potassium",
      labelHe: "אשלגן",
      total: todaysTotals.potassiumMg,
      min: Number(activeTargetProfile?.potassium_min_mg ?? 0),
      max: Number(activeTargetProfile?.potassium_max_mg ?? 0),
      unit: "mg",
    },
    iron: {
      id: "iron",
      labelEn: "Iron",
      labelHe: "ברזל",
      total: todaysTotals.ironMg,
      min: Number(activeTargetProfile?.iron_min_mg ?? 0),
      max: Number(activeTargetProfile?.iron_max_mg ?? 0),
      unit: "mg",
    },
    zinc: {
      id: "zinc",
      labelEn: "Zinc",
      labelHe: "אבץ",
      total: todaysTotals.zincMg,
      min: Number(activeTargetProfile?.zinc_min_mg ?? 0),
      max: Number(activeTargetProfile?.zinc_max_mg ?? 0),
      unit: "mg",
    },
    sodium: {
      id: "sodium",
      labelEn: "Sodium",
      labelHe: "נתרן",
      total: todaysTotals.sodiumMg,
      min: Number(activeTargetProfile?.sodium_min_mg ?? 0),
      max: Number(activeTargetProfile?.sodium_max_mg ?? 0),
      unit: "mg",
    },
    addedSugar: {
      id: "addedSugar",
      labelEn: "Added Sugar",
      labelHe: "סוכר מוסף",
      total: todaysTotals.addedSugarG,
      min: Number(activeTargetProfile?.added_sugar_min_g ?? 0),
      max: Number(activeTargetProfile?.added_sugar_max_g ?? 0),
      unit: "g",
    },
    calcium: {
      id: "calcium",
      labelEn: "Calcium",
      labelHe: "סידן",
      total: todaysTotals.calciumMg,
      min: Number(activeTargetProfile?.calcium_min_mg ?? 0),
      max: Number(activeTargetProfile?.calcium_max_mg ?? 0),
      unit: "mg",
    },
    vitC: {
      id: "vitC",
      labelEn: "Vitamin C",
      labelHe: "ויטמין C",
      total: todaysTotals.vitCMg,
      min: Number(activeTargetProfile?.vit_c_min_mg ?? 0),
      max: Number(activeTargetProfile?.vit_c_max_mg ?? 0),
      unit: "mg",
    },
    vitB12: {
      id: "vitB12",
      labelEn: "Vitamin B12",
      labelHe: "ויטמין B12",
      total: todaysTotals.vitB12Mcg,
      min: Number(activeTargetProfile?.vit_b12_min_mcg ?? 0),
      max: Number(activeTargetProfile?.vit_b12_max_mcg ?? 0),
      unit: "mcg",
    },
    vitD: {
      id: "vitD",
      labelEn: "Vitamin D",
      labelHe: "ויטמין D",
      total: todaysTotals.vitDMcg,
      min: Number(activeTargetProfile?.vit_d_min_mcg ?? 0),
      max: Number(activeTargetProfile?.vit_d_max_mcg ?? 0),
      unit: "mcg",
    },
    satFat: {
      id: "satFat",
      labelEn: "Saturated Fat",
      labelHe: "שומן רווי",
      total: todaysTotals.satFatG,
      min: Number(activeTargetProfile?.sat_fat_min_g ?? 0),
      max: Number(activeTargetProfile?.sat_fat_max_g ?? 0),
      unit: "g",
    },
    omega3: {
      id: "omega3",
      labelEn: "Omega-3",
      labelHe: "אומגה 3",
      total: todaysTotals.omega3G,
      min: Number(activeTargetProfile?.omega3_min_g ?? 0),
      max: Number(activeTargetProfile?.omega3_max_g ?? 0),
      unit: "g",
    },
  };

  for (const metricId of chartPreferences.extraMetrics) {
    ringMetrics.push(extraMetricDefinitions[metricId]);
  }

  let weightHistory: WeightPoint[] = [];
  if (chartPreferences.showWeightTrend) {
    const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weightRows } = await supabase
      .from("user_daily_reports")
      .select("report_at, reported_weight_kg")
      .eq("user_id", user.id)
      .not("reported_weight_kg", "is", null)
      .gte("report_at", thirtyDaysAgoIso)
      .order("report_at", { ascending: true });

    weightHistory = (weightRows ?? [])
      .filter((row) => row.reported_weight_kg !== null)
      .map((row) => ({ date: row.report_at, weightKg: Number(row.reported_weight_kg) }));
  }

  let reportsError: Error | null = null;
  let reports:
    | Array<{
        id: string;
        raw_report_text: string | null;
        report_at: string;
        parse_confidence: number | null;
        calories_kcal: number | null;
        protein_g: number | null;
        carbs_g: number | null;
        fat_g: number | null;
        water_ml: number | null;
        magnesium_mg: number | null;
        potassium_mg: number | null;
        iron_mg: number | null;
        zinc_mg: number | null;
        exercise_minutes: number | null;
        estimated_burn_kcal: number | null;
        reported_weight_kg: number | null;
        parsed_items: unknown;
        parsed_exercises: unknown;
      }>
    | null = null;

  const reportsWithWeight = await supabase
    .from("user_daily_reports")
    .select(
      "id, raw_report_text, report_at, parse_confidence, calories_kcal, protein_g, carbs_g, fat_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, exercise_minutes, estimated_burn_kcal, reported_weight_kg, parsed_items, parsed_exercises",
    )
    .eq("user_id", user.id)
    .order("report_at", { ascending: false })
    .limit(20);

  if (reportsWithWeight.error && isMissingReportedWeightColumn(reportsWithWeight.error.message)) {
    const reportsWithoutWeight = await supabase
      .from("user_daily_reports")
      .select(
        "id, raw_report_text, report_at, parse_confidence, calories_kcal, protein_g, carbs_g, fat_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, exercise_minutes, estimated_burn_kcal, parsed_items, parsed_exercises",
      )
      .eq("user_id", user.id)
      .order("report_at", { ascending: false })
      .limit(20);

    reportsError = reportsWithoutWeight.error;
    reports = (reportsWithoutWeight.data ?? []).map((item) => ({ ...item, reported_weight_kg: null }));
  } else {
    reportsError = reportsWithWeight.error;
    reports = reportsWithWeight.data;
  }

  const { data: defaultItems } = await supabase
    .from("user_default_items")
    .select(
      "id, name, kind, default_quantity, default_unit, is_active",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (reportsError) {
    throw new Error(reportsError.message);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "User daily report", "דיווח יומי")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {tr(
            locale,
            "Record your daily food, drinks, activity, and other data.",
            "תעדו כאן את האוכל, השתייה, הפעילות והנתונים היומיים שלכם.",
          )}
        </p>

        {resolvedSearchParams.error ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {resolvedSearchParams.error}
          </p>
        ) : null}
        {resolvedSearchParams.notice ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {resolvedSearchParams.notice}
          </p>
        ) : null}

        <DailyReportForm
          defaultItems={defaultItems ?? []}
          aiAvailable={aiAvailable}
          locale={locale}
          currentWeightKg={profileRow?.weight_kg ? Number(profileRow.weight_kg) : null}
        />
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "Today's progress", "ההתקדמות שלך היום")}</h2>
        {activeTargetProfile ? (
          <>
            <div className="mt-4">
              <DailyReportProgressRings locale={locale} metrics={ringMetrics} />
            </div>

            {chartPreferences.showWeightTrend ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800">{tr(locale, "Weight trend (last 30 days)", "מגמת משקל (30 הימים האחרונים)")}</p>
                <div className="mt-2">
                  <DailyReportWeightTrend locale={locale} points={weightHistory} />
                </div>
              </div>
            ) : null}

            <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-teal-700">
                {tr(locale, "Customize charts", "התאמת התרשימים")}
              </summary>
              <form action={updateDailyReportChartPreferencesAction} className="mt-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {CHART_EXTRA_METRIC_IDS.map((metricId) => (
                    <label key={metricId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="extra_metric"
                        value={metricId}
                        defaultChecked={chartPreferences.extraMetrics.includes(metricId)}
                        className="h-4 w-4 accent-teal-700"
                      />
                      {tr(locale, extraMetricLabels[metricId].en, extraMetricLabels[metricId].he)}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="show_weight_trend"
                      defaultChecked={chartPreferences.showWeightTrend}
                      className="h-4 w-4 accent-teal-700"
                    />
                    {tr(locale, "Weight trend", "מגמת משקל")}
                  </label>
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800"
                >
                  {tr(locale, "Save chart preferences", "שמירת העדפות תרשימים")}
                </button>
              </form>
            </details>
          </>
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

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "Recent entries", "רשומות אחרונות")}</h2>

        {!reports?.length ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            {tr(locale, "No reports yet. Add your first free-text daily report above.", "אין עדיין דיווחים. אפשר להוסיף דיווח יומי ראשון למעלה.")}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {reports.map((report) => {
              const proteinStatus = activeTargetProfile?.protein_min_g
                ? compareRatio(Number(report.protein_g), Number(activeTargetProfile.protein_min_g))
                : "yellow";
              const hydrationTargetMl = activeTargetProfile?.water_min_ml
                ? Number(activeTargetProfile.water_min_ml)
                : 0;
              const hydrationStatus = hydrationTargetMl
                ? compareRatio(Number(report.water_ml), hydrationTargetMl)
                : "yellow";
              const entrySummary = buildEntrySummary(report.parsed_items, report.parsed_exercises, locale);
              const fullConversation = report.raw_report_text?.trim() ?? "";

              return (
                <article key={report.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {formatDateTimeForLocale(report.report_at, locale)}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">{tr(locale, "Confidence", "רמת ביטחון")}: {formatConfidence(report.parse_confidence, locale)}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(proteinStatus)}`}>
                        {tr(locale, "Protein", "חלבון")}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(hydrationStatus)}`}>
                        {tr(locale, "Hydration", "נוזלים")}
                      </span>
                    </div>
                  </div>

                  <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
                    {entrySummary || tr(locale, "No items recorded. Entry created from selected defaults.", "לא נרשמו פריטים. הרשומה נוצרה מברירות המחדל שנבחרו.")}
                  </p>

                  {fullConversation ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
                        {tr(locale, "View full conversation", "הצגת השיחה המלאה")}
                      </summary>
                      <p className="mt-2 whitespace-pre-line rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
                        {fullConversation}
                      </p>
                    </details>
                  ) : null}

                  <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                    <p>{tr(locale, "Reported weight", "משקל מדווח")}: <span className="font-semibold text-slate-900">{report.reported_weight_kg === null ? tr(locale, "n/a", "לא זמין") : formatNumber(report.reported_weight_kg, locale, 2)}</span>{report.reported_weight_kg === null ? "" : ` ${formatMeasurementUnit("kg", locale)}`}</p>
                    <p>{tr(locale, "Calories", "קלוריות")}: <span className="font-semibold text-slate-900">{formatNumber(report.calories_kcal, locale, 0)}</span> {tr(locale, "kcal", 'קק"ל')}</p>
                    <p>{tr(locale, "Protein", "חלבון")}: <span className="font-semibold text-slate-900">{formatNumber(report.protein_g, locale, 1)}</span> {formatMeasurementUnit("g", locale)}</p>
                    <p>{tr(locale, "Water", "מים")}: <span className="font-semibold text-slate-900">{formatNumber(report.water_ml, locale, 0)}</span> {formatMeasurementUnit("ml", locale)}</p>
                    <p>{tr(locale, "Exercise", "פעילות")}: <span className="font-semibold text-slate-900">{formatNumber(report.exercise_minutes, locale, 0)}</span> {formatMeasurementUnit("min", locale)}</p>
                    <p>{tr(locale, "Magnesium", "מגנזיום")}: <span className="font-semibold text-slate-900">{formatNumber(report.magnesium_mg, locale, 1)}</span> {formatMeasurementUnit("mg", locale)}</p>
                    <p>{tr(locale, "Potassium", "אשלגן")}: <span className="font-semibold text-slate-900">{formatNumber(report.potassium_mg, locale, 1)}</span> {formatMeasurementUnit("mg", locale)}</p>
                    <p>{tr(locale, "Iron", "ברזל")}: <span className="font-semibold text-slate-900">{formatNumber(report.iron_mg, locale, 2)}</span> {formatMeasurementUnit("mg", locale)}</p>
                    <p>{tr(locale, "Zinc", "אבץ")}: <span className="font-semibold text-slate-900">{formatNumber(report.zinc_mg, locale, 2)}</span> {formatMeasurementUnit("mg", locale)}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <details className="rounded-lg border border-cyan-200 bg-cyan-50/40 px-2 py-1">
                      <summary className="cursor-pointer list-none rounded-lg border border-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50">
                        {tr(locale, "Add to defaults", "הוספה לברירות מחדל")}
                      </summary>
                      <form action={addReportToDefaultsAction} className="mt-2 flex flex-wrap items-center gap-2 px-1 pb-1">
                        <input type="hidden" name="report_id" value={report.id} />
                        <input
                          type="text"
                          name="default_name"
                          maxLength={80}
                          placeholder={tr(locale, "e.g. My morning eggs breakfast", "לדוגמה: ארוחת בוקר ביצים שלי")}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
                        >
                          {tr(locale, "Save as default", "שמירה כברירת מחדל")}
                        </button>
                      </form>
                    </details>

                    <form action={deleteDailyReportAction}>
                      <input type="hidden" name="report_id" value={report.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        {tr(locale, "Delete entry", "מחיקת רשומה")}
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
