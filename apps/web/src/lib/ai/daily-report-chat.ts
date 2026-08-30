import type { AiExtractionConfig } from "@/lib/ai/env";
import type { AppLocale } from "@/lib/locale";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * Opens a raw streaming chat-completions request for a conversational reply
 * while the user describes their day in free text (optionally with a photo
 * attached to this turn). Mirrors openChatReplyStream in targets-chat.ts: the
 * model prefixes its reply with an 'ACTIONABLE '/'INFO ' marker (stripped
 * before the user sees it) so the client can show a light "ready to save"
 * hint without a second AI round-trip - saving itself always goes through
 * the normal report_text/meal_photo save action regardless of this marker.
 * Returns the raw fetch Response so the caller can pipe/transform its SSE
 * body directly.
 */
export async function openDailyReportChatReplyStream({
  config,
  locale,
  chatHistory,
  userMessage,
  imageBase64,
  mimeType,
}: {
  config: AiExtractionConfig;
  locale: AppLocale;
  chatHistory: ChatMessage[];
  userMessage: string;
  /** A photo attached to this specific turn, if any - not resent on later
   * turns since the reflection already happened once. */
  imageBase64?: string;
  mimeType?: string;
}): Promise<Response> {
  const languageName = locale === "he" ? "Hebrew" : "English";

  const userContentText = [`Reply in ${languageName} only.`, "user_message:", userMessage.slice(0, 1000) || "(no text, see attached photo)"].join(
    "\n",
  );

  const userMessageContent = imageBase64
    ? [
        { type: "text", text: userContentText },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
      ]
    : userContentText;

  const requestBody = {
    model: config.model,
    temperature: 0.4,
    stream: true,
    messages: [
      {
        role: "system",
        content: [
          "You are a warm, concise assistant helping a user log what they ate, drank, or exercised today in a Personal Health Companion app. This is a conversation only - your reply never saves anything by itself; the user saves whenever they choose using a separate Save button.",
          "Ask brief clarifying questions when a food/drink/exercise item is missing a rough quantity or detail needed to estimate nutrition (e.g. how much, what size, how long) - one or two questions at a time, not a long checklist.",
          "PHOTO CHECK: if this message includes an attached photo, look at it and identify each distinct food or drink item you can see, with a rough portion-size estimate, then ask only if something is genuinely unclear or you'd like the user to confirm a detail - otherwise say plainly that they can save it now as is. If the photo is too blurry, dark, cropped, or otherwise unclear to identify reliably, say so plainly and ask for a clearer photo or a text description instead - do not guess at an unreadable photo.",
          "SCOPE CHECK: only what the user ate, drank, or did for exercise/activity today is in scope. If the user asks about something unrelated (targets, general chit-chat, unrelated advice), warmly redirect them to describe something they ate, drank, or did today instead.",
          "SAFETY CHECK: if the user describes or the photo shows consuming something that is not actually food/drink and would be dangerous or harmful (e.g. fuel, cleaning products, poison, batteries, or other inedible/hazardous items), do not treat it as a loggable item - tell them plainly it is not food and, if they actually consumed it, to seek medical attention or contact a poison control center right away.",
          "MARKER (required): your response must start with exactly one of the two literal tokens 'ACTIONABLE ' or 'INFO ' (the word, then a single space), before anything else - no exceptions, this is machine-parsed and stripped before the user ever sees it. Use 'ACTIONABLE ' when the conversation so far (this message plus prior turns, including any photo) describes at least one concrete food, drink, or exercise item with enough detail (item + rough quantity/duration) to log right now - this includes a clear, readable photo you just identified, even if you're also asking an optional follow-up question. Use 'INFO ' for everything else: an unclear/unreadable photo, a clarifying question with no loggable detail yet, an off-topic redirect, a safety warning, or small talk. Never write the word ACTIONABLE or INFO anywhere else in your reply.",
          "Reply in 1-3 short sentences, conversationally - not a list, not JSON, no markdown. Address the user directly in second person (\"you\"/\"your\"), never third person.",
        ].join(" "),
      },
      ...chatHistory.map((message) => ({ role: message.role, content: message.content })),
      {
        role: "user",
        content: userMessageContent,
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
