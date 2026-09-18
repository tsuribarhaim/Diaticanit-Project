import { z } from "zod";

import type { createClient } from "@/lib/supabase/server";

export const dailyReportInputSchema = z.object({
  reportText: z
    .string()
    .trim()
    .min(8, "Please add more details in your daily report.")
    .max(2000, "Daily report must be 2000 characters or less."),
});

/**
 * Deterministic, always-on guard against clearly dangerous/inedible
 * substances (not merely unusual food choices) - runs regardless of
 * translation mode or AI availability, since it must never depend on an AI
 * call succeeding. AI-mode parsing layers a second, more nuanced judgment
 * call on top of this for paraphrased/less literal mentions.
 */
const DANGEROUS_SUBSTANCE_TERMS = [
  "fuel",
  "gasoline",
  "petrol",
  "diesel",
  "kerosene",
  "antifreeze",
  "bleach",
  "detergent",
  "dish soap",
  "laundry soap",
  "ammonia",
  "drain cleaner",
  "pesticide",
  "insecticide",
  "rat poison",
  "poison",
  "battery acid",
  "motor oil",
  "paint thinner",
  "nail polish remover",
  "acetone",
  "lighter fluid",
  "methanol",
  "rubbing alcohol",
  "superglue",
  "bug spray",
  "weed killer",
  "herbicide",
  "דלק",
  "בנזין",
  "סולר",
  "נוזל קירור",
  "נוזל למניעת קיפאון",
  "אקונומיקה",
  "חומר ניקוי",
  "אמוניה",
  "פותח סתימות",
  "רעל",
  "קוטל חרקים",
  "סוללה",
  "סוללות",
  "שמן מנוע",
  "מדלל צבע",
  "מסיר לק",
  "אצטון",
  "נוזל מצתים",
  "מתנול",
  "אלכוהול לשפשוף",
  "דבק תעשייתי",
  "תרסיס נגד חרקים",
  "קוטל עשבים",
];

export function detectDangerousSubstance(text: string): string | null {
  const lowered = text.toLowerCase();
  const match = DANGEROUS_SUBSTANCE_TERMS.find((term) => lowered.includes(term.toLowerCase()));
  return match ?? null;
}

export type ParsedFoodItem = {
  name: string;
  quantity: number;
  unit: string;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  waterMl: number;
  magnesiumMg: number;
  potassiumMg: number;
  ironMg: number;
  zincMg: number;
  sodiumMg: number;
  addedSugarG: number;
  calciumMg: number;
  vitCMg: number;
  vitB12Mcg: number;
  vitDMcg: number;
  satFatG: number;
  omega3G: number;
  cholesterolMg: number;
};

export type ParsedExerciseItem = {
  name: string;
  minutes: number;
  estimatedBurnKcal: number;
};

export type DailyReportMetrics = {
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  waterMl: number;
  magnesiumMg: number;
  potassiumMg: number;
  ironMg: number;
  zincMg: number;
  sodiumMg: number;
  addedSugarG: number;
  calciumMg: number;
  vitCMg: number;
  vitB12Mcg: number;
  vitDMcg: number;
  satFatG: number;
  omega3G: number;
  cholesterolMg: number;
  exerciseMinutes: number;
  estimatedBurnKcal: number;
};

const EMPTY_METRICS: DailyReportMetrics = {
  caloriesKcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  waterMl: 0,
  magnesiumMg: 0,
  potassiumMg: 0,
  ironMg: 0,
  zincMg: 0,
  sodiumMg: 0,
  addedSugarG: 0,
  calciumMg: 0,
  vitCMg: 0,
  vitB12Mcg: 0,
  vitDMcg: 0,
  satFatG: 0,
  omega3G: 0,
  cholesterolMg: 0,
  exerciseMinutes: 0,
  estimatedBurnKcal: 0,
};

/**
 * "Today" has no per-user timezone concept yet, so it's bucketed by UTC
 * calendar day (matching the only other day-bucketing precedent in this
 * codebase). For users far from UTC this "day" boundary won't line up with
 * local midnight - revisit once the Daily Reporting redesign needs a stored
 * per-user timezone plumbed through every day-bucketing site.
 */
export async function getTodaysDailyReportTotals({
  supabase,
  userId,
  excludeReportId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  /** Leaves this one report's own contribution out of the totals - used by
   * the Daily Report chat route while editing an existing entry, so
   * "everything already logged today" doesn't silently include the very
   * entry being edited (its full content is already in the conversation
   * history sent alongside it). */
  excludeReportId?: string;
}): Promise<DailyReportMetrics> {
  const now = new Date();
  const todayStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const todayEndIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

  return getDailyReportTotalsForRange({ supabase, userId, rangeStartIso: todayStartIso, rangeEndIso: todayEndIso, excludeReportId });
}

/** Same aggregation as getTodaysDailyReportTotals, but for an arbitrary
 * UTC day range - lets the Daily Report page's progress rings track
 * whatever date the user is currently browsing instead of always today. */
export async function getDailyReportTotalsForRange({
  supabase,
  userId,
  rangeStartIso,
  rangeEndIso,
  excludeReportId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  rangeStartIso: string;
  rangeEndIso: string;
  excludeReportId?: string;
}): Promise<DailyReportMetrics> {
  const todayStartIso = rangeStartIso;
  const todayEndIso = rangeEndIso;

  let query = supabase
    .from("user_daily_reports")
    .select(
      "calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, sodium_mg, added_sugar_g, calcium_mg, vit_c_mg, vit_b12_mcg, vit_d_mcg, sat_fat_g, omega3_g, cholesterol_mg, exercise_minutes, estimated_burn_kcal",
    )
    .eq("user_id", userId);
  if (excludeReportId) query = query.neq("id", excludeReportId);

  const { data: todaysReports } = await query
    .gte("report_at", todayStartIso)
    .lt("report_at", todayEndIso);

  return (todaysReports ?? []).reduce(
    (acc, row) => ({
      caloriesKcal: acc.caloriesKcal + Number(row.calories_kcal ?? 0),
      proteinG: acc.proteinG + Number(row.protein_g ?? 0),
      carbsG: acc.carbsG + Number(row.carbs_g ?? 0),
      fatG: acc.fatG + Number(row.fat_g ?? 0),
      fiberG: acc.fiberG + Number(row.fiber_g ?? 0),
      waterMl: acc.waterMl + Number(row.water_ml ?? 0),
      magnesiumMg: acc.magnesiumMg + Number(row.magnesium_mg ?? 0),
      potassiumMg: acc.potassiumMg + Number(row.potassium_mg ?? 0),
      ironMg: acc.ironMg + Number(row.iron_mg ?? 0),
      zincMg: acc.zincMg + Number(row.zinc_mg ?? 0),
      sodiumMg: acc.sodiumMg + Number(row.sodium_mg ?? 0),
      addedSugarG: acc.addedSugarG + Number(row.added_sugar_g ?? 0),
      calciumMg: acc.calciumMg + Number(row.calcium_mg ?? 0),
      vitCMg: acc.vitCMg + Number(row.vit_c_mg ?? 0),
      vitB12Mcg: acc.vitB12Mcg + Number(row.vit_b12_mcg ?? 0),
      vitDMcg: acc.vitDMcg + Number(row.vit_d_mcg ?? 0),
      satFatG: acc.satFatG + Number(row.sat_fat_g ?? 0),
      omega3G: acc.omega3G + Number(row.omega3_g ?? 0),
      cholesterolMg: acc.cholesterolMg + Number(row.cholesterol_mg ?? 0),
      exerciseMinutes: acc.exerciseMinutes + Number(row.exercise_minutes ?? 0),
      estimatedBurnKcal: acc.estimatedBurnKcal + Number(row.estimated_burn_kcal ?? 0),
    }),
    { ...EMPTY_METRICS },
  );
}

export type TodaysLoggedItems = {
  foodItems: Array<{ reportAt: string } & ParsedFoodItem>;
  exerciseItems: Array<{ reportAt: string } & ParsedExerciseItem>;
  weighIns: Array<{ reportAt: string; weightKg: number }>;
};

/**
 * The item-level detail behind getTodaysDailyReportTotals' sums - each food/
 * exercise entry already logged today, with its own per-item nutrient
 * breakdown (parsed_items/parsed_exercises are stored with exactly this
 * shape at save time - see saveDailyReportAction). Exists so the Daily
 * Report chat assistant can explain WHY a total is high/low by naming the
 * specific item responsible, instead of only knowing the aggregate number
 * and having to ask the user to redescribe food they already logged.
 */
export async function getTodaysLoggedItems({
  supabase,
  userId,
  excludeReportId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  /** See getTodaysDailyReportTotals' own comment - leaves this one report
   * out of "today's already-logged items" while it's the one being edited. */
  excludeReportId?: string;
}): Promise<TodaysLoggedItems> {
  const now = new Date();
  const todayStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const todayEndIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

  let itemsQuery = supabase
    .from("user_daily_reports")
    .select("report_at, parsed_items, parsed_exercises, reported_weight_kg")
    .eq("user_id", userId);
  if (excludeReportId) itemsQuery = itemsQuery.neq("id", excludeReportId);

  const { data: rows } = await itemsQuery
    .gte("report_at", todayStartIso)
    .lt("report_at", todayEndIso)
    .order("report_at", { ascending: true });

  const foodItems: TodaysLoggedItems["foodItems"] = [];
  const exerciseItems: TodaysLoggedItems["exerciseItems"] = [];
  const weighIns: TodaysLoggedItems["weighIns"] = [];

  for (const row of rows ?? []) {
    const reportAt = String(row.report_at);

    if (Array.isArray(row.parsed_items)) {
      for (const raw of row.parsed_items as Array<Record<string, unknown>>) {
        foodItems.push({
          reportAt,
          name: String(raw.name ?? ""),
          quantity: Number(raw.quantity ?? 0),
          unit: String(raw.unit ?? ""),
          caloriesKcal: Number(raw.caloriesKcal ?? 0),
          proteinG: Number(raw.proteinG ?? 0),
          carbsG: Number(raw.carbsG ?? 0),
          fatG: Number(raw.fatG ?? 0),
          fiberG: Number(raw.fiberG ?? 0),
          waterMl: Number(raw.waterMl ?? 0),
          magnesiumMg: Number(raw.magnesiumMg ?? 0),
          potassiumMg: Number(raw.potassiumMg ?? 0),
          ironMg: Number(raw.ironMg ?? 0),
          zincMg: Number(raw.zincMg ?? 0),
          sodiumMg: Number(raw.sodiumMg ?? 0),
          addedSugarG: Number(raw.addedSugarG ?? 0),
          calciumMg: Number(raw.calciumMg ?? 0),
          vitCMg: Number(raw.vitCMg ?? 0),
          vitB12Mcg: Number(raw.vitB12Mcg ?? 0),
          vitDMcg: Number(raw.vitDMcg ?? 0),
          satFatG: Number(raw.satFatG ?? 0),
          omega3G: Number(raw.omega3G ?? 0),
          cholesterolMg: Number(raw.cholesterolMg ?? 0),
        });
      }
    }

    if (Array.isArray(row.parsed_exercises)) {
      for (const raw of row.parsed_exercises as Array<Record<string, unknown>>) {
        exerciseItems.push({
          reportAt,
          name: String(raw.name ?? ""),
          minutes: Number(raw.minutes ?? 0),
          estimatedBurnKcal: Number(raw.estimatedBurnKcal ?? 0),
        });
      }
    }

    if (row.reported_weight_kg != null) {
      weighIns.push({ reportAt, weightKg: Number(row.reported_weight_kg) });
    }
  }

  return { foodItems, exerciseItems, weighIns };
}

/** Each custom target's value (by id) for the given range - the latest
 * value logged per day, averaged across days that logged anything for it.
 * Kept separate from DailyReportMetrics (a closed, fixed-field type
 * covering only the ~20 built-in nutrients) rather than bolting a dynamic
 * key onto it, so none of that type's many existing call sites need to
 * change.
 *
 * NOT summed across reports, unlike the built-in nutrient metrics: a custom
 * target (e.g. "Daily steps") is logged as a running STATUS, not an
 * incremental add - the Daily Report form pre-fills each new entry with
 * whatever's already logged that day (see todaysCustomTargetValues in
 * daily-report/page.tsx's own "most-recent-report-wins" comment), so a user
 * who saves three reports in one day (breakfast, lunch, dinner - routine,
 * not an edge case) had the SAME value counted three times when this used
 * to sum every row's value (e.g. logging "3000" once showed as "9000" on
 * the Targets Overview ring after two more same-day saves). Fixed to take
 * the latest value per day (the same precedence the form's own prefill
 * already uses), then average across days that logged anything for a
 * multi-day range - consistent with how every other metric here (calories,
 * protein, ...) is averaged across logged days via
 * getLoggedDaysAverageDailyReportTotals, rather than summed across the
 * whole range. For a single-day range (e.g. "today") this naturally reduces
 * to just that day's latest value. */
export async function getCustomTargetValueTotals({
  supabase,
  userId,
  rangeStartIso,
  rangeEndIso,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  rangeStartIso: string;
  rangeEndIso: string;
}): Promise<Record<string, number>> {
  const { data: rows } = await supabase
    .from("user_daily_reports")
    .select("report_at, custom_target_values")
    .eq("user_id", userId)
    .gte("report_at", rangeStartIso)
    .lt("report_at", rangeEndIso)
    .order("report_at", { ascending: true });

  // Latest value per (day, target id) - iterating oldest-to-newest and
  // overwriting on each match means the last (most recent) row seen for a
  // given day is whatever ends up stored for it.
  const perDayLatest = new Map<string, Record<string, number>>();
  for (const row of rows ?? []) {
    const values = row.custom_target_values;
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    const dayKey = String(row.report_at).slice(0, 10);
    const dayValues = perDayLatest.get(dayKey) ?? {};
    for (const [id, value] of Object.entries(values as Record<string, unknown>)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        dayValues[id] = numeric;
      }
    }
    perDayLatest.set(dayKey, dayValues);
  }

  const sums: Record<string, number> = {};
  const dayCounts: Record<string, number> = {};
  for (const dayValues of perDayLatest.values()) {
    for (const [id, value] of Object.entries(dayValues)) {
      sums[id] = (sums[id] ?? 0) + value;
      dayCounts[id] = (dayCounts[id] ?? 0) + 1;
    }
  }

  const averages: Record<string, number> = {};
  for (const id of Object.keys(sums)) {
    averages[id] = sums[id] / dayCounts[id];
  }
  return averages;
}

/** Recent raw values the user has actually logged (most recent last) for
 * each of the given custom-target ids, over the last `lookbackDays` days -
 * used by generateTargetsWithAi's adjustment path to notice when a target's
 * stored unit doesn't match what's really being tracked (see that
 * function's own "UNIT RECONCILIATION" prompt rule), e.g. a "40 minutes"
 * walking target against logged values in the thousands - clearly a step
 * count logged under the wrong unit. Capped at 10 values per id, both to
 * keep the AI prompt small and because a handful of recent entries is
 * plenty to judge what unit the numbers represent. */
export async function getRecentCustomTargetLogs({
  supabase,
  userId,
  ids,
  lookbackDays = 14,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  ids: string[];
  lookbackDays?: number;
}): Promise<Record<string, number[]>> {
  if (ids.length === 0) return {};

  const rangeStartIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await supabase
    .from("user_daily_reports")
    .select("report_at, custom_target_values")
    .eq("user_id", userId)
    .gte("report_at", rangeStartIso)
    .order("report_at", { ascending: true });

  const idSet = new Set(ids);
  const result: Record<string, number[]> = {};
  for (const row of rows ?? []) {
    const values = row.custom_target_values;
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const [id, value] of Object.entries(values as Record<string, unknown>)) {
      if (!idSet.has(id)) continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      const existing = result[id] ?? [];
      existing.push(numeric);
      result[id] = existing.slice(-10);
    }
  }
  return result;
}

// Note: custom_target_value_originals (migration 040) intentionally has no
// reader here - the Targets/Home rings always display a custom target in
// its own canonical unit (see home-overview.ts's own comment on why a
// display-time "most recently logged unit" conversion was reverted), so
// there's currently no consumer for the per-log original value/unit beyond
// reconcileCustomTargetValueUnits writing it as an audit trail. Add a
// reader here if a future feature (e.g. showing "you typed 3,000 steps"
// verbatim somewhere) needs one.

const METRIC_KEYS = Object.keys(EMPTY_METRICS) as Array<keyof DailyReportMetrics>;

function rowToMetrics(row: Record<string, unknown>): DailyReportMetrics {
  return {
    caloriesKcal: Number(row.calories_kcal ?? 0),
    proteinG: Number(row.protein_g ?? 0),
    carbsG: Number(row.carbs_g ?? 0),
    fatG: Number(row.fat_g ?? 0),
    fiberG: Number(row.fiber_g ?? 0),
    waterMl: Number(row.water_ml ?? 0),
    magnesiumMg: Number(row.magnesium_mg ?? 0),
    potassiumMg: Number(row.potassium_mg ?? 0),
    ironMg: Number(row.iron_mg ?? 0),
    zincMg: Number(row.zinc_mg ?? 0),
    sodiumMg: Number(row.sodium_mg ?? 0),
    addedSugarG: Number(row.added_sugar_g ?? 0),
    calciumMg: Number(row.calcium_mg ?? 0),
    vitCMg: Number(row.vit_c_mg ?? 0),
    vitB12Mcg: Number(row.vit_b12_mcg ?? 0),
    vitDMcg: Number(row.vit_d_mcg ?? 0),
    satFatG: Number(row.sat_fat_g ?? 0),
    omega3G: Number(row.omega3_g ?? 0),
    cholesterolMg: Number(row.cholesterol_mg ?? 0),
    exerciseMinutes: Number(row.exercise_minutes ?? 0),
    estimatedBurnKcal: Number(row.estimated_burn_kcal ?? 0),
  };
}

function sumMetrics(a: DailyReportMetrics, b: DailyReportMetrics): DailyReportMetrics {
  const result = { ...EMPTY_METRICS };
  for (const key of METRIC_KEYS) result[key] = a[key] + b[key];
  return result;
}

function divideMetrics(a: DailyReportMetrics, divisor: number): DailyReportMetrics {
  const result = { ...EMPTY_METRICS };
  for (const key of METRIC_KEYS) result[key] = a[key] / divisor;
  return result;
}

export type LoggedDaysAverageResult = {
  averages: DailyReportMetrics;
  loggedDayCount: number;
  totalDayCount: number;
};

/**
 * Averages metrics only over days that actually have at least one report -
 * a 7-day window where the user only logged 3 days shows the average of
 * those 3 logged days, not diluted toward zero by the 4 unlogged days.
 */
export async function getLoggedDaysAverageDailyReportTotals({
  supabase,
  userId,
  rangeStartIso,
  rangeEndIso,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  rangeStartIso: string;
  rangeEndIso: string;
}): Promise<LoggedDaysAverageResult> {
  const { data: rows } = await supabase
    .from("user_daily_reports")
    .select(
      "report_at, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, sodium_mg, added_sugar_g, calcium_mg, vit_c_mg, vit_b12_mcg, vit_d_mcg, sat_fat_g, omega3_g, cholesterol_mg, exercise_minutes, estimated_burn_kcal",
    )
    .eq("user_id", userId)
    .gte("report_at", rangeStartIso)
    .lt("report_at", rangeEndIso);

  const totalDayCount = Math.max(
    1,
    Math.round((new Date(rangeEndIso).getTime() - new Date(rangeStartIso).getTime()) / (24 * 60 * 60 * 1000)),
  );

  const dayTotals = new Map<string, DailyReportMetrics>();
  for (const row of rows ?? []) {
    const dayKey = String(row.report_at).slice(0, 10);
    dayTotals.set(dayKey, sumMetrics(dayTotals.get(dayKey) ?? EMPTY_METRICS, rowToMetrics(row)));
  }

  const loggedDayCount = dayTotals.size;
  const sums = Array.from(dayTotals.values()).reduce(sumMetrics, { ...EMPTY_METRICS });
  const averages = divideMetrics(sums, loggedDayCount || 1);

  return { averages, loggedDayCount, totalDayCount };
}

/**
 * "Any day counts as a session" - a day with exercise logged counts once
 * toward exercise consistency regardless of how many separate exercise
 * entries or minutes were logged that day, within the given range. Takes
 * explicit bounds (unlike the earlier "always trailing 7 days" version this
 * replaced) so it can be scoped to whatever range the Targets/Home
 * Overview's own duration selector currently shows - the calorie/protein
 * rings, the reporting-consistency ring, and this exercise ring should all
 * agree on the same period instead of exercise silently staying fixed at a
 * week regardless of what's selected.
 */
export async function getExerciseSessionDayCount({
  supabase,
  userId,
  rangeStartIso,
  rangeEndIso,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  rangeStartIso: string;
  rangeEndIso: string;
}): Promise<number> {
  const { data: rows } = await supabase
    .from("user_daily_reports")
    .select("report_at")
    .eq("user_id", userId)
    .gt("exercise_minutes", 0)
    .gte("report_at", rangeStartIso)
    .lt("report_at", rangeEndIso);

  const sessionDays = new Set((rows ?? []).map((row) => String(row.report_at).slice(0, 10)));
  return sessionDays.size;
}

export type DailyReportParseResult = {
  confidence: number;
  requiresConfirmation: boolean;
  metrics: DailyReportMetrics;
  foodItems: ParsedFoodItem[];
  exerciseItems: ParsedExerciseItem[];
  /** AI-judged (never set by the heuristic parser, which relies solely on
   * detectDangerousSubstance against the raw text): true when what's
   * described isn't actually food/drink and would be dangerous to consume. */
  isDangerous?: boolean;
  dangerReason?: string;
};

type FoodProfile = {
  aliases: string[];
  unit: string;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  waterMl: number;
  magnesiumMg: number;
  potassiumMg: number;
  ironMg: number;
  zincMg: number;
  sodiumMg: number;
  addedSugarG: number;
  calciumMg: number;
  vitCMg: number;
  vitB12Mcg: number;
  vitDMcg: number;
  satFatG: number;
  omega3G: number;
  cholesterolMg: number;
};

const foodProfiles: FoodProfile[] = [
  {
    aliases: ["apple", "apples", "תפוח", "תפוחים"],
    unit: "piece",
    caloriesKcal: 95,
    proteinG: 0.5,
    carbsG: 25,
    fatG: 0.3,
    fiberG: 4.4,
    waterMl: 0,
    magnesiumMg: 9,
    potassiumMg: 195,
    ironMg: 0.2,
    zincMg: 0.1,
    sodiumMg: 2,
    addedSugarG: 0,
    calciumMg: 11,
    vitCMg: 8.4,
    vitB12Mcg: 0,
    vitDMcg: 0,
    satFatG: 0.05,
    omega3G: 0.01,
    cholesterolMg: 0,
  },
  {
    aliases: ["egg", "eggs", "boiled egg", "boilled egg", "boilled eggs", "boiled eggs", "ביצה", "ביצים", "ביצה קשה", "ביצים קשות"],
    unit: "piece",
    caloriesKcal: 78,
    proteinG: 6.3,
    carbsG: 0.6,
    fatG: 5.3,
    fiberG: 0,
    waterMl: 0,
    magnesiumMg: 5,
    potassiumMg: 63,
    ironMg: 0.9,
    zincMg: 0.6,
    sodiumMg: 62,
    addedSugarG: 0,
    calciumMg: 25,
    vitCMg: 0,
    vitB12Mcg: 0.6,
    vitDMcg: 1.1,
    satFatG: 1.6,
    omega3G: 0.04,
    cholesterolMg: 186,
  },
  {
    aliases: ["banana", "bananas", "בננה", "בננות"],
    unit: "piece",
    caloriesKcal: 105,
    proteinG: 1.3,
    carbsG: 27,
    fatG: 0.4,
    fiberG: 3.1,
    waterMl: 0,
    magnesiumMg: 32,
    potassiumMg: 422,
    ironMg: 0.3,
    zincMg: 0.2,
    sodiumMg: 1,
    addedSugarG: 0,
    calciumMg: 6,
    vitCMg: 10.3,
    vitB12Mcg: 0,
    vitDMcg: 0,
    satFatG: 0.1,
    omega3G: 0.03,
    cholesterolMg: 0,
  },
  {
    aliases: ["chicken breast", "grilled chicken", "chicken", "עוף", "חזה עוף", "עוף בגריל"],
    unit: "portion",
    caloriesKcal: 165,
    proteinG: 31,
    carbsG: 0,
    fatG: 3.6,
    fiberG: 0,
    waterMl: 0,
    magnesiumMg: 29,
    potassiumMg: 256,
    ironMg: 1,
    zincMg: 1,
    sodiumMg: 74,
    addedSugarG: 0,
    calciumMg: 15,
    vitCMg: 0,
    vitB12Mcg: 0.3,
    vitDMcg: 0.1,
    satFatG: 1,
    omega3G: 0.05,
    cholesterolMg: 85,
  },
  {
    aliases: ["rice", "white rice", "brown rice", "אורז", "אורז לבן", "אורז מלא"],
    unit: "cup",
    caloriesKcal: 206,
    proteinG: 4.3,
    carbsG: 45,
    fatG: 0.4,
    fiberG: 0.6,
    waterMl: 0,
    magnesiumMg: 19,
    potassiumMg: 55,
    ironMg: 1.9,
    zincMg: 0.8,
    sodiumMg: 2,
    addedSugarG: 0,
    calciumMg: 16,
    vitCMg: 0,
    vitB12Mcg: 0,
    vitDMcg: 0,
    satFatG: 0.1,
    omega3G: 0.02,
    cholesterolMg: 0,
  },
];

type ExerciseProfile = {
  aliases: string[];
  met: number;
};

const exerciseProfiles: ExerciseProfile[] = [
  { aliases: ["strength", "full body strength", "weights", "resistance", "כוח", "אימון כוח"], met: 5 },
  { aliases: ["walking", "walk", "הליכה"], met: 3.5 },
  { aliases: ["running", "run", "jogging", "ריצה"], met: 8 },
  { aliases: ["cycling", "bike", "biking", "אופניים", "רכיבה"], met: 6 },
  { aliases: ["yoga", "יוגה"], met: 3 },
];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseQuantity(segment: string): number {
  const match = segment.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 1;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function parseExerciseMinutes(segment: string): number {
  const match = segment.match(/(\d+(?:\.\d+)?)\s*(minute|minutes|min|דקה|דקות)/i);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

// A step count (e.g. from a phone pedometer) has no dedicated field in this
// schema - rather than dropping it when no duration is stated, it's folded
// into an estimated duration (at a typical walking cadence) so it still
// produces a real exercise entry, and the literal step count is kept in the
// item's name below so what the user actually entered isn't lost.
const AVERAGE_WALKING_STEPS_PER_MINUTE = 100;

function parseExerciseSteps(segment: string): number {
  const match = segment.match(/(\d[\d,]*)\s*(steps?|צעדים|צעד)/i);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function estimateBurnKcal({ met, weightKg, minutes }: { met: number; weightKg: number; minutes: number }): number {
  if (minutes <= 0 || weightKg <= 0) return 0;
  const kcalPerMinute = (met * 3.5 * weightKg) / 200;
  return round(kcalPerMinute * minutes, 1);
}

function splitIntoSegments(reportText: string): string[] {
  const decimalToken = "__decimal_token__";
  const protectedText = reportText
    .toLowerCase()
    .replace(/(\d)[\.,](\d)/g, `$1${decimalToken}$2`);

  return protectedText
    .split(/[.,;\n]/)
    .map((item) => item.replaceAll(decimalToken, ".").trim())
    .filter(Boolean);
}

function parseHydrationWaterMl(segment: string): { quantity: number; unit: string; waterMl: number } | null {
  if (!/\b(water|waters|hydration|drink|drank|drunk|fluid|fluids|מים|שתיה|נוזלים)\b/i.test(segment)) {
    return null;
  }

  const match = segment.match(
    /(\d+(?:\.\d+)?)\s*(ml|milliliter|milliliters|l|liter|liters|litre|litres|cup|cups|glass|glasses|מ"ל|מל|ליטר|ליטרים|כוס|כוסות)\b/i,
  );
  if (!match) {
    return null;
  }

  const quantity = Number(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const rawUnit = match[2].toLowerCase();
  let unit = "ml";
  let multiplier = 1;

  if (["l", "liter", "liters", "litre", "litres", "ליטר", "ליטרים"].includes(rawUnit)) {
    unit = "liter";
    multiplier = 1000;
  } else if (["cup", "cups", "glass", "glasses", "כוס", "כוסות"].includes(rawUnit)) {
    unit = "cup";
    multiplier = 240;
  }

  return {
    quantity,
    unit,
    waterMl: round(quantity * multiplier),
  };
}

export function parseDailyReportText({
  reportText,
  weightKg,
}: {
  reportText: string;
  weightKg: number;
}): DailyReportParseResult {
  const segments = splitIntoSegments(reportText);

  const foodItems: ParsedFoodItem[] = [];
  const exerciseItems: ParsedExerciseItem[] = [];

  let recognizedSignals = 0;

  for (const segment of segments) {
    const quantity = parseQuantity(segment);

    let matchedFood = false;
    const hydration = parseHydrationWaterMl(segment);
    if (hydration) {
      foodItems.push({
        name: "water",
        quantity: hydration.quantity,
        unit: hydration.unit,
        caloriesKcal: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        waterMl: hydration.waterMl,
        magnesiumMg: 0,
        potassiumMg: 0,
        ironMg: 0,
        zincMg: 0,
        sodiumMg: 0,
        addedSugarG: 0,
        calciumMg: 0,
        vitCMg: 0,
        vitB12Mcg: 0,
        vitDMcg: 0,
        satFatG: 0,
        omega3G: 0,
        cholesterolMg: 0,
      });
      matchedFood = true;
      recognizedSignals += 1;
    }

    if (!matchedFood) {
      for (const profile of foodProfiles) {
        if (profile.aliases.some((alias) => segment.includes(alias))) {
          foodItems.push({
            name: profile.aliases[0],
            quantity,
            unit: profile.unit,
            caloriesKcal: round(profile.caloriesKcal * quantity),
            proteinG: round(profile.proteinG * quantity),
            carbsG: round(profile.carbsG * quantity),
            fatG: round(profile.fatG * quantity),
            fiberG: round(profile.fiberG * quantity),
            waterMl: round(profile.waterMl * quantity),
            magnesiumMg: round(profile.magnesiumMg * quantity),
            potassiumMg: round(profile.potassiumMg * quantity),
            ironMg: round(profile.ironMg * quantity),
            zincMg: round(profile.zincMg * quantity),
            sodiumMg: round(profile.sodiumMg * quantity),
            addedSugarG: round(profile.addedSugarG * quantity),
            calciumMg: round(profile.calciumMg * quantity),
            vitCMg: round(profile.vitCMg * quantity),
            vitB12Mcg: round(profile.vitB12Mcg * quantity),
            vitDMcg: round(profile.vitDMcg * quantity),
            satFatG: round(profile.satFatG * quantity),
            omega3G: round(profile.omega3G * quantity),
            cholesterolMg: round(profile.cholesterolMg * quantity),
          });
          matchedFood = true;
          recognizedSignals += 1;
          break;
        }
      }
    }

    let matchedExercise = false;
    for (const profile of exerciseProfiles) {
      if (profile.aliases.some((alias) => segment.includes(alias))) {
        const statedMinutes = parseExerciseMinutes(segment);
        const steps = parseExerciseSteps(segment);
        const minutes = statedMinutes > 0 ? statedMinutes : steps > 0 ? Math.round(steps / AVERAGE_WALKING_STEPS_PER_MINUTE) : 0;
        if (minutes > 0) {
          const name = statedMinutes === 0 && steps > 0 ? `${profile.aliases[0]} (${steps} steps)` : profile.aliases[0];
          exerciseItems.push({
            name,
            minutes,
            estimatedBurnKcal: estimateBurnKcal({ met: profile.met, weightKg, minutes }),
          });
          matchedExercise = true;
          recognizedSignals += 1;
          break;
        }
      }
    }

    if (!matchedFood && !matchedExercise && /\b(cup|cups|glass|glasses|ml|liter|litre|minutes|min|מ"ל|מל|ליטר|דקה|דקות|כוס|כוסות)\b/.test(segment)) {
      recognizedSignals += 0.25;
    }
  }

  const totals: DailyReportMetrics = { ...EMPTY_METRICS };

  for (const item of foodItems) {
    totals.caloriesKcal += item.caloriesKcal;
    totals.proteinG += item.proteinG;
    totals.carbsG += item.carbsG;
    totals.fatG += item.fatG;
    totals.fiberG += item.fiberG;
    totals.waterMl += item.waterMl;
    totals.magnesiumMg += item.magnesiumMg;
    totals.potassiumMg += item.potassiumMg;
    totals.ironMg += item.ironMg;
    totals.zincMg += item.zincMg;
    totals.sodiumMg += item.sodiumMg;
    totals.addedSugarG += item.addedSugarG;
    totals.calciumMg += item.calciumMg;
    totals.vitCMg += item.vitCMg;
    totals.vitB12Mcg += item.vitB12Mcg;
    totals.vitDMcg += item.vitDMcg;
    totals.satFatG += item.satFatG;
    totals.omega3G += item.omega3G;
    totals.cholesterolMg += item.cholesterolMg;
  }

  for (const item of exerciseItems) {
    totals.exerciseMinutes += item.minutes;
    totals.estimatedBurnKcal += item.estimatedBurnKcal;
  }

  const confidenceBase = segments.length ? recognizedSignals / segments.length : 0;
  const confidence = round(Math.max(0.25, Math.min(0.98, confidenceBase)), 4);

  const requiresConfirmation = confidence < 0.72;

  return {
    confidence,
    requiresConfirmation,
    metrics: {
      caloriesKcal: round(totals.caloriesKcal),
      proteinG: round(totals.proteinG),
      carbsG: round(totals.carbsG),
      fatG: round(totals.fatG),
      fiberG: round(totals.fiberG),
      waterMl: round(totals.waterMl),
      magnesiumMg: round(totals.magnesiumMg),
      potassiumMg: round(totals.potassiumMg),
      ironMg: round(totals.ironMg),
      zincMg: round(totals.zincMg),
      sodiumMg: round(totals.sodiumMg),
      addedSugarG: round(totals.addedSugarG),
      calciumMg: round(totals.calciumMg),
      vitCMg: round(totals.vitCMg),
      vitB12Mcg: round(totals.vitB12Mcg),
      vitDMcg: round(totals.vitDMcg),
      satFatG: round(totals.satFatG),
      omega3G: round(totals.omega3G),
      cholesterolMg: round(totals.cholesterolMg),
      exerciseMinutes: Math.round(totals.exerciseMinutes),
      estimatedBurnKcal: round(totals.estimatedBurnKcal),
    },
    foodItems,
    exerciseItems,
  };
}
