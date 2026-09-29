/**
 * The 3-way production rollout switch for targets-adjustment generation
 * (see docs/design/targets-generation-latency-and-hebrew-redesign.md).
 * Deliberately a single env var, not a DB-backed toggle - the user's own
 * choice, given the option, trading a slightly slower switch (an env-var
 * change + redeploy, a few minutes on Vercel) for zero new infrastructure.
 *
 * - "full_ai": today's exact behavior, generation in the user's real
 *   locale, one full call, nothing else changed. The safety net - always
 *   available to drop back to immediately if either of the other two
 *   modes causes a problem in production.
 * - "lang_only": the same full call/schema/safety-review as "full_ai",
 *   generated in English only, then rendered into the user's real locale
 *   by a second, smaller translation call (targets-translate.ts).
 *   Isolates just the Hebrew-generation-latency fix from the rules-engine
 *   changes - a middle ground to fall back to if "full_change" specifically
 *   turns out to be the problem, without giving up the language-latency
 *   win too.
 * - "full_change": the complete pipeline (targets-fast-path.ts) - intent
 *   extraction, the deterministic rules engine, and a localized
 *   explanation - falling back to "full_ai" behavior for anything it
 *   doesn't cover.
 *
 * Defaults to "full_ai" for any unset or unrecognized value - this must
 * never silently start behaving differently because of a typo or a
 * missing env var in some environment.
 */
export type TargetsUpdateMode = "full_ai" | "lang_only" | "full_change";

export function getTargetsUpdateMode(): TargetsUpdateMode {
  const raw = process.env.TARGETS_UPDATE_MODE?.trim().toLowerCase();
  if (raw === "lang_only" || raw === "full_change") return raw;
  return "full_ai";
}
