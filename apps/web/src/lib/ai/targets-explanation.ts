import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";
import type { DecidedFact } from "@/lib/ai/targets-rules-engine";
import type { AppLocale } from "@/lib/locale";

/**
 * Stage (c) of the 3-stage targets-adjustment pipeline (see
 * docs/design/targets-generation-latency-and-hebrew-redesign.md, §B). The
 * rules engine (targets-rules-engine.ts) has already decided every number
 * in the plan by the time this runs - this call's ONLY job is turning
 * that already-decided, already-safety-reviewed set of facts into a short,
 * warm, localized coaching message. It must never change, recompute, or
 * second-guess a number; the facts below are handed to it as fixed given
 * every time. (Verified empirically: in every test run of this exact
 * pattern, the explanation's stated numbers matched the injected facts
 * with zero drift - see targets-pipeline-empirical-test-results.md.)
 */

const explanationOutputSchema = z.object({
  global_coaching_explanation: z.string().min(1),
  profile_discrepancy_message: z.string().default(""),
});

const TOOL_NAME = "write_targets_explanation";

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    global_coaching_explanation: { type: "string" },
    profile_discrepancy_message: { type: "string" },
  },
  required: ["global_coaching_explanation"],
} as const;

function describeFact(fact: DecidedFact): string {
  switch (fact.kind) {
    case "nutrient_range_changed":
      return `${fact.field} range changed from ${fact.fromMin}-${fact.fromMax} to ${fact.toMin}-${fact.toMax}, because: ${fact.reasonKey}.`;
    case "condition_tightening_applied":
      return `${fact.condition} tightening applied (a standing rule for this condition).`;
    case "condition_tightening_removed":
      return `${fact.condition} tightening removed (condition no longer on file) - range relaxed back to the generic default.`;
    case "target_weight_changed":
      return `Target weight changed from ${fact.fromKg ?? "unset"} to ${fact.toKg} kg${fact.durationDays ? `, over ${fact.durationDays} days` : ""}.`;
    case "no_changes_needed":
      return "Nothing needed to change - the plan is already accurate for this request.";
  }
}

export async function writeTargetsExplanation({
  config,
  locale,
  decidedFacts,
  profileDiscrepancy,
}: {
  config: AiExtractionConfig;
  locale: AppLocale;
  decidedFacts: DecidedFact[];
  profileDiscrepancy: string;
}): Promise<{ globalCoachingExplanation: string; profileDiscrepancyMessage: string }> {
  const languageName = locale === "he" ? "Hebrew" : "English";

  const messages = [
    {
      role: "system" as const,
      content:
        "You are the final explanation step in a nutrition coaching pipeline. A deterministic rules engine has already computed the actual changes to a user's target plan. Your only job is to turn those already-decided facts into a short, warm, accurate coaching message - you must NOT change, recompute, or second-guess any number; just explain what was already decided and why. Call the write_targets_explanation tool exactly once with your answer.",
    },
    {
      role: "user" as const,
      content: [
        `Write entirely in ${languageName}. Do not mix languages within a field.`,
        "Address the user directly in second person (\"you\"/\"your\"). Never third person.",
        'In Hebrew specifically, prefer gender-neutral or mixed-form second-person phrasing (e.g. "שלך", "את/ה") over a gendered third-person construction.',
        "global_coaching_explanation: 2-5 sentences, must state the actual applied numbers below (never a different number), and read naturally as one coaching message covering all the changes below.",
        "profile_discrepancy_message: one short plain-language sentence naming both values from PROFILE_DISCREPANCY_NOTE below, if it's non-empty. Empty string otherwise.",
        "",
        "DECIDED FACTS (already computed by the deterministic rules engine - do not alter these numbers, only explain them):",
        ...decidedFacts.map((fact) => `- ${describeFact(fact)}`),
        "",
        `PROFILE_DISCREPANCY_NOTE: ${profileDiscrepancy || "(none)"}`,
      ].join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    tool: { name: TOOL_NAME, description: "Write the localized coaching explanation for an already-decided targets update.", inputSchema: TOOL_INPUT_SCHEMA },
    timeoutMs: 20_000,
  });

  const raw = explanationOutputSchema.parse(JSON.parse(contentText));
  return { globalCoachingExplanation: raw.global_coaching_explanation, profileDiscrepancyMessage: raw.profile_discrepancy_message };
}
