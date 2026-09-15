import Link from "next/link";
import { redirect } from "next/navigation";

import {
  addReportToDefaultsAction,
  deleteDailyReportAction,
  updateDailyReportChartPreferencesAction,
} from "@/app/app/daily-report/actions";
import { DailyReportForm } from "@/components/daily-report-form";
import { LocalizedDateInput } from "@/components/localized-date-input";
import { DailyReportProgressRings, type RingMetric } from "@/components/daily-report-progress-rings";
import { DailyReportWeightTrend, type WeightPoint } from "@/components/daily-report-weight-trend";
import {
  CHART_CORE_METRIC_IDS,
  CHART_EXTRA_METRIC_IDS,
  normalizeDailyReportChartPreferences,
  type DailyReportChartCoreMetric,
  type DailyReportChartExtraMetric,
} from "@/lib/daily-report-chart-preferences";
import { getDailyReportTotalsForRange } from "@/lib/daily-report";
import { normalizeUserTargetsJson } from "@/lib/targets";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { formatDateForLocale, formatDateTimeForLocale, formatMeasurementUnit, formatNumberForLocale, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

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

/**
 * The stored transcript always uses neutral "User"/"Assistant" line prefixes
 * regardless of locale (a stable internal format, also fed back into the AI
 * as conversation history) - this swaps in the user's real name and a
 * localized assistant label purely for display, so a Hebrew reader isn't
 * confronted with English words anchoring each line to the left in an
 * otherwise-RTL paragraph.
 */
function buildDisplayConversation(rawText: string, locale: AppLocale, userDisplayName: string): string {
  const assistantLabel = tr(locale, "Assistant", "עוזר");
  return rawText
    .split("\n")
    .map((line) => line.replace(/^User: /, `${userDisplayName}: `).replace(/^Assistant: /, `${assistantLabel}: `))
    .join("\n");
}

const coreMetricLabels: Record<DailyReportChartCoreMetric, { en: string; he: string }> = {
  calories: { en: "Calories", he: "קלוריות" },
  protein: { en: "Protein", he: "חלבון" },
  carbs: { en: "Carbs", he: "פחמימות" },
  fats: { en: "Fats", he: "שומנים" },
  fiber: { en: "Dietary Fiber", he: "סיבים תזונתיים" },
  water: { en: "Fluid / Water", he: "נוזלים / מים" },
};

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

function getUtcDateStringToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parses a YYYY-MM-DD search param into a valid UTC calendar-day string,
 * falling back to today for anything missing or malformed (e.g. a stale/
 * tampered query string) rather than letting an invalid date reach the
 * query below. */
function parseSelectedDateParam(value: string | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    return value;
  }
  return getUtcDateStringToday();
}

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; date?: string; edit?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const selectedDate = parseSelectedDateParam(resolvedSearchParams.date);
  const editReportId = resolvedSearchParams.edit || null;
  const selectedDayStartIso = new Date(`${selectedDate}T00:00:00.000Z`).toISOString();
  const selectedDayEndIso = new Date(new Date(`${selectedDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const aiAvailable = Boolean(getAiExtractionConfig());

  const { data: profileRow } = await supabase
    .from("user_profile")
    .select("preferred_language, daily_report_chart_preferences, weight_kg, first_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const locale = normalizeLocale(profileRow?.preferred_language);
  const userDisplayName = profileRow?.first_name?.trim() || tr(locale, "You", "אתה");
  const chartPreferences = normalizeDailyReportChartPreferences(profileRow?.daily_report_chart_preferences);

  // The weight field on the compose form should default to whatever the
  // user most recently reported (any prior report, not just today's),
  // falling back to their profile weight only if they've never reported one
  // - otherwise it always shows the same static profile value regardless of
  // what was actually last logged, which looks like weight entries aren't
  // being saved at all.
  const { data: lastWeightReport } = await supabase
    .from("user_daily_reports")
    .select("reported_weight_kg")
    .eq("user_id", user.id)
    .not("reported_weight_kg", "is", null)
    .order("report_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastRecordedWeightKg = lastWeightReport?.reported_weight_kg ?? null;

  // The report being edited (via the "Edit entry" button on the list below)
  // needs its full original content - not just the summary fields the list
  // query below selects - so DailyReportForm can faithfully re-seed the
  // chat/weight/custom-target inputs and saveDailyReportAction re-saves
  // everything that actually contributed to the original totals.
  let editingReport: {
    id: string;
    rawReportText: string;
    reportedWeightKg: number | null;
    reportAt: string;
    selectedDefaults: Array<{ id: string; quantity: number }>;
    customTargetValues: Record<string, number>;
  } | null = null;

  if (editReportId) {
    const { data: editableReportRow } = await supabase
      .from("user_daily_reports")
      .select("id, raw_report_text, reported_weight_kg, report_at, selected_defaults, custom_target_values")
      .eq("id", editReportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (editableReportRow) {
      const selectedDefaultsRaw = Array.isArray(editableReportRow.selected_defaults)
        ? (editableReportRow.selected_defaults as Array<{ id?: unknown; quantity?: unknown }>)
        : [];
      const customTargetValuesRaw =
        editableReportRow.custom_target_values && typeof editableReportRow.custom_target_values === "object"
          ? (editableReportRow.custom_target_values as Record<string, unknown>)
          : {};

      editingReport = {
        id: editableReportRow.id,
        rawReportText: editableReportRow.raw_report_text ?? "",
        reportedWeightKg: editableReportRow.reported_weight_kg ?? null,
        reportAt: editableReportRow.report_at,
        selectedDefaults: selectedDefaultsRaw
          .filter((item): item is { id: string; quantity: number } => typeof item.id === "string" && Number.isFinite(Number(item.quantity)))
          .map((item) => ({ id: item.id, quantity: Number(item.quantity) })),
        customTargetValues: Object.fromEntries(
          Object.entries(customTargetValuesRaw).filter(([, value]) => Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)]),
        ),
      };
    }
  }

  // Daily-report entries no longer compare against scalar targets; the active
  // target profile stores min/max ranges instead. We compare against the
  // minimum of each range here (protein_min_g / water_min_ml) as a reasonable
  // "did you hit at least the floor" signal for this simple status badge.
  const { data: activeTargetProfile } = await supabase
    .from("user_target_profiles")
    .select(
      "id, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, water_min_ml, water_max_ml, calories_min, calories_max, fats_min_g, fats_max_g, fiber_min_g, fiber_max_g, magnesium_min_mg, magnesium_max_mg, potassium_min_mg, potassium_max_mg, iron_min_mg, iron_max_mg, zinc_min_mg, zinc_max_mg, sodium_min_mg, sodium_max_mg, added_sugar_min_g, added_sugar_max_g, calcium_min_mg, calcium_max_mg, vit_c_min_mg, vit_c_max_mg, vit_b12_min_mcg, vit_b12_max_mcg, vit_d_min_mcg, vit_d_max_mcg, sat_fat_min_g, sat_fat_max_g, omega3_min_g, omega3_max_g, user_targets",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  // Only entries with a full id/unit/targetMin/targetMax set are loggable -
  // a legacy or non-numeric user_targets entry (display-only) is silently
  // excluded here rather than showing a broken/incomplete input for it.
  const loggableCustomTargets = normalizeUserTargetsJson(activeTargetProfile?.user_targets)
    .filter((entry) => entry.id && entry.unit && entry.targetMin !== undefined && entry.targetMax !== undefined)
    .map((entry) => ({
      id: entry.id!,
      label: entry.label,
      unit: entry.unit!,
    }));

  const now = new Date();
  const todaysTotals = await getDailyReportTotalsForRange({
    supabase,
    userId: user.id,
    rangeStartIso: selectedDayStartIso,
    rangeEndIso: selectedDayEndIso,
  });

  // Exercise burn offsets calories gained from food/drink - net can go
  // negative on a day with heavy exercise and light intake, which is a
  // legitimate value to show, not an error state. grossTotal is only
  // attached when there was actually something to burn back, so a day with
  // no exercise still shows a single plain number like before.
  const netCaloriesKcal = Math.round(todaysTotals.caloriesKcal - todaysTotals.estimatedBurnKcal);

  const coreMetricDefinitions: Record<DailyReportChartCoreMetric, RingMetric> = {
    calories: {
      id: "calories",
      labelEn: "Calories",
      labelHe: "קלוריות",
      total: netCaloriesKcal,
      ...(todaysTotals.estimatedBurnKcal > 0 ? { grossTotal: todaysTotals.caloriesKcal } : {}),
      min: Number(activeTargetProfile?.calories_min ?? 0),
      max: Number(activeTargetProfile?.calories_max ?? 0),
      unit: "kcal",
    },
    protein: {
      id: "protein",
      labelEn: "Protein",
      labelHe: "חלבון",
      total: todaysTotals.proteinG,
      min: Number(activeTargetProfile?.protein_min_g ?? 0),
      max: Number(activeTargetProfile?.protein_max_g ?? 0),
      unit: "g",
    },
    carbs: {
      id: "carbs",
      labelEn: "Carbs",
      labelHe: "פחמימות",
      total: todaysTotals.carbsG,
      min: Number(activeTargetProfile?.carbs_min_g ?? 0),
      max: Number(activeTargetProfile?.carbs_max_g ?? 0),
      unit: "g",
    },
    fats: {
      id: "fats",
      labelEn: "Fats",
      labelHe: "שומנים",
      total: todaysTotals.fatG,
      min: Number(activeTargetProfile?.fats_min_g ?? 0),
      max: Number(activeTargetProfile?.fats_max_g ?? 0),
      unit: "g",
    },
    fiber: {
      id: "fiber",
      labelEn: "Dietary Fiber",
      labelHe: "סיבים תזונתיים",
      total: todaysTotals.fiberG,
      min: Number(activeTargetProfile?.fiber_min_g ?? 0),
      max: Number(activeTargetProfile?.fiber_max_g ?? 0),
      unit: "g",
    },
    water: {
      id: "water",
      labelEn: "Fluid / Water",
      labelHe: "נוזלים / מים",
      total: todaysTotals.waterMl,
      min: Number(activeTargetProfile?.water_min_ml ?? 0),
      max: Number(activeTargetProfile?.water_max_ml ?? 0),
      unit: "ml",
    },
  };

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

  // Built in canonical order (not the order the user happened to check
  // boxes in, which `getAll()` would otherwise preserve) so the displayed
  // ring order stays stable and predictable regardless of how the
  // selection was saved.
  const ringMetrics: RingMetric[] = [
    ...CHART_CORE_METRIC_IDS.filter((id) => chartPreferences.coreMetrics.includes(id)).map((id) => coreMetricDefinitions[id]),
    ...CHART_EXTRA_METRIC_IDS.filter((id) => chartPreferences.extraMetrics.includes(id)).map((id) => extraMetricDefinitions[id]),
  ];

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
    .gte("report_at", selectedDayStartIso)
    .lt("report_at", selectedDayEndIso)
    .order("report_at", { ascending: false })
    .limit(200);

  if (reportsWithWeight.error && isMissingReportedWeightColumn(reportsWithWeight.error.message)) {
    const reportsWithoutWeight = await supabase
      .from("user_daily_reports")
      .select(
        "id, raw_report_text, report_at, parse_confidence, calories_kcal, protein_g, carbs_g, fat_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, exercise_minutes, estimated_burn_kcal, parsed_items, parsed_exercises",
      )
      .eq("user_id", user.id)
      .gte("report_at", selectedDayStartIso)
      .lt("report_at", selectedDayEndIso)
      .order("report_at", { ascending: false })
      .limit(200);

    reportsError = reportsWithoutWeight.error;
    reports = (reportsWithoutWeight.data ?? []).map((item) => ({ ...item, reported_weight_kg: null }));
  } else {
    reportsError = reportsWithWeight.error;
    reports = reportsWithWeight.data;
  }

  const { data: defaultItems } = await supabase
    .from("user_default_items")
    .select(
      "id, name, kind, default_quantity, default_unit, ingredients, is_active",
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
        <p className="text-sm text-slate-600">
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

        {editingReport ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            <span>{tr(locale, "Editing a previously saved entry - saving below will update it in place.", "עריכת רשומה שנשמרה בעבר - השמירה למטה תעדכן אותה במקום.")}</span>
            <Link
              href={resolvedSearchParams.date ? `/app/daily-report?date=${resolvedSearchParams.date}` : "/app/daily-report"}
              className="rounded-lg border border-teal-300 bg-white px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100"
            >
              {tr(locale, "Cancel edit", "ביטול עריכה")}
            </Link>
          </div>
        ) : null}

        <DailyReportForm
          key={editingReport?.id ?? "new"}
          defaultItems={defaultItems ?? []}
          aiAvailable={aiAvailable}
          locale={locale}
          customTargets={loggableCustomTargets}
          currentWeightKg={
            lastRecordedWeightKg !== null
              ? Number(lastRecordedWeightKg)
              : profileRow?.weight_kg
                ? Number(profileRow.weight_kg)
                : null
          }
          editingReport={editingReport}
          selectedDateParam={resolvedSearchParams.date}
        />
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {tr(locale, "Your Progress as of", "ההתקדמות שלך ליום")} {formatDateForLocale(`${selectedDate}T00:00:00.000Z`, locale)}
          </h2>
          <form method="GET" className="flex items-center gap-2">
            <LocalizedDateInput
              locale={locale}
              name="date"
              value={selectedDate}
              max={getUtcDateStringToday()}
              ariaLabel={tr(locale, "View date", "תאריך לצפייה")}
            />
            <button
              type="submit"
              className="rounded-lg border border-teal-300 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
            >
              {tr(locale, "View", "הצגה")}
            </button>
          </form>
        </div>
        {activeTargetProfile ? (
          <>
            {ringMetrics.length ? (
              <div className="mt-4">
                <DailyReportProgressRings locale={locale} metrics={ringMetrics} />
              </div>
            ) : !chartPreferences.showWeightTrend ? (
              <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
                {tr(
                  locale,
                  "No charts selected. Choose what to show under \"Customize charts\" below.",
                  "לא נבחרו תרשימים. יש לבחור מה להציג תחת \"התאמת התרשימים\" למטה.",
                )}
              </p>
            ) : null}

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
              <form action={updateDailyReportChartPreferencesAction} className="mt-3 space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {tr(locale, "Primary metrics", "מדדים עיקריים")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {CHART_CORE_METRIC_IDS.map((metricId) => (
                      <label key={metricId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          name="core_metric"
                          value={metricId}
                          defaultChecked={chartPreferences.coreMetrics.includes(metricId)}
                          className="h-4 w-4 accent-teal-700"
                        />
                        {tr(locale, coreMetricLabels[metricId].en, coreMetricLabels[metricId].he)}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {tr(locale, "Additional metrics", "מדדים נוספים")}
                  </p>
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
        <h2 className="text-lg font-semibold text-slate-900">
          {tr(locale, "Your Reports as of", "הדיווחים שלך ליום")} {formatDateForLocale(`${selectedDate}T00:00:00.000Z`, locale)}
        </h2>

        {!reports?.length ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            {tr(locale, "No reports for this date.", "אין דיווחים לתאריך זה.")}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {reports.map((report) => {
              const entrySummary = buildEntrySummary(report.parsed_items, report.parsed_exercises, locale);
              const fullConversation = report.raw_report_text?.trim() ?? "";

              const editHref = `/app/daily-report?edit=${report.id}${resolvedSearchParams.date ? `&date=${resolvedSearchParams.date}` : ""}`;
              const isBeingEdited = report.id === editReportId;

              return (
                <article
                  key={report.id}
                  className={`rounded-xl border p-4 ${isBeingEdited ? "border-teal-400 bg-teal-50/40 ring-1 ring-teal-300" : "border-slate-200 bg-slate-50"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {formatDateTimeForLocale(report.report_at, locale)}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">{tr(locale, "Confidence", "רמת ביטחון")}: {formatConfidence(report.parse_confidence, locale)}</p>
                    </div>
                    {isBeingEdited ? (
                      <span className="rounded-full border border-teal-300 bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-800">
                        {tr(locale, "Editing this entry", "עריכת רשומה זו")}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
                    {entrySummary || tr(locale, "No food or exercise items recorded.", "לא נרשמו פריטי מזון או פעילות.")}
                  </p>

                  {fullConversation ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
                        {tr(locale, "View full conversation", "הצגת השיחה המלאה")}
                      </summary>
                      <p
                        dir={locale === "he" ? "rtl" : "ltr"}
                        className="mt-2 whitespace-pre-line rounded-lg bg-white px-3 py-2 text-xs text-slate-600"
                      >
                        {buildDisplayConversation(fullConversation, locale, userDisplayName)}
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
                    <details>
                      <summary className="cursor-pointer list-none rounded-lg border border-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 [&::-webkit-details-marker]:hidden">
                        {tr(locale, "Add to Saved List", "הוספה לרשימה השמורה")}
                      </summary>
                      <form action={addReportToDefaultsAction} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50/40 px-2 py-2">
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
                          {tr(locale, "Save to Saved List", "שמירה לרשימה השמורה")}
                        </button>
                      </form>
                    </details>

                    <Link
                      href={editHref}
                      prefetch={false}
                      className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                    >
                      {tr(locale, "Edit entry", "עריכת רשומה")}
                    </Link>

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
