"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  dailyReportInputSchema,
  detectDangerousSubstance,
  parseDailyReportText,
  type DailyReportMetrics,
  type DailyReportParseResult,
} from "@/lib/daily-report";
import { CHART_EXTRA_METRIC_IDS, type DailyReportChartExtraMetric, type DailyReportChartPreferences } from "@/lib/daily-report-chart-preferences";
import { parseDailyReportPhotoWithAi, parseDailyReportWithAi } from "@/lib/ai/daily-report";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export type DailyReportActionState = {
  error?: string;
  success?: string;
};

type DailyReportParseMode = "heuristic" | "ai" | "ai_photo";

const ALLOWED_MEAL_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_MEAL_PHOTO_BYTES = 10 * 1024 * 1024;

type DailyParseResult = DailyReportParseResult;

type SelectedDefaultSnapshot = {
  id: string;
  name: string;
  kind: string;
  unit: string;
  quantity: number;
};

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildDefaultParseText({
  name,
  kind,
  quantity,
  unit,
}: {
  name: string;
  kind: string;
  quantity: number;
  unit: string;
}): string {
  if (kind === "exercise") {
    return `${name} ${quantity} minutes`;
  }

  if (kind === "hydration") {
    return `${name} ${quantity} ${unit} water`;
  }

  return `${name} ${quantity} ${unit}`;
}

function emptyParseResult(): DailyParseResult {
  return {
    confidence: 0.25,
    requiresConfirmation: true,
    metrics: {
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
    },
    foodItems: [],
    exerciseItems: [],
  };
}

function getRequestedParseMode(formData: FormData): DailyReportParseMode {
  const raw = formData.get("parse_mode")?.toString();
  if (raw === "ai") return "ai";
  if (raw === "ai_photo") return "ai_photo";
  return "heuristic";
}

function buildDailyReportRedirectPath(params: { notice?: string; error?: string }): string {
  const search = new URLSearchParams();
  if (params.notice) {
    search.set("notice", params.notice);
  }
  if (params.error) {
    search.set("error", params.error);
  }

  const query = search.toString();
  return query ? `/app/daily-report?${query}` : "/app/daily-report";
}

function isMissingReportedWeightColumn(errorMessage: string): boolean {
  return errorMessage.includes("reported_weight_kg") && errorMessage.includes("does not exist");
}

function isMissingSelectedDefaultsColumn(errorMessage: string): boolean {
  return errorMessage.includes("selected_defaults") && errorMessage.includes("does not exist");
}

function extractReportedWeightFromText(reportText: string): number | null {
  const normalized = reportText.replace(/,/g, ".");

  const directWeightMatch = normalized.match(/(?:weight|weigh|wiegth|משקל)[^\d]{0,20}(\d{2,3}(?:\.\d{1,2})?)/i);
  if (directWeightMatch) {
    const value = Number(directWeightMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  const unitMatch = normalized.match(/(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|ק"ג|קג)\b/i);
  if (unitMatch) {
    const value = Number(unitMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

async function resolveDailyReportLocale(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<AppLocale> {
  const { data } = await supabase
    .from("user_profile")
    .select("preferred_language")
    .eq("user_id", userId)
    .maybeSingle();

  return normalizeLocale(data?.preferred_language);
}

function buildDangerousTermMessage(locale: AppLocale, term: string, context: "save" | "retry"): string {
  const notSaved = tr(
    locale,
    context === "save" ? "This entry was not saved." : "AI retry was not performed.",
    context === "save" ? "הדיווח לא נשמר." : "ניתוח ה-AI לא בוצע.",
  );

  return tr(
    locale,
    `⚠️ "${term}" is not food or a beverage and can be dangerous to consume. ${notSaved} If you actually consumed this, please seek medical attention or contact a poison control center right away.`,
    `⚠️ "${term}" אינו מזון או משקה ועלול להיות מסוכן לצריכה. ${notSaved} אם אכן צרכת זאת, פנה/י מיד לעזרה רפואית או למרכז המידע לארס והרעלות.`,
  );
}

function buildGenericDangerousMessage(locale: AppLocale, context: "save" | "retry"): string {
  const notSaved = tr(
    locale,
    context === "save" ? "This entry was not saved." : "AI retry was not performed.",
    context === "save" ? "הדיווח לא נשמר." : "ניתוח ה-AI לא בוצע.",
  );

  return tr(
    locale,
    `⚠️ This entry describes something that isn't food or a beverage and can be dangerous to consume. ${notSaved} If you actually consumed this, please seek medical attention or contact a poison control center right away.`,
    `⚠️ הדיווח מתאר משהו שאינו מזון או משקה ועלול להיות מסוכן לצריכה. ${notSaved} אם אכן צרכת זאת, פנה/י מיד לעזרה רפואית או למרכז המידע לארס והרעלות.`,
  );
}

async function parseReportTextByMode({
  reportText,
  weightKg,
  mode,
  locale,
}: {
  reportText: string;
  weightKg: number;
  mode: DailyReportParseMode;
  locale: AppLocale;
}): Promise<{
  result: DailyParseResult;
  modeUsed: DailyReportParseMode;
  parserVersion: string;
}> {
  if (!reportText.trim()) {
    return {
      result: emptyParseResult(),
      modeUsed: "heuristic",
      parserVersion: "daily-heuristic-v1",
    };
  }

  if (mode === "ai") {
    const aiConfig = getAiExtractionConfig();
    if (!aiConfig) {
      throw new Error(
        tr(
          locale,
          "AI mode is unavailable. Configure AI extraction settings first.",
          "מצב AI אינו זמין. יש להגדיר תחילה את הגדרות ה-AI.",
        ),
      );
    }

    const aiResult = await parseDailyReportWithAi({
      config: aiConfig,
      reportText,
      weightKg,
      locale,
    });

    return {
      result: aiResult,
      modeUsed: "ai",
      parserVersion: `daily-ai-${aiConfig.provider}-v1`,
    };
  }

  return {
    result: parseDailyReportText({
      reportText,
      weightKg,
    }),
    modeUsed: "heuristic",
    parserVersion: "daily-heuristic-v1",
  };
}

export async function saveDailyReportAction(
  _prevState: DailyReportActionState,
  formData: FormData,
): Promise<DailyReportActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveDailyReportLocale(supabase, user.id);

  const reportTextRaw = formData.get("report_text")?.toString() ?? "";
  const reportText = reportTextRaw.trim();
  const requestedParseMode = getRequestedParseMode(formData);
  const selectedDefaultIds = formData
    .getAll("selected_default_ids")
    .map((value) => value.toString())
    .filter(Boolean);
  const mealPhotoEntry = formData.get("meal_photo");
  // A photo attached via the camera icon takes priority over whatever
  // heuristic/AI text mode is selected - the mode radios only apply when no
  // photo is present.
  const mealPhotoFile = mealPhotoEntry instanceof File && mealPhotoEntry.size > 0 ? mealPhotoEntry : null;

  if (!reportText && selectedDefaultIds.length === 0 && !mealPhotoFile) {
    return {
      error: tr(
        locale,
        "Add free text, a meal photo, select at least one default, or a combination.",
        "יש להוסיף טקסט חופשי, תמונת ארוחה, לבחור לפחות ברירת מחדל אחת, או שילוב ביניהם.",
      ),
    };
  }

  if (reportText.length > 2000) {
    return {
      error: tr(locale, "Daily report must be 2000 characters or less.", "הדיווח היומי חייב להיות עד 2000 תווים."),
    };
  }

  if (reportText.length > 0) {
    const parsedInput = dailyReportInputSchema.safeParse({
      reportText,
    });

    if (!parsedInput.success) {
      return {
        error: tr(
          locale,
          "Please add more details in your daily report.",
          "יש להוסיף פרטים נוספים לדיווח היומי.",
        ),
      };
    }

    const dangerousTerm = detectDangerousSubstance(reportText);
    if (dangerousTerm) {
      return { error: buildDangerousTermMessage(locale, dangerousTerm, "save") };
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profile")
    .select("weight_kg")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return {
      error: tr(
        locale,
        "Please complete profile details before logging daily reports.",
        "יש להשלים את פרטי הפרופיל לפני רישום דיווחים יומיים.",
      ),
    };
  }

  const { data: activeTargetProfile } = await supabase
    .from("user_target_profiles")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  let parsedResult: DailyParseResult;
  let modeUsedForReport: DailyReportParseMode;
  let parserVersionUsed = "daily-heuristic-v1";

  try {
    if (mealPhotoFile) {
      if (!ALLOWED_MEAL_PHOTO_TYPES.includes(mealPhotoFile.type)) {
        throw new Error(
          tr(locale, "Meal photo must be a JPEG, PNG, or WEBP image.", "תמונת הארוחה חייבת להיות מסוג JPEG, PNG או WEBP."),
        );
      }
      if (mealPhotoFile.size > MAX_MEAL_PHOTO_BYTES) {
        throw new Error(tr(locale, "Meal photo must be 10 MB or smaller.", "תמונת הארוחה חייבת להיות עד 10MB."));
      }

      const aiConfig = getAiExtractionConfig();
      if (!aiConfig) {
        throw new Error(
          tr(
            locale,
            "AI mode is unavailable. Configure AI extraction settings first.",
            "מצב AI אינו זמין. יש להגדיר תחילה את הגדרות ה-AI.",
          ),
        );
      }

      const imageBase64 = Buffer.from(await mealPhotoFile.arrayBuffer()).toString("base64");

      parsedResult = await parseDailyReportPhotoWithAi({
        config: aiConfig,
        imageBase64,
        mimeType: mealPhotoFile.type,
        weightKg: Number(profile.weight_kg),
        noteText: reportText || undefined,
        locale,
      });
      modeUsedForReport = "ai_photo";
      parserVersionUsed = `daily-ai-photo-${aiConfig.provider}-v1`;
    } else {
      const parsedByMode = await parseReportTextByMode({
        reportText,
        weightKg: Number(profile.weight_kg),
        mode: requestedParseMode === "ai_photo" ? "heuristic" : requestedParseMode,
        locale,
      });
      parsedResult = parsedByMode.result;
      modeUsedForReport = parsedByMode.modeUsed;
      parserVersionUsed = parsedByMode.parserVersion;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : tr(locale, "Failed to parse daily report.", "פענוח הדיווח היומי נכשל.");
    logServerError("dailyReport.save", "parse_failed", {
      userId: user.id,
      mode: requestedParseMode,
      error: message,
    });
    return { error: message };
  }

  if (parsedResult.isDangerous) {
    return {
      error: parsedResult.dangerReason || buildGenericDangerousMessage(locale, "save"),
    };
  }

  const defaultFoodItems: Array<{
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
  }> = [];
  const defaultExerciseItems: Array<{
    name: string;
    minutes: number;
    estimatedBurnKcal: number;
  }> = [];
  const selectedDefaultsSnapshot: SelectedDefaultSnapshot[] = [];

  let mergedMetrics = { ...parsedResult.metrics };

  if (selectedDefaultIds.length > 0) {
    const { data: defaultsRows } = await supabase
      .from("user_default_items")
      .select(
        "id, name, kind, default_quantity, default_unit, parse_confidence, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, sodium_mg, added_sugar_g, calcium_mg, vit_c_mg, vit_b12_mcg, vit_d_mcg, sat_fat_g, omega3_g, exercise_minutes, estimated_burn_kcal",
      )
      .eq("user_id", user.id)
      .in("id", selectedDefaultIds)
      .eq("is_active", true);

    for (const item of defaultsRows ?? []) {
      const quantityValue = formData.get(`quantity_default_${item.id}`);
      const quantity = Math.max(0, toNumber(quantityValue, toNumber(item.default_quantity, 1)));
      const baseQuantity = Math.max(0.0001, toNumber(item.default_quantity, 1));
      const scale = quantity / baseQuantity;
      const hasCachedMetrics = toNumber(item.parse_confidence, 0) > 0;

      let cachedMetrics: DailyReportMetrics;

      if (hasCachedMetrics) {
        cachedMetrics = {
          caloriesKcal: round(toNumber(item.calories_kcal) * scale),
          proteinG: round(toNumber(item.protein_g) * scale),
          carbsG: round(toNumber(item.carbs_g) * scale),
          fatG: round(toNumber(item.fat_g) * scale),
          fiberG: round(toNumber(item.fiber_g) * scale),
          waterMl: round(toNumber(item.water_ml) * scale),
          magnesiumMg: round(toNumber(item.magnesium_mg) * scale),
          potassiumMg: round(toNumber(item.potassium_mg) * scale),
          ironMg: round(toNumber(item.iron_mg) * scale),
          zincMg: round(toNumber(item.zinc_mg) * scale),
          sodiumMg: round(toNumber(item.sodium_mg) * scale),
          addedSugarG: round(toNumber(item.added_sugar_g) * scale),
          calciumMg: round(toNumber(item.calcium_mg) * scale),
          vitCMg: round(toNumber(item.vit_c_mg) * scale),
          vitB12Mcg: round(toNumber(item.vit_b12_mcg) * scale),
          vitDMcg: round(toNumber(item.vit_d_mcg) * scale),
          satFatG: round(toNumber(item.sat_fat_g) * scale),
          omega3G: round(toNumber(item.omega3_g) * scale),
          exerciseMinutes: Math.round(toNumber(item.exercise_minutes) * scale),
          estimatedBurnKcal: round(toNumber(item.estimated_burn_kcal) * scale),
        };
      } else {
        const fallbackParsed = parseDailyReportText({
          reportText: buildDefaultParseText({
            name: item.name,
            kind: item.kind,
            quantity,
            unit: item.default_unit,
          }),
          weightKg: Number(profile.weight_kg),
        });

        cachedMetrics = fallbackParsed.metrics;
      }

      mergedMetrics.caloriesKcal += cachedMetrics.caloriesKcal;
      mergedMetrics.proteinG += cachedMetrics.proteinG;
      mergedMetrics.carbsG += cachedMetrics.carbsG;
      mergedMetrics.fatG += cachedMetrics.fatG;
      mergedMetrics.fiberG += cachedMetrics.fiberG;
      mergedMetrics.waterMl += cachedMetrics.waterMl;
      mergedMetrics.magnesiumMg += cachedMetrics.magnesiumMg;
      mergedMetrics.potassiumMg += cachedMetrics.potassiumMg;
      mergedMetrics.ironMg += cachedMetrics.ironMg;
      mergedMetrics.zincMg += cachedMetrics.zincMg;
      mergedMetrics.sodiumMg += cachedMetrics.sodiumMg;
      mergedMetrics.addedSugarG += cachedMetrics.addedSugarG;
      mergedMetrics.calciumMg += cachedMetrics.calciumMg;
      mergedMetrics.vitCMg += cachedMetrics.vitCMg;
      mergedMetrics.vitB12Mcg += cachedMetrics.vitB12Mcg;
      mergedMetrics.vitDMcg += cachedMetrics.vitDMcg;
      mergedMetrics.satFatG += cachedMetrics.satFatG;
      mergedMetrics.omega3G += cachedMetrics.omega3G;
      mergedMetrics.exerciseMinutes += cachedMetrics.exerciseMinutes;
      mergedMetrics.estimatedBurnKcal += cachedMetrics.estimatedBurnKcal;

      if (item.kind === "exercise") {
        defaultExerciseItems.push({
          name: item.name,
          minutes: Math.max(0, cachedMetrics.exerciseMinutes || Math.round(quantity)),
          estimatedBurnKcal: Math.max(0, cachedMetrics.estimatedBurnKcal),
        });
      } else {
        defaultFoodItems.push({
          name: item.name,
          quantity,
          unit: item.default_unit,
          caloriesKcal: cachedMetrics.caloriesKcal,
          proteinG: cachedMetrics.proteinG,
          carbsG: cachedMetrics.carbsG,
          fatG: cachedMetrics.fatG,
          fiberG: cachedMetrics.fiberG,
          waterMl: cachedMetrics.waterMl,
          magnesiumMg: cachedMetrics.magnesiumMg,
          potassiumMg: cachedMetrics.potassiumMg,
          ironMg: cachedMetrics.ironMg,
          zincMg: cachedMetrics.zincMg,
          sodiumMg: cachedMetrics.sodiumMg,
          addedSugarG: cachedMetrics.addedSugarG,
          calciumMg: cachedMetrics.calciumMg,
          vitCMg: cachedMetrics.vitCMg,
          vitB12Mcg: cachedMetrics.vitB12Mcg,
          vitDMcg: cachedMetrics.vitDMcg,
          satFatG: cachedMetrics.satFatG,
          omega3G: cachedMetrics.omega3G,
        });
      }

      selectedDefaultsSnapshot.push({
        id: item.id,
        name: item.name,
        kind: item.kind,
        unit: item.default_unit,
        quantity,
      });
    }
  }

  mergedMetrics = {
    caloriesKcal: round(mergedMetrics.caloriesKcal),
    proteinG: round(mergedMetrics.proteinG),
    carbsG: round(mergedMetrics.carbsG),
    fatG: round(mergedMetrics.fatG),
    fiberG: round(mergedMetrics.fiberG),
    waterMl: round(mergedMetrics.waterMl),
    magnesiumMg: round(mergedMetrics.magnesiumMg),
    potassiumMg: round(mergedMetrics.potassiumMg),
    ironMg: round(mergedMetrics.ironMg),
    zincMg: round(mergedMetrics.zincMg),
    sodiumMg: round(mergedMetrics.sodiumMg),
    addedSugarG: round(mergedMetrics.addedSugarG),
    calciumMg: round(mergedMetrics.calciumMg),
    vitCMg: round(mergedMetrics.vitCMg),
    vitB12Mcg: round(mergedMetrics.vitB12Mcg),
    vitDMcg: round(mergedMetrics.vitDMcg),
    satFatG: round(mergedMetrics.satFatG),
    omega3G: round(mergedMetrics.omega3G),
    exerciseMinutes: Math.round(mergedMetrics.exerciseMinutes),
    estimatedBurnKcal: round(mergedMetrics.estimatedBurnKcal),
  };

  const confidenceBoost = selectedDefaultIds.length > 0 ? Math.min(0.2, selectedDefaultIds.length * 0.05) : 0;
  const finalConfidence = Math.min(0.98, round(parsedResult.confidence + confidenceBoost, 4));
  const requiresConfirmation = parsedResult.requiresConfirmation || finalConfidence < 0.72;
  const reportAtRaw = formData.get("report_at")?.toString().trim();
  const reportDate = reportAtRaw ? new Date(reportAtRaw) : null;
  const reportAt = reportDate && !Number.isNaN(reportDate.getTime()) ? reportDate.toISOString() : new Date().toISOString();
  const reportedWeightRaw = formData.get("reported_weight_kg")?.toString().trim() ?? "";
  const inferredWeightFromText = reportText ? extractReportedWeightFromText(reportText) : null;
  const enteredReportedWeightKg = reportedWeightRaw ? toNumber(reportedWeightRaw, NaN) : null;
  const reportedWeightKg = enteredReportedWeightKg ?? inferredWeightFromText;

  if (
    reportedWeightRaw &&
    (enteredReportedWeightKg === null ||
      !Number.isFinite(enteredReportedWeightKg) ||
      enteredReportedWeightKg < 20 ||
      enteredReportedWeightKg > 400)
  ) {
    return {
      error: tr(locale, "Reported weight must be between 20 and 400 kg.", "המשקל המדווח חייב להיות בין 20 ל-400 ק\"ג."),
    };
  }

  const status = requiresConfirmation ? "needs_confirmation" : "confirmed";
  const confirmedAt = requiresConfirmation ? null : new Date().toISOString();

  const baseInsertPayload = {
    user_id: user.id,
    target_profile_id: activeTargetProfile?.id ?? null,
    raw_report_text: reportText,
    report_at: reportAt,
    status,
    parse_confidence: finalConfidence,
    requires_confirmation: requiresConfirmation,
    confirmed_at: confirmedAt,
    calories_kcal: mergedMetrics.caloriesKcal,
    protein_g: mergedMetrics.proteinG,
    carbs_g: mergedMetrics.carbsG,
    fat_g: mergedMetrics.fatG,
    fiber_g: mergedMetrics.fiberG,
    water_ml: mergedMetrics.waterMl,
    magnesium_mg: mergedMetrics.magnesiumMg,
    potassium_mg: mergedMetrics.potassiumMg,
    iron_mg: mergedMetrics.ironMg,
    zinc_mg: mergedMetrics.zincMg,
    sodium_mg: mergedMetrics.sodiumMg,
    added_sugar_g: mergedMetrics.addedSugarG,
    calcium_mg: mergedMetrics.calciumMg,
    vit_c_mg: mergedMetrics.vitCMg,
    vit_b12_mcg: mergedMetrics.vitB12Mcg,
    vit_d_mcg: mergedMetrics.vitDMcg,
    sat_fat_g: mergedMetrics.satFatG,
    omega3_g: mergedMetrics.omega3G,
    exercise_minutes: mergedMetrics.exerciseMinutes,
    estimated_burn_kcal: mergedMetrics.estimatedBurnKcal,
    reported_weight_kg: reportedWeightKg,
    selected_defaults: selectedDefaultsSnapshot,
    // DB check constraint only allows 'heuristic' | 'ai'; parser_version carries the "-photo-" marker.
    parse_mode: modeUsedForReport === "ai_photo" ? "ai" : modeUsedForReport,
    parser_version: parserVersionUsed,
    parsed_items: [...parsedResult.foodItems, ...defaultFoodItems],
    parsed_exercises: [...parsedResult.exerciseItems, ...defaultExerciseItems],
  };

  let insertError: { message: string } | null = null;
  let reportedWeightNotPersisted = false;
  const insertWithWeight = await supabase.from("user_daily_reports").insert(baseInsertPayload);

  if (
    insertWithWeight.error &&
    (isMissingReportedWeightColumn(insertWithWeight.error.message) ||
      isMissingSelectedDefaultsColumn(insertWithWeight.error.message))
  ) {
    reportedWeightNotPersisted =
      reportedWeightKg !== null && isMissingReportedWeightColumn(insertWithWeight.error.message);

    const legacyPayload = Object.fromEntries(
      Object.entries(baseInsertPayload).filter(([key]) => {
        if (key === "reported_weight_kg" && isMissingReportedWeightColumn(insertWithWeight.error!.message)) {
          return false;
        }

        if (key === "selected_defaults" && isMissingSelectedDefaultsColumn(insertWithWeight.error!.message)) {
          return false;
        }

        return true;
      }),
    );
    const legacyInsert = await supabase.from("user_daily_reports").insert(legacyPayload);
    insertError = legacyInsert.error;
  } else {
    insertError = insertWithWeight.error;
  }

  if (insertError) {
    logServerError("dailyReport.save", "insert_failed", {
      userId: user.id,
      error: insertError.message,
    });
    return { error: insertError.message };
  }

  revalidatePath("/app/daily-report");
  revalidatePath("/app/targets");

  const weightNotice = reportedWeightNotPersisted
    ? " " +
      tr(
        locale,
        "Reported weight was not saved because migration db/migrations/012_phase4_daily_reports_reported_weight.sql is not applied yet.",
        "המשקל שדווח לא נשמר מכיוון שהמיגרציה db/migrations/012_phase4_daily_reports_reported_weight.sql עדיין לא הוחלה.",
      )
    : "";

  return {
    success: tr(locale, "Daily report saved.", "הדיווח היומי נשמר.") + weightNotice,
  };
}

export async function deleteDailyReportAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const reportId = formData.get("report_id")?.toString();
  if (!reportId) {
    return;
  }

  const { error } = await supabase
    .from("user_daily_reports")
    .delete()
    .eq("id", reportId)
    .eq("user_id", user.id);

  if (error) {
    logServerError("dailyReport.delete", "delete_failed", {
      userId: user.id,
      reportId,
      error: error.message,
    });
    return;
  }

  revalidatePath("/app/daily-report");
  revalidatePath("/app/targets");
}

export async function addReportToDefaultsAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveDailyReportLocale(supabase, user.id);

  const reportId = formData.get("report_id")?.toString();
  const customNameRaw = formData.get("default_name")?.toString() ?? "";
  const customName = customNameRaw.trim();

  if (!reportId) {
    redirect(
      buildDailyReportRedirectPath({
        error: tr(locale, "Missing report id for adding default.", "מזהה הדיווח חסר להוספת ברירת מחדל."),
      }),
    );
  }

  const { data: reportRow, error: reportError } = await supabase
    .from("user_daily_reports")
    .select(
      "id, report_at, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, sodium_mg, added_sugar_g, calcium_mg, vit_c_mg, vit_b12_mcg, vit_d_mcg, sat_fat_g, omega3_g, exercise_minutes, estimated_burn_kcal, parse_mode, parser_version, parse_confidence",
    )
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (reportError || !reportRow) {
    redirect(
      buildDailyReportRedirectPath({
        error: tr(locale, "Daily report not found for default creation.", "הדיווח היומי לא נמצא ליצירת ברירת מחדל."),
      }),
    );
  }

  const fallbackName = `Saved report ${new Date(reportRow.report_at).toISOString().slice(0, 10)}`;
  const defaultName = customName || fallbackName;

  const { error: insertError } = await supabase
    .from("user_default_items")
    .insert({
      user_id: user.id,
      name: defaultName,
      kind: "custom",
      default_quantity: 1,
      default_unit: "entry",
      is_active: true,
      parse_mode: reportRow.parse_mode === "ai" ? "ai" : "heuristic",
      parser_version: reportRow.parser_version ?? "daily-heuristic-v1",
      parse_confidence: toNumber(reportRow.parse_confidence, 0),
      calories_kcal: round(toNumber(reportRow.calories_kcal)),
      protein_g: round(toNumber(reportRow.protein_g)),
      carbs_g: round(toNumber(reportRow.carbs_g)),
      fat_g: round(toNumber(reportRow.fat_g)),
      fiber_g: round(toNumber(reportRow.fiber_g)),
      water_ml: round(toNumber(reportRow.water_ml)),
      magnesium_mg: round(toNumber(reportRow.magnesium_mg)),
      potassium_mg: round(toNumber(reportRow.potassium_mg)),
      iron_mg: round(toNumber(reportRow.iron_mg)),
      zinc_mg: round(toNumber(reportRow.zinc_mg)),
      sodium_mg: round(toNumber(reportRow.sodium_mg)),
      added_sugar_g: round(toNumber(reportRow.added_sugar_g)),
      calcium_mg: round(toNumber(reportRow.calcium_mg)),
      vit_c_mg: round(toNumber(reportRow.vit_c_mg)),
      vit_b12_mcg: round(toNumber(reportRow.vit_b12_mcg)),
      vit_d_mcg: round(toNumber(reportRow.vit_d_mcg)),
      sat_fat_g: round(toNumber(reportRow.sat_fat_g)),
      omega3_g: round(toNumber(reportRow.omega3_g)),
      exercise_minutes: Math.round(toNumber(reportRow.exercise_minutes)),
      estimated_burn_kcal: round(toNumber(reportRow.estimated_burn_kcal)),
    });

  if (insertError) {
    logServerError("dailyReport.addDefault", "insert_failed", {
      userId: user.id,
      reportId,
      error: insertError.message,
    });
    redirect(
      buildDailyReportRedirectPath({
        error: tr(locale, "Could not add this report to defaults.", "לא ניתן להוסיף דיווח זה לברירות המחדל."),
      }),
    );
  }

  revalidatePath("/app/daily-report");
  revalidatePath("/app/daily-report/defaults");

  redirect(
    buildDailyReportRedirectPath({ notice: tr(locale, "Report was added to defaults.", "הדיווח נוסף לברירות המחדל.") }),
  );
}

export async function updateDailyReportChartPreferencesAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveDailyReportLocale(supabase, user.id);

  const extraMetrics = formData
    .getAll("extra_metric")
    .map((value) => value.toString())
    .filter((id): id is DailyReportChartExtraMetric => CHART_EXTRA_METRIC_IDS.includes(id as DailyReportChartExtraMetric));
  const showWeightTrend = formData.get("show_weight_trend")?.toString() === "on";

  const preferences: DailyReportChartPreferences = { extraMetrics, showWeightTrend };

  const { error } = await supabase
    .from("user_profile")
    .update({ daily_report_chart_preferences: preferences })
    .eq("user_id", user.id);

  if (error) {
    logServerError("dailyReport.chartPreferences", "update_failed", {
      userId: user.id,
      error: error.message,
    });
    redirect(
      buildDailyReportRedirectPath({
        error: tr(locale, "Could not save your chart preferences.", "לא ניתן היה לשמור את העדפות התרשים שלך."),
      }),
    );
  }

  revalidatePath("/app/daily-report");

  redirect(buildDailyReportRedirectPath({ notice: tr(locale, "Chart preferences saved.", "העדפות התרשים נשמרו.") }));
}
