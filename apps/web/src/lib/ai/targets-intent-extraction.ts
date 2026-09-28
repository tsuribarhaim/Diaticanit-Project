import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";
import type { IntentDiff, IntentDiffIntent, NutrientRangeField } from "@/lib/ai/targets-rules-engine";
import type { ProfileForTargets, TargetGenerationPayload } from "@/lib/targets";

/**
 * Stage (a) of the 3-stage targets-adjustment pipeline (see
 * docs/design/targets-generation-latency-and-hebrew-redesign.md, §B). A
 * small, fast AI call that only classifies WHAT the user is asking for -
 * it never invents a numeric range itself; that's the deterministic rules
 * engine's job (targets-rules-engine.ts) for anything this stage
 * recognizes, with the existing full-schema generateTargetsWithAi as the
 * fallback for anything it doesn't.
 */

const NUTRIENT_FIELD_TOKENS = [
  "calories", "protein_g", "carbs_g", "fats_g", "fiber_g", "sodium_mg", "added_sugar_g", "water_ml",
  "potassium_mg", "magnesium_mg", "calcium_mg", "iron_mg", "zinc_mg", "vit_c_mg", "vit_b12_mcg", "vit_d_mcg",
  "sat_fat_g", "omega3_g", "cholesterol_mg",
] as const satisfies readonly NutrientRangeField[];

const intentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("nutrient_set_value"),
    field: z.enum(NUTRIENT_FIELD_TOKENS),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({
    type: z.literal("weight_goal"),
    direction: z.enum(["lose", "gain", "maintain"]),
    delta_kg: z.number().optional(),
    target_weight_kg: z.number().optional(),
    duration_days: z.number().optional(),
  }),
]);

const extractionOutputSchema = z.object({
  no_actionable_change: z.boolean(),
  no_actionable_change_reason: z.string().default(""),
  intents: z.array(intentSchema).default([]),
  profile_discrepancy: z.string().default(""),
  confidence: z.number().min(0).max(1),
});

const TOOL_NAME = "extract_targets_intent";

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    no_actionable_change: { type: "boolean" },
    no_actionable_change_reason: { type: "string" },
    intents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["nutrient_set_value", "weight_goal"] },
          field: { type: "string", enum: NUTRIENT_FIELD_TOKENS },
          min: { type: "number" },
          max: { type: "number" },
          direction: { type: "string", enum: ["lose", "gain", "maintain"] },
          delta_kg: { type: "number" },
          target_weight_kg: { type: "number" },
          duration_days: { type: "number" },
        },
        required: ["type"],
      },
    },
    profile_discrepancy: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["no_actionable_change", "intents", "confidence"],
} as const;

/**
 * Only worth calling for an ADJUSTMENT request against an already-locked
 * plan (the fast path never attempts a fresh from-scratch generation -
 * that's a much bigger, less structured task, left entirely to the full
 * AI path or the heuristic generator).
 */
export async function extractTargetsIntent({
  config,
  goalText,
  profile,
  currentTargets,
}: {
  config: AiExtractionConfig;
  goalText: string;
  profile: ProfileForTargets;
  currentTargets: TargetGenerationPayload;
}): Promise<IntentDiff> {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a fast intent-extraction step in a nutrition coaching pipeline. Given a user's free-text health goal and their profile, extract ONLY what they are literally, concretely asking for. Do NOT compute or infer a numeric range for anything that isn't an explicit, literal number in goal_text - a deterministic rules engine downstream handles concrete asks, and anything vague or qualitative (e.g. \"a bit less\", \"lower\", \"more\") must be left out of intents entirely so the caller can fall back to a full AI pass. Never invent a nutrition or medical rule that isn't given to you explicitly below. Call the extract_targets_intent tool exactly once with your answer.",
    },
    {
      role: "user" as const,
      content: [
        "Rules:",
        "- Only emit a nutrient_set_value intent when goal_text states a literal number for that field (a target value, or an explicit min/max) - e.g. \"set my sodium max to 1800mg\" or \"I want at least 30g of fiber\". Never emit one for a vague direction with no number (\"lower my sodium a bit\", \"more protein\"). min and max are each optional - only include the side(s) goal_text actually states a number for (e.g. \"set my sodium max to 1800mg\" only states max; leave min out entirely rather than guessing one).",
        "- Only emit a weight_goal intent when goal_text states a literal weight change with at least a rough amount or explicit target (e.g. \"lose 5kg\", \"get down to 70kg\", \"gain some muscle mass over 3 months\" - amount can be approximate but must be stated). A bare \"I want to lose weight\" with no amount at all does not qualify - leave it out.",
        "- Set no_actionable_change true ONLY when goal_text describes nothing concrete and in-scope for a health/nutrition/exercise/sleep/hydration/weight plan AT ALL (off-topic like a career/financial goal, pure small talk, or a question already answered in conversation). This is a narrow flag for \"there is nothing here to act on, not even vaguely\" - it is NOT for a real health-related ask that merely lacks a literal number, and it is NOT for a bare \"profile changed\"/\"recalculate\" note (that always has an implicit safety review to run, even with no explicit number - it is real, in-scope work, just not work this fast classifier can itself resolve). When goal_text is genuinely healthcare-relevant but vague/qualitative/lacks a literal number, leave no_actionable_change false, leave intents empty or partial, and instead express that uncertainty through a LOW confidence score (see below) - that is the correct way to signal \"this needs full review\", not no_actionable_change.",
        "- profile_discrepancy: one short English sentence naming both values, only when goal_text clearly states something that factually contradicts a specific user_profile field (age, pregnancy status, a medical condition/medication, dietary preference). Empty string otherwise.",
        "- confidence (0-1): your confidence that the intents list above is a COMPLETE and CORRECT reading of goal_text, AND that nothing else about this request needs full human/AI judgment beyond what intents already captures. Score LOW (well under 0.85) whenever goal_text: contains any vague or qualitative health-related ask with no literal number (\"a bit less\", \"lower\", \"more\", \"kind of high\"); is a bare profile-changed/recalculate note; mentions a new medical condition, allergy, medication, or dietary-preference change not already reflected in the profile; or bundles multiple simultaneous asks. Score HIGH only when goal_text is a clean, literal, single, unambiguous ask that intents fully captures. When in doubt, score lower - a low score safely routes to a full, careful AI review instead of a fast path that might miss something.",
        "- All text fields in English, regardless of goal_text's language.",
        "",
        "user_profile:",
        `age: ${profile.age}, biological_sex: ${profile.biological_sex ?? profile.gender ?? "unknown"}, height_cm: ${profile.height_cm}, weight_kg: ${profile.weight_kg}`,
        `medical_conditions: ${profile.medical_conditions.join(", ") || "none"}`,
        `dietary_preference: ${profile.dietary_preference ?? "standard"}`,
        "",
        "current_active_targets_summary (only what's needed to judge this request):",
        `target_weight_kg: ${currentTargets.targetWeightKg ?? "unset"}, goal_type: ${currentTargets.goalType}`,
        "",
        "goal_text (the user's actual message - may be in any language; your own output fields must still be English):",
        goalText.length > 2000 ? goalText.slice(-2000) : goalText,
      ].join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    tool: { name: TOOL_NAME, description: "Extract a structured intent diff from a targets-adjustment request.", inputSchema: TOOL_INPUT_SCHEMA },
    timeoutMs: 20_000,
  });

  const raw = extractionOutputSchema.parse(JSON.parse(contentText));

  const intents: IntentDiffIntent[] = raw.intents.map((intent) => {
    if (intent.type === "nutrient_set_value") {
      return { type: "nutrient_set_value", field: intent.field, min: intent.min, max: intent.max };
    }
    return {
      type: "weight_goal",
      direction: intent.direction,
      deltaKg: intent.delta_kg,
      targetWeightKg: intent.target_weight_kg,
      durationDays: intent.duration_days,
    };
  });

  return {
    noActionableChange: raw.no_actionable_change,
    noActionableChangeReason: raw.no_actionable_change_reason,
    intents,
    hasHypertension: profile.medical_conditions.includes("hypertension"),
    hasDiabetes: profile.medical_conditions.includes("diabetes"),
    profileDiscrepancy: raw.profile_discrepancy,
    confidence: raw.confidence,
  };
}
