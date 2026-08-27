import type { AiExtractionConfig } from "@/lib/ai/env";
import type { AppLocale } from "@/lib/locale";
import type { ProfileForTargets, TargetGenerationPayload } from "@/lib/targets";

export type ChatMessage = { role: "user" | "assistant"; content: string };

function buildProfileSummary(profile: ProfileForTargets): string {
  return [
    `age: ${profile.age}`,
    `biological_sex: ${profile.biological_sex ?? profile.gender ?? "unknown"}`,
    `weight_kg: ${profile.weight_kg}`,
    `activity_level: ${profile.activity_level}`,
    `medical_conditions: ${profile.medical_conditions.join(", ") || "none"}`,
    `medications: ${profile.regular_medications_details || "none"}`,
  ].join("\n");
}

function summarizeTargets(payload: TargetGenerationPayload): string {
  const totalExerciseFrequency = payload.exerciseTargets.reduce((sum, entry) => sum + entry.frequencyPerWeek, 0);
  return [
    `calories: ${payload.caloriesMin}-${payload.caloriesMax} kcal`,
    `protein: ${payload.proteinMinG}-${payload.proteinMaxG} g`,
    `carbs: ${payload.carbsMinG}-${payload.carbsMaxG} g`,
    `fats: ${payload.fatsMinG}-${payload.fatsMaxG} g`,
    `water: ${payload.waterMinMl}-${payload.waterMaxMl} ml`,
    `total weekly exercise frequency: ${totalExerciseFrequency}x`,
    `goal_type: ${payload.goalType}`,
  ].join("\n");
}

/**
 * Opens a raw streaming chat-completions request for a short conversational
 * reply (2-3 sentences) acknowledging the user's negotiation message. This is
 * intentionally separate from the structured target-generation call
 * (generateTargetsWithAi) - it exists purely to drive the chat bubble's
 * "typing" effect. Returns the raw fetch Response so the caller can pipe/
 * transform its SSE body directly.
 */
export async function openChatReplyStream({
  config,
  locale,
  profile,
  currentTargets,
  chatHistory,
  userMessage,
}: {
  config: AiExtractionConfig;
  locale: AppLocale;
  profile: ProfileForTargets;
  currentTargets: TargetGenerationPayload;
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
        content:
          "You are a warm, concise nutrition and exercise coaching assistant chatting with a user about adjusting their locked daily targets. Reply in 1-3 short sentences acknowledging what you're changing and why, conversationally - not a list, not JSON, no markdown. Address the user directly in second person (\"you\"/\"your\"), never third person, and never a gendered third-person construction even if the user's sex is known.",
      },
      ...chatHistory.map((message) => ({ role: message.role, content: message.content })),
      {
        role: "user",
        content: [
          `Reply in ${languageName} only.`,
          "current_targets_summary:",
          summarizeTargets(currentTargets),
          "user_profile_summary:",
          buildProfileSummary(profile),
          "user_message:",
          userMessage.slice(0, 1000),
        ].join("\n"),
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
