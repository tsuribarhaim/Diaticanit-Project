import { computeBmi } from "@/lib/bmi";
import type { AiExtractionConfig } from "@/lib/ai/env";
import { ASSISTANT_PERSONA_INSTRUCTIONS, resolveUserGenderForAddressing } from "@/lib/ai/persona";
import { streamAiChatCompletion } from "@/lib/ai/provider-client";
import type { AppLocale } from "@/lib/locale";
import type { ProfileForTargets, TargetGenerationPayload } from "@/lib/targets";

export type ChatMessage = { role: "user" | "assistant"; content: string };

function buildProfileSummary(profile: ProfileForTargets): string {
  const currentBmi = computeBmi(profile.weight_kg, profile.height_cm);
  const userGender = resolveUserGenderForAddressing(profile.gender, profile.biological_sex);
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
    `user_first_name: ${profile.first_name?.trim() || "unknown"}`,
    `user_gender: ${userGender ?? "unknown"}`,
  ].join("\n");
}

function summarizeTargets(payload: TargetGenerationPayload): string {
  const totalExerciseFrequency = payload.exerciseTargets.reduce((sum, entry) => sum + entry.frequencyPerWeek, 0);
  const userTargetsSummary = payload.userTargets.length
    ? payload.userTargets.map((entry) => `${entry.label}: ${entry.value}`).join(", ")
    : "none";
  return [
    `calories: ${payload.caloriesMin}-${payload.caloriesMax} kcal`,
    `protein: ${payload.proteinMinG}-${payload.proteinMaxG} g`,
    `carbs: ${payload.carbsMinG}-${payload.carbsMaxG} g`,
    `fats: ${payload.fatsMinG}-${payload.fatsMaxG} g`,
    `water: ${payload.waterMinMl}-${payload.waterMaxMl} ml`,
    `total weekly exercise frequency: ${totalExerciseFrequency}x`,
    `goal_type: ${payload.goalType}`,
    `other tracked targets (custom, logged daily): ${userTargetsSummary}`,
  ].join("\n");
}

/**
 * Opens a streaming chat-completions request for a short conversational
 * reply (2-3 sentences) acknowledging the user's negotiation message. This is
 * intentionally separate from the structured target-generation call
 * (generateTargetsWithAi) - it exists purely to drive the chat bubble's
 * "typing" effect. Returns a Response whose SSE body is always OpenAI-shaped
 * (see streamAiChatCompletion in provider-client.ts) regardless of which
 * provider is actually configured, so the caller's parsing never needs to
 * know the difference.
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
  // The literal button label the user sees on screen (see the "Update
  // Targets" button in targets-chat-workspace.tsx) - quoting the English
  // string here regardless of reply language would have the model drop an
  // English phrase into an otherwise-Hebrew sentence, which doesn't even
  // match what the button actually says in that locale.
  const updateTargetsLabel = locale === "he" ? "עדכון היעדים" : "Update Targets";

  const messages = [
      {
        role: "system" as const,
        content: [
          "You are a warm, concise nutrition and exercise coaching assistant chatting with a user about their locked daily targets. This is a conversation only - your reply never changes anything by itself, so just answer naturally: explain, advise, or discuss as asked.",
          ...ASSISTANT_PERSONA_INSTRUCTIONS,
          `If the user is describing something that genuinely calls for changing their targets (a new goal, a schedule change, a symptom, etc.) AND it is safe and reasonable, say so plainly and mention that they can tap "${updateTargetsLabel}" below whenever they're ready - don't imply the change has already happened.`,
          `TRACKING CAPABILITY (important - do not underclaim this): current_targets_summary's "other tracked targets" line lists any custom targets already being tracked. Any concrete, quantifiable, in-scope goal - sleep hours, step count, a supplement dose, anything expressed as a number with a unit - can be added the same way and becomes genuinely trackable once added: the app shows the user a matching numeric input in their Daily Report every day and shows real progress against it on their Home page, exactly like calories or protein already work. This is NOT limited to nutrition and exercise. If a user asks whether something like this can be tracked, or asks to add it, the honest answer is yes (as long as it's a concrete quantifiable health/wellbeing goal) - never tell them the app can't track it or that it only supports nutrition and exercise, and never claim a tracking limitation that isn't true.`,
          `SCOPE CHECK: only nutrition, exercise, sleep, hydration, weight, and closely related wellbeing topics can become a target here. If the user asks for something unrelated to health (e.g. becoming a millionaire, a relationship, a career goal), warmly acknowledge the sentiment, make clear Bites & Bytes can't set or track that kind of goal, and invite them to share a health-related goal instead. Do not mention "${updateTargetsLabel}" for an off-topic ask.`,
          `SAFETY CHECK: user_profile_summary includes height_cm, weight_kg, and current_bmi. If the user asks for a weight change, estimate the resulting BMI yourself (BMI = weight_kg / (height_cm/100)^2). A healthy adult BMI is roughly 18.5-24.9. If the resulting BMI would fall below about 18.5, and especially below about 16.5, say plainly that this specific target is not safe or realistic to pursue through this app, give a rough sense of why (the resulting BMI would be in an underweight/unsafe range), and suggest a smaller, healthier amount instead. Do not mention "${updateTargetsLabel}" for a request you flagged as unsafe - only once they name a safer amount.`,
          "PROFILE CONSISTENCY CHECK: user_profile_summary includes age and pregnancy_lactation_status among other fields. If the user's message clearly states something that factually contradicts a specific profile field (e.g. a different age, no longer being pregnant when the profile says pregnant, a medical condition or medication not reflected in the profile), point this out plainly in your reply - name both what the profile says and what they just said - and suggest they update their profile (or clarify their message if it was a mistake) so their targets stay accurate. Only flag a clear, specific contradiction, not vague or ambiguous wording. This does not change whether the reply is ACTIONABLE or INFO by itself - judge that independently based on the rules above.",
          `MARKER (required): your response must start with exactly one of the two literal tokens 'ACTIONABLE ' or 'INFO ' (the word, then a single space), before anything else - no exceptions, this is machine-parsed and stripped before the user ever sees it. Use 'ACTIONABLE ' only when the user's message describes a concrete, in-scope, safe-and-reasonable target change you would tell them to tap "${updateTargetsLabel}" for. Use 'INFO ' for everything else: questions, off-topic asks, unsafe asks, small talk, or anything that doesn't call for a target change. Never write the word ACTIONABLE or INFO anywhere else in your reply.`,
          `THE MARKER AND THE BUTTON MUST MATCH: the "${updateTargetsLabel}" button is only ever shown to the user when your reply is marked ACTIONABLE - an INFO reply never renders it, for any reason. So never mention tapping "${updateTargetsLabel}" in an INFO reply, not even conditionally ("if you'd like to make this permanent, tap...") - that would tell the user to press a button they cannot see. If the user's ask is concrete enough to invite that tap, it IS the concrete, in-scope, safe change described above, so mark it ACTIONABLE instead of hedging into INFO while still mentioning the button.`,
          "Reply in 1-3 short sentences, conversationally - not a list, not JSON, no markdown. Address the user directly in second person (\"you\"/\"your\"), never third person - see ADDRESSING THE USER above for the grammatically correct Hebrew second-person form to use.",
        ].join(" "),
      },
      ...chatHistory.map((message) => ({ role: message.role, content: message.content })),
      {
        role: "user" as const,
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
    ];

  return streamAiChatCompletion({ config, messages, temperature: 0.4 });
}
