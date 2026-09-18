import Link from "next/link";
import { redirect } from "next/navigation";

import {
  addReportToDefaultsAction,
  deleteDailyReportAction,
  updateDailyReportChartPreferencesAction,
} from "@/app/app/daily-report/actions";
import { DailyReportDateJumpForm } from "@/components/daily-report-date-jump-form";
import { DailyReportEditPencilIcon, DailyReportEntryEditForm } from "@/components/daily-report-entry-edit-form";
import { DailyReportEntryQuickActions } from "@/components/daily-report-entry-quick-actions";
import { DailyReportForm } from "@/components/daily-report-form";
import { DailyReportPageNotice } from "@/components/daily-report-page-notice";
import { DailyReportGoalBars, type RingMetric } from "@/components/daily-report-goal-bars";
import { DailyReportWeightTrend, type WeightPoint } from "@/components/daily-report-weight-trend";
import {
  CHART_CORE_METRIC_IDS,
  CHART_EXTRA_METRIC_IDS,
  normalizeDailyReportChartPreferences,
  type DailyReportChartCoreMetric,
  type DailyReportChartExtraMetric,
} from "@/lib/daily-report-chart-preferences";
import { resolveUserGenderForAddressing } from "@/lib/ai/persona";
import { getDailyReportTotalsForRange } from "@/lib/daily-report";
import { normalizeUserTargetsJson } from "@/lib/targets";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { formatDateForLocale, formatDefaultUnit, formatMeasurementUnit, formatNumberForLocale, formatTimeForLocale, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
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
      return quantity > 0 && unit ? `${name} (${formatNumber(quantity, locale, 1)} ${formatDefaultUnit(unit, locale)})` : name;
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

type EditableFoodItem = { index: number; name: string; quantity: number; unit: string };
type EditableExerciseItem = { index: number; name: string; minutes: number };

/**
 * Item position within parsed_items/parsed_exercises doubles as its
 * identifier for the "Edit quantities" inline form below (see
 * adjustDailyReportItemQuantitiesAction's food_quantity__<index>/
 * exercise_minutes__<index> field names) - neither array carries a stable
 * per-item id of its own.
 */
function buildEditableItems(
  parsedItems: unknown,
  parsedExercises: unknown,
): { foodItems: EditableFoodItem[]; exerciseItems: EditableExerciseItem[] } {
  const foodItems = (Array.isArray(parsedItems) ? (parsedItems as SummaryFoodItem[]) : [])
    .map((item, index) => ({
      index,
      name: typeof item.name === "string" ? item.name : "",
      quantity: Number(item.quantity ?? 0),
      unit: typeof item.unit === "string" ? item.unit : "",
    }))
    .filter((item) => item.name);

  const exerciseItems = (Array.isArray(parsedExercises) ? (parsedExercises as SummaryExerciseItem[]) : [])
    .map((item, index) => ({
      index,
      name: typeof item.name === "string" ? item.name : "",
      minutes: Number(item.minutes ?? 0),
    }))
    .filter((item) => item.name);

  return { foodItems, exerciseItems };
}

/** The collapsed feed row's icon - one of a fixed small set based on what
 * the report actually contains, not an invented "meal type" the data model
 * has no concept of. */
function entryIconPaths(kind: "meal" | "exercise" | "weight" | "target") {
  if (kind === "exercise") return <path d="M6 7v10M18 7v10M2 9v6M22 9v6M6 12h12" />;
  if (kind === "weight") {
    return (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
        <circle cx="12" cy="12" r="3.4" />
      </>
    );
  }
  if (kind === "target") {
    return (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.2" />
      </>
    );
  }
  return (
    <>
      <path d="M4 13a8 8 0 0 0 16 0" />
      <path d="M4 13h16l-1 2a2 2 0 0 1-2 1.5H7A2 2 0 0 1 5 15z" />
    </>
  );
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
  cholesterol: { en: "Cholesterol", he: "כולסטרול" },
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

/** Sunday-start calendar week (matching the app's primary Hebrew/Israeli
 * locale convention) containing the given UTC date string - used for the
 * weekly exercise-adherence badge, which tracks the week around whichever
 * day the page is currently showing, consistent with everything else on
 * this page reacting to the selected date rather than always "right now". */
function getWeekBoundsIso(dateString: string): { weekStartIso: string; weekEndIso: string } {
  const dayStart = new Date(`${dateString}T00:00:00.000Z`);
  const weekStart = new Date(dayStart.getTime() - dayStart.getUTCDay() * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { weekStartIso: weekStart.toISOString(), weekEndIso: weekEnd.toISOString() };
}

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; date?: string; edit?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const selectedDate = parseSelectedDateParam(resolvedSearchParams.date);
  const editReportId = resolvedSearchParams.edit || null;
  const todayDateString = getUtcDateStringToday();
  const previousDateString = new Date(new Date(`${selectedDate}T00:00:00.000Z`).getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const nextDateString = new Date(new Date(`${selectedDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const isNextDayDisabled = selectedDate >= todayDateString;
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
  const now = new Date();
  const { weekStartIso, weekEndIso } = getWeekBoundsIso(selectedDate);
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Sentinel used to keep the "report being edited" lookup below in the same
  // Promise.all batch as everything else even when there's nothing to edit -
  // querying a UUID column that can never match a real row (rather than
  // branching the query in/out of the array) keeps every element the same
  // shape, so TypeScript doesn't have to reconcile two different response
  // types, and the extra lookup is free since it runs concurrently with the
  // rest anyway.
  const editableReportLookupId = editReportId ?? "00000000-0000-0000-0000-000000000000";

  // None of the reads below depends on another's result - each only needs
  // values already known from the URL (selectedDate/editReportId/etc) - so
  // they run as one batch of concurrent round-trips instead of one at a
  // time. This page previously issued 8+ sequential awaits to Postgres, each
  // paying its own network round-trip; that serial chain (not the AI parse
  // call some page loads follow, e.g. right after "Conclude & Report") was
  // the dominant cost behind slow daily-report loads, worth roughly 5-8x on
  // a page that's otherwise almost entirely reads.
  const [
    profileRowResult,
    weekExerciseRowsResult,
    lastWeightReportResult,
    editableReportRowResult,
    activeTargetProfileResult,
    todaysTotals,
    weightHistoryRowsResult,
    reportsWithWeight,
    defaultItemsResult,
  ] = await Promise.all([
    supabase
      .from("user_profile")
      .select("preferred_language, daily_report_chart_preferences, weight_kg, first_name, gender, biological_sex, exercise_modalities, exercise_schedule_by_modality, exercise_other_activities")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_daily_reports")
      .select("report_at, exercise_minutes")
      .eq("user_id", user.id)
      .gte("report_at", weekStartIso)
      .lt("report_at", weekEndIso)
      .gt("exercise_minutes", 0),
    supabase
      .from("user_daily_reports")
      .select("reported_weight_kg")
      .eq("user_id", user.id)
      .not("reported_weight_kg", "is", null)
      // report_at is minute-precision (see getLocalDateTimeValue in
      // daily-report-form.tsx) - two reports saved within the same minute
      // tie on it, and without a tiebreaker Postgres can return either one
      // regardless of which was actually saved last (confirmed as the
      // cause of the weight field's placeholder showing a stale value right
      // after saving a newer one). created_at (full precision, set once at
      // insert) reflects true save order - same fix as
      // resyncProfileWeightFromReports in daily-report/actions.ts, which
      // this must stay consistent with since both claim to answer the same
      // "what's the current weight" question.
      .order("report_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_daily_reports")
      .select("id, raw_report_text, reported_weight_kg, report_at, selected_defaults, custom_target_values, parsed_items, parsed_exercises")
      .eq("id", editableReportLookupId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_target_profiles")
      .select(
        "id, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, water_min_ml, water_max_ml, calories_min, calories_max, fats_min_g, fats_max_g, fiber_min_g, fiber_max_g, magnesium_min_mg, magnesium_max_mg, potassium_min_mg, potassium_max_mg, iron_min_mg, iron_max_mg, zinc_min_mg, zinc_max_mg, sodium_min_mg, sodium_max_mg, added_sugar_min_g, added_sugar_max_g, calcium_min_mg, calcium_max_mg, vit_c_min_mg, vit_c_max_mg, vit_b12_min_mcg, vit_b12_max_mcg, vit_d_min_mcg, vit_d_max_mcg, sat_fat_min_g, sat_fat_max_g, omega3_min_g, omega3_max_g, cholesterol_min_mg, cholesterol_max_mg, user_targets",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
    getDailyReportTotalsForRange({
      supabase,
      userId: user.id,
      rangeStartIso: selectedDayStartIso,
      rangeEndIso: selectedDayEndIso,
    }),
    supabase
      .from("user_daily_reports")
      .select("report_at, reported_weight_kg")
      .eq("user_id", user.id)
      .not("reported_weight_kg", "is", null)
      .gte("report_at", thirtyDaysAgoIso)
      .order("report_at", { ascending: true }),
    supabase
      .from("user_daily_reports")
      .select(
        "id, raw_report_text, report_at, parse_confidence, requires_confirmation, calories_kcal, protein_g, carbs_g, fat_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, exercise_minutes, estimated_burn_kcal, reported_weight_kg, parsed_items, parsed_exercises, custom_target_values, nutrient_overrides",
      )
      .eq("user_id", user.id)
      .gte("report_at", selectedDayStartIso)
      .lt("report_at", selectedDayEndIso)
      .order("report_at", { ascending: false })
      .limit(200),
    supabase
      .from("user_default_items")
      .select("id, name, kind, default_quantity, default_unit, ingredients, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const profileRow = profileRowResult.data;
  const locale = normalizeLocale(profileRow?.preferred_language);
  const userDisplayName = profileRow?.first_name?.trim() || tr(locale, "You", "אתה");
  // For the chat panel's own static greeting/intro copy (see
  // DailyReportChatPanel) - grammatically correct Hebrew addressing and an
  // occasional first-name mention, same rules the AI chat itself now
  // follows (see lib/ai/persona.ts, which this shares its normalization
  // logic with).
  const userFirstName = profileRow?.first_name?.trim() || null;
  const userGender = resolveUserGenderForAddressing(profileRow?.gender, profileRow?.biological_sex);
  const chartPreferences = normalizeDailyReportChartPreferences(profileRow?.daily_report_chart_preferences);

  // Weekly exercise-adherence badge: total sessions logged this calendar
  // week vs. the total weekly frequency the user's profile targets across
  // every modality (fixed + named "other" activities). Deliberately NOT
  // broken out per modality - a logged exercise entry is free text (e.g.
  // "walked 50 minutes") with no link back to which profile modality it
  // belongs to, so a per-modality count would need fragile keyword-guessing
  // rather than an accurate query. "Session" here means a distinct day with
  // at least one exercise logged, matching days_per_week's own unit.
  const scheduleByModalityForWeek =
    profileRow?.exercise_schedule_by_modality
    && typeof profileRow.exercise_schedule_by_modality === "object"
    && !Array.isArray(profileRow.exercise_schedule_by_modality)
      ? (profileRow.exercise_schedule_by_modality as Record<string, { days_per_week?: number }>)
      : {};
  const otherActivitiesForWeek = Array.isArray(profileRow?.exercise_other_activities)
    ? (profileRow.exercise_other_activities as Array<{ days_per_week?: number }>)
    : [];
  const weeklyExerciseTargetDays = Math.round(
    Object.values(scheduleByModalityForWeek).reduce((sum, entry) => sum + (Number(entry?.days_per_week) || 0), 0)
    + otherActivitiesForWeek.reduce((sum, entry) => sum + (Number(entry?.days_per_week) || 0), 0),
  );
  const weeklyExerciseLoggedDays = new Set(
    (weekExerciseRowsResult.data ?? []).map((row) => new Date(row.report_at).toISOString().slice(0, 10)),
  ).size;

  // The weight field on the compose form should default to whatever the
  // user most recently reported (any prior report, not just today's),
  // falling back to their profile weight only if they've never reported one
  // - otherwise it always shows the same static profile value regardless of
  // what was actually last logged, which looks like weight entries aren't
  // being saved at all.
  const lastRecordedWeightKg = lastWeightReportResult.data?.reported_weight_kg ?? null;

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
    itemsSummaryText: string;
  } | null = null;

  const editableReportRow = editReportId ? editableReportRowResult.data : null;
  if (editableReportRow) {
    const selectedDefaultsRaw = Array.isArray(editableReportRow.selected_defaults)
      ? (editableReportRow.selected_defaults as Array<{ id?: unknown; quantity?: unknown }>)
      : [];
    const customTargetValuesRaw =
      editableReportRow.custom_target_values && typeof editableReportRow.custom_target_values === "object"
        ? (editableReportRow.custom_target_values as Record<string, unknown>)
        : {};

    // A plain-text, locale-formatted line-per-item recap of exactly what
    // THIS entry (and only this entry - never anything else logged the same
    // day) currently contains, computed straight from its own parsed_items/
    // parsed_exercises rather than asking the AI to describe it - shown as
    // part of the chat panel's edit-mode intro so the user sees what's in
    // the entry immediately, without scrolling up through its original
    // conversation or risking the AI blending in some other entry.
    const editableFoodItemsRaw = Array.isArray(editableReportRow.parsed_items)
      ? (editableReportRow.parsed_items as Array<Record<string, unknown>>)
      : [];
    const editableExerciseItemsRaw = Array.isArray(editableReportRow.parsed_exercises)
      ? (editableReportRow.parsed_exercises as Array<Record<string, unknown>>)
      : [];
    const itemsSummaryLines = [
      ...editableFoodItemsRaw.map((item) => {
        const quantity = formatNumber(Number(item.quantity ?? 0), locale, Number.isInteger(Number(item.quantity)) ? 0 : 1);
        const unit = formatMeasurementUnit(String(item.unit ?? ""), locale);
        const kcal = formatNumber(Number(item.caloriesKcal ?? 0), locale, 0);
        return `${quantity} ${unit} ${tr(locale, "of", "של")} ${String(item.name ?? "")} (${kcal} ${tr(locale, "kcal", "קק\"ל")})`;
      }),
      ...editableExerciseItemsRaw.map((item) => {
        const minutes = formatNumber(Number(item.minutes ?? 0), locale, 0);
        const kcal = formatNumber(Number(item.estimatedBurnKcal ?? 0), locale, 0);
        return `${String(item.name ?? "")} - ${minutes} ${tr(locale, "min", "דקות")} (${tr(locale, "~", "~")}${kcal} ${tr(locale, "kcal burned", "קק\"ל נשרפו")})`;
      }),
    ];

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
      itemsSummaryText: itemsSummaryLines.join("\n"),
    };
  }

  // Daily-report entries no longer compare against scalar targets; the active
  // target profile stores min/max ranges instead. We compare against the
  // minimum of each range here (protein_min_g / water_min_ml) as a reasonable
  // "did you hit at least the floor" signal for this simple status badge.
  const activeTargetProfile = activeTargetProfileResult.data;

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
  const customTargetById = new Map(loggableCustomTargets.map((target) => [target.id, target]));

  // Exercise burn offsets calories gained from food/drink - net can go
  // negative on a day with heavy exercise and light intake, which is a
  // legitimate value to show, not an error state. grossTotal is only
  // attached when there was actually something to burn back, so a day with
  // no exercise still shows a single plain number like before.
  const netCaloriesKcal = Math.round(todaysTotals.caloriesKcal - todaysTotals.estimatedBurnKcal);

  const coreMetricDefinitions: Record<DailyReportChartCoreMetric, RingMetric> = {
    calories: {
      id: "calories",
      // "(net)" only when there's actually a gross/burned breakdown to
      // reconcile it against (see grossTotal below) - the bar's own number
      // is always net-of-exercise, but labeling it plain "Calories" reads
      // as if it matched what was eaten (808 in the reported mismatch) when
      // it's really 808 minus exercise burn. On a day with no exercise,
      // net and eaten are the same number anyway, so the plain label stays
      // accurate as-is.
      labelEn: todaysTotals.estimatedBurnKcal > 0 ? "Calories (net)" : "Calories",
      labelHe: todaysTotals.estimatedBurnKcal > 0 ? "קלוריות (נטו)" : "קלוריות",
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
      exceedingIsPositive: true,
    },
    carbs: {
      id: "carbs",
      labelEn: "Carbs",
      labelHe: "פחמימות",
      total: todaysTotals.carbsG,
      min: Number(activeTargetProfile?.carbs_min_g ?? 0),
      max: Number(activeTargetProfile?.carbs_max_g ?? 0),
      unit: "g",
      exceedingIsPositive: true,
    },
    fats: {
      id: "fats",
      labelEn: "Fats",
      labelHe: "שומנים",
      total: todaysTotals.fatG,
      min: Number(activeTargetProfile?.fats_min_g ?? 0),
      max: Number(activeTargetProfile?.fats_max_g ?? 0),
      unit: "g",
      exceedingIsPositive: true,
    },
    fiber: {
      id: "fiber",
      labelEn: "Dietary Fiber",
      labelHe: "סיבים תזונתיים",
      total: todaysTotals.fiberG,
      min: Number(activeTargetProfile?.fiber_min_g ?? 0),
      max: Number(activeTargetProfile?.fiber_max_g ?? 0),
      unit: "g",
      exceedingIsPositive: true,
    },
    water: {
      id: "water",
      labelEn: "Fluid / Water",
      labelHe: "נוזלים / מים",
      total: todaysTotals.waterMl,
      min: Number(activeTargetProfile?.water_min_ml ?? 0),
      max: Number(activeTargetProfile?.water_max_ml ?? 0),
      unit: "ml",
      exceedingIsPositive: true,
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
      exceedingIsPositive: true,
    },
    potassium: {
      id: "potassium",
      labelEn: "Potassium",
      labelHe: "אשלגן",
      total: todaysTotals.potassiumMg,
      min: Number(activeTargetProfile?.potassium_min_mg ?? 0),
      max: Number(activeTargetProfile?.potassium_max_mg ?? 0),
      unit: "mg",
      exceedingIsPositive: true,
    },
    iron: {
      id: "iron",
      labelEn: "Iron",
      labelHe: "ברזל",
      total: todaysTotals.ironMg,
      min: Number(activeTargetProfile?.iron_min_mg ?? 0),
      max: Number(activeTargetProfile?.iron_max_mg ?? 0),
      unit: "mg",
      exceedingIsPositive: true,
    },
    zinc: {
      id: "zinc",
      labelEn: "Zinc",
      labelHe: "אבץ",
      total: todaysTotals.zincMg,
      min: Number(activeTargetProfile?.zinc_min_mg ?? 0),
      max: Number(activeTargetProfile?.zinc_max_mg ?? 0),
      unit: "mg",
      exceedingIsPositive: true,
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
      exceedingIsPositive: true,
    },
    vitC: {
      id: "vitC",
      labelEn: "Vitamin C",
      labelHe: "ויטמין C",
      total: todaysTotals.vitCMg,
      min: Number(activeTargetProfile?.vit_c_min_mg ?? 0),
      max: Number(activeTargetProfile?.vit_c_max_mg ?? 0),
      unit: "mg",
      exceedingIsPositive: true,
    },
    vitB12: {
      id: "vitB12",
      labelEn: "Vitamin B12",
      labelHe: "ויטמין B12",
      total: todaysTotals.vitB12Mcg,
      min: Number(activeTargetProfile?.vit_b12_min_mcg ?? 0),
      max: Number(activeTargetProfile?.vit_b12_max_mcg ?? 0),
      unit: "mcg",
      exceedingIsPositive: true,
    },
    vitD: {
      id: "vitD",
      labelEn: "Vitamin D",
      labelHe: "ויטמין D",
      total: todaysTotals.vitDMcg,
      min: Number(activeTargetProfile?.vit_d_min_mcg ?? 0),
      max: Number(activeTargetProfile?.vit_d_max_mcg ?? 0),
      unit: "mcg",
      exceedingIsPositive: true,
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
      exceedingIsPositive: true,
    },
    cholesterol: {
      id: "cholesterol",
      labelEn: "Cholesterol",
      labelHe: "כולסטרול",
      total: todaysTotals.cholesterolMg,
      min: Number(activeTargetProfile?.cholesterol_min_mg ?? 0),
      max: Number(activeTargetProfile?.cholesterol_max_mg ?? 0),
      unit: "mg",
    },
  };

  // Built in canonical order (not the order the user happened to check
  // boxes in, which `getAll()` would otherwise preserve) so the displayed
  // order stays stable and predictable regardless of how the selection was
  // saved. Kept as two separate arrays (rather than one merged list, as
  // before DailyReportGoalBars replaced the ring grid) - core metrics
  // render as always-visible bars, extra metrics render collapsed behind
  // "Show full detail".
  const coreDisplayMetrics: RingMetric[] = CHART_CORE_METRIC_IDS.filter((id) => chartPreferences.coreMetrics.includes(id)).map(
    (id) => coreMetricDefinitions[id],
  );
  const extraDisplayMetrics: RingMetric[] = CHART_EXTRA_METRIC_IDS.filter((id) => chartPreferences.extraMetrics.includes(id)).map(
    (id) => extraMetricDefinitions[id],
  );

  const weightHistory: WeightPoint[] = chartPreferences.showWeightTrend
    ? (weightHistoryRowsResult.data ?? [])
        .filter((row) => row.reported_weight_kg !== null)
        .map((row) => ({ date: row.report_at, weightKg: Number(row.reported_weight_kg) }))
    : [];

  let reportsError: Error | null = null;
  let reports:
    | Array<{
        id: string;
        raw_report_text: string | null;
        report_at: string;
        parse_confidence: number | null;
        requires_confirmation: boolean | null;
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
        custom_target_values: unknown;
        nutrient_overrides: unknown;
      }>
    | null = null;

  if (reportsWithWeight.error && isMissingReportedWeightColumn(reportsWithWeight.error.message)) {
    const reportsWithoutWeight = await supabase
      .from("user_daily_reports")
      .select(
        "id, raw_report_text, report_at, parse_confidence, requires_confirmation, calories_kcal, protein_g, carbs_g, fat_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, exercise_minutes, estimated_burn_kcal, parsed_items, parsed_exercises, custom_target_values, nutrient_overrides",
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

  const defaultItems = defaultItemsResult.data;

  if (reportsError) {
    throw new Error(reportsError.message);
  }

  // Today's (or whatever day is being viewed) already-logged custom target
  // values (e.g. Sleep duration), most-recent-report-wins per target id -
  // mirrors lastRecordedWeightKg's own "most recently reported" precedence.
  // Lets DailyReportForm's quick-entry field keep showing an already-logged
  // value even on a fresh page load, not just right after saving in the same
  // browser session, so the user can tell at a glance they already logged it
  // for this day. `reports` is already scoped to selectedDayStartIso..
  // selectedDayEndIso and sorted newest-first, so this naturally reads as
  // empty again on any day nothing has been logged for yet.
  const todaysCustomTargetValues: Record<string, number> = {};
  for (const report of reports ?? []) {
    if (!report.custom_target_values || typeof report.custom_target_values !== "object" || Array.isArray(report.custom_target_values)) {
      continue;
    }
    for (const [id, rawValue] of Object.entries(report.custom_target_values as Record<string, unknown>)) {
      if (id in todaysCustomTargetValues) continue;
      const value = Number(rawValue);
      if (Number.isFinite(value)) {
        todaysCustomTargetValues[id] = value;
      }
    }
  }

  return (
    // Extra bottom padding below `sm` clears the chat panel's floating
    // bubble trigger (fixed above AppBottomNav on mobile - see
    // daily-report-chat-panel.tsx) so the last entry's tap targets are never
    // covered by it; AppBottomNav's own height is already reserved globally
    // in layout.tsx. Much smaller than the old pinned-composer-dock
    // reservation this replaced - a single floating circle needs far less
    // clearance than a full chip row + textarea + send + save dock did.
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-10 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-10">
      {/* A centered, self-dismissing toast (see DailyReportPageNotice) for
          whatever several actions on this page (add to saved list, adjust
          item quantities, chart preferences, etc.) still redirect back
          with as ?notice=/?error= - shown regardless of scroll position,
          not a banner competing for a spot in the page's own layout, so it
          doesn't matter that the form/list those actions actually touch
          can sit anywhere on the page. */}
      <DailyReportPageNotice
        locale={locale}
        notice={resolvedSearchParams.notice}
        error={resolvedSearchParams.error}
        clearedHref={resolvedSearchParams.date ? `/app/daily-report?date=${resolvedSearchParams.date}` : "/app/daily-report"}
      />
      {editingReport ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
          <span>{tr(locale, "Editing a previously saved entry - saving will update it in place.", "עריכת רשומה שנשמרה בעבר - השמירה תעדכן אותה במקום.")}</span>
          <Link
            href={resolvedSearchParams.date ? `/app/daily-report?date=${resolvedSearchParams.date}` : "/app/daily-report"}
            className="rounded-lg border border-teal-300 bg-white px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100 dark:border-teal-700 dark:bg-slate-900 dark:text-teal-400 dark:hover:bg-teal-900/40"
          >
            {tr(locale, "Cancel edit", "ביטול עריכה")}
          </Link>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          {/* dir="ltr" locked here (not just on numeric spans, as usual) so
              the two arrows stay tied to their own DOM position instead of
              swapping sides with the page's RTL direction - a chevron
              pointing "<" needs to sit physically left of one pointing ">",
              same as any date-nav pager, regardless of Hebrew vs English.
              Without it, RTL visually reverses this row so the "<" (first
              child, previousDay) lands on the right and ">" (last child,
              nextDay) lands on the left - both arrows pointing the "wrong"
              way for where they'd actually appear on screen. The Hebrew
              title/date text below still renders correctly since Hebrew
              glyphs carry their own right-to-left directionality regardless
              of this ancestor's dir. */}
          <div dir="ltr" className="flex w-full items-center justify-center gap-4">
            <Link
              href={`/app/daily-report?date=${previousDateString}`}
              aria-label={tr(locale, "Previous day", "יום קודם")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </Link>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Today's summary", "סיכום היום שלי")}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{formatDateForLocale(`${selectedDate}T00:00:00.000Z`, locale)}</p>
            </div>
            {isNextDayDisabled ? (
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-300 dark:border-slate-800 dark:text-slate-600"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            ) : (
              <Link
                href={`/app/daily-report?date=${nextDateString}`}
                aria-label={tr(locale, "Next day", "יום הבא")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            )}
          </div>

          <details className="w-full text-center">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {tr(locale, "Jump to a date", "מעבר לתאריך אחר")}
            </summary>
            <DailyReportDateJumpForm locale={locale} selectedDate={selectedDate} todayDateString={todayDateString} />
          </details>
        </div>

        {weeklyExerciseTargetDays > 0 ? (
          <div className="mt-3 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-700 dark:text-teal-400" aria-hidden="true">
                {entryIconPaths("exercise")}
              </svg>
              {tr(locale, "Exercise this week", "פעילות השבוע")}
              {": "}
              <span dir="ltr" className={weeklyExerciseLoggedDays >= weeklyExerciseTargetDays ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900 dark:text-slate-100"}>
                {weeklyExerciseLoggedDays}/{weeklyExerciseTargetDays}
              </span>
            </span>
          </div>
        ) : null}

        {/* Empty on purpose - DailyReportForm portals its Weight/Sleep
            fields here (see its own comment) instead of rendering them in
            their old spot at the bottom of the page. Placed above the bar
            charts (and outside the activeTargetProfile check below) since
            logging weight/sleep shouldn't depend on targets being set. */}
        <div id="daily-report-quick-metrics" className="mt-4 flex flex-wrap gap-2" />

        {activeTargetProfile ? (
          <>
            {coreDisplayMetrics.length || extraDisplayMetrics.length ? (
              <div className="mt-4">
                <DailyReportGoalBars locale={locale} coreMetrics={coreDisplayMetrics} extraMetrics={extraDisplayMetrics} />
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
                {tr(
                  locale,
                  "No charts selected. Choose what to show under \"Customize charts\" below.",
                  "לא נבחרו תרשימים. יש לבחור מה להציג תחת \"התאמת התרשימים\" למטה.",
                )}
              </p>
            )}

            {/* Previously this chart only ever appeared inside a specific
                weigh-in entry's own expanded detail further down the page -
                meaning enabling "Weight trend" below showed nothing at all
                unless you happened to open a report that itself logged a
                weight today. That made the toggle look broken. Showing it
                here too (gated on the same preference, plus actually having
                at least one weigh-in in the last 30 days) makes it reachable
                the moment it's turned on, the way every other chart here
                already is - the per-entry copy further down still exists
                alongside it, not instead of it. */}
            {chartPreferences.showWeightTrend && weightHistory.length > 0 ? (
              <details open className="mt-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <summary className="cursor-pointer text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {tr(locale, "Weight trend (last 30 days)", "מגמת משקל (30 הימים האחרונים)")}
                </summary>
                <div className="mt-2">
                  <DailyReportWeightTrend locale={locale} points={weightHistory} />
                </div>
              </details>
            ) : null}

            <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
              <summary className="cursor-pointer text-sm font-semibold text-teal-700 dark:text-teal-400">
                {tr(locale, "Customize charts", "התאמת התרשימים")}
              </summary>
              <form action={updateDailyReportChartPreferencesAction} className="mt-3 space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tr(locale, "Primary metrics", "מדדים עיקריים")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {CHART_CORE_METRIC_IDS.map((metricId) => (
                      <label key={metricId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
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
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tr(locale, "Additional metrics", "מדדים נוספים")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {CHART_EXTRA_METRIC_IDS.map((metricId) => (
                      <label key={metricId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
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
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
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
                  className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                >
                  {tr(locale, "Save chart preferences", "שמירת העדפות תרשימים")}
                </button>
              </form>
            </details>
          </>
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

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {tr(locale, "Your Reports as of", "הדיווחים שלך ליום")} {formatDateForLocale(`${selectedDate}T00:00:00.000Z`, locale)}
        </h2>

        {!reports?.length ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {tr(locale, "No reports for this date.", "אין דיווחים לתאריך זה.")}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {reports.map((report) => {
              const entrySummary = buildEntrySummary(report.parsed_items, report.parsed_exercises, locale);
              const fullConversation = report.raw_report_text?.trim() ?? "";
              const { foodItems: editableFoodItems, exerciseItems: editableExerciseItems } = buildEditableItems(
                report.parsed_items,
                report.parsed_exercises,
              );

              const editHref = `/app/daily-report?edit=${report.id}${resolvedSearchParams.date ? `&date=${resolvedSearchParams.date}` : ""}`;
              const isBeingEdited = report.id === editReportId;

              const hasFood = editableFoodItems.length > 0;
              const hasExercise = editableExerciseItems.length > 0;
              const hasWeight = report.reported_weight_kg !== null;

              const reportCustomTargetValues =
                report.custom_target_values
                && typeof report.custom_target_values === "object"
                && !Array.isArray(report.custom_target_values)
                  ? (report.custom_target_values as Record<string, number>)
                  : {};
              const reportCustomTargetRows = Object.entries(reportCustomTargetValues)
                .map(([id, value]) => ({ target: customTargetById.get(id), value }))
                .filter((row): row is { target: { id: string; label: string; unit: string }; value: number } => Boolean(row.target));

              // Which of this report's own nutrient totals are directly
              // editable in "Edit" below, and whether each is currently
              // pinned to a manually-entered value (see nutrient_overrides -
              // db/migrations/034_phase12_daily_report_nutrient_overrides.sql)
              // rather than derived from its items. Only the fields the
              // detail grid above actually shows, same as that grid's own
              // hasFood/hasExercise gating - a weight/target-only report has
              // nothing meaningful here to correct.
              const reportNutrientOverrides =
                report.nutrient_overrides
                && typeof report.nutrient_overrides === "object"
                && !Array.isArray(report.nutrient_overrides)
                  ? (report.nutrient_overrides as Record<string, boolean>)
                  : {};
              const nutrientFields =
                hasFood || hasExercise
                  ? [
                      {
                        dbColumn: "calories_kcal",
                        labelEn: "Calories",
                        labelHe: "קלוריות",
                        unit: "kcal",
                        value: report.calories_kcal ?? 0,
                        overridden: Boolean(reportNutrientOverrides.calories_kcal),
                      },
                      {
                        dbColumn: "protein_g",
                        labelEn: "Protein",
                        labelHe: "חלבון",
                        unit: "g",
                        value: report.protein_g ?? 0,
                        overridden: Boolean(reportNutrientOverrides.protein_g),
                      },
                      {
                        dbColumn: "water_ml",
                        labelEn: "Water",
                        labelHe: "מים",
                        unit: "ml",
                        value: report.water_ml ?? 0,
                        overridden: Boolean(reportNutrientOverrides.water_ml),
                      },
                      ...(hasExercise
                        ? [
                            {
                              dbColumn: "estimated_burn_kcal",
                              labelEn: "Calories burned",
                              labelHe: "קלוריות שנשרפו",
                              unit: "kcal",
                              value: report.estimated_burn_kcal ?? 0,
                              overridden: Boolean(reportNutrientOverrides.estimated_burn_kcal),
                            },
                          ]
                        : []),
                      {
                        dbColumn: "magnesium_mg",
                        labelEn: "Magnesium",
                        labelHe: "מגנזיום",
                        unit: "mg",
                        value: report.magnesium_mg ?? 0,
                        overridden: Boolean(reportNutrientOverrides.magnesium_mg),
                      },
                      {
                        dbColumn: "potassium_mg",
                        labelEn: "Potassium",
                        labelHe: "אשלגן",
                        unit: "mg",
                        value: report.potassium_mg ?? 0,
                        overridden: Boolean(reportNutrientOverrides.potassium_mg),
                      },
                      {
                        dbColumn: "iron_mg",
                        labelEn: "Iron",
                        labelHe: "ברזל",
                        unit: "mg",
                        value: report.iron_mg ?? 0,
                        overridden: Boolean(reportNutrientOverrides.iron_mg),
                      },
                      {
                        dbColumn: "zinc_mg",
                        labelEn: "Zinc",
                        labelHe: "אבץ",
                        unit: "mg",
                        value: report.zinc_mg ?? 0,
                        overridden: Boolean(reportNutrientOverrides.zinc_mg),
                      },
                    ]
                  : [];

              const formatTargetValue = (value: number, unit: string) =>
                `${formatNumberForLocale(value, locale, { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 })} ${formatMeasurementUnit(unit, locale)}`;
              // An exercise-only entry (no food) has nothing meaningful in
              // calories_kcal - that column only ever holds calories EATEN,
              // always 0 with nothing logged to eat - the calories the
              // exercise itself burned live in the separate
              // estimated_burn_kcal column instead. The pill used to always
              // show calories_kcal regardless, so a pure exercise entry
              // (e.g. "Strength training (60 min)") displayed "0 kcal" even
              // though real burn had been estimated and counted toward the
              // day's totals - reported as "the number of calories does not
              // change" when logging exercise. hasFood still wins when an
              // entry has both (matching entryKind's own meal-first
              // priority above) since calories eaten is the more relevant
              // headline number there. estimated_burn_kcal is shown as a
              // negative number with the plain "kcal" unit (e.g. "-220
              // kcal") rather than a positive number plus a "burned"
              // qualifier - reads at a glance as a deduction the same way an
              // expense-tracking app shows a refund, without needing an
              // extra word to explain the direction.
              //
              // number/unit kept as two separate fields (rendered as two
              // separate flex items below, not one concatenated string) -
              // a plain "${number} ${unit}" string, even inside a dir="ltr"
              // wrapper, still let the Hebrew unit word visually swap
              // places with its own number (reported as "קק"ל 0" instead of
              // "0 קק"ל") because the two were never actually isolated from
              // each other's bidi run, just forced into an LTR paragraph
              // that couldn't fully pin a lone RTL word's position within
              // it - the exact same class of bug the goal-bars "eaten -
              // burned = net" line had. Separate flex items sidestep it by
              // construction: layout order comes from flex-direction, which
              // bidi text reordering can't touch, regardless of the
              // *value*'s own reading direction - and rendering with NO
              // forced dir on the pill itself (only the number span keeps
              // its own dir="ltr", to protect the digits themselves from
              // ever reversing) means each locale's natural direction
              // decides the number/unit order on its own: Hebrew (RTL)
              // reads the number first, landing physically on the right
              // with the unit trailing to its left; English (LTR) reads
              // the same number-first order onto the left instead - both
              // exactly matching how each locale would order it naturally.
              const valuePill: { number: string; unit: string } | null = hasFood
                ? { number: formatNumber(report.calories_kcal, locale, 0), unit: tr(locale, "kcal", 'קק"ל') }
                : hasExercise
                  ? { number: formatNumber(-Math.abs(Number(report.estimated_burn_kcal ?? 0)), locale, 0), unit: tr(locale, "kcal", 'קק"ל') }
                  : hasWeight
                    ? { number: formatNumber(report.reported_weight_kg, locale, 2), unit: formatMeasurementUnit("kg", locale) }
                    : reportCustomTargetRows.length === 1
                      ? {
                          number: formatNumberForLocale(reportCustomTargetRows[0].value, locale, {
                            maximumFractionDigits: Number.isInteger(reportCustomTargetRows[0].value) ? 0 : 1,
                          }),
                          unit: formatMeasurementUnit(reportCustomTargetRows[0].target.unit, locale),
                        }
                      : Number(report.calories_kcal ?? 0) > 0
                        ? { number: formatNumber(report.calories_kcal, locale, 0), unit: tr(locale, "kcal", 'קק"ל') }
                        : null;
              // A report holding only a custom target value has nothing for
              // buildEntrySummary to describe (it only looks at parsed food/
              // exercise items), so the row's own custom target(s) become
              // the summary line instead of the generic "nothing recorded"
              // fallback - that fallback is now reserved for a report that
              // genuinely has none of food, exercise, weight, or a tracked
              // value (which shouldn't normally happen, but is possible for
              // a legacy/edge-case row). A weight-only report has the exact
              // same gap - buildEntrySummary has nothing to say about it
              // either - so it gets the same treatment instead of also
              // falling through to the generic "nothing recorded" text.
              const noContentSummaryParts: string[] = [];
              if (hasWeight) {
                noContentSummaryParts.push(
                  `${tr(locale, "Weight", "משקל")} (${formatNumber(report.reported_weight_kg, locale, 2)} ${formatMeasurementUnit("kg", locale)})`,
                );
              }
              for (const row of reportCustomTargetRows) {
                noContentSummaryParts.push(`${row.target.label} (${formatTargetValue(row.value, row.target.unit)})`);
              }
              const displaySummary =
                entrySummary
                || noContentSummaryParts.join(" · ")
                || tr(locale, "No food or exercise items recorded.", "לא נרשמו פריטי מזון או פעילות.");

              return (
                <div key={report.id} className="space-y-2">
                  <details
                    id={`daily-report-entry-${report.id}`}
                    open={isBeingEdited}
                    className={`rounded-xl border transition-colors duration-700 ${isBeingEdited ? "border-teal-400 bg-teal-50/40 ring-1 ring-teal-300 dark:border-teal-700 dark:bg-teal-950/30 dark:ring-teal-700" : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60"}`}
                  >
                    <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
                      {/* Top row is dedicated to the time and the trailing
                          controls (value pill, quick actions, chevron) -
                          previously these sat beside the summary text in one
                          flex row, which both squeezed the text into a
                          narrow column (wrapping after only a few
                          characters) and left the icons vertically centered
                          against the whole, often multi-line, block once
                          the text wrapped - reported as icons floating off
                          to the side, disconnected from the row they
                          belonged to. The summary text now gets its own
                          full-width row below instead. */}
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span dir="ltr" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {formatTimeForLocale(report.report_at, locale)}
                          </span>
                          {isBeingEdited ? (
                            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-800 dark:bg-teal-900/50 dark:text-teal-300">
                              {tr(locale, "Editing", "בעריכה")}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {valuePill ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              <span dir="ltr" className="tabular-nums">{valuePill.number}</span>
                              <span>{valuePill.unit}</span>
                            </span>
                          ) : null}
                          {/* Replaces the old entry-kind icon (redundant
                              next to the item text itself) with two
                              quick-action icons - delete and a shortcut to
                              the inline edit form - at the row's trailing
                              edge, right next to the chevron. Every handler
                              in DailyReportEntryQuickActions calls
                              stopPropagation, since it's visually inside
                              this <summary> (the whole row's click-to-expand
                              toggle) even though it isn't logically part of
                              it - without that, tapping either icon would
                              also fire the native <details> toggle
                              underneath it. */}
                          <DailyReportEntryQuickActions
                            locale={locale}
                            userGender={userGender}
                            reportId={report.id}
                            hasInlineEdit={editableFoodItems.length > 0 || editableExerciseItems.length > 0 || hasWeight || reportCustomTargetRows.length > 0}
                          />
                          <span className="flex shrink-0 items-center gap-1 text-slate-400 dark:text-slate-500">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </span>
                        </span>
                      </div>
                      {/* No truncate here (deliberately, on purpose) - a
                          single-line ellipsis silently hid later items once
                          the joined summary ran past one line's width, e.g.
                          "Pear (1 unit) · Soda (1 glass)" collapsing to just
                          "Pear (1 unit) ..." with no indication anything
                          followed. Reported as "I added soda from my saved
                          list but don't see it in the log" - it WAS saved
                          (and did count toward the day's totals), just
                          invisible at a glance. Wrapping instead of clipping
                          means the collapsed row can grow to two or more
                          lines when an entry holds several items, which is
                          the honest trade-off for never silently hiding
                          one - now across the row's full width instead of a
                          narrow column squeezed beside the trailing icons. */}
                      <span className="mt-1.5 block text-xs text-slate-600 dark:text-slate-400">
                        {displaySummary}
                      </span>
                    </summary>

                    <div className="space-y-3 border-t border-dashed border-slate-300 px-4 pb-4 pt-3 dark:border-slate-700">
                      {fullConversation ? (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
                            {tr(locale, "View full conversation", "הצגת השיחה המלאה")}
                          </summary>
                          <p
                            dir={locale === "he" ? "rtl" : "ltr"}
                            className="mt-2 whitespace-pre-line rounded-lg bg-white px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          >
                            {buildDisplayConversation(fullConversation, locale, userDisplayName)}
                          </p>
                        </details>
                      ) : null}

                      {hasWeight && chartPreferences.showWeightTrend ? (
                        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-800">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {tr(locale, "Weight trend (last 30 days)", "מגמת משקל (30 הימים האחרונים)")}
                          </p>
                          <div className="mt-2">
                            <DailyReportWeightTrend locale={locale} points={weightHistory} />
                          </div>
                        </div>
                      ) : null}

                      {/* The full nutrient/exercise grid only earns its
                          place when there's actual food or exercise data to
                          show - for a weight-only (or target-only) report
                          every one of these fields but one is a meaningless
                          zero, which read as a wall of irrelevant noise.
                          Weight-only and target-only reports below get just
                          their own relevant value(s) instead. */}
                      {hasFood || hasExercise ? (
                        <div className="grid gap-2 text-xs text-slate-700 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                          <p>{tr(locale, "Reported weight", "משקל מדווח")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{report.reported_weight_kg === null ? tr(locale, "n/a", "לא זמין") : formatNumber(report.reported_weight_kg, locale, 2)}</span>{report.reported_weight_kg === null ? "" : ` ${formatMeasurementUnit("kg", locale)}`}</p>
                          <p>{tr(locale, "Calories", "קלוריות")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.calories_kcal, locale, 0)}</span> {tr(locale, "kcal", 'קק"ל')}</p>
                          <p>{tr(locale, "Protein", "חלבון")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.protein_g, locale, 1)}</span> {formatMeasurementUnit("g", locale)}</p>
                          <p>{tr(locale, "Water", "מים")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.water_ml, locale, 0)}</span> {formatMeasurementUnit("ml", locale)}</p>
                          <p>{tr(locale, "Exercise", "פעילות")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.exercise_minutes, locale, 0)}</span> {formatMeasurementUnit("min", locale)}</p>
                          {hasExercise ? (
                            <p>{tr(locale, "Calories burned", "קלוריות שנשרפו")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.estimated_burn_kcal, locale, 0)}</span> {tr(locale, "kcal", 'קק"ל')}</p>
                          ) : null}
                          <p>{tr(locale, "Magnesium", "מגנזיום")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.magnesium_mg, locale, 1)}</span> {formatMeasurementUnit("mg", locale)}</p>
                          <p>{tr(locale, "Potassium", "אשלגן")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.potassium_mg, locale, 1)}</span> {formatMeasurementUnit("mg", locale)}</p>
                          <p>{tr(locale, "Iron", "ברזל")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.iron_mg, locale, 2)}</span> {formatMeasurementUnit("mg", locale)}</p>
                          <p>{tr(locale, "Zinc", "אבץ")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.zinc_mg, locale, 2)}</span> {formatMeasurementUnit("mg", locale)}</p>
                        </div>
                      ) : hasWeight ? (
                        <p className="text-xs text-slate-700 dark:text-slate-300">
                          {tr(locale, "Reported weight", "משקל מדווח")}: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(report.reported_weight_kg, locale, 2)}</span> {formatMeasurementUnit("kg", locale)}
                        </p>
                      ) : null}

                      {/* Folded in here (rather than as separate rows after
                          this entry's details, outside its Edit/Delete
                          controls) so a tracked value like sleep duration is
                          part of the same expandable, deletable, editable
                          entry instead of looking like a disconnected,
                          non-interactive fragment with no way to manage it. */}
                      {reportCustomTargetRows.length > 0 ? (
                        <div className="space-y-1.5">
                          {reportCustomTargetRows.map(({ target, value }) => (
                            <p key={target.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
                              <span>{target.label}</span>
                              <span dir="ltr" className="font-semibold text-slate-900 dark:text-slate-100">{formatTargetValue(value, target.unit)}</span>
                            </p>
                          ))}
                        </div>
                      ) : null}

                      {/* Every action for this entry lives together here as
                          plain colored text, not a row of bordered buttons -
                          one consistent, lightweight "form" for edit/save/
                          delete rather than a mix of button-styled and
                          text-styled controls doing conceptually similar
                          things. Each keeps its own color as the only visual
                          distinction (teal for editing, cyan for saving to
                          the list, rose for the destructive action). */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {editableFoodItems.length > 0 || editableExerciseItems.length > 0 || hasWeight || reportCustomTargetRows.length > 0 ? (
                          <details data-inline-edit-details>
                            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 [&::-webkit-details-marker]:hidden">
                              <DailyReportEditPencilIcon className="h-3.5 w-3.5" />
                              {tr(locale, "Edit", "עריכה")}
                            </summary>
                            <DailyReportEntryEditForm
                              locale={locale}
                              reportId={report.id}
                              selectedDateParam={resolvedSearchParams.date}
                              hasWeight={hasWeight}
                              reportedWeightKg={report.reported_weight_kg}
                              customTargets={reportCustomTargetRows.map(({ target, value }) => ({
                                id: target.id,
                                label: target.label,
                                unit: target.unit,
                                value,
                              }))}
                              foodItems={editableFoodItems}
                              exerciseItems={editableExerciseItems}
                              nutrientFields={nutrientFields}
                              userGender={userGender}
                            />
                          </details>
                        ) : null}

                        {/* "Edit in chat" reopens the full compose form/chat -
                            genuinely useful for a meal/exercise entry (fix a
                            misidentified item's name, add something new,
                            attach a corrected photo - things the inline
                            "Edit" above can't do, since it only adjusts
                            numbers on items that already exist). A
                            weight-only or target-only entry has no such
                            item list to redescribe - inline "Edit" already
                            covers the entire thing (it's just a number), so
                            offering a second, heavier way to do the exact
                            same edit would be redundant rather than useful.
                            Kept immediately next to "Edit" (rather than
                            after "Add to Saved List") since both are edit
                            actions on the same entry - grouping them avoids
                            the two "Edit..." labels reading as unrelated. */}
                        {hasFood || hasExercise ? (
                          <Link
                            href={editHref}
                            prefetch={false}
                            className="text-xs font-medium text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
                          >
                            {tr(locale, "Edit in chat", "עריכה בצ'אט")}
                          </Link>
                        ) : null}

                        {/* "Add to Saved List" copies this entry's food/
                            exercise items into a reusable default - a
                            weight-only or target-only entry has none of
                            those, so there'd be nothing meaningful to save
                            (a "default" of 0 calories representing a weigh-
                            in doesn't mean anything as a reusable item). */}
                        {hasFood || hasExercise ? (
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-cyan-700 hover:text-cyan-800 dark:text-cyan-400 dark:hover:text-cyan-300">
                              {tr(locale, "Add to Saved List", "הוספה לרשימה השמורה")}
                            </summary>
                            <form action={addReportToDefaultsAction} className="mt-2 flex w-full flex-wrap items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50/40 px-2 py-2 dark:border-cyan-800 dark:bg-cyan-950/30">
                              <input type="hidden" name="report_id" value={report.id} />
                              <input
                                type="text"
                                name="default_name"
                                maxLength={80}
                                placeholder={tr(locale, "e.g. My morning eggs breakfast", "לדוגמה: ארוחת בוקר ביצים שלי")}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                              />
                              <button
                                type="submit"
                                className="rounded-lg border border-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 dark:border-cyan-700 dark:text-cyan-400 dark:hover:bg-cyan-900/30"
                              >
                                {tr(locale, "Save to Saved List", "שמירה לרשימה השמורה")}
                              </button>
                            </form>
                          </details>
                        ) : null}

                        <form action={deleteDailyReportAction}>
                          <input type="hidden" name="report_id" value={report.id} />
                          <button
                            type="submit"
                            className="text-xs font-medium text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
                          >
                            {tr(locale, "Delete entry", "מחיקת רשומה")}
                          </button>
                        </form>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* No card here below `sm` at all - mobile's Weight/Sleep are
          portaled up to the summary section, Date & time lives inside the
          chat sheet, and the chat trigger/sheet themselves are portaled to
          document.body. This still mounts DailyReportForm (it owns the
          actual <form>, hidden fields, and the chat panel), just without a
          visible wrapper box around it, since there's nothing left of its
          own to show in this spot on mobile. Desktop keeps this as a real
          card - it doesn't have a floating bubble, so its inline chat panel
          still needs a home. */}
      <section className="hidden sm:mt-6 sm:block sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:p-6 sm:dark:border-slate-800 sm:dark:bg-slate-900">
        <DailyReportForm
          // Includes selectedDate so navigating to a different day remounts
          // the form fresh from that day's own server-provided state
          // (weight placeholder, todaysCustomTargetValues, etc.) instead of
          // carrying over whatever was typed/shown for the previously
          // viewed day - see todaysCustomTargetValues' own comment on why
          // that matters for the Sleep-duration field specifically.
          key={`${editingReport?.id ?? "new"}-${selectedDate}`}
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
          todaysCustomTargetValues={todaysCustomTargetValues}
          editingReport={editingReport}
          selectedDateParam={resolvedSearchParams.date}
          userFirstName={userFirstName}
          userGender={userGender}
        />
      </section>
    </main>
  );
}
