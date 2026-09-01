import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";

export type HomeCoachInputs = {
  locale: "en" | "he";
  range: "today" | "7" | "30" | "90";
  caloriesAvg: number;
  caloriesMin: number;
  caloriesMax: number;
  proteinAvg: number;
  proteinMinG: number;
  proteinMaxG: number;
  /** null for the "today" range, where a same-day consistency percent isn't meaningful. */
  reportingConsistencyPercent: number | null;
  exerciseSessionDays: number;
  exerciseWeeklyTarget: number;
  goalType: string;
  /** Signed kg change over the period (negative = lost); null when there's
   * not enough weight-log data in the period to compute a reliable shift -
   * in that case the prompt is told to skip milestone language entirely,
   * per the "only celebrate when there's an actual shift" rule. */
  weightShiftKg: number | null;
};

const narrativeResponseSchema = z.object({
  narrative: z.string().trim().min(1).max(600),
});

const AI_REQUEST_TIMEOUT_MS = 15000;

function parseJsonPayload(payload: string): unknown {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new Error("AI Home Coach narrative generator returned empty payload.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new Error("AI Home Coach narrative generator returned invalid JSON.");
  }
}

function buildSystemPrompt(locale: "en" | "he"): string {
  const languageName = locale === "he" ? "Hebrew" : "English";
  return [
    "You are an encouraging, expert AI health coach writing a short homepage summary card.",
    "Combine up to two things, only when the data actually supports them:",
    "1) A nutrition/activity pattern insight - a specific, concrete observation comparing actual logged averages against the user's target ranges (e.g. hitting calories but running low on protein, or exercising consistently but under on some nutrient). Only mention this if there is a real, notable gap or a genuine strength - never invent one.",
    "2) A milestone celebration - if a meaningful weight shift is provided in the data, you must include it, naming the actual kg amount and direction. If no shift is provided, omit celebration language entirely - never congratulate on something that didn't happen.",
    "Do not mention missing or incomplete logging, reminders to log more, or any accountability/nagging language - that is out of scope for this card.",
    "Keep it warm, specific, and brief: 2-4 sentences, no headers, no bullet points, no markdown.",
    `Write the narrative entirely in ${languageName}. Do not mix languages within the response.`,
    'Return strict JSON only with this shape: {"narrative":"string"}',
  ].join("\n");
}

function buildUserPrompt(inputs: HomeCoachInputs): string {
  const rangeLabel = inputs.range === "today" ? "today" : `the last ${inputs.range} days`;
  const lines = [
    `Period: ${rangeLabel}.`,
    `Calories: averaging ${Math.round(inputs.caloriesAvg)} kcal/day against a target range of ${inputs.caloriesMin}-${inputs.caloriesMax} kcal.`,
    `Protein: averaging ${Math.round(inputs.proteinAvg)} g/day against a target range of ${inputs.proteinMinG}-${inputs.proteinMaxG} g.`,
    `Exercise this week: ${inputs.exerciseSessionDays} of ${inputs.exerciseWeeklyTarget || "no set"} planned weekly sessions logged.`,
    `Goal type: ${inputs.goalType}.`,
  ];

  if (inputs.reportingConsistencyPercent !== null) {
    lines.push(`Reporting consistency: ${Math.round(inputs.reportingConsistencyPercent)}% of days in this period were logged.`);
  }

  if (inputs.weightShiftKg !== null && Math.abs(inputs.weightShiftKg) >= 0.1) {
    const direction = inputs.weightShiftKg < 0 ? "lost" : "gained";
    lines.push(`Weight shift in this period: ${direction} ${Math.abs(inputs.weightShiftKg).toFixed(1)} kg.`);
  } else {
    lines.push("No meaningful weight shift in this period - do not mention weight milestones.");
  }

  return lines.join("\n");
}

/** Generates one short narrative combining Layer B (nutrition/activity
 * pattern insight) and Layer C (milestone celebration, only when the
 * caller-provided weightShiftKg is meaningful) for the Home page's AI
 * Coach card. Layer A (missing-log nudges) is intentionally out of scope -
 * deferred per product decision. Callers are expected to cache the result
 * themselves (see the Home page's use of user_home_coach_narratives). */
export async function generateHomeCoachNarrative({
  config,
  inputs,
}: {
  config: AiExtractionConfig;
  inputs: HomeCoachInputs;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  let contentText: string;
  try {
    contentText = await callAiChatCompletion({
      config,
      jsonMode: true,
      signal: controller.signal,
      messages: [
        { role: "system", content: buildSystemPrompt(inputs.locale) },
        { role: "user", content: buildUserPrompt(inputs) },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`AI Home Coach narrative generation timed out after ${AI_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const parsed = narrativeResponseSchema.parse(parseJsonPayload(contentText));
  return parsed.narrative;
}
