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
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<DailyReportMetrics> {
  const now = new Date();
  const todayStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const todayEndIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

  const { data: todaysReports } = await supabase
    .from("user_daily_reports")
    .select(
      "calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, sodium_mg, added_sugar_g, calcium_mg, vit_c_mg, vit_b12_mcg, vit_d_mcg, sat_fat_g, omega3_g, exercise_minutes, estimated_burn_kcal",
    )
    .eq("user_id", userId)
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
      exerciseMinutes: acc.exerciseMinutes + Number(row.exercise_minutes ?? 0),
      estimatedBurnKcal: acc.estimatedBurnKcal + Number(row.estimated_burn_kcal ?? 0),
    }),
    { ...EMPTY_METRICS },
  );
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
        const minutes = parseExerciseMinutes(segment);
        if (minutes > 0) {
          exerciseItems.push({
            name: profile.aliases[0],
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
      exerciseMinutes: Math.round(totals.exerciseMinutes),
      estimatedBurnKcal: round(totals.estimatedBurnKcal),
    },
    foodItems,
    exerciseItems,
  };
}
