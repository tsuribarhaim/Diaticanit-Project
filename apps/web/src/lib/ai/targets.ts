import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import type { AppLocale } from "@/lib/locale";
import type { ExerciseTargetEntry, HabitEntry, ProfileForTargets, TargetGenerationPayload, TargetGoalType, UserTargetEntry } from "@/lib/targets";

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

  exercise_targets: z.array(aiExerciseTargetSchema).max(6).optional().default([]),
  habits_do: z.array(aiHabitEntrySchema).max(6).optional().default([]),
  habits_dont: z.array(aiHabitEntrySchema).max(6).optional().default([]),
  user_targets: z.array(aiUserTargetEntrySchema).max(8).optional().default([]),

  global_coaching_explanation: z.string().trim().max(1000).optional().default(""),
  confidence: numberFromUnknown.optional(),
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
    modality: item.modality,
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

    exerciseTargets: toExerciseTargets(raw.exercise_targets),
    habitsDo: toHabitEntries(raw.habits_do),
    habitsDont: toHabitEntries(raw.habits_dont),
    userTargets: toUserTargets(raw.user_targets),

    aiRationaleExplanation: raw.global_coaching_explanation,
    confidence: clamp(raw.confidence ?? 0.75, 0.3, 0.97),
    assumptions: [],
  };
}

function buildProfileSummary(profile: ProfileForTargets): string {
  return [
    `age: ${profile.age}`,
    `biological_sex: ${profile.biological_sex ?? profile.gender ?? "unknown"}`,
    `height_cm: ${profile.height_cm}`,
    `weight_kg: ${profile.weight_kg}`,
    `activity_level: ${profile.activity_level}`,
    `allergies: ${profile.allergies.join(", ") || "none"}`,
    `medical_conditions: ${profile.medical_conditions.join(", ") || "none"}`,
    `medical_conditions_details: ${profile.medical_conditions_details || "none"}`,
    `regular_medications_details: ${profile.regular_medications_details || "none"}`,
    `dietary_preference: ${profile.dietary_preference ?? "standard"}`,
    `exercise_modalities: ${profile.exercise_modalities.join(", ") || "none"}`,
    `habits: ${profile.habits.join(", ") || "none"}`,
    `pregnancy_lactation_status: ${profile.pregnancy_lactation_status ?? "none"}`,
  ].join("\n");
}

function summarizeAiError(errorBody: string, status: number): string {
  return `AI targets generation request failed (${status}): ${errorBody.slice(0, 240)}`;
}

export async function generateTargetsWithAi({
  config,
  goalText,
  profile,
  locale,
  currentTargets,
  medicalDocumentsContext,
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
}): Promise<TargetGenerationPayload> {
  if (config.provider === "github") {
    throw new Error(
      "GitHub Models endpoint is retired. Switch AI_EXTRACTION_PROVIDER to openai or custom (Azure OpenAI Foundry).",
    );
  }

  const languageName = locale === "he" ? "Hebrew" : "English";

  const adjustmentContextLines = currentTargets
    ? [
        "This is an ADJUSTMENT request against an already-locked target plan, not a fresh generation.",
        "current_active_targets (JSON):",
        JSON.stringify(currentTargets),
        "NO-ACTIONABLE-CHANGE CHECK (adjustment requests only): if goal_text (the conversation transcript) does not describe any concrete, in-scope health/nutrition/exercise/sleep/hydration/weight change to make - e.g. it's off-topic (a career, financial, or relationship goal), pure small talk, a question you already answered conversationally, or too vague to translate into a number - set no_actionable_change to true, put a short plain-language reason in no_actionable_change_reason (in the reply language), and you may leave every other field as a best-effort copy of current_active_targets since it will be discarded. Do not set this just because the request happens to be unsafe (that has its own handling below) - only when there is genuinely nothing concrete and in-scope to apply.",
        "Change what the goal_text below asks for, plus anything the current profile now requires for safety (see the mandatory safety review rule above) - keep every other range, exercise entry, and habit as close to the current values as reasonable.",
        "If the requested change would create an unsafe or unbalanced combination (e.g. reducing exercise while keeping calories at the same level), proactively adjust the DEPENDENT values (e.g. lower the calorie range) to keep the plan coherent, and explain that adjustment in global_coaching_explanation. This does not apply to target_weight_kg itself - that must stay a literal translation of goal_text per the rule above, not something you adjust for safety.",
        "Do not treat a vague goal_text (e.g. \"please recalculate\" or \"my profile changed\") as a reason to leave everything unchanged - in that case, the safety review against the current profile IS the request.",
        "current_active_targets.user_targets holds the user's previously tracked asks. Carry forward any still-relevant ones, add a new entry for whatever this request newly asks for, and update the value of an existing entry instead of duplicating it if this request changes the same thing (e.g. a new weight-loss amount replaces the old \"Lose weight\" value rather than adding a second one).",
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

  const requestBody = {
    model: config.model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a cautious nutrition and exercise coaching assistant. You translate a user's free-text health goal plus their profile into a full, safety-bounded set of daily nutrient ranges, an exercise plan, and do/don't habits. Return strict JSON only. No markdown.",
      },
      {
        role: "user",
        content: [
          "Return strict JSON with exactly this shape (all numeric fields are plain numbers, all ranges must have min <= max):",
          '{"no_actionable_change":boolean,"no_actionable_change_reason":"string",',
          '"goal_type":"weight_loss|weight_gain|maintain|general","target_weight_kg":number,"duration_days":number,"blood_balance_focus":boolean,"sleep_focus":boolean,',
          '"calories_min":number,"calories_max":number,"protein_min_g":number,"protein_max_g":number,"carbs_min_g":number,"carbs_max_g":number,"fats_min_g":number,"fats_max_g":number,',
          '"fiber_min_g":number,"fiber_max_g":number,"sodium_min_mg":number,"sodium_max_mg":number,"added_sugar_min_g":number,"added_sugar_max_g":number,"water_min_ml":number,"water_max_ml":number,',
          '"potassium_min_mg":number,"potassium_max_mg":number,"magnesium_min_mg":number,"magnesium_max_mg":number,"calcium_min_mg":number,"calcium_max_mg":number,"iron_min_mg":number,"iron_max_mg":number,',
          '"zinc_min_mg":number,"zinc_max_mg":number,"vit_c_min_mg":number,"vit_c_max_mg":number,"vit_b12_min_mcg":number,"vit_b12_max_mcg":number,"vit_d_min_mcg":number,"vit_d_max_mcg":number,',
          '"sat_fat_min_g":number,"sat_fat_max_g":number,"omega3_min_g":number,"omega3_max_g":number,',
          '"exercise_targets":[{"modality":"string","frequency_per_week":number,"duration_minutes_per_session":number,"ai_adjustment_note":"string","search_keywords":["string"]}],',
          '"habits_do":[{"id":"string","habit_instruction":"string","rationale":"string"}],',
          '"habits_dont":[{"id":"string","habit_instruction":"string","rationale":"string"}],',
          '"user_targets":[{"label":"string","value":"string"}],',
          '"global_coaching_explanation":"string","confidence":number}',
          "Rules:",
          "- target_weight_kg and duration_days must be a FAITHFUL, literal translation of what goal_text actually asks for (e.g. \"lose 5kg\" against a known current weight, or an explicit target weight) - never silently substitute a different, \"safer\" number of your own choosing, even if the literal ask looks medically unwise. The application runs its own independent, deterministic safety check on target_weight_kg after you respond and will reject the whole request if it's unsafe; your job here is accurate translation, not moderation. If goal_text does not state or imply a weight/duration change, leave the current value(s) unchanged.",
          "- Base all ranges on standard adult Dietary Reference Intake (DRI) style ranges, scaled to the user's profile. This is general guidance, not a clinical diagnosis.",
          "- Respect any allergies, medical conditions, medications, and dietary preference when shaping habits and exercise notes (e.g. avoid recommending foods that conflict with a stated allergy).",
          "- MANDATORY SAFETY REVIEW: check the numeric ranges themselves (not just habit text) against the user's medical conditions. In particular: hypertension calls for a tighter, lower sodium range (roughly 1,200-1,500 mg rather than a generic 1,500-2,300 mg); diabetes calls for a lower added-sugar ceiling (roughly 15 g rather than a generic 25 g). Apply comparable, clinically-reasonable tightening for any other stated condition that has an established dietary implication. This review applies even when it is not the explicit subject of goal_text.",
          "- exercise_targets: 2 to 4 entries. search_keywords must be short YouTube search phrases only (e.g. \"beginner resistance training routine\") — NEVER include a URL or a specific video title/link, since direct AI-suggested links are unreliable.",
          "- habits_do and habits_dont: 2 to 4 entries each, each with a short actionable instruction and a one-sentence rationale.",
          "- user_targets: 0 to 5 entries. For each concrete, health-relevant ask the user actually made in goal_text (e.g. losing/gaining a specific amount of weight, a sleep-duration goal, a hydration goal, a step-count goal), add one entry with a short clean label (e.g. \"Target weight\", \"Lose weight\", \"Sleep duration\") and a short concrete value (e.g. \"62 kg\", \"2 kg\", \"8 hours\"). Only include asks that are genuinely about health, nutrition, exercise, sleep, or a related wellbeing topic and that you judged safe to apply; silently omit anything irrelevant, unsafe, or too vague to state as a concrete value. Do not invent entries the user didn't ask for - leave user_targets empty if goal_text has no concrete ask.",
          "- confidence must be between 0 and 1.",
          `- Write every text field (ai_adjustment_note, habit_instruction, rationale, global_coaching_explanation, user_targets label/value) entirely in ${languageName}. Do not mix languages within a field.`,
          "- Address the user directly in second person (\"you\"/\"your\") in every text field. Never refer to the user in third person (\"he\", \"she\", \"his\", \"her\", or the user's inferred gender) even when their biological_sex is known.",
          "- In Hebrew specifically, prefer gender-neutral or mixed-form second-person phrasing (e.g. \"שלך\", \"את/ה\") over a gendered third-person construction like \"בשל מצבו הרפואי\" or \"בשל מצבה הרפואי\" — write \"בשל המצב הרפואי שלך\" instead.",
          ...adjustmentContextLines,
          ...medicalDocumentsContextLines,
          "user_profile:",
          buildProfileSummary(profile),
          "goal_text:",
          goalText.slice(0, 1200),
        ].join("\n"),
      },
    ],
  };

  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, "");
  const candidateUrls = normalizedBaseUrl.endsWith("/v1")
    ? [`${normalizedBaseUrl}/chat/completions`]
    : [`${normalizedBaseUrl}/chat/completions`, `${normalizedBaseUrl}/v1/chat/completions`];

  let response: Response | null = null;
  let lastStatus = 0;
  let lastBody = "";

  for (const candidateUrl of candidateUrls) {
    response = await fetch(candidateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      break;
    }

    const body = await response.text();
    lastStatus = response.status;
    lastBody = body;

    if (response.status !== 404) {
      throw new Error(summarizeAiError(body, response.status));
    }
  }

  if (!response?.ok) {
    throw new Error(summarizeAiError(lastBody, lastStatus || 404));
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };

  const messageContent = payload.choices?.[0]?.message?.content;
  const contentText = Array.isArray(messageContent)
    ? messageContent.map((item) => (typeof item?.text === "string" ? item.text : "")).join("\n")
    : typeof messageContent === "string"
      ? messageContent
      : "";

  const parsed = aiTargetsSchema.parse(parseJsonPayload(contentText));

  if (currentTargets && parsed.no_actionable_change) {
    throw new NoActionableChangeError(
      parsed.no_actionable_change_reason || "The message didn't describe a specific health-related change to apply.",
    );
  }

  return mapAiTargetsResponse(parsed);
}
