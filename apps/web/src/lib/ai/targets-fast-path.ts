import type { AiExtractionConfig } from "@/lib/ai/env";
import { extractTargetsIntent } from "@/lib/ai/targets-intent-extraction";
import { writeTargetsExplanation } from "@/lib/ai/targets-explanation";
import { applyDeterministicAdjustment, type DecidedFact } from "@/lib/ai/targets-rules-engine";
import type { AppLocale } from "@/lib/locale";
import type { ProfileForTargets, TargetGenerationPayload } from "@/lib/targets";

/**
 * Orchestrates the full 3-stage fast path (see
 * docs/design/targets-generation-latency-and-hebrew-redesign.md) end to
 * end: intent extraction -> deterministic rules engine -> localized
 * explanation. NOT wired into generateTargetsWithAi's live call path yet -
 * this is deliberately standalone, additive code so it can be exercised
 * directly (a manual smoke test, or a future shadow-mode background run)
 * without changing what any real user request does today. Wiring this in
 * as an actual default is a separate, later step per the design doc's
 * rollout plan (shadow mode + a regression corpus first).
 */
export type FastPathResult =
  | { outcome: "applied"; payload: TargetGenerationPayload; decidedFacts: DecidedFact[] }
  | { outcome: "declined"; reason: string }
  | { outcome: "no_actionable_change"; reason: string };

export async function tryFastPathTargetsAdjustment({
  config,
  goalText,
  profile,
  locale,
  currentTargets,
}: {
  config: AiExtractionConfig;
  goalText: string;
  profile: ProfileForTargets;
  locale: AppLocale;
  currentTargets: TargetGenerationPayload;
}): Promise<FastPathResult> {
  const diff = await extractTargetsIntent({ config, goalText, profile, currentTargets });

  if (diff.noActionableChange) {
    return { outcome: "no_actionable_change", reason: diff.noActionableChangeReason };
  }

  const rulesResult = applyDeterministicAdjustment({ currentTargets, profile, diff, locale });
  if (!rulesResult.covered) {
    return { outcome: "declined", reason: rulesResult.reason };
  }

  const explanation = await writeTargetsExplanation({
    config,
    locale,
    decidedFacts: rulesResult.decidedFacts,
    profileDiscrepancy: rulesResult.profileDiscrepancy,
  });

  const payload: TargetGenerationPayload = {
    ...rulesResult.payload,
    aiRationaleExplanation: explanation.globalCoachingExplanation,
    profileDiscrepancyMessage: explanation.profileDiscrepancyMessage,
    // Fixed, not carried from the diff's own confidence - once the rules
    // engine has claimed coverage, the numbers are deterministic, not a
    // probabilistic AI guess; this mirrors mapAiTargetsResponse's own
    // clamp(..., 0.3, 0.97) range on the full-call path.
    confidence: 0.9,
  };

  return { outcome: "applied", payload, decidedFacts: rulesResult.decidedFacts };
}
