import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";
import type { AppLocale } from "@/lib/locale";

/**
 * The classification step behind the unified, app-wide Daffy chat (see
 * docs discussion: chat should work from any screen - asking about
 * targets from Daily Report, or logging a meal from Targets, should both
 * just work). A small, fast, non-streamed JSON call, same pattern as
 * classifyTargetsQuickApply - picks which domain's existing, already-
 * hardened handler should answer this message, rather than one giant
 * prompt trying to do everything itself. currentScreen is a tie-breaker
 * only, for a genuinely ambiguous message ("can we lower this a bit?"
 * with no clear subject) - never overrides what the message actually
 * says when that's clear.
 */
export type ChatDomain = "targets" | "daily_report" | "profile" | "help";

const classifySchema = z.object({
  domain: z.enum(["targets", "daily_report", "profile", "help"]),
  reason: z.string().trim().max(200).optional().default(""),
});

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

export async function classifyChatDomain({
  config,
  message,
  currentScreen,
  locale,
}: {
  config: AiExtractionConfig;
  message: string;
  /** Which page the chat was opened from - a tie-breaker only, see this
   * file's own top comment. */
  currentScreen: ChatDomain;
  locale: AppLocale;
}): Promise<{ domain: ChatDomain; reason: string }> {
  const messages = [
    {
      role: "system" as const,
      content:
        "You classify a message sent to a health-tracking app's AI chat, which works the same from any screen in the app. Return strict JSON only, no markdown. You do not answer the message here - only decide which of four domains should handle it.",
    },
    {
      role: "user" as const,
      content: [
        'Return strict JSON with exactly this shape: {"domain":"targets"|"daily_report"|"profile"|"help","reason":"string"}',
        "Rules:",
        '- "targets": the message is about the user\'s standing daily targets/goals - nutrient ranges (calories, protein, carbs, etc.), weight target, sleep target, step target, or asking to change/review any of those.',
        '- "daily_report": the message is about logging or asking about what the user has actually eaten, drunk, done for exercise, or weighed TODAY (or on a specific day) - a concrete real-world event, not a standing goal.',
        '- "profile": the message is about the user\'s own personal/biometric profile info - their name, date of birth, biological sex, current height or weight (not a target), activity level, dietary preference, nutritional goal, allergies, habits (smoking/alcohol), pregnancy/lactation status, hot climate note, medical conditions, or medications - either asking what\'s on file, or asking to change it.',
        '- "help": the message is about the APP ITSELF, not the user\'s own health data - a "how do I..." / "where is..." / "what does X do" question, general small talk/greeting with no health content, a bug report ("this isn\'t working", "I got an error"), or a feature request ("it would be great if...", "can you add..."). Also use "help" for anything about requesting a new feature or reporting a problem with the app.',
        '- A message can mention more than one domain, in which case pick whichever is the actual ACTION being requested (e.g. "I just ate a salad, does that fit my carb target?" is daily_report - logging the salad is the action; a follow-up like "so should I lower my carb target?" is targets; "I switched to vegetarian, update my profile" is profile; "how do I change my target weight?" is help, since the action is asking how, not actually changing it).',
        '- Weight is ambiguous by itself: "I now weigh 71kg" (a fact about the user right now) is profile; "lower my weight target to 71kg" (a goal) is targets.',
        `- If the message is genuinely ambiguous with no clear subject of its own (e.g. "can we lower this a bit?", "what about now?"), fall back to whichever domain matches currentScreen ("${currentScreen}") below, since that's most likely what "this" refers to.`,
        `- reason: one short phrase in ${locale === "he" ? "Hebrew" : "English"} explaining the classification, for logging only.`,
        `currentScreen: ${currentScreen}`,
        "message:",
        message,
      ].join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    temperature: 0,
    jsonMode: true,
    // Same reasoning as classifyTargetsQuickApply's own timeout - this is a
    // small, fast pre-step, not the actual answer; if it ever runs long,
    // falling back to currentScreen (below) keeps the whole message from
    // hanging on classification alone.
    timeoutMs: 12_000,
  }).catch(() => null);

  if (!contentText) {
    return { domain: currentScreen, reason: "classification unavailable, fell back to current screen" };
  }

  try {
    const parsed = classifySchema.parse(parseJson(contentText));
    return { domain: parsed.domain, reason: parsed.reason };
  } catch {
    return { domain: currentScreen, reason: "classification unparseable, fell back to current screen" };
  }
}
