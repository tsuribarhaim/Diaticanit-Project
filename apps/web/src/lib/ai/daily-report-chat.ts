import type { AiExtractionConfig } from "@/lib/ai/env";
import type { AppLocale } from "@/lib/locale";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * Opens a raw streaming chat-completions request for a conversational reply
 * while the user describes their day in free text. Mirrors
 * openChatReplyStream in targets-chat.ts: the model prefixes its reply with
 * an 'ACTIONABLE '/'INFO ' marker (stripped before the user sees it) so the
 * client can offer a "Log this entry" action only when the conversation so
 * far actually has enough detail to save - without a second AI round-trip.
 * Returns the raw fetch Response so the caller can pipe/transform its SSE
 * body directly.
 */
export async function openDailyReportChatReplyStream({
  config,
  locale,
  chatHistory,
  userMessage,
}: {
  config: AiExtractionConfig;
  locale: AppLocale;
  chatHistory: ChatMessage[];
  userMessage: string;
}): Promise<Response> {
  const languageName = locale === "he" ? "Hebrew" : "English";

  const requestBody = {
    model: config.model,
    temperature: 0.4,
    stream: true,
    messages: [
      {
        role: "system",
        content: [
          "You are a warm, concise assistant helping a user log what they ate, drank, or exercised today in a Personal Health Companion app. This is a conversation only - your reply never saves anything by itself.",
          "Ask brief clarifying questions when a food/drink/exercise item is missing a rough quantity or detail needed to estimate nutrition (e.g. how much, what size, how long) - one or two questions at a time, not a long checklist.",
          "SCOPE CHECK: only what the user ate, drank, or did for exercise/activity today is in scope. If the user asks about something unrelated (targets, general chit-chat, unrelated advice), warmly redirect them to describe something they ate, drank, or did today instead.",
          "SAFETY CHECK: if the user describes consuming something that is not actually food/drink and would be dangerous or harmful (e.g. fuel, cleaning products, poison, batteries, or other inedible/hazardous items), do not treat it as a loggable item - tell them plainly it is not food and, if they actually consumed it, to seek medical attention or contact a poison control center right away.",
          "MARKER (required): your response must start with exactly one of the two literal tokens 'ACTIONABLE ' or 'INFO ' (the word, then a single space), before anything else - no exceptions, this is machine-parsed and stripped before the user ever sees it. Use 'ACTIONABLE ' only when the conversation so far (this message plus prior turns) describes at least one concrete food, drink, or exercise item with enough detail (item + rough quantity/duration) to log as a daily report entry right now. Use 'INFO ' for everything else: a clarifying question you're asking, an off-topic redirect, a safety warning, or small talk. Never write the word ACTIONABLE or INFO anywhere else in your reply.",
          "Reply in 1-3 short sentences, conversationally - not a list, not JSON, no markdown. Address the user directly in second person (\"you\"/\"your\"), never third person.",
        ].join(" "),
      },
      ...chatHistory.map((message) => ({ role: message.role, content: message.content })),
      {
        role: "user",
        content: [`Reply in ${languageName} only.`, "user_message:", userMessage.slice(0, 1000)].join("\n"),
      },
    ],
  };

  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = normalizedBaseUrl.endsWith("/v1") ? `${normalizedBaseUrl}/chat/completions` : `${normalizedBaseUrl}/v1/chat/completions`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
}
