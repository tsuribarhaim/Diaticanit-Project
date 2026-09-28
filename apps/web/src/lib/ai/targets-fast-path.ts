import type { AiExtractionConfig } from "@/lib/ai/env";
import { extractTargetsIntent } from "@/lib/ai/targets-intent-extraction";
import { writeTargetsExplanation } from "@/lib/ai/targets-explanation";
import { applyDeterministicAdjustment, type DecidedFact } from "@/lib/ai/targets-rules-engine";
import type { AppLocale } from "@/lib/locale";
import { computeTargetsDiff } from "@/lib/targets-diff";
import { logServerError } from "@/lib/server-log";
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

/**
 * Controls whether runFastPathShadowComparison actually does anything -
 * defaults OFF (unset/anything other than "true"), so this entire feature
 * is inert unless a developer deliberately opts in for local shadow-mode
 * data collection. See docs/design/targets-generation-latency-and-hebrew-redesign.md's
 * rollout plan §5 - this is step 1 (shadow mode) before any regression
 * corpus or real traffic exposure.
 */
export function isTargetsFastPathShadowEnabled(): boolean {
  return process.env.TARGETS_FAST_PATH_SHADOW?.toLowerCase() === "true";
}

/**
 * Runs the fast path purely for comparison against an already-completed,
 * already-served full-call result - never affects what any real user sees.
 * Intended to be invoked via Next's after() at the call site so it adds
 * zero latency to the real request and can never fail it: every error is
 * caught and logged, never rethrown. Every outcome (applied-and-matching,
 * applied-and-different, declined, no_actionable_change, or errored) is
 * logged via logServerError under the "targets.fast_path_shadow" scope so
 * real-world coverage/accuracy can be reviewed from Vercel logs before any
 * decision to actually serve the fast path to real users.
 */
export async function runFastPathShadowComparison({
  config,
  goalText,
  profile,
  locale,
  currentTargets,
  fullPathPayload,
}: {
  config: AiExtractionConfig;
  goalText: string;
  profile: ProfileForTargets;
  locale: AppLocale;
  currentTargets: TargetGenerationPayload;
  /** The real, already-served result from the existing full-call path -
   * the shadow run's answer is compared against this, never against the
   * pre-request currentTargets. */
  fullPathPayload: TargetGenerationPayload;
}): Promise<void> {
  const start = Date.now();
  try {
    const shadowResult = await tryFastPathTargetsAdjustment({ config, goalText, profile, locale, currentTargets });
    const elapsedMs = Date.now() - start;

    if (shadowResult.outcome !== "applied") {
      logServerError("targets.fast_path_shadow", "declined", { outcome: shadowResult.outcome, reason: shadowResult.reason, elapsedMs });
      return;
    }

    const diffRows = computeTargetsDiff(fullPathPayload, shadowResult.payload, locale);
    logServerError("targets.fast_path_shadow", diffRows.length === 0 ? "applied_matching" : "applied_diverged", {
      elapsedMs,
      decidedFacts: shadowResult.decidedFacts,
      diffRowCount: diffRows.length,
      diffRows,
    });
  } catch (error) {
    logServerError("targets.fast_path_shadow", "errored", {
      elapsedMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
