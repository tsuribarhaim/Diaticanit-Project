import { computeBmi } from "@/lib/bmi";
import type { AiExtractionConfig } from "@/lib/ai/env";
import type { AppLocale } from "@/lib/locale";
import type { ProfileForTargets, TargetGenerationPayload } from "@/lib/targets";

export type ChatMessage = { role: "user" | "assistant"; content: string };

function buildProfileSummary(profile: ProfileForTargets): string {
  const currentBmi = computeBmi(profile.weight_kg, profile.height_cm);
  return [
    `age: ${profile.age}`,
    `biological_sex: ${profile.biological_sex ?? profile.gender ?? "unknown"}`,
    `height_cm: ${profile.height_cm}`,
    `weight_kg: ${profile.weight_kg}`,
    `current_bmi: ${currentBmi > 0 ? currentBmi.toFixed(1) : "unknown"}`,
    `activity_level: ${profile.activity_level}`,
    `medical_conditions: ${profile.medical_conditions.join(", ") || "none"}`,
    `medications: ${profile.regular_medications_details || "none"}`,
    `pregnancy_lactation_status: ${profile.pregnancy_lactation_status ?? "none"}`,
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
        content: [
          "You are a warm, concise nutrition and exercise coaching assistant chatting with a user about their locked daily targets. This is a conversation only - your reply never changes anything by itself, so just answer naturally: explain, advise, or discuss as asked.",
          "If the user is describing something that genuinely calls for changing their targets (a new goal, a schedule change, a symptom, etc.) AND it is safe and reasonable, say so plainly and mention that they can tap \"Update Targets\" below whenever they're ready - don't imply the change has already happened.",
          "SCOPE CHECK: only nutrition, exercise, sleep, hydration, weight, and closely related wellbeing topics can become a target here. If the user asks for something unrelated to health (e.g. becoming a millionaire, a relationship, a career goal), warmly acknowledge the sentiment, make clear Bites & Bytes can't set or track that kind of goal, and invite them to share a health-related goal instead. Do not mention \"Update Targets\" for an off-topic ask.",
          "SAFETY CHECK: user_profile_summary includes height_cm, weight_kg, and current_bmi. If the user asks for a weight change, estimate the resulting BMI yourself (BMI = weight_kg / (height_cm/100)^2). A healthy adult BMI is roughly 18.5-24.9. If the resulting BMI would fall below about 18.5, and especially below about 16.5, say plainly that this specific target is not safe or realistic to pursue through this app, give a rough sense of why (the resulting BMI would be in an underweight/unsafe range), and suggest a smaller, healthier amount instead. Do not mention \"Update Targets\" for a request you flagged as unsafe - only once they name a safer amount.",
          "PROFILE CONSISTENCY CHECK: user_profile_summary includes age and pregnancy_lactation_status among other fields. If the user's message clearly states something that factually contradicts a specific profile field (e.g. a different age, no longer being pregnant when the profile says pregnant, a medical condition or medication not reflected in the profile), point this out plainly in your reply - name both what the profile says and what they just said - and suggest they update their profile (or clarify their message if it was a mistake) so their targets stay accurate. Only flag a clear, specific contradiction, not vague or ambiguous wording. This does not change whether the reply is ACTIONABLE or INFO by itself - judge that independently based on the rules above.",
          "MARKER (required): your response must start with exactly one of the two literal tokens 'ACTIONABLE ' or 'INFO ' (the word, then a single space), before anything else - no exceptions, this is machine-parsed and stripped before the user ever sees it. Use 'ACTIONABLE ' only when the user's message describes a concrete, in-scope, safe-and-reasonable target change you would tell them to tap \"Update Targets\" for. Use 'INFO ' for everything else: questions, off-topic asks, unsafe asks, small talk, or anything that doesn't call for a target change. Never write the word ACTIONABLE or INFO anywhere else in your reply.",
          "Reply in 1-3 short sentences, conversationally - not a list, not JSON, no markdown. Address the user directly in second person (\"you\"/\"your\"), never third person, and never a gendered third-person construction even if the user's sex is known.",
        ].join(" "),
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
