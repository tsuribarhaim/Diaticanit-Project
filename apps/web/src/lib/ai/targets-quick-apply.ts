import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";
import { computeBmi } from "@/lib/bmi";
import type { AppLocale } from "@/lib/locale";
import type { ProfileForTargets, TargetGenerationPayload } from "@/lib/targets";

/**
 * The tiny, fast classification call behind the Targets save-flow redesign
 * (docs/design/targets-save-performance-redesign.md, decisions #1 and #2) -
 * a small, non-streamed JSON call asking only "does this reduce to a
 * literal target-weight/duration change with nothing else needing
 * adjustment, or does it need the full careful pass?" Deliberately a
 * SEPARATE call from the conversational chat reply (rather than embedding
 * this in that reply's own streamed marker, which was the original design
 * sketch) - streaming token-by-token parsing of a variable-length JSON
 * blob is fragile, while a small dedicated non-streamed call is simple and
 * just as fast in practice, since its output is tiny regardless of the
 * provider's max-token ceiling.
 *
 * Currently only recognizes target_weight_kg and duration_days as
 * quick-apply candidates (the exact case this whole redesign was scoped
 * around) - not yet generalized to arbitrary custom user_targets entries,
 * which would need to also decide a new id/label/unit and is a bigger
 * follow-up.
 */
const quickApplySchema = z.object({
  quick_apply_weight_kg: z.number().nullable().optional().default(null),
  quick_apply_duration_days: z.number().nullable().optional().default(null),
  // True whenever the request touches anything beyond that literal
  // weight/duration ask - a new medical/dietary fact, an exercise change,
  // multiple asks at once, or anything else that would trigger the full
  // prompt's own mandatory safety/BMI review coupling rules. When true,
  // quick-apply is skipped entirely and the caller falls through to the
  // full regeneration - never force a narrow patch when unsure.
  needs_full_review: z.boolean(),
  reason: z.string().trim().max(300).optional().default(""),
});

export type QuickApplyResult = {
  quickApplyWeightKg: number | null;
  quickApplyDurationDays: number | null;
  needsFullReview: boolean;
  reason: string;
};

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
    throw new Error("AI returned invalid JSON.");
  }
}

export async function classifyTargetsQuickApply({
  config,
  goalText,
  profile,
  currentTargets,
  locale,
}: {
  config: AiExtractionConfig;
  goalText: string;
  profile: ProfileForTargets;
  currentTargets: TargetGenerationPayload;
  locale: AppLocale;
}): Promise<QuickApplyResult> {
  const currentBmi = computeBmi(profile.weight_kg, profile.height_cm);
  const languageName = locale === "he" ? "Hebrew" : "English";

  const messages = [
    {
      role: "system" as const,
      content:
        "You classify a health-target adjustment request. Return strict JSON only, no markdown. You do not generate the actual target plan here - only decide whether this specific request is simple enough to apply immediately.",
    },
    {
      role: "user" as const,
      content: [
        'Return strict JSON with exactly this shape: {"quick_apply_weight_kg":number|null,"quick_apply_duration_days":number|null,"needs_full_review":boolean,"reason":"string"}',
        "Rules:",
        "- Set quick_apply_weight_kg to a literal new target weight (kg) ONLY when goal_text asks for nothing except a target weight (optionally with a duration/timeframe) and requires no other judgment - a plain, unambiguous restatement of a number the user asked for, not something you're inferring or adjusting.",
        "- Set quick_apply_duration_days similarly, only when goal_text states or implies a timeframe (e.g. \"over 2 months\" -> about 60 days).",
        "- Set needs_full_review to true whenever the request touches ANYTHING beyond a literal weight/duration ask: a medical condition, allergy, medication, dietary preference, exercise change, sleep/hydration/step goal, multiple asks at once, a vague or ambiguous request, or anything a careful safety review ought to consider (e.g. a profile-changed note). When in doubt, set this true - a narrow quick-apply should only ever be used for the clearly simple case.",
        `- reason: one short plain-language sentence in ${languageName} explaining the classification, for logging only (not shown to the user in the fast path).`,
        `user_profile: age ${profile.age}, current weight_kg ${profile.weight_kg}, height_cm ${profile.height_cm}, current_bmi ${currentBmi > 0 ? currentBmi.toFixed(1) : "unknown"}, medical_conditions: ${profile.medical_conditions.join(", ") || "none"}, dietary_preference: ${profile.dietary_preference ?? "standard"}`,
        `current_target_weight_kg: ${currentTargets.targetWeightKg ?? "none"}, current_duration_days: ${currentTargets.durationDays ?? "none"}, current_goal_type: ${currentTargets.goalType}`,
        "goal_text (the conversation; the actual ask is the newest message):",
        goalText.length > 3000 ? goalText.slice(-3000) : goalText,
      ].join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    temperature: 0,
    jsonMode: true,
    // Small, simple schema - this is deliberately NOT the 90s budget the
    // full generation needs; if it ever runs long, falling through to the
    // full review path (the same outcome as needs_full_review: true) is
    // the safe default rather than making the user wait on this too.
    timeoutMs: 15_000,
  });

  const parsed = quickApplySchema.parse(parseJson(contentText));

  return {
    quickApplyWeightKg: parsed.quick_apply_weight_kg,
    quickApplyDurationDays: parsed.quick_apply_duration_days,
    needsFullReview: parsed.needs_full_review,
    reason: parsed.reason,
  };
}
