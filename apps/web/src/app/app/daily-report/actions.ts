"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  dailyReportInputSchema,
  detectDangerousSubstance,
  parseDailyReportText,
  type DailyReportMetrics,
  type DailyReportParseResult,
  type ParsedExerciseItem,
  type ParsedFoodItem,
} from "@/lib/daily-report";
import {
  CHART_CORE_METRIC_IDS,
  CHART_EXTRA_METRIC_IDS,
  type DailyReportChartCoreMetric,
  type DailyReportChartExtraMetric,
  type DailyReportChartPreferences,
} from "@/lib/daily-report-chart-preferences";
import { parseDailyReportPhotoWithAi, parseDailyReportWithAi, reconcileCustomTargetValueUnits } from "@/lib/ai/daily-report";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { buildBmiWarningMessage } from "@/lib/bmi";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import { computeProfileDiff, normalizeUserTargetsJson, parseProfileSnapshot, type ProfileDiffRow, type ProfileForTargets } from "@/lib/targets";

export type DailyReportActionState = {
  error?: string;
  success?: string;
  /** Set when this save changed weight enough that the locked target
   * profile's snapshot no longer matches - same data/mechanism as the
   * Profile Edit page's own targets-stale prompt (see computeProfileDiff),
   * just triggered from here since weight changes reported through Daily
   * Report also sync back to the profile. */
  targetsStaleChanges?: ProfileDiffRow[];
  /** Set when the newly reported weight puts BMI outside the healthy
   * range - a plain-language warning plus general recommendations. */
  bmiWarning?: string;
  /** The id of the report row this save just touched - a fresh insert for a
   * new report, or the same row for an edit (the update write also selects
   * "id" back) - lets the form scroll to and briefly highlight that entry
   * in the list below once it re-renders, so a save is easy to spot instead
   * of blending into whatever else was already logged that day. */
  savedReportId?: string;
  /** True when this save updated an existing report rather than creating a
   * new one - no longer a server redirect (see saveDailyReportAction's own
   * comment on why), so the form itself is what exits edit mode - reading
   * this tells it to do so, via a scroll-preserving client-side URL update
   * rather than a real navigation. */
  wasEditing?: boolean;
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
      cholesterolMg: 0,
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

function buildDailyReportRedirectPath(params: { notice?: string; error?: string; date?: string; highlight?: string }): string {
  const search = new URLSearchParams();
  if (params.notice) {
    search.set("notice", params.notice);
  }
  if (params.error) {
    search.set("error", params.error);
  }
  if (params.date) {
    search.set("date", params.date);
  }
  if (params.highlight) {
    search.set("highlight", params.highlight);
  }

  const query = search.toString();
  return query ? `/app/daily-report?${query}` : "/app/daily-report";
}

/**
 * Keeps user_profile.weight_kg pointed at whatever the most recently logged
 * weigh-in among the user's daily reports currently is (by report_at, not
 * insertion order) - shared by every action that can change which report
 * carries "the" current weight or remove it entirely: a fresh save, editing
 * an entry's weight (including clearing it), or deleting the entry that had
 * it. Re-deriving this from scratch each time - rather than trusting the
 * triggering action's own reported_weight_kg - also correctly handles
 * editing/backdating a report that ISN'T the most recent one: that must
 * never override a more recent weigh-in still on record. Returns the value
 * it synced to (or null if no report has a weight at all, in which case the
 * profile is left untouched - weight_kg is a required field with nothing
 * meaningful to revert to).
 */
async function resyncProfileWeightFromReports(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<number | null> {
  const { data: latest } = await supabase
    .from("user_daily_reports")
    .select("reported_weight_kg")
    .eq("user_id", userId)
    .not("reported_weight_kg", "is", null)
    // report_at is truncated to minute precision at save time (see
    // getLocalDateTimeValue) - two reports saved within the same minute tie
    // on it, and without a secondary sort Postgres picks an arbitrary
    // winner among ties, not necessarily the one actually saved last, which
    // is exactly why this needs a real tiebreaker. created_at (set once at
    // insert, full timestamp precision) always reflects true save order.
    .order("report_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestWeightKg = latest?.reported_weight_kg ?? null;
  if (latestWeightKg == null) {
    return null;
  }

  const { error } = await supabase
    .from("user_profile")
    .update({ weight_kg: latestWeightKg })
    .eq("user_id", userId);

  if (error) {
    logServerError("dailyReport.weightResync", "profile_weight_resync_failed", {
      userId,
      error: error.message,
    });
    return null;
  }

  return latestWeightKg;
}

function isMissingReportedWeightColumn(errorMessage: string): boolean {
  return errorMessage.includes("reported_weight_kg") && errorMessage.includes("does not exist");
}

function isMissingSelectedDefaultsColumn(errorMessage: string): boolean {
  return errorMessage.includes("selected_defaults") && errorMessage.includes("does not exist");
}

function isMissingCustomTargetValuesColumn(errorMessage: string): boolean {
  return errorMessage.includes("custom_target_values") && errorMessage.includes("does not exist");
}

function isMissingEditHistoryColumn(errorMessage: string): boolean {
  return errorMessage.includes("edit_history") && errorMessage.includes("does not exist");
}

/** Reads every `custom_target_value__<id>` field the Daily Report form
 * submits (one per currently loggable custom target - see
 * DailyReportForm's customTargets prop) into a plain `{id: number}` map,
 * skipping blanks/invalid numbers rather than writing 0 for a target the
 * user didn't fill in today. */
function extractCustomTargetValues(formData: FormData): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("custom_target_value__")) continue;
    const targetId = key.slice("custom_target_value__".length);
    const trimmed = rawValue?.toString().trim() ?? "";
    // Number("") is 0, not NaN - without this explicit check, a target the
    // user left untouched would silently be recorded as "0", contradicting
    // this function's whole purpose of skipping blanks.
    if (!targetId || trimmed === "") continue;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      values[targetId] = parsed;
    }
  }
  return values;
}

function extractReportedWeightFromText(reportText: string): number | null {
  const normalized = reportText.replace(/,/g, ".");

  const directWeightMatch = normalized.match(/(?:weight|weigh|wiegth|משקל)[^\d]{0,20}(\d{2,3}(?:\.\d{1,2})?)/i);
  if (directWeightMatch) {
    const value = Number(directWeightMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  // A trailing `\b` here would silently never match after the Hebrew
  // units below - JS's `\b` is only defined relative to ASCII `\w`, so it
  // doesn't fire between a Hebrew letter and a space/end-of-string. A
  // negative lookahead for another word character (Latin or Hebrew) gives
  // the same "don't match mid-word" guard (e.g. rejects "20kgs") while
  // actually working for "קג"/ק"ג".
  const unitMatch = normalized.match(/(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|ק"ג|קג)(?![a-zA-Zא-ת])/i);
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

  // Editing (see the "Edit entry" button on each report in the list) reuses
  // this exact same action/pipeline - the only difference is the terminal
  // write is an update of the existing row instead of an insert, once we've
  // confirmed the report being edited actually belongs to this user.
  const editReportId = formData.get("edit_report_id")?.toString() || null;
  // Appended to on every edit save below (see nextEditHistory) - a
  // lightweight "this was modified after its original save" audit trail,
  // not a full diff/transcript (raw_report_text already carries the full
  // updated conversation).
  let previousEditHistory: unknown[] = [];
  let editHistoryColumnMissing = false;
  if (editReportId) {
    let { data: editableReport, error: editableReportError } = await supabase
      .from("user_daily_reports")
      .select("id, edit_history")
      .eq("id", editReportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (editableReportError && isMissingEditHistoryColumn(editableReportError.message)) {
      editHistoryColumnMissing = true;
      ({ data: editableReport, error: editableReportError } = await supabase
        .from("user_daily_reports")
        .select("id")
        .eq("id", editReportId)
        .eq("user_id", user.id)
        .maybeSingle());
    }

    if (editableReportError || !editableReport) {
      return {
        error: tr(locale, "The report you're editing could not be found.", "הדיווח שאתם עורכים לא נמצא."),
      };
    }
    previousEditHistory = Array.isArray((editableReport as { edit_history?: unknown }).edit_history)
      ? ((editableReport as { edit_history: unknown[] }).edit_history)
      : [];
  }
  const isEditing = editReportId !== null;

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
  // A weight-only entry (no food/exercise content at all) is a legitimate
  // way to just log today's weight, so it bypasses the "add something"
  // requirement below.
  const hasWeightEntry = Boolean(formData.get("reported_weight_kg")?.toString().trim());
  // Computed once here (rather than only later, right before it's written to
  // the row) so a report consisting ONLY of a custom target value - e.g.
  // sleep duration with nothing else filled in - is recognized as real
  // content below instead of being rejected outright. It previously wasn't
  // considered here at all, so entering just a sleep duration and nothing
  // else silently failed this check with a generic "add something" error
  // that didn't mention sleep/custom targets, making it look like saving a
  // custom target on its own wasn't supported.
  const customTargetValues = extractCustomTargetValues(formData);
  const hasCustomTargetValue = Object.keys(customTargetValues).length > 0;

  if (!reportText && selectedDefaultIds.length === 0 && !mealPhotoFile && !hasWeightEntry && !hasCustomTargetValue) {
    return {
      error: tr(
        locale,
        "Add free text, a meal photo, an item from your saved list, a weight, a tracked value like sleep, or a combination.",
        "יש להוסיף טקסט חופשי, תמונת ארוחה, פריט מהרשימה השמורה, משקל, ערך במעקב כמו שינה, או שילוב ביניהם.",
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
    .select(
      "age, weight_kg, height_cm, gender, biological_sex, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating",
    )
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
    .select("id, profile_snapshot, user_targets")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  // Reconciles each submitted custom-target value against its target's own
  // unit before anything gets written - see reconcileCustomTargetValueUnits'
  // own comment. Only ever touches an AI call when a value actually looks
  // implausible for its unit; a normal save (or a value that already
  // matches) costs nothing extra here.
  let reconciledCustomTargetValues: Record<string, number> = customTargetValues;
  const customTargetValueOriginals: Record<string, { value: number; unit: string }> = {};

  if (hasCustomTargetValue) {
    const loggableTargets = normalizeUserTargetsJson(activeTargetProfile?.user_targets).filter(
      (target) => target.id && target.unit && target.targetMin !== undefined && target.targetMax !== undefined && target.id in customTargetValues,
    );

    if (loggableTargets.length > 0) {
      const aiConfig = getAiExtractionConfig();
      if (aiConfig) {
        const reconciliations = await reconcileCustomTargetValueUnits({
          config: aiConfig,
          locale,
          entries: loggableTargets.map((target) => ({
            id: target.id!,
            label: target.label,
            unit: target.unit!,
            targetMin: target.targetMin!,
            targetMax: target.targetMax!,
            typedValue: customTargetValues[target.id!],
          })),
        }).catch((error) => {
          logServerError("dailyReport.save", "custom_target_unit_reconcile_failed", {
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });

        if (reconciliations) {
          reconciledCustomTargetValues = { ...customTargetValues };
          for (const [id, reconciliation] of Object.entries(reconciliations)) {
            reconciledCustomTargetValues[id] = reconciliation.canonicalValue;
            if (reconciliation.original) {
              customTargetValueOriginals[id] = reconciliation.original;
            }
          }
        }
      }
    }
  }

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
    cholesterolMg: number;
  }> = [];
  const defaultExerciseItems: Array<{
    name: string;
    minutes: number;
    estimatedBurnKcal: number;
  }> = [];
  const selectedDefaultsSnapshot: SelectedDefaultSnapshot[] = [];
  const defaultConfidenceSamples: number[] = [];

  let mergedMetrics = { ...parsedResult.metrics };

  if (selectedDefaultIds.length > 0) {
    const { data: defaultsRows } = await supabase
      .from("user_default_items")
      .select(
        "id, name, kind, default_quantity, default_unit, parse_confidence, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, sodium_mg, added_sugar_g, calcium_mg, vit_c_mg, vit_b12_mcg, vit_d_mcg, sat_fat_g, omega3_g, cholesterol_mg, exercise_minutes, estimated_burn_kcal",
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
          cholesterolMg: round(toNumber(item.cholesterol_mg) * scale),
          exerciseMinutes: Math.round(toNumber(item.exercise_minutes) * scale),
          estimatedBurnKcal: round(toNumber(item.estimated_burn_kcal) * scale),
        };
        defaultConfidenceSamples.push(toNumber(item.parse_confidence, 0));
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
        defaultConfidenceSamples.push(fallbackParsed.confidence);
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
      mergedMetrics.cholesterolMg += cachedMetrics.cholesterolMg;
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
          cholesterolMg: cachedMetrics.cholesterolMg,
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
    cholesterolMg: round(mergedMetrics.cholesterolMg),
    exerciseMinutes: Math.round(mergedMetrics.exerciseMinutes),
    estimatedBurnKcal: round(mergedMetrics.estimatedBurnKcal),
  };

  /**
   * The overall entry's confidence used to just be the free-text/photo
   * parse's own confidence plus a flat +0.05-per-default "boost" - which
   * meant a report built entirely from a default that was originally saved
   * at, say, 90% confidence fell back to the empty-parse baseline (0.25)
   * plus a token boost, showing as ~30% even though the reused data was
   * exactly as trustworthy as when it was first parsed. Averaging in each
   * contributing source's own confidence (the free-text/photo parse when
   * there was one, and each selected default's real cached or freshly
   * heuristic-parsed confidence) reflects what was actually used.
   */
  const hasMeaningfulTextOrPhotoParse = Boolean(mealPhotoFile) || reportText.length > 0;
  const confidenceSamples = [
    ...(hasMeaningfulTextOrPhotoParse ? [parsedResult.confidence] : []),
    ...defaultConfidenceSamples,
  ];
  const averageConfidence =
    confidenceSamples.length > 0
      ? confidenceSamples.reduce((sum, value) => sum + value, 0) / confidenceSamples.length
      : parsedResult.confidence;
  const finalConfidence = Math.min(0.98, round(averageConfidence, 4));
  const requiresConfirmation = parsedResult.requiresConfirmation || finalConfidence < 0.72;
  const reportAtRaw = formData.get("report_at")?.toString().trim();
  const reportDate = reportAtRaw ? new Date(reportAtRaw) : null;
  const reportAt = reportDate && !Number.isNaN(reportDate.getTime()) ? reportDate.toISOString() : new Date().toISOString();
  const reportedWeightRaw = formData.get("reported_weight_kg")?.toString().trim() ?? "";
  const inferredWeightFromText = reportText ? extractReportedWeightFromText(reportText) : null;
  const enteredReportedWeightKg = reportedWeightRaw ? toNumber(reportedWeightRaw, NaN) : null;

  // An explicit, deliberate entry in the Weight field gets validated
  // strictly and blocks the whole save on failure - the user clearly meant
  // to report a weight and typing something out of range is worth asking
  // them to fix. A weight merely *extracted* from free chat text is a
  // different situation: extractReportedWeightFromText's "kg" fallback
  // pattern has no way to tell a body weight from an unrelated quantity
  // (e.g. "45 קג אבטיח" - 45kg of watermelon) apart from plausibility, so
  // an implausible extracted value (outside 20-400) is far more likely a
  // misparse than a genuine data-entry error. Blocking the entire report -
  // including otherwise-valid food/exercise logging - over a probable
  // misparse would be worse than just not treating it as a weight report.
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

  const isInferredWeightPlausible =
    inferredWeightFromText !== null && inferredWeightFromText >= 20 && inferredWeightFromText <= 400;
  const reportedWeightKg = enteredReportedWeightKg ?? (isInferredWeightPlausible ? inferredWeightFromText : null);

  const status = requiresConfirmation ? "needs_confirmation" : "confirmed";
  const confirmedAt = requiresConfirmation ? null : new Date().toISOString();

  // Capped so a report edited back and forth many times doesn't grow this
  // column unboundedly - only the most recent edits are actually useful to
  // look back on.
  const nextEditHistory = isEditing
    ? [...previousEditHistory, { edited_at: new Date().toISOString(), source: "chat" }].slice(-20)
    : undefined;

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
    cholesterol_mg: mergedMetrics.cholesterolMg,
    exercise_minutes: mergedMetrics.exerciseMinutes,
    estimated_burn_kcal: mergedMetrics.estimatedBurnKcal,
    reported_weight_kg: reportedWeightKg,
    selected_defaults: selectedDefaultsSnapshot,
    custom_target_values: reconciledCustomTargetValues,
    custom_target_value_originals: customTargetValueOriginals,
    // DB check constraint only allows 'heuristic' | 'ai'; parser_version carries the "-photo-" marker.
    parse_mode: modeUsedForReport === "ai_photo" ? "ai" : modeUsedForReport,
    parser_version: parserVersionUsed,
    parsed_items: [...parsedResult.foodItems, ...defaultFoodItems],
    parsed_exercises: [...parsedResult.exerciseItems, ...defaultExerciseItems],
    ...(nextEditHistory && !editHistoryColumnMissing ? { edit_history: nextEditHistory } : {}),
  };

  let insertError: { message: string } | null = null;
  let reportedWeightNotPersisted = false;

  /** insert for a new report, update for an edit - same payload either way,
   * only the write mode and target row differ. */
  const userId = user.id;
  function writeReport(payload: Record<string, unknown>) {
    return isEditing
      ? supabase.from("user_daily_reports").update(payload).eq("id", editReportId!).eq("user_id", userId).select("id")
      : supabase.from("user_daily_reports").insert(payload).select("id");
  }

  const writeWithWeight = await writeReport(baseInsertPayload);
  let insertedId: string | null = (writeWithWeight.data?.[0] as { id?: string } | undefined)?.id ?? null;

  if (
    writeWithWeight.error &&
    (isMissingReportedWeightColumn(writeWithWeight.error.message) ||
      isMissingSelectedDefaultsColumn(writeWithWeight.error.message) ||
      isMissingCustomTargetValuesColumn(writeWithWeight.error.message) ||
      isMissingEditHistoryColumn(writeWithWeight.error.message))
  ) {
    reportedWeightNotPersisted =
      reportedWeightKg !== null && isMissingReportedWeightColumn(writeWithWeight.error.message);

    const legacyPayload = Object.fromEntries(
      Object.entries(baseInsertPayload).filter(([key]) => {
        if (key === "reported_weight_kg" && isMissingReportedWeightColumn(writeWithWeight.error!.message)) {
          return false;
        }

        if (key === "selected_defaults" && isMissingSelectedDefaultsColumn(writeWithWeight.error!.message)) {
          return false;
        }

        if (key === "custom_target_values" && isMissingCustomTargetValuesColumn(writeWithWeight.error!.message)) {
          return false;
        }

        if (key === "edit_history" && isMissingEditHistoryColumn(writeWithWeight.error!.message)) {
          return false;
        }

        return true;
      }),
    );
    const legacyWrite = await writeReport(legacyPayload);
    insertError = legacyWrite.error;
    insertedId = (legacyWrite.data?.[0] as { id?: string } | undefined)?.id ?? null;
  } else {
    insertError = writeWithWeight.error;
  }

  if (insertError) {
    logServerError(isEditing ? "dailyReport.edit" : "dailyReport.save", "write_failed", {
      userId: user.id,
      editReportId,
      error: insertError.message,
    });
    return { error: insertError.message };
  }

  // Keep the profile's weight in sync with whatever the most recently
  // logged weigh-in now is, so other features that read it (BMI/safety
  // checks when generating targets, the compose form's own default) reflect
  // reality instead of a stale value. Re-derived from scratch (not just set
  // to this save's own reportedWeightKg) so editing/backdating an entry that
  // ISN'T the most recent one can never override a more recent weigh-in -
  // and so an edit that removes a previously-set weight correctly falls
  // back instead of leaving the profile pointing at data that no longer
  // exists. Runs whenever this save itself reported a weight, or when
  // editing could have changed/removed one; best-effort either way - a
  // failure here shouldn't undo an already-successful report save.
  let targetsStaleChanges: ProfileDiffRow[] | undefined;
  let bmiWarning: string | undefined;

  if ((reportedWeightKg !== null || isEditing) && !reportedWeightNotPersisted) {
    const syncedWeightKg = await resyncProfileWeightFromReports(supabase, user.id);

    // Only surface BMI/targets-stale messaging when this save's own weight
    // is what's now actually current - editing an older entry's weight
    // while a newer weigh-in still exists shouldn't claim to be reviewing
    // the profile's current safety against a number that didn't win.
    if (reportedWeightKg !== null && syncedWeightKg === reportedWeightKg) {
      const heightCm = Number(profile.height_cm ?? 0);

      // BMI safety check: deterministic, not AI-generated - a safety
      // message should be instant and consistent, not depend on an AI
      // call's latency or availability. Shared with the Targets page's
      // profile-change banner (lib/bmi.ts) so the wording stays identical.
      bmiWarning = buildBmiWarningMessage(reportedWeightKg, heightCm, locale);

      // Targets-stale check: same computeProfileDiff/profile_snapshot
      // mechanism the Profile Edit page uses (see updateProfileAction) -
      // a weight change logged here can just as easily make the locked
      // target profile's snapshot stale as one made via Profile Edit.
      if (activeTargetProfile) {
        const snapshot = parseProfileSnapshot(activeTargetProfile.profile_snapshot);
        if (snapshot) {
          const updatedProfileForTargets: ProfileForTargets = {
            age: Number(profile.age ?? 0),
            gender: profile.gender ?? null,
            biological_sex: profile.biological_sex ?? null,
            height_cm: heightCm,
            weight_kg: reportedWeightKg,
            activity_level: profile.activity_level,
            allergies: Array.isArray(profile.allergies) ? profile.allergies : [],
            medical_conditions: Array.isArray(profile.medical_conditions) ? profile.medical_conditions : [],
            medical_conditions_details: profile.medical_conditions_details ?? null,
            regular_medications_details: profile.regular_medications_details ?? null,
            dietary_preference: profile.dietary_preference ?? null,
            exercise_modalities: Array.isArray(profile.exercise_modalities) ? profile.exercise_modalities : [],
            exercise_other_activities: Array.isArray(profile.exercise_other_activities)
              ? (profile.exercise_other_activities as ProfileForTargets["exercise_other_activities"])
              : [],
            exercise_schedule_by_modality: profile.exercise_schedule_by_modality ?? null,
            habits: Array.isArray(profile.habits) ? profile.habits : [],
            pregnancy_lactation_status: profile.pregnancy_lactation_status ?? null,
            hot_climate_or_heavy_sweating: Boolean(profile.hot_climate_or_heavy_sweating),
          };
          const diff = computeProfileDiff(snapshot, updatedProfileForTargets, locale);
          if (diff.length > 0) {
            targetsStaleChanges = diff;
          }
        }
      }
    }
  }

  revalidatePath("/app/daily-report");
  revalidatePath("/app/targets");
  revalidatePath("/app/profile");

  const weightNotice = reportedWeightNotPersisted
    ? " " +
      tr(
        locale,
        "Reported weight was not saved because migration db/migrations/012_phase4_daily_reports_reported_weight.sql is not applied yet.",
        "המשקל שדווח לא נשמר מכיוון שהמיגרציה db/migrations/012_phase4_daily_reports_reported_weight.sql עדיין לא הוחלה.",
      )
    : "";

  // An edit used to redirect here (back to the list, off the ?edit= URL) -
  // that's a real Next.js navigation, which resets scroll to the top of the
  // page by default with no way to opt out via redirect() itself, and the
  // notice it carried as a query param stuck around indefinitely instead of
  // fading on its own. Returning a plain state instead (exactly like the
  // non-editing path already does) lets the form itself exit edit mode via
  // router.replace(..., { scroll: false }) and show a brief, self-dismissing
  // toast - see wasEditing's own comment and DailyReportForm's handling of
  // state.wasEditing.
  return {
    success: isEditing
      ? tr(locale, "Daily report updated.", "הדיווח היומי עודכן.") + weightNotice
      : tr(locale, "Daily report saved.", "הדיווח היומי נשמר.") + weightNotice,
    // targetsStale/bmiWarning are only meaningful for a fresh save - an
    // edit's own weight, if changed, is still resynced above and still
    // updates the profile, but the Targets page independently re-checks
    // profile staleness on its own next load regardless, so surfacing this
    // banner specifically here for an edit isn't necessary (matches what
    // the previous redirect-based behavior already did).
    targetsStaleChanges: isEditing ? undefined : targetsStaleChanges,
    bmiWarning: isEditing ? undefined : bmiWarning,
    savedReportId: insertedId ?? undefined,
    wasEditing: isEditing,
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

  // saveDailyReportAction keeps user_profile.weight_kg in sync with the most
  // recently logged weigh-in - if the report being deleted is the one that
  // set it, deleting the row alone would leave the profile pointing at data
  // that no longer exists. Read its weight before deleting so we know
  // whether a resync is needed at all.
  const { data: deletedReport } = await supabase
    .from("user_daily_reports")
    .select("reported_weight_kg")
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();

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

  if (deletedReport?.reported_weight_kg != null) {
    await resyncProfileWeightFromReports(supabase, user.id);
  }

  revalidatePath("/app/daily-report");
  revalidatePath("/app/targets");
  revalidatePath("/app/profile");
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
        error: tr(locale, "Missing report id for saving to your list.", "מזהה הדיווח חסר לשמירה ברשימה."),
      }),
    );
  }

  const { data: reportRow, error: reportError } = await supabase
    .from("user_daily_reports")
    .select(
      "id, report_at, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, sodium_mg, added_sugar_g, calcium_mg, vit_c_mg, vit_b12_mcg, vit_d_mcg, sat_fat_g, omega3_g, cholesterol_mg, exercise_minutes, estimated_burn_kcal, parse_mode, parser_version, parse_confidence",
    )
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (reportError || !reportRow) {
    redirect(
      buildDailyReportRedirectPath({
        error: tr(locale, "Daily report not found for saving to your list.", "הדיווח היומי לא נמצא לשמירה ברשימה."),
      }),
    );
  }

  const fallbackName = `Saved report ${new Date(reportRow.report_at).toISOString().slice(0, 10)}`;
  const defaultName = customName || fallbackName;

  const { data: existingNameMatch } = await supabase
    .from("user_default_items")
    .select("id")
    .eq("user_id", user.id)
    .ilike("name", defaultName)
    .maybeSingle();

  if (existingNameMatch) {
    redirect(
      buildDailyReportRedirectPath({
        error: tr(
          locale,
          `An item named "${defaultName}" is already in your saved list. Please choose a different name.`,
          `פריט בשם "${defaultName}" כבר קיים ברשימה השמורה שלך. יש לבחור שם אחר.`,
        ),
      }),
    );
  }

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
      cholesterol_mg: round(toNumber(reportRow.cholesterol_mg)),
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
        error: tr(locale, "Could not add this report to your Saved List.", "לא ניתן להוסיף דיווח זה לרשימה השמורה."),
      }),
    );
  }

  revalidatePath("/app/daily-report");
  revalidatePath("/app/daily-report/defaults");

  redirect(
    buildDailyReportRedirectPath({ notice: tr(locale, "Report was added to your Saved List.", "הדיווח נוסף לרשימה השמורה.") }),
  );
}

const FOOD_NUMERIC_FIELDS: Array<Exclude<keyof ParsedFoodItem, "name" | "quantity" | "unit">> = [
  "caloriesKcal", "proteinG", "carbsG", "fatG", "fiberG", "waterMl",
  "magnesiumMg", "potassiumMg", "ironMg", "zincMg", "sodiumMg", "addedSugarG",
  "calciumMg", "vitCMg", "vitB12Mcg", "vitDMcg", "satFatG", "omega3G", "cholesterolMg",
];

/** Rescales every nutrient field on a single already-logged food item to a
 * new quantity, proportional to its original quantity (e.g. "2 rolls" -> "1
 * roll" halves calories/protein/etc. too) - the same scale-by-quantity-ratio
 * approach already used when a saved-list item's quantity differs from its
 * default (see the `scale = quantity / baseQuantity` block above). Falls
 * back to leaving nutrients untouched (scale 1) only in the degenerate case
 * where the item's original quantity was 0 and no rate can be derived. */
function scaleFoodItem(item: Record<string, unknown>, newQuantity: number): ParsedFoodItem {
  const oldQuantity = toNumber(item.quantity, 0);
  const scale = oldQuantity > 0 ? newQuantity / oldQuantity : 1;
  const scaled: Record<string, unknown> = { ...item, quantity: round(newQuantity, 2) };
  for (const field of FOOD_NUMERIC_FIELDS) {
    scaled[field] = round(toNumber(item[field]) * scale, 2);
  }
  return scaled as ParsedFoodItem;
}

/** Same idea as scaleFoodItem, for an already-logged exercise entry's
 * duration - estimatedBurnKcal scales with minutes the same way it was
 * originally computed (MET x weight x minutes, linear in minutes). */
function scaleExerciseItem(item: Record<string, unknown>, newMinutes: number): ParsedExerciseItem {
  const oldMinutes = toNumber(item.minutes, 0);
  const scale = oldMinutes > 0 ? newMinutes / oldMinutes : 1;
  return {
    ...item,
    minutes: Math.round(newMinutes),
    estimatedBurnKcal: round(toNumber(item.estimatedBurnKcal) * scale, 2),
  } as ParsedExerciseItem;
}

function sumFoodTotals(items: Array<Record<string, unknown>>): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(FOOD_NUMERIC_FIELDS.map((field) => [field, 0]));
  for (const item of items) {
    for (const field of FOOD_NUMERIC_FIELDS) {
      totals[field] += toNumber(item[field]);
    }
  }
  return totals;
}

function sumExerciseTotals(items: Array<Record<string, unknown>>): { exerciseMinutes: number; estimatedBurnKcal: number } {
  let exerciseMinutes = 0;
  let estimatedBurnKcal = 0;
  for (const item of items) {
    exerciseMinutes += toNumber(item.minutes);
    estimatedBurnKcal += toNumber(item.estimatedBurnKcal);
  }
  return { exerciseMinutes: Math.round(exerciseMinutes), estimatedBurnKcal: round(estimatedBurnKcal) };
}

/**
 * Lets the user correct a single already-logged item's quantity/duration
 * directly from the reports list (e.g. "2 rolls" -> "1 roll") without going
 * through the chat again - the "Edit entry" flow re-opens the whole
 * conversation and re-runs AI parsing on the full transcript, which is far
 * more than a one-number correction calls for. Items are matched by their
 * position in parsed_items/parsed_exercises (the same order the form was
 * rendered with, via food_quantity__<index>/exercise_minutes__<index> field
 * names) since neither array carries a stable per-item id. Setting an
 * item's quantity/duration to 0 removes it from the log entirely (see the
 * flatMap below), rather than leaving a zeroed-out entry behind.
 */
/**
 * The nutrient totals a user can correct directly (e.g. typing in the exact
 * calorie count printed on a food package, overriding what the AI parser
 * estimated) - each maps its DB column (also this field's form input name,
 * `nutrient_value__<dbColumn>`) to where its *automatically calculated*
 * value lives on the same-shaped objects sumFoodTotals/sumExerciseTotals
 * already return. Deliberately a subset, not every nutrient tracked - only
 * the ones actually shown (and therefore editable) in the page's own
 * per-entry detail grid.
 */
const OVERRIDABLE_NUTRIENT_FIELDS: Array<{ dbColumn: string; autoKey: string; source: "food" | "exercise" }> = [
  { dbColumn: "calories_kcal", autoKey: "caloriesKcal", source: "food" },
  { dbColumn: "protein_g", autoKey: "proteinG", source: "food" },
  { dbColumn: "water_ml", autoKey: "waterMl", source: "food" },
  { dbColumn: "magnesium_mg", autoKey: "magnesiumMg", source: "food" },
  { dbColumn: "potassium_mg", autoKey: "potassiumMg", source: "food" },
  { dbColumn: "iron_mg", autoKey: "ironMg", source: "food" },
  { dbColumn: "zinc_mg", autoKey: "zincMg", source: "food" },
  { dbColumn: "estimated_burn_kcal", autoKey: "estimatedBurnKcal", source: "exercise" },
];

export async function adjustDailyReportItemQuantitiesAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveDailyReportLocale(supabase, user.id);
  const reportId = formData.get("report_id")?.toString();
  const selectedDateParam = formData.get("selected_date")?.toString() || undefined;

  if (!reportId) {
    redirect(
      buildDailyReportRedirectPath({
        error: tr(locale, "Missing report id.", "מזהה הדיווח חסר."),
        date: selectedDateParam,
      }),
    );
  }

  const { data: reportRow, error: reportError } = await supabase
    .from("user_daily_reports")
    .select(
      "id, parsed_items, parsed_exercises, reported_weight_kg, custom_target_values, custom_target_value_originals, nutrient_overrides, calories_kcal, protein_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, estimated_burn_kcal",
    )
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (reportError || !reportRow) {
    redirect(
      buildDailyReportRedirectPath({
        error: tr(locale, "Daily report not found.", "הדיווח היומי לא נמצא."),
        date: selectedDateParam,
      }),
    );
  }

  const foodItems = (Array.isArray(reportRow.parsed_items) ? reportRow.parsed_items : []) as Array<Record<string, unknown>>;
  const exerciseItems = (Array.isArray(reportRow.parsed_exercises) ? reportRow.parsed_exercises : []) as Array<Record<string, unknown>>;

  let changed = false;

  // flatMap rather than map: setting a quantity/duration to 0 removes the
  // item from the log entirely (an empty array in place of it) rather than
  // leaving a zeroed-out "banana (0 unit)" entry behind - that matches what
  // a user setting it to 0 actually means ("I didn't have this").
  const nextFoodItems = foodItems.flatMap((item, index) => {
    const raw = formData.get(`food_quantity__${index}`);
    if (raw == null) return [item];
    const nextQuantity = toNumber(raw, Number.NaN);
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) return [item];
    const currentQuantity = toNumber(item.quantity, 0);
    if (Math.abs(nextQuantity - currentQuantity) < 1e-9) return [item];
    changed = true;
    if (nextQuantity <= 1e-9) return [];
    return [scaleFoodItem(item, nextQuantity)];
  });

  const nextExerciseItems = exerciseItems.flatMap((item, index) => {
    const raw = formData.get(`exercise_minutes__${index}`);
    if (raw == null) return [item];
    const nextMinutes = toNumber(raw, Number.NaN);
    if (!Number.isFinite(nextMinutes) || nextMinutes < 0) return [item];
    const currentMinutes = toNumber(item.minutes, 0);
    if (Math.abs(nextMinutes - currentMinutes) < 1e-9) return [item];
    changed = true;
    if (nextMinutes <= 1e-9) return [];
    return [scaleExerciseItem(item, nextMinutes)];
  });

  // Weight and custom targets (e.g. sleep duration) are plain scalars, not
  // arrays of items to rescale - the field is only present in formData at
  // all when the "Edit quantities" form actually rendered an input for it
  // (see the page's per-entry detail view), so a missing field always means
  // "this report has nothing of that kind," never "leave it untouched."
  // Blank clears it (same "0 removes it" idea the food/exercise fields
  // above already use), matching what typing over the prefilled value and
  // deleting it would intuitively mean.
  let nextReportedWeightKg = reportRow.reported_weight_kg;
  const weightRaw = formData.get("reported_weight_kg");
  if (weightRaw != null) {
    const trimmedWeight = weightRaw.toString().trim();
    if (trimmedWeight === "") {
      if (reportRow.reported_weight_kg !== null) {
        nextReportedWeightKg = null;
        changed = true;
      }
    } else {
      const parsedWeight = toNumber(trimmedWeight, Number.NaN);
      if (Number.isFinite(parsedWeight) && parsedWeight >= 20 && parsedWeight <= 400) {
        const roundedWeight = round(parsedWeight, 2);
        if (reportRow.reported_weight_kg === null || Math.abs(roundedWeight - Number(reportRow.reported_weight_kg)) > 1e-9) {
          nextReportedWeightKg = roundedWeight;
          changed = true;
        }
      }
      // Out-of-range/non-numeric input is silently ignored (kept at its
      // current value) rather than blocking the whole save - the same
      // "invalid input keeps the existing value" behavior the food/exercise
      // fields above already use.
    }
  }
  const weightChanged = nextReportedWeightKg !== reportRow.reported_weight_kg;

  const currentCustomTargetValues =
    reportRow.custom_target_values
    && typeof reportRow.custom_target_values === "object"
    && !Array.isArray(reportRow.custom_target_values)
      ? (reportRow.custom_target_values as Record<string, number>)
      : {};
  const currentCustomTargetValueOriginals =
    reportRow.custom_target_value_originals
    && typeof reportRow.custom_target_value_originals === "object"
    && !Array.isArray(reportRow.custom_target_value_originals)
      ? (reportRow.custom_target_value_originals as Record<string, { value: number; unit: string }>)
      : {};
  const nextCustomTargetValues: Record<string, number> = { ...currentCustomTargetValues };
  const nextCustomTargetValueOriginals: Record<string, { value: number; unit: string }> = { ...currentCustomTargetValueOriginals };
  // Collected first, reconciled against each target's own unit in one
  // batched AI call below (see reconcileCustomTargetValueUnits' own
  // comment), rather than applied field-by-field - same reasoning as
  // saveDailyReportAction's own version of this step.
  const pendingCustomTargetChanges: Record<string, number> = {};

  for (const [targetId, currentValue] of Object.entries(currentCustomTargetValues)) {
    const raw = formData.get(`custom_target_value__${targetId}`);
    if (raw == null) continue;
    const trimmed = raw.toString().trim();
    if (trimmed === "") {
      delete nextCustomTargetValues[targetId];
      delete nextCustomTargetValueOriginals[targetId];
      changed = true;
      continue;
    }
    const parsed = toNumber(trimmed, Number.NaN);
    if (!Number.isFinite(parsed)) continue;
    const rounded = round(parsed, 2);
    if (Math.abs(rounded - Number(currentValue)) > 1e-9) {
      pendingCustomTargetChanges[targetId] = rounded;
      changed = true;
    }
  }

  if (Object.keys(pendingCustomTargetChanges).length > 0) {
    const { data: activeTargetProfileForUnits } = await supabase
      .from("user_target_profiles")
      .select("user_targets")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    const loggableTargetsById = new Map(
      normalizeUserTargetsJson(activeTargetProfileForUnits?.user_targets)
        .filter((target) => target.id && target.unit && target.targetMin !== undefined && target.targetMax !== undefined)
        .map((target) => [target.id!, target]),
    );

    const entriesToCheck = Object.entries(pendingCustomTargetChanges)
      .map(([targetId, typedValue]) => {
        const target = loggableTargetsById.get(targetId);
        return target
          ? { id: targetId, label: target.label, unit: target.unit!, targetMin: target.targetMin!, targetMax: target.targetMax!, typedValue }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const aiConfig = entriesToCheck.length > 0 ? getAiExtractionConfig() : null;
    const reconciliations = aiConfig
      ? await reconcileCustomTargetValueUnits({ config: aiConfig, locale, entries: entriesToCheck }).catch((error) => {
          logServerError("dailyReport.adjustQuantities", "custom_target_unit_reconcile_failed", {
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
      : null;

    for (const [targetId, typedValue] of Object.entries(pendingCustomTargetChanges)) {
      const reconciliation = reconciliations?.[targetId];
      nextCustomTargetValues[targetId] = reconciliation?.canonicalValue ?? typedValue;
      if (reconciliation?.original) {
        nextCustomTargetValueOriginals[targetId] = reconciliation.original;
      } else {
        delete nextCustomTargetValueOriginals[targetId];
      }
    }
  }

  // A nutrient field is only ever touched here when the form actually
  // marks it so (a hidden `nutrient_value__<column>__touched` field the
  // client sets the moment the user types into that specific input - see
  // the page's own edit form) - never inferred from "the submitted number
  // differs from the current one", which would be true for every override-
  // able field any time this same save ALSO changed an item, since those
  // fields' own inputs are pre-filled with the report's LAST totals, not
  // whatever this save is about to recompute. Blank clears a field's own
  // override (back to automatically derived from items); a real number
  // pins it so a later item edit/delete can't silently overwrite a
  // deliberate correction (e.g. the exact calorie count off a food
  // package) - see this action's own final write below for how overridden
  // fields are protected from the auto-recalculated totals.
  const currentOverrides =
    reportRow.nutrient_overrides && typeof reportRow.nutrient_overrides === "object" && !Array.isArray(reportRow.nutrient_overrides)
      ? (reportRow.nutrient_overrides as Record<string, boolean>)
      : {};
  const nextOverrides: Record<string, boolean> = { ...currentOverrides };
  const overrideValues: Record<string, number> = {};

  for (const field of OVERRIDABLE_NUTRIENT_FIELDS) {
    const touched = formData.get(`nutrient_value__${field.dbColumn}__touched`) != null;
    if (!touched) continue;

    const raw = formData.get(`nutrient_value__${field.dbColumn}`)?.toString().trim() ?? "";
    if (raw === "") {
      if (nextOverrides[field.dbColumn]) {
        delete nextOverrides[field.dbColumn];
        changed = true;
      }
      continue;
    }

    const parsed = toNumber(raw, Number.NaN);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    const rounded = round(parsed, 2);
    const currentValue = toNumber((reportRow as Record<string, unknown>)[field.dbColumn], 0);
    if (!currentOverrides[field.dbColumn] || Math.abs(rounded - currentValue) > 1e-9) {
      nextOverrides[field.dbColumn] = true;
      overrideValues[field.dbColumn] = rounded;
      changed = true;
    }
  }

  if (!changed) {
    redirect(buildDailyReportRedirectPath({ date: selectedDateParam }));
  }

  // Zeroing out every remaining item leaves a report with nothing left to
  // say - rather than persist an empty "0 calories, 0 of everything" row,
  // delete it outright (same as the explicit "Delete entry" button). But
  // only when the row is ACTUALLY empty once food/exercise items are gone -
  // a report can also carry a logged weigh-in and/or custom target values
  // (e.g. sleep hours, steps) entirely independent of its food/exercise
  // items, and zeroing out "1 apple" must not silently delete those too.
  // Checked against the POST-edit values (not reportRow's original ones),
  // since this same edit may be exactly what just cleared the weight and/or
  // every custom target, in which case an otherwise-empty report should be
  // deleted here too, not left behind as a blank row.
  const hasReportedWeight = nextReportedWeightKg != null;
  // A value of exactly 0 is treated the same as "not logged" here (not just
  // "key absent") - a leftover {"sleep_hours": 0} from an untouched custom
  // target field (see extractCustomTargetValues) must not by itself block
  // deleting an otherwise-empty report.
  const hasCustomTargetValues = Object.values(nextCustomTargetValues).some((value) => Number(value) !== 0);

  if (nextFoodItems.length === 0 && nextExerciseItems.length === 0 && !hasReportedWeight && !hasCustomTargetValues) {
    const { error: deleteError } = await supabase
      .from("user_daily_reports")
      .delete()
      .eq("id", reportId)
      .eq("user_id", user.id);

    if (deleteError) {
      logServerError("dailyReport.adjustQuantities", "delete_empty_report_failed", {
        userId: user.id,
        reportId,
        error: deleteError.message,
      });
      redirect(
        buildDailyReportRedirectPath({
          error: tr(locale, "Failed to update quantities. Please try again.", "עדכון הכמויות נכשל. יש לנסות שוב."),
          date: selectedDateParam,
        }),
      );
    }

    // The report being deleted may have carried the weigh-in that this very
    // edit just cleared (or one it already had) - either way, if it had a
    // weight, user_profile.weight_kg needs to be re-derived from whatever's
    // left now that this row is gone, same as deleteDailyReportAction does
    // for the explicit "Delete entry" button. Best-effort: a failure here
    // shouldn't undo the deletion that already succeeded.
    if (reportRow.reported_weight_kg != null) {
      await resyncProfileWeightFromReports(supabase, user.id);
    }

    revalidatePath("/app/daily-report");
    revalidatePath("/app");

    redirect(
      buildDailyReportRedirectPath({
        notice: tr(
          locale,
          "All items were removed, so the entry was deleted.",
          "כל הפריטים הוסרו, ולכן הרשומה נמחקה.",
        ),
        date: selectedDateParam,
      }),
    );
  }

  const foodTotals = sumFoodTotals(nextFoodItems);
  const exerciseTotals = sumExerciseTotals(nextExerciseItems);
  const autoTotalsByKey: Record<string, number> = { ...foodTotals, ...exerciseTotals };

  // A field pinned via nutrient_overrides never takes the freshly
  // recalculated auto value below, regardless of what item changes this
  // exact save also made - it takes this save's own new override value
  // when the user just set one, otherwise the value it already had
  // (reportRow's own current column), never the recomputed total.
  function resolveNutrientValue(field: (typeof OVERRIDABLE_NUTRIENT_FIELDS)[number]): number {
    if (field.dbColumn in overrideValues) return overrideValues[field.dbColumn];
    if (nextOverrides[field.dbColumn]) return toNumber((reportRow as Record<string, unknown>)[field.dbColumn], 0);
    return round(autoTotalsByKey[field.autoKey] ?? 0);
  }

  const nutrientColumnValues = Object.fromEntries(
    OVERRIDABLE_NUTRIENT_FIELDS.map((field) => [field.dbColumn, resolveNutrientValue(field)]),
  ) as Record<string, number>;

  const { error: updateError } = await supabase
    .from("user_daily_reports")
    .update({
      parsed_items: nextFoodItems,
      parsed_exercises: nextExerciseItems,
      reported_weight_kg: nextReportedWeightKg,
      custom_target_values: nextCustomTargetValues,
      custom_target_value_originals: nextCustomTargetValueOriginals,
      nutrient_overrides: nextOverrides,
      calories_kcal: nutrientColumnValues.calories_kcal,
      protein_g: nutrientColumnValues.protein_g,
      carbs_g: round(foodTotals.carbsG),
      fat_g: round(foodTotals.fatG),
      fiber_g: round(foodTotals.fiberG),
      water_ml: nutrientColumnValues.water_ml,
      magnesium_mg: nutrientColumnValues.magnesium_mg,
      potassium_mg: nutrientColumnValues.potassium_mg,
      iron_mg: nutrientColumnValues.iron_mg,
      zinc_mg: nutrientColumnValues.zinc_mg,
      sodium_mg: round(foodTotals.sodiumMg),
      added_sugar_g: round(foodTotals.addedSugarG),
      calcium_mg: round(foodTotals.calciumMg),
      vit_c_mg: round(foodTotals.vitCMg),
      vit_b12_mcg: round(foodTotals.vitB12Mcg),
      vit_d_mcg: round(foodTotals.vitDMcg),
      sat_fat_g: round(foodTotals.satFatG),
      omega3_g: round(foodTotals.omega3G),
      cholesterol_mg: round(foodTotals.cholesterolMg),
      exercise_minutes: exerciseTotals.exerciseMinutes,
      estimated_burn_kcal: nutrientColumnValues.estimated_burn_kcal,
    })
    .eq("id", reportId)
    .eq("user_id", user.id);

  if (updateError) {
    logServerError("dailyReport.adjustQuantities", "update_failed", {
      userId: user.id,
      reportId,
      error: updateError.message,
    });
    redirect(
      buildDailyReportRedirectPath({
        error: tr(locale, "Failed to update quantities. Please try again.", "עדכון הכמויות נכשל. יש לנסות שוב."),
        date: selectedDateParam,
      }),
    );
  }

  // Keep the profile's cached current weight in sync whenever this edit
  // touched this report's own weight - same reasoning as saveDailyReportAction,
  // just re-derived from scratch rather than assumed to be this report's new
  // value, so an edit to an older, non-most-recent entry can never override
  // a genuinely more recent weigh-in. Best-effort, after the write already
  // succeeded.
  if (weightChanged) {
    await resyncProfileWeightFromReports(supabase, user.id);
  }

  revalidatePath("/app/daily-report");
  revalidatePath("/app");

  redirect(
    buildDailyReportRedirectPath({
      notice: tr(locale, "Quantities updated.", "הכמויות עודכנו."),
      date: selectedDateParam,
    }),
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

  const coreMetrics = formData
    .getAll("core_metric")
    .map((value) => value.toString())
    .filter((id): id is DailyReportChartCoreMetric => CHART_CORE_METRIC_IDS.includes(id as DailyReportChartCoreMetric));
  const extraMetrics = formData
    .getAll("extra_metric")
    .map((value) => value.toString())
    .filter((id): id is DailyReportChartExtraMetric => CHART_EXTRA_METRIC_IDS.includes(id as DailyReportChartExtraMetric));
  const showWeightTrend = formData.get("show_weight_trend")?.toString() === "on";

  // `customized: true` marks that the user has explicitly saved a selection
  // at least once, so an intentionally empty one (every box unchecked) is
  // respected instead of being indistinguishable from a pristine, never-
  // configured row - see normalizeDailyReportChartPreferences.
  const preferences: DailyReportChartPreferences & { customized: true } = {
    customized: true,
    coreMetrics,
    extraMetrics,
    showWeightTrend,
  };

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
