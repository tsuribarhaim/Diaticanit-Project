import { evaluateTargetWeightSafety } from "@/lib/targets";
import { CONDITION_TIGHTENING, DEFAULT_ADDED_SUGAR_MAX_G, DEFAULT_SODIUM_RANGE, computeStandingUserTargets } from "@/lib/targets";
import type { AppLocale } from "@/lib/locale";
import type { ProfileForTargets, TargetGenerationPayload } from "@/lib/targets";

/**
 * Deterministic, code-based second stage of the 3-stage targets-adjustment
 * pipeline (see docs/design/targets-generation-latency-and-hebrew-redesign.md,
 * §A/§B). Given a small structured diff already extracted by stage (a) (an
 * AI call - see targets-intent-extraction.ts) plus the current locked plan
 * and profile, either produces the full updated plan in milliseconds with
 * zero AI cost, or declines (covered: false) so the caller falls back to
 * the existing full AI generation path unchanged.
 *
 * DELIBERATE, NARROW v1 SCOPE - this only ever claims coverage for cases
 * that already have a genuinely deterministic rule somewhere in this app
 * today (the heuristic generator in lib/targets.ts, or the AI prompt's own
 * stated formulas in lib/ai/targets.ts). It does NOT invent new medical/
 * nutrition rules (e.g. there is no vegetarian iron/zinc adjustment
 * anywhere in this app today, so this engine does not add one either) and
 * does NOT attempt the AI prompt's MANDATORY BMI SAFETY REVIEW (raising/
 * lowering calories for an out-of-healthy-range current BMI) - that
 * formula doesn't exist in deterministic form anywhere yet and is a
 * separate, later piece of work. Anything outside this scope must decline
 * coverage rather than guess - a wrong "covered: true" here would be a
 * real, silent quality regression on medical-adjacent data, not just an
 * engineering bug.
 */

export type NutrientRangeField =
  | "calories"
  | "protein_g"
  | "carbs_g"
  | "fats_g"
  | "fiber_g"
  | "sodium_mg"
  | "added_sugar_g"
  | "water_ml"
  | "potassium_mg"
  | "magnesium_mg"
  | "calcium_mg"
  | "iron_mg"
  | "zinc_mg"
  | "vit_c_mg"
  | "vit_b12_mcg"
  | "vit_d_mcg"
  | "sat_fat_g"
  | "omega3_g"
  | "cholesterol_mg";

/** One already-decided fact, in English, for stage (c) to explain - never
 * for stage (c) to recompute or second-guess (see the explanation module's
 * own doc comment). Kept intentionally small/flat rather than a full diff
 * object, since stage (c)'s only job is turning this into a few sentences. */
export type DecidedFact =
  | { kind: "nutrient_range_changed"; field: NutrientRangeField; fromMin: number; fromMax: number; toMin: number; toMax: number; reasonKey: ReasonKey }
  | { kind: "condition_tightening_applied"; condition: "hypertension" | "diabetes" }
  | { kind: "condition_tightening_removed"; condition: "hypertension" | "diabetes" }
  | { kind: "target_weight_changed"; fromKg: number | null; toKg: number; durationDays: number | null }
  | { kind: "no_changes_needed" };

export type ReasonKey = "explicit_user_request" | "condition_tightening" | "condition_tightening_removed";

export type IntentDiffIntent =
  // min/max are each optional - a request often only pins down one side
  // ("set my sodium MAX to 1800mg" says nothing about the minimum); the
  // rules engine carries the unspecified side forward from the current
  // plan rather than requiring the AI to invent a value for it.
  | { type: "nutrient_set_value"; field: NutrientRangeField; min?: number; max?: number }
  | { type: "weight_goal"; direction: "lose" | "gain" | "maintain"; deltaKg?: number; targetWeightKg?: number; durationDays?: number };

/**
 * The tiny structured output stage (a) produces (see
 * targets-intent-extraction.ts). Deliberately does NOT include a general
 * "vague qualitative adjustment" intent shape (e.g. "decrease sodium a
 * bit") - there is no deterministic rule to turn "a bit" into an exact
 * number, so stage (a) is expected to either resolve a vague ask into a
 * concrete literal target_min/target_max itself (out of scope for v1 - see
 * the module doc comment) or, more conservatively, simply not emit a
 * nutrient_set_value intent for it, which naturally makes this engine
 * decline coverage and fall back to the full AI path.
 */
export type IntentDiff = {
  noActionableChange: boolean;
  noActionableChangeReason: string;
  intents: IntentDiffIntent[];
  /** Structured, not free text - read directly off ProfileForTargets by
   * the caller, not asked of the AI (see targets-intent-extraction.ts). */
  hasHypertension: boolean;
  hasDiabetes: boolean;
  profileDiscrepancy: string;
  confidence: number;
};

export type RulesEngineResult =
  | { covered: true; payload: TargetGenerationPayload; decidedFacts: DecidedFact[]; profileDiscrepancy: string }
  | { covered: false; reason: string };

function clampRangeSimple(min: number, max: number): { min: number; max: number } {
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/** Applies (or removes) the two conditions this app has an actual
 * deterministic rule for. Idempotent - safe to call on every request
 * regardless of whether the condition is what the request is actually
 * about, mirroring the AI prompt's own "this review applies even when it
 * is not the explicit subject of goal_text" instruction. */
function applyConditionTightening(
  current: TargetGenerationPayload,
  hasHypertension: boolean,
  hasDiabetes: boolean,
): { sodiumMinMg: number; sodiumMaxMg: number; addedSugarMaxG: number; facts: DecidedFact[] } {
  const facts: DecidedFact[] = [];

  const wasHypertensionTightened = current.sodiumMinMg === CONDITION_TIGHTENING.hypertension.sodiumMinMg && current.sodiumMaxMg === CONDITION_TIGHTENING.hypertension.sodiumMaxMg;
  let sodiumMinMg = current.sodiumMinMg;
  let sodiumMaxMg = current.sodiumMaxMg;
  if (hasHypertension && !wasHypertensionTightened) {
    sodiumMinMg = CONDITION_TIGHTENING.hypertension.sodiumMinMg;
    sodiumMaxMg = CONDITION_TIGHTENING.hypertension.sodiumMaxMg;
    facts.push({ kind: "condition_tightening_applied", condition: "hypertension" });
  } else if (!hasHypertension && wasHypertensionTightened) {
    // Condition was removed from the profile - relax back to the generic
    // default rather than leaving a stale clinical-looking range in place.
    sodiumMinMg = DEFAULT_SODIUM_RANGE.min;
    sodiumMaxMg = DEFAULT_SODIUM_RANGE.max;
    facts.push({ kind: "condition_tightening_removed", condition: "hypertension" });
  }

  const wasDiabetesTightened = current.addedSugarMaxG === CONDITION_TIGHTENING.diabetes.addedSugarMaxG;
  let addedSugarMaxG = current.addedSugarMaxG;
  if (hasDiabetes && !wasDiabetesTightened) {
    addedSugarMaxG = CONDITION_TIGHTENING.diabetes.addedSugarMaxG;
    facts.push({ kind: "condition_tightening_applied", condition: "diabetes" });
  } else if (!hasDiabetes && wasDiabetesTightened) {
    addedSugarMaxG = DEFAULT_ADDED_SUGAR_MAX_G;
    facts.push({ kind: "condition_tightening_removed", condition: "diabetes" });
  }

  return { sodiumMinMg, sodiumMaxMg, addedSugarMaxG, facts };
}

const NUTRIENT_FIELD_KEYS: Record<NutrientRangeField, { minKey: keyof TargetGenerationPayload; maxKey: keyof TargetGenerationPayload }> = {
  calories: { minKey: "caloriesMin", maxKey: "caloriesMax" },
  protein_g: { minKey: "proteinMinG", maxKey: "proteinMaxG" },
  carbs_g: { minKey: "carbsMinG", maxKey: "carbsMaxG" },
  fats_g: { minKey: "fatsMinG", maxKey: "fatsMaxG" },
  fiber_g: { minKey: "fiberMinG", maxKey: "fiberMaxG" },
  sodium_mg: { minKey: "sodiumMinMg", maxKey: "sodiumMaxMg" },
  added_sugar_g: { minKey: "addedSugarMinG", maxKey: "addedSugarMaxG" },
  water_ml: { minKey: "waterMinMl", maxKey: "waterMaxMl" },
  potassium_mg: { minKey: "potassiumMinMg", maxKey: "potassiumMaxMg" },
  magnesium_mg: { minKey: "magnesiumMinMg", maxKey: "magnesiumMaxMg" },
  calcium_mg: { minKey: "calciumMinMg", maxKey: "calciumMaxMg" },
  iron_mg: { minKey: "ironMinMg", maxKey: "ironMaxMg" },
  zinc_mg: { minKey: "zincMinMg", maxKey: "zincMaxMg" },
  vit_c_mg: { minKey: "vitCMinMg", maxKey: "vitCMaxMg" },
  vit_b12_mcg: { minKey: "vitB12MinMcg", maxKey: "vitB12MaxMcg" },
  vit_d_mcg: { minKey: "vitDMinMcg", maxKey: "vitDMaxMcg" },
  sat_fat_g: { minKey: "satFatMinG", maxKey: "satFatMaxG" },
  omega3_g: { minKey: "omega3MinG", maxKey: "omega3MaxG" },
  cholesterol_mg: { minKey: "cholesterolMinMg", maxKey: "cholesterolMaxMg" },
};

const WEIGHT_LOSS_DAILY_DEFICIT_KCAL_PER_KG_PER_DAY = 7700;

export function applyDeterministicAdjustment({
  currentTargets,
  profile,
  diff,
  locale,
}: {
  currentTargets: TargetGenerationPayload;
  profile: ProfileForTargets;
  diff: IntentDiff;
  locale: AppLocale;
}): RulesEngineResult {
  if (diff.confidence < 0.85) {
    return { covered: false, reason: "Intent-extraction confidence below the fast-path threshold." };
  }

  if (diff.noActionableChange) {
    // Matches the AI prompt's own no_actionable_change handling - the
    // caller (generateTargetsWithAi's fast-path wrapper) is expected to
    // raise NoActionableChangeError from this, same as the full AI path.
    return { covered: false, reason: "no_actionable_change" };
  }

  // Anything the profile's structured BMI would flag as out-of-healthy-
  // range needs the AI prompt's MANDATORY BMI SAFETY REVIEW, which has no
  // deterministic equivalent yet (see module doc comment) - decline rather
  // than silently skip a safety review the full path would have run.
  // (Deliberately re-derived here, not trusted from the diff, since this
  // must never depend on the AI extraction step noticing it.)
  const bmi = profile.height_cm > 0 ? (profile.weight_kg / ((profile.height_cm / 100) ** 2)) : 0;
  if (bmi > 0 && (bmi < 18.5 || bmi > 24.9)) {
    return { covered: false, reason: "Current BMI is outside the healthy range - needs the full BMI safety review." };
  }

  const facts: DecidedFact[] = [];
  let next: TargetGenerationPayload = { ...currentTargets };

  // 1. Condition tightening - always evaluated, regardless of what the
  // request is nominally about (mirrors the AI prompt's own rule).
  const tightening = applyConditionTightening(currentTargets, diff.hasHypertension, diff.hasDiabetes);
  next = { ...next, sodiumMinMg: tightening.sodiumMinMg, sodiumMaxMg: tightening.sodiumMaxMg, addedSugarMaxG: tightening.addedSugarMaxG };
  facts.push(...tightening.facts);

  // 2. Explicit intents - only ever literal, concrete asks (see
  // IntentDiffIntent's own doc comment for why vague asks never reach
  // here).
  for (const intent of diff.intents) {
    if (intent.type === "nutrient_set_value") {
      const keys = NUTRIENT_FIELD_KEYS[intent.field];
      if (!keys) return { covered: false, reason: `Unknown nutrient field: ${intent.field}` };
      const fromMin = next[keys.minKey] as number;
      const fromMax = next[keys.maxKey] as number;
      const clamped = clampRangeSimple(intent.min ?? fromMin, intent.max ?? fromMax);
      next = { ...next, [keys.minKey]: clamped.min, [keys.maxKey]: clamped.max };
      facts.push({ kind: "nutrient_range_changed", field: intent.field, fromMin, fromMax, toMin: clamped.min, toMax: clamped.max, reasonKey: "explicit_user_request" });
      continue;
    }

    if (intent.type === "weight_goal") {
      if (intent.direction === "maintain") {
        continue;
      }
      const deltaKg = intent.deltaKg ?? 2;
      const durationDays = intent.durationDays ?? (intent.direction === "lose" ? 60 : 90);
      const targetWeightKg =
        intent.targetWeightKg ?? Math.round((profile.weight_kg + (intent.direction === "lose" ? -deltaKg : deltaKg)) * 10) / 10;

      const candidatePayload: TargetGenerationPayload = { ...next, targetWeightKg };
      const safetyMessage = evaluateTargetWeightSafety(candidatePayload, profile, locale);
      if (safetyMessage) {
        // Not "declining coverage" - this is the deterministic safety
        // check correctly rejecting an unsafe literal ask, exactly as the
        // full AI path's own independent app-side check already does
        // today (see generateTargetsPayload's caller). Surfacing it here
        // as a decline lets the caller fall back to the full path, which
        // will produce the same rejection through its own existing check.
        return { covered: false, reason: safetyMessage };
      }

      const dailyKcalDelta = Math.round(
        Math.min(900, Math.max(200, (deltaKg * WEIGHT_LOSS_DAILY_DEFICIT_KCAL_PER_KG_PER_DAY) / durationDays)),
      );
      const sign = intent.direction === "lose" ? -1 : 1;
      const maintenanceEstimate = (next.caloriesMin + next.caloriesMax) / 2;
      const caloriesMin = Math.round(maintenanceEstimate + sign * dailyKcalDelta - 100);
      const caloriesMax = Math.round(maintenanceEstimate + sign * dailyKcalDelta + 100);

      facts.push({ kind: "target_weight_changed", fromKg: next.targetWeightKg, toKg: targetWeightKg, durationDays });
      facts.push({ kind: "nutrient_range_changed", field: "calories", fromMin: next.caloriesMin, fromMax: next.caloriesMax, toMin: caloriesMin, toMax: caloriesMax, reasonKey: "explicit_user_request" });

      next = { ...next, targetWeightKg, durationDays, goalType: intent.direction === "lose" ? "weight_loss" : "weight_gain", caloriesMin, caloriesMax: Math.max(caloriesMin + 100, caloriesMax) };
      continue;
    }
  }

  // 3. Standing targets - always refreshed from the (possibly just-
  // updated) target weight, so target_weight's display value never drifts
  // from a weight_goal intent handled above.
  next = { ...next, userTargets: computeStandingUserTargets({ profile, targetWeightKg: next.targetWeightKg, locale }) };

  if (facts.length === 0) {
    facts.push({ kind: "no_changes_needed" });
  }

  return { covered: true, payload: next, decidedFacts: facts, profileDiscrepancy: diff.profileDiscrepancy };
}
