import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletionWithProgress } from "@/lib/ai/provider-client";
import { BMI_GOOD_MAX, BMI_GOOD_MIN, classifyBmi, computeBmi } from "@/lib/bmi";
import type { AppLocale } from "@/lib/locale";
import { exerciseModalityOptions } from "@/lib/profile";
import type { ExerciseTargetEntry, HabitEntry, ProfileForTargets, TargetGenerationPayload, TargetGoalType, UserTargetEntry } from "@/lib/targets";

/** The exact modality tokens the rest of the app knows how to localize (see
 * formatExerciseModality in lib/locale.ts) and that onboarding/profile already
 * constrain users to. "none" is excluded - it never makes sense for an actual
 * planned exercise_targets entry. */
const AI_EXERCISE_MODALITY_TOKENS = exerciseModalityOptions.filter((option) => option !== "none");

/** The AI is asked to only ever use one of AI_EXERCISE_MODALITY_TOKENS, but
 * models drift toward a more natural free-text word (e.g. "walking") instead
 * of the bucket it belongs to (e.g. "endurance_cardio") - formatExerciseModality
 * has no translation for an arbitrary word, so it would render that raw
 * English word untouched even in a Hebrew UI. Coercing anything outside the
 * known set to "other" here guarantees a correctly localized label every
 * time; the specific activity name itself isn't lost - it already lives in
 * ai_adjustment_note and search_keywords, both free text the model already
 * writes in the right language. */
function normalizeAiModality(rawModality: string): (typeof AI_EXERCISE_MODALITY_TOKENS)[number] {
  const normalized = rawModality.trim().toLowerCase();
  const match = AI_EXERCISE_MODALITY_TOKENS.find((token) => token === normalized);
  return match ?? "other";
}

/** Thrown when the model determines goal_text (an adjustment request against
 * an already-locked plan) doesn't describe any concrete, in-scope health
 * change to apply - as opposed to a generation failure, this should not fall
 * back to the heuristic generator, since that would silently mask the signal
 * with an unrelated baseline payload. */
export class NoActionableChangeError extends Error {}

const numberFromUnknown = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}, z.number());

const aiExerciseTargetSchema = z.object({
  modality: z.string().trim().min(1).max(60),
  frequency_per_week: numberFromUnknown,
  duration_minutes_per_session: numberFromUnknown,
  ai_adjustment_note: z.string().trim().max(400).optional().default(""),
  // Search keyword phrases only - never trust AI-suggested direct video URLs.
  search_keywords: z.array(z.string().trim().min(1).max(120)).max(5).optional().default([]),
});

const aiHabitEntrySchema = z.object({
  id: z.string().trim().min(1).max(60),
  habit_instruction: z.string().trim().min(1).max(300),
  rationale: z.string().trim().min(1).max(500),
});

const aiUserTargetEntrySchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(80),
  // Optional so a response that omits these (model drift) still validates
  // as a display-only entry rather than failing generation entirely - see
  // the prompt rule below for why they should normally always be present.
  id: z.string().trim().min(1).max(60).optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  target_min: z.number().min(0).max(100000).optional(),
  target_max: z.number().min(0).max(100000).optional(),
  higher_is_better: z.boolean().optional(),
});

const aiTargetsSchema = z.object({
  no_actionable_change: z.boolean().optional().default(false),
  no_actionable_change_reason: z.string().trim().max(300).optional().default(""),

  goal_type: z.enum(["weight_loss", "weight_gain", "maintain", "general"]),
  target_weight_kg: numberFromUnknown.optional(),
  duration_days: numberFromUnknown.optional(),
  blood_balance_focus: z.boolean().optional(),
  sleep_focus: z.boolean().optional(),

  calories_min: numberFromUnknown,
  calories_max: numberFromUnknown,
  protein_min_g: numberFromUnknown,
  protein_max_g: numberFromUnknown,
  carbs_min_g: numberFromUnknown,
  carbs_max_g: numberFromUnknown,
  fats_min_g: numberFromUnknown,
  fats_max_g: numberFromUnknown,
  fiber_min_g: numberFromUnknown,
  fiber_max_g: numberFromUnknown,
  sodium_min_mg: numberFromUnknown,
  sodium_max_mg: numberFromUnknown,
  added_sugar_min_g: numberFromUnknown,
  added_sugar_max_g: numberFromUnknown,
  water_min_ml: numberFromUnknown,
  water_max_ml: numberFromUnknown,

  potassium_min_mg: numberFromUnknown,
  potassium_max_mg: numberFromUnknown,
  magnesium_min_mg: numberFromUnknown,
  magnesium_max_mg: numberFromUnknown,
  calcium_min_mg: numberFromUnknown,
  calcium_max_mg: numberFromUnknown,
  iron_min_mg: numberFromUnknown,
  iron_max_mg: numberFromUnknown,
  zinc_min_mg: numberFromUnknown,
  zinc_max_mg: numberFromUnknown,
  vit_c_min_mg: numberFromUnknown,
  vit_c_max_mg: numberFromUnknown,
  vit_b12_min_mcg: numberFromUnknown,
  vit_b12_max_mcg: numberFromUnknown,
  vit_d_min_mcg: numberFromUnknown,
  vit_d_max_mcg: numberFromUnknown,
  sat_fat_min_g: numberFromUnknown,
  sat_fat_max_g: numberFromUnknown,
  omega3_min_g: numberFromUnknown,
  omega3_max_g: numberFromUnknown,
  cholesterol_min_mg: numberFromUnknown,
  cholesterol_max_mg: numberFromUnknown,

  exercise_targets: z.array(aiExerciseTargetSchema).max(6).optional().default([]),
  habits_do: z.array(aiHabitEntrySchema).max(6).optional().default([]),
  habits_dont: z.array(aiHabitEntrySchema).max(6).optional().default([]),
  user_targets: z.array(aiUserTargetEntrySchema).max(8).optional().default([]),

  // 1000 was too tight for a thorough explanation covering more than one
  // simultaneous change (e.g. a medical condition AND a dietary preference
  // both requiring their own safety/compatibility discussion) - the model
  // would write a longer, genuinely justified explanation and the whole
  // generation would fail validation over it, indistinguishable from a real
  // failure to the caller (see generateTargetsPayload's catch-all).
  global_coaching_explanation: z.string().trim().max(2500).optional().default(""),
  confidence: numberFromUnknown.optional(),
  profile_discrepancy_message: z.string().trim().max(300).optional().default(""),
});

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamps a min/max pair into [lo, hi] and guarantees min <= max. */
function clampRange(min: number, max: number, lo: number, hi: number, digits = 1): { min: number; max: number } {
  const clampedMin = clamp(min, lo, hi);
  const clampedMax = clamp(max, lo, hi);
  return {
    min: round(Math.min(clampedMin, clampedMax), digits),
    max: round(Math.max(clampedMin, clampedMax), digits),
  };
}

function parseJsonPayload(contentText: string): unknown {
  const trimmed = contentText.trim();
  if (!trimmed.length) {
    throw new Error("AI returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("AI returned invalid JSON.");
  }
}

function toExerciseTargets(items: z.infer<typeof aiExerciseTargetSchema>[]): ExerciseTargetEntry[] {
  return items.slice(0, 6).map((item) => ({
    modality: normalizeAiModality(item.modality),
    frequencyPerWeek: Math.round(clamp(item.frequency_per_week, 0, 14)),
    durationMinutesPerSession: Math.round(clamp(item.duration_minutes_per_session, 0, 240)),
    aiAdjustmentNote: item.ai_adjustment_note,
    // Never trust AI-suggested direct video links; only keyword phrases are
    // accepted, and the UI only ever builds YouTube *search* URLs from them.
    searchKeywords: item.search_keywords.slice(0, 5),
  }));
}

function toHabitEntries(items: z.infer<typeof aiHabitEntrySchema>[]): HabitEntry[] {
  return items.slice(0, 6).map((item) => ({
    id: item.id,
    habitInstruction: item.habit_instruction,
    rationale: item.rationale,
  }));
}

function toUserTargets(items: z.infer<typeof aiUserTargetEntrySchema>[]): UserTargetEntry[] {
  return items.slice(0, 8).map((item) => ({
    label: item.label,
    value: item.value,
    // Only exposed as a group - see normalizeAiModality's sibling reasoning
    // in this file: a partial set (e.g. unit without target_min) isn't
    // enough to log against, so it's treated the same as absent.
    ...(item.id && item.unit && item.target_min !== undefined && item.target_max !== undefined
      ? {
          id: item.id,
          unit: item.unit,
          targetMin: item.target_min,
          targetMax: item.target_max,
          // Defaults true (see UserTargetEntry's own comment) for the rare
          // case a model response omits it despite the prompt asking for it
          // on every entry.
          higherIsBetter: item.higher_is_better ?? true,
        }
      : {}),
  }));
}

function mapAiTargetsResponse(raw: z.infer<typeof aiTargetsSchema>): TargetGenerationPayload {
  const calories = clampRange(raw.calories_min, raw.calories_max, 800, 6000, 0);
  const protein = clampRange(raw.protein_min_g, raw.protein_max_g, 0, 400);
  const carbs = clampRange(raw.carbs_min_g, raw.carbs_max_g, 0, 900);
  const fats = clampRange(raw.fats_min_g, raw.fats_max_g, 0, 400);
  const fiber = clampRange(raw.fiber_min_g, raw.fiber_max_g, 0, 100);
  const sodium = clampRange(raw.sodium_min_mg, raw.sodium_max_mg, 0, 4000, 0);
  const addedSugar = clampRange(raw.added_sugar_min_g, raw.added_sugar_max_g, 0, 100);
  const water = clampRange(raw.water_min_ml, raw.water_max_ml, 500, 6000, 0);
  const potassium = clampRange(raw.potassium_min_mg, raw.potassium_max_mg, 0, 6000, 0);
  const magnesium = clampRange(raw.magnesium_min_mg, raw.magnesium_max_mg, 0, 600, 0);
  const calcium = clampRange(raw.calcium_min_mg, raw.calcium_max_mg, 0, 2500, 0);
  const iron = clampRange(raw.iron_min_mg, raw.iron_max_mg, 0, 45);
  const zinc = clampRange(raw.zinc_min_mg, raw.zinc_max_mg, 0, 40);
  const vitC = clampRange(raw.vit_c_min_mg, raw.vit_c_max_mg, 0, 2000, 0);
  const vitB12 = clampRange(raw.vit_b12_min_mcg, raw.vit_b12_max_mcg, 0, 100);
  const vitD = clampRange(raw.vit_d_min_mcg, raw.vit_d_max_mcg, 0, 100);
  const satFat = clampRange(raw.sat_fat_min_g, raw.sat_fat_max_g, 0, 100);
  const omega3 = clampRange(raw.omega3_min_g, raw.omega3_max_g, 0, 10);
  const cholesterol = clampRange(raw.cholesterol_min_mg, raw.cholesterol_max_mg, 0, 1000, 0);

  return {
    goalType: raw.goal_type as TargetGoalType,
    targetWeightKg: typeof raw.target_weight_kg === "number" && raw.target_weight_kg > 0 ? round(raw.target_weight_kg) : null,
    durationDays: typeof raw.duration_days === "number" && raw.duration_days > 0 ? Math.round(raw.duration_days) : null,
    bloodBalanceFocus: Boolean(raw.blood_balance_focus),
    sleepFocus: Boolean(raw.sleep_focus),

    caloriesMin: calories.min,
    caloriesMax: calories.max,
    proteinMinG: protein.min,
    proteinMaxG: protein.max,
    carbsMinG: carbs.min,
    carbsMaxG: carbs.max,
    fatsMinG: fats.min,
    fatsMaxG: fats.max,
    fiberMinG: fiber.min,
    fiberMaxG: fiber.max,
    sodiumMinMg: sodium.min,
    sodiumMaxMg: sodium.max,
    addedSugarMinG: addedSugar.min,
    addedSugarMaxG: addedSugar.max,
    waterMinMl: water.min,
    waterMaxMl: water.max,

    potassiumMinMg: potassium.min,
    potassiumMaxMg: potassium.max,
    magnesiumMinMg: magnesium.min,
    magnesiumMaxMg: magnesium.max,
    calciumMinMg: calcium.min,
    calciumMaxMg: calcium.max,
    ironMinMg: iron.min,
    ironMaxMg: iron.max,
    zincMinMg: zinc.min,
    zincMaxMg: zinc.max,
    vitCMinMg: vitC.min,
    vitCMaxMg: vitC.max,
    vitB12MinMcg: vitB12.min,
    vitB12MaxMcg: vitB12.max,
    vitDMinMcg: vitD.min,
    vitDMaxMcg: vitD.max,
    satFatMinG: satFat.min,
    satFatMaxG: satFat.max,
    omega3MinG: omega3.min,
    omega3MaxG: omega3.max,
    cholesterolMinMg: cholesterol.min,
    cholesterolMaxMg: cholesterol.max,

    exerciseTargets: toExerciseTargets(raw.exercise_targets),
    habitsDo: toHabitEntries(raw.habits_do),
    habitsDont: toHabitEntries(raw.habits_dont),
    userTargets: toUserTargets(raw.user_targets),

    aiRationaleExplanation: raw.global_coaching_explanation,
    confidence: clamp(raw.confidence ?? 0.75, 0.3, 0.97),
    assumptions: [],
    profileDiscrepancyMessage: raw.profile_discrepancy_message,
  };
}

function buildProfileSummary(profile: ProfileForTargets): string {
  // Computed deterministically (not left for the model to derive) so the
  // MANDATORY BMI SAFETY REVIEW rule below has an exact, pre-classified
  // number to act on instead of relying on the model to both do the
  // arithmetic correctly and recognize on its own that it matters.
  const bmi = computeBmi(profile.weight_kg, profile.height_cm);
  const bmiLine =
    bmi > 0
      ? `bmi: ${bmi.toFixed(1)} (${classifyBmi(bmi) === "good" ? "within" : classifyBmi(bmi) === "warning" ? "borderline outside" : "well outside"} the healthy range of ${BMI_GOOD_MIN}-${BMI_GOOD_MAX})`
      : "bmi: unknown (missing height or weight)";

  return [
    `age: ${profile.age}`,
    `biological_sex: ${profile.biological_sex ?? profile.gender ?? "unknown"}`,
    `height_cm: ${profile.height_cm}`,
    `weight_kg: ${profile.weight_kg}`,
    bmiLine,
    `activity_level: ${profile.activity_level}`,
    `allergies: ${profile.allergies.join(", ") || "none"}`,
    `medical_conditions: ${profile.medical_conditions.join(", ") || "none"}`,
    `medical_conditions_details: ${profile.medical_conditions_details || "none"}`,
    `regular_medications_details: ${profile.regular_medications_details || "none"}`,
    `dietary_preference: ${profile.dietary_preference ?? "standard"}`,
    `exercise_modalities: ${profile.exercise_modalities.join(", ") || "none"}`,
    ...(profile.exercise_other_activities.length
      ? [
          `exercise_other_activities: ${profile.exercise_other_activities
            .map((activity) => `${activity.name} (${activity.days_per_week}x/week, ${activity.minutes_per_session}min/session)`)
            .join("; ")}`,
        ]
      : []),
    `habits: ${profile.habits.join(", ") || "none"}`,
    `pregnancy_lactation_status: ${profile.pregnancy_lactation_status ?? "none"}`,
  ].join("\n");
}

export async function generateTargetsWithAi({
  config,
  goalText,
  profile,
  locale,
  currentTargets,
  medicalDocumentsContext,
  recentCustomTargetLogs,
  onProgress,
}: {
  config: AiExtractionConfig;
  goalText: string;
  profile: ProfileForTargets;
  locale: AppLocale;
  /** When present, this is an adjustment request against an already-locked
   * plan: the model should change only what was asked and keep everything
   * else as close to unchanged as reasonable, propagating any necessary
   * consistency changes (e.g. lower workout frequency -> lower calorie
   * ceiling), instead of generating a fresh plan from scratch. */
  currentTargets?: TargetGenerationPayload;
  /** Extracted findings from the user's uploaded medical documents (e.g. lab
   * results), when any are available - see buildMedicalDocumentsContextRules
   * for how the model is instructed to weigh these. */
  medicalDocumentsContext?: string;
  /** Recent raw values (most recent last) the user has actually logged in
   * Daily Report for each of current_active_targets.user_targets' loggable
   * ids, when any exist - lets the model notice when a target's stored unit
   * doesn't match what the user is really tracking (e.g. a "40 minutes"
   * walking target against logged values in the thousands - clearly a step
   * count) and reconcile it, instead of the two silently drifting apart.
   * Only meaningful for an adjustment request (currentTargets present). */
  recentCustomTargetLogs?: Record<string, number[]>;
  /** Forwarded to callAiChatCompletionWithProgress - lets a caller (the
   * targets chat route) drive a live "still working" status instead of a
   * fixed timer, since this call routinely takes 30s+ (see the timeoutMs
   * comment below). */
  onProgress?: () => void;
}): Promise<TargetGenerationPayload> {
  if (config.provider === "github") {
    throw new Error(
      "GitHub Models endpoint is retired. Switch AI_EXTRACTION_PROVIDER to openai or custom (Azure OpenAI Foundry).",
    );
  }

  const languageName = locale === "he" ? "Hebrew" : "English";

  const customTargetLoggingContextLines =
    currentTargets && recentCustomTargetLogs && Object.keys(recentCustomTargetLogs).length > 0
      ? [
          "recently_logged_custom_target_values (JSON, by user_targets id - the raw numbers the user has actually been typing into Daily Report for each existing custom target, most recent last):",
          JSON.stringify(recentCustomTargetLogs),
          "UNIT RECONCILIATION: for each id above, compare these logged numbers against that same entry's stored unit/target_min/target_max in current_active_targets.user_targets. If they're a plausible match for the stored unit (e.g. values around 6-9 for \"hours\" of sleep), leave that entry's unit/target_min/target_max unchanged. If they clearly look like a DIFFERENT unit than what's stored (e.g. stored unit is \"minutes\" with a target around 30-60, but the user has actually been logging numbers in the thousands - almost certainly a step count, not minutes), rewrite that entry's unit, target_min, and target_max to the unit the user is actually tracking, converting the numeric target accordingly (rough anchor for walking specifically: about 100 steps per minute of brisk walking, so a 40-minute goal is roughly 4,000 steps) - keep the underlying goal itself the same (e.g. still \"walk more\"), just expressed in the unit that matches reality. Trust the user's own logged numbers over a previously stored unit when they disagree.",
        ]
      : [];

  const adjustmentContextLines = currentTargets
    ? [
        "This is an ADJUSTMENT request against an already-locked target plan, not a fresh generation.",
        "current_active_targets (JSON):",
        JSON.stringify(currentTargets),
        "NO-ACTIONABLE-CHANGE CHECK (adjustment requests only): if goal_text (the conversation transcript) does not describe any concrete, in-scope health/nutrition/exercise/sleep/hydration/weight change to make - e.g. it's off-topic (a career, financial, or relationship goal), pure small talk, a question you already answered conversationally, or too vague to translate into a number - set no_actionable_change to true, put a short plain-language reason in no_actionable_change_reason (in the reply language), and you may leave every other field as a best-effort copy of current_active_targets since it will be discarded. Do not set this just because the request happens to be unsafe (that has its own handling below) - only when there is genuinely nothing concrete and in-scope to apply.",
        "Change what the goal_text below asks for, plus anything the current profile now requires for safety (see the mandatory safety review rule above) - keep every other range, exercise entry, and habit as close to the current values as reasonable.",
        "If the requested change would create an unsafe or unbalanced combination (e.g. reducing exercise while keeping calories at the same level), proactively adjust the DEPENDENT values (e.g. lower the calorie range) to keep the plan coherent, and explain that adjustment in global_coaching_explanation. This does not apply to target_weight_kg itself - that must stay a literal translation of goal_text per the rule above, not something you adjust for safety.",
        "Do not treat a vague goal_text (e.g. \"please recalculate\" or \"my profile changed\") as a reason to leave everything unchanged - in that case, the safety review against the current profile IS the request. Concretely: if user_profile's bmi is currently outside the healthy range, no_actionable_change must NOT be set to true, even for a bare profile-changed note with no explicit weight ask - apply the MANDATORY BMI SAFETY REVIEW rule instead.",
        "The same override applies to medical_conditions, allergies, regular_medications_details, AND dietary_preference: if goal_text says the user's profile changed and user_profile's medical_conditions, allergies, regular_medications_details, or dietary_preference now includes or states something not already reflected in current_active_targets (a newly added condition, allergy, medication, or a changed dietary preference - not just a rewording of the same one), no_actionable_change must NOT be set to true, even with no explicit numeric ask - apply the MANDATORY SAFETY REVIEW rule instead and tighten/adjust whatever ranges or habits it calls for (a dietary_preference change alone still requires reviewing habits_do/habits_dont and any affected ranges for compatibility, e.g. protein sourcing for a new vegetarian/vegan preference). A placeholder \"before\" value such as \"prefers not to share\", \"undisclosed\", or \"none stated\" is NOT the same as an actual condition/preference - a change FROM one of these TO a real, specific value (e.g. \"prefers not to share\" -> \"kidney insufficiency\") is exactly the kind of newly-added information this override exists for, not a case to wave through as unchanged. Only fall back to no_actionable_change when you have genuinely checked this and there is nothing in the new profile that the safety review, the BMI review, or a dietary-preference compatibility check would change.",
        "current_active_targets.user_targets holds the user's previously tracked asks. Carry forward any still-relevant ones, add a new entry for whatever this request newly asks for, and update the value/target_min/target_max of an existing entry instead of duplicating it if this request changes the same thing (e.g. a new weight-loss amount replaces the old \"Lose weight\" value rather than adding a second one) - when updating an existing entry, KEEP ITS id UNCHANGED (copy it from current_active_targets) so any Daily Report values already logged against it stay linked; only invent a new id for a genuinely new entry.",
      ]
    : [];

  const todayIso = new Date().toISOString().slice(0, 10);
  const medicalDocumentsContextLines = medicalDocumentsContext
    ? [
        `today's date: ${todayIso}`,
        "medical_documents_context (extracted findings from documents the user uploaded, e.g. blood tests):",
        medicalDocumentsContext,
        "MEDICAL DOCUMENT RULES: judge for yourself, per finding, whether it's still valid/relevant enough to factor into today's targets. Weigh the observed/report date (or, when no report date was found, the upload date as a rough proxy) against today's date and against how quickly that specific kind of marker typically changes. Judge the AGE PLAINLY against today's date - a gap of several years is old regardless of how the number itself reads, and must not be described as \"recent\" or \"current\". As a concrete anchor: blood glucose, lipids (cholesterol/LDL/HDL/triglycerides), and HbA1c are typically only meaningful for roughly 6-12 months and should usually be treated as stale beyond about 2 years; something like blood type or a genetic result never goes stale. If multiple documents cover the same topic, prioritize the most recent, most relevant one rather than mechanically averaging them. Only let a finding influence the numeric ranges or habits when it is both genuinely relevant to nutrition/exercise/sleep/hydration and judged valid. In global_coaching_explanation, state the finding's actual date (or age) plainly, briefly mention which specific medical finding(s) you factored in AND why (or, if you judged a finding or document too stale or not relevant to use, say so explicitly instead) - do not silently ignore something without mentioning it, and do not mischaracterize an old date as recent.",
      ]
    : [];

  const messages = [
      {
        role: "system" as const,
        content:
          "You are a cautious nutrition and exercise coaching assistant. You translate a user's free-text health goal plus their profile into a full, safety-bounded set of daily nutrient ranges, an exercise plan, and do/don't habits. Return strict JSON only. No markdown.",
      },
      {
        role: "user" as const,
        content: [
          "Return strict JSON with exactly this shape (all numeric fields are plain numbers, all ranges must have min <= max):",
          '{"no_actionable_change":boolean,"no_actionable_change_reason":"string",',
          '"goal_type":"weight_loss|weight_gain|maintain|general","target_weight_kg":number,"duration_days":number,"blood_balance_focus":boolean,"sleep_focus":boolean,',
          '"calories_min":number,"calories_max":number,"protein_min_g":number,"protein_max_g":number,"carbs_min_g":number,"carbs_max_g":number,"fats_min_g":number,"fats_max_g":number,',
          '"fiber_min_g":number,"fiber_max_g":number,"sodium_min_mg":number,"sodium_max_mg":number,"added_sugar_min_g":number,"added_sugar_max_g":number,"water_min_ml":number,"water_max_ml":number,',
          '"potassium_min_mg":number,"potassium_max_mg":number,"magnesium_min_mg":number,"magnesium_max_mg":number,"calcium_min_mg":number,"calcium_max_mg":number,"iron_min_mg":number,"iron_max_mg":number,',
          '"zinc_min_mg":number,"zinc_max_mg":number,"vit_c_min_mg":number,"vit_c_max_mg":number,"vit_b12_min_mcg":number,"vit_b12_max_mcg":number,"vit_d_min_mcg":number,"vit_d_max_mcg":number,',
          '"sat_fat_min_g":number,"sat_fat_max_g":number,"omega3_min_g":number,"omega3_max_g":number,"cholesterol_min_mg":number,"cholesterol_max_mg":number,',
          `"exercise_targets":[{"modality":"${AI_EXERCISE_MODALITY_TOKENS.join("|")}","frequency_per_week":number,"duration_minutes_per_session":number,"ai_adjustment_note":"string","search_keywords":["string"]}],`,
          '"habits_do":[{"id":"string","habit_instruction":"string","rationale":"string"}],',
          '"habits_dont":[{"id":"string","habit_instruction":"string","rationale":"string"}],',
          '"user_targets":[{"id":"string","label":"string","value":"string","unit":"string","target_min":number,"target_max":number,"higher_is_better":boolean}],',
          '"global_coaching_explanation":"string","confidence":number,"profile_discrepancy_message":"string"}',
          "Rules:",
          "- target_weight_kg and duration_days must be a FAITHFUL, literal translation of what goal_text actually asks for (e.g. \"lose 5kg\" against a known current weight, or an explicit target weight) - never silently substitute a different, \"safer\" number of your own choosing, even if the literal ask looks medically unwise. The application runs its own independent, deterministic safety check on target_weight_kg after you respond and will reject the whole request if it's unsafe; your job here is accurate translation, not moderation. If goal_text does not state or imply a weight/duration change, leave the current value(s) unchanged.",
          "- Base all ranges on standard adult Dietary Reference Intake (DRI) style ranges, scaled to the user's profile. This is general guidance, not a clinical diagnosis.",
          "- Respect any allergies, medical conditions, medications, and dietary preference when shaping habits and exercise notes (e.g. avoid recommending foods that conflict with a stated allergy).",
          "- MANDATORY SAFETY REVIEW: check the numeric ranges themselves (not just habit text) against the user's medical conditions. In particular: hypertension calls for a tighter, lower sodium range (roughly 1,200-1,500 mg rather than a generic 1,500-2,300 mg); diabetes calls for a lower added-sugar ceiling (roughly 15 g rather than a generic 25 g). Apply comparable, clinically-reasonable tightening for any other stated condition that has an established dietary implication. This review applies even when it is not the explicit subject of goal_text.",
          "- MANDATORY BMI SAFETY REVIEW: user_profile's bmi line reflects the user's CURRENT weight, not a request or a hypothetical - if it is outside the healthy 18.5-24.9 range, that by itself is a concrete, in-scope safety issue you must act on, even when goal_text says nothing about weight (a bare \"profile changed\" or \"recalculate\" note included - see the no-actionable-change rule above, this is exactly the kind of thing that rule means by \"the safety review IS the request\"). Underweight (bmi below 18.5): raise calories_min/calories_max and protein_min_g/protein_max_g above the generic DRI baseline to support safe, gradual weight gain. Overweight/obese (bmi above 24.9): lower calories_min/calories_max moderately, keeping protein comparatively high, to support safe, gradual weight loss. State the current bmi value and this adjustment explicitly in global_coaching_explanation. This is independent of target_weight_kg, which must still remain a literal translation of goal_text per the rule above - do not set or change target_weight_kg based on this review alone.",
          `- exercise_targets: 2 to 4 entries. modality must be exactly one of these tokens: ${AI_EXERCISE_MODALITY_TOKENS.join(", ")} - never a free-text activity name like "walking" or "yoga" (the app only knows how to display these exact tokens; anything else renders as raw untranslated text). Put the specific activity itself (e.g. "brisk walking", "beginner yoga") in ai_adjustment_note and search_keywords instead - that's where the detail belongs, not in modality. search_keywords must be short YouTube search phrases only (e.g. \"beginner resistance training routine\") — NEVER include a URL or a specific video title/link, since direct AI-suggested links are unreliable.`,
          "- When user_profile includes exercise_other_activities (one or more specific activity names the user typed, e.g. \"Dance\", \"Pilates\", each with its own weekly frequency/duration), each one is a real, named part of the user's routine, not a generic placeholder - give each its own exercise_targets entry with modality \"other\" (per the fixed token list above; multiple entries may share modality \"other\", one per named activity), anchored on that activity's own days_per_week/minutes_per_session unless goal_text asks to change it, and name the activity explicitly and by name (e.g. \"Dance\", not just \"other workouts\") in that entry's ai_adjustment_note and search_keywords. Refer to each by its specific name rather than the generic word \"other\" in global_coaching_explanation whenever you mention it - talk about it exactly like you would talk about any other activity (e.g. \"your Dance sessions\"). Never explain, mention, or allude to the fact that the app internally files it under an \"other\" category/modality/token, that this required a definition or naming step, or any other detail about how the app's taxonomy works internally; the user only ever typed an activity name and should only ever read that plain activity name back. If exercise_other_activities lists more named activities than the 2-4 exercise_targets slots allow alongside the user's other modalities, prioritize by weekly frequency and keep the rest implicit rather than dropping them from global_coaching_explanation silently.",
          "- habits_do and habits_dont: 2 to 4 entries each, each with a short actionable instruction and a one-sentence rationale.",
          "- user_targets: 3 to 6 entries. Three are STANDING and always required, regardless of whether goal_text asks for them - id \"target_weight\" (unit \"kg\", label a plain \"Target weight\"/localized equivalent), id \"sleep_hours\" (unit \"hours\"), and id \"daily_steps\" (unit \"steps\"). If current_active_targets.user_targets already has an entry with one of these exact ids, carry it forward (update it only if this request specifically changes it, keeping the same id); otherwise generate a sensible starting value from user_profile and goal_type - target_weight: current body weight adjusted by roughly 5% in the goal's direction for weight_loss/weight_gain, or unchanged for maintain/general; sleep_hours: 7-9 (typically 8) unless a stated medical condition or habit calls for adjusting it; daily_steps: 7,000-10,000 based on activity_level (lower for sedentary, higher for active). Beyond these three, add up to 3 more entries only for other concrete, health-relevant OUTCOMEs the user actually asked for in goal_text that this schema has no OTHER dedicated field for (e.g. a specific step-free exercise-minutes goal, or a genuinely custom tracked habit) - do not invent additional entries beyond the three standing ones. user_targets is NEVER for an exercise activity or modality itself (e.g. \"Walking\", \"Running\", \"Yoga\") - any activity you add or recommend, including one chosen specifically to help reach a user_targets goal like weight loss, belongs in exercise_targets instead, never as its own user_targets entry.",
          "- user_targets MUST NEVER duplicate a macro/micronutrient this same schema already has its own dedicated min/max fields for - calories, protein, carbs, fats, fiber, sodium, added sugar, water/fluid, potassium, magnesium, iron, zinc, calcium, vitamin C, vitamin B12, vitamin D, saturated fat, omega-3, and cholesterol. A request about any of these (\"change my saturated fat target\", \"I want to track my water intake more closely\", etc.) affects ONLY that field's own calories_min/calories_max-style pair above - never add, update, or carry forward a user_targets entry with a matching name for it, even when the request is phrased as a request to \"track\" or \"set a goal\" for it, and even when the change came from a value outside the currently recommended range. This was confirmed live: adjusting Saturated Fat outside its normal range correctly updated sat_fat_min_g/sat_fat_max_g but ALSO spawned a redundant \"Saturated Fat\" user_targets entry duplicating the same thing under a different mechanism - that second entry must never be created.",
          "- user_targets id/unit/target_min/target_max/higher_is_better (required on every entry, not just label/value): these make the target loggable - the app shows the user a numeric input for it in their Daily Report and tracks real progress against it, so every entry needs all five, not just the ones that feel like an obvious number. id is a short, stable, lowercase snake_case machine key you invent from the label (e.g. \"sleep_hours\", \"daily_steps\") - use ASCII only even when label/value are in Hebrew. target_min/target_max are the numeric range this entry represents (set them equal for an exact single-value goal, e.g. both 8 for \"8 hours of sleep\"); value stays the short human-readable string as before (e.g. \"8 hours\") - it is display text, target_min/target_max are what tracking actually runs on and must be consistent with it.",
          "- user_targets UNIT CHOICE: pick the unit a person would naturally type as a single running number into their daily log for THIS SPECIFIC goal - the app has no way to convert between units later, so getting this wrong makes every future comparison meaningless (e.g. logging a step count of 3,000 against a target stored as \"40 minutes\" shows as 7,500% complete, not 100%). A step-count ask (\"walk 3000 steps\", \"10k steps a day\", or just a bare number like \"3000\" with no unit stated in a walking context) must use unit \"steps\" with target_min/target_max as a step count - never default to a time duration just because a nearby exercise_targets entry happens to be minutes-based. Only use a duration unit (\"minutes\") when goal_text is explicitly about TIME spent (e.g. \"walk for 30 minutes a day\"), not a count. Other common units: \"hours\" (sleep), \"ml\" (hydration), \"kg\" (weight).",
          "- user_targets higher_is_better (boolean): true when logging MORE than target_max is still a good outcome for this specific goal (e.g. steps, sleep duration, hydration, a workout-minutes goal - exceeding the number is an achievement worth celebrating, not a problem); false when target_max is a genuine ceiling this goal wants to stay under (e.g. an explicit ask to reduce or cap something). Judge this from the nature of the SPECIFIC goal, not a fixed per-label rule - default to true when genuinely unsure, since most user_targets are asks to reach or exceed a number rather than stay under one.",
          "- confidence must be between 0 and 1.",
          "- PROFILE CONSISTENCY CHECK: compare goal_text against user_profile. If goal_text clearly states something that factually contradicts a specific profile field (e.g. the user states an age that doesn't match user_profile's age, says they are no longer pregnant while user_profile marks them as pregnant, mentions a medical condition or medication that isn't reflected in user_profile, or similar), set profile_discrepancy_message to one short plain-language sentence describing the specific mismatch (in the reply language) so the app can alert the user to review their profile or their input - name both the profile's value and what goal_text stated. Leave profile_discrepancy_message empty when there is no clear, specific factual contradiction (do not flag vague, ambiguous, or merely-updated-over-time statements). This check never blocks generation and is independent of the no_actionable_change and safety checks - still generate the best targets you can even when a discrepancy is flagged.",
          "- NUMERIC CONSISTENCY: whenever global_coaching_explanation mentions a specific number for a field you are changing, that number MUST match what you actually put in this same response's structured fields for that field - never restate the user's originally-requested number if the applied value (after a safety cap, rounding, or any other adjustment) came out different. If the applied number differs from what the user asked for, say so explicitly (e.g. state the applied number and briefly note why it differs), rather than silently describing the request instead of the outcome.",
          `- Write every text field (ai_adjustment_note, habit_instruction, rationale, global_coaching_explanation, user_targets label/value/unit) entirely in ${languageName}, EXCEPT user_targets id which must stay ASCII snake_case regardless of reply language. Do not mix languages within a field.`,
          "- Address the user directly in second person (\"you\"/\"your\") in every text field. Never refer to the user in third person (\"he\", \"she\", \"his\", \"her\", or the user's inferred gender) even when their biological_sex is known.",
          "- In Hebrew specifically, prefer gender-neutral or mixed-form second-person phrasing (e.g. \"שלך\", \"את/ה\") over a gendered third-person construction like \"בשל מצבו הרפואי\" or \"בשל מצבה הרפואי\" — write \"בשל המצב הרפואי שלך\" instead.",
          ...adjustmentContextLines,
          ...customTargetLoggingContextLines,
          ...medicalDocumentsContextLines,
          "user_profile:",
          buildProfileSummary(profile),
          "goal_text:",
          // Tail, not head: for the update_targets flow goalText is a joined
          // conversation where the actual ask is the newest (last) message -
          // route.ts's buildConversationText already keeps this under budget
          // newest-first, but slicing from the end here too (rather than the
          // start) is a cheap defense against ever silently dropping the
          // part that matters for any other caller of this function.
          goalText.length > 4500 ? goalText.slice(-4500) : goalText,
        ].join("\n"),
      },
    ];

  const contentText = await callAiChatCompletionWithProgress({
    config,
    messages,
    temperature: 0.2,
    jsonMode: true,
    onProgress,
    // This full-schema structured JSON generation (calories, every
    // macro/micro range, exercise targets, habits, user targets) routinely
    // runs close to or past provider-client's default 45s timeout even with
    // extended thinking disabled - it was observed failing 3/3 times in a
    // row at ~48s against a real profile-change adjustment. The client side
    // (targets-chat-workspace.tsx) already tolerates an open-ended wait via
    // an 8s heartbeat that resets its own 20s inactivity timer specifically
    // for this call, so there's no UI cost to giving the upstream request
    // itself more room before this route's own abort kicks in.
    timeoutMs: 90_000,
  });

  const parsed = aiTargetsSchema.parse(parseJsonPayload(contentText));

  if (currentTargets && parsed.no_actionable_change) {
    throw new NoActionableChangeError(
      parsed.no_actionable_change_reason || "The message didn't describe a specific health-related change to apply.",
    );
  }

  return mapAiTargetsResponse(parsed);
}
