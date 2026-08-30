import type { AiExtractionConfig } from "@/lib/ai/env";
import type { DailyReportMetrics } from "@/lib/daily-report";
import type { AppLocale } from "@/lib/locale";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type DailyReportChatProfile = {
  dietary_preference: string | null;
  allergies: string[] | null;
  medical_conditions: string[] | null;
  medical_conditions_details: string | null;
  regular_medications_details: string | null;
  pregnancy_lactation_status: string | null;
};

export type DailyReportChatTargets = {
  calories_min: number | null;
  calories_max: number | null;
  protein_min_g: number | null;
  protein_max_g: number | null;
  carbs_min_g: number | null;
  carbs_max_g: number | null;
  fats_min_g: number | null;
  fats_max_g: number | null;
  fiber_min_g: number | null;
  fiber_max_g: number | null;
  water_min_ml: number | null;
  water_max_ml: number | null;
  sodium_min_mg: number | null;
  sodium_max_mg: number | null;
  added_sugar_min_g: number | null;
  added_sugar_max_g: number | null;
  calcium_min_mg: number | null;
  calcium_max_mg: number | null;
  vit_c_min_mg: number | null;
  vit_c_max_mg: number | null;
  vit_b12_min_mcg: number | null;
  vit_b12_max_mcg: number | null;
  vit_d_min_mcg: number | null;
  vit_d_max_mcg: number | null;
  sat_fat_min_g: number | null;
  sat_fat_max_g: number | null;
  omega3_min_g: number | null;
  omega3_max_g: number | null;
} | null;

function buildProfileSummary(profile: DailyReportChatProfile): string {
  return [
    `dietary_preference: ${profile.dietary_preference ?? "unknown"}`,
    `allergies: ${profile.allergies?.join(", ") || "none"}`,
    `medical_conditions: ${profile.medical_conditions?.join(", ") || "none"}${
      profile.medical_conditions_details ? ` (${profile.medical_conditions_details})` : ""
    }`,
    `medications: ${profile.regular_medications_details || "none"}`,
    `pregnancy_lactation_status: ${profile.pregnancy_lactation_status ?? "none"}`,
  ].join("\n");
}

function buildTargetsSummary(targets: DailyReportChatTargets): string {
  if (!targets) return "no active targets set";
  return [
    `calories: ${targets.calories_min ?? 0}-${targets.calories_max ?? 0} kcal`,
    `protein: ${targets.protein_min_g ?? 0}-${targets.protein_max_g ?? 0} g`,
    `carbs: ${targets.carbs_min_g ?? 0}-${targets.carbs_max_g ?? 0} g`,
    `fats: ${targets.fats_min_g ?? 0}-${targets.fats_max_g ?? 0} g`,
    `fiber: ${targets.fiber_min_g ?? 0}-${targets.fiber_max_g ?? 0} g`,
    `water: ${targets.water_min_ml ?? 0}-${targets.water_max_ml ?? 0} ml`,
    `sodium: ${targets.sodium_min_mg ?? 0}-${targets.sodium_max_mg ?? 0} mg`,
    `added sugar: ${targets.added_sugar_min_g ?? 0}-${targets.added_sugar_max_g ?? 0} g`,
    `calcium: ${targets.calcium_min_mg ?? 0}-${targets.calcium_max_mg ?? 0} mg`,
    `vitamin C: ${targets.vit_c_min_mg ?? 0}-${targets.vit_c_max_mg ?? 0} mg`,
    `vitamin B12: ${targets.vit_b12_min_mcg ?? 0}-${targets.vit_b12_max_mcg ?? 0} mcg`,
    `vitamin D: ${targets.vit_d_min_mcg ?? 0}-${targets.vit_d_max_mcg ?? 0} mcg`,
    `saturated fat: ${targets.sat_fat_min_g ?? 0}-${targets.sat_fat_max_g ?? 0} g`,
    `omega-3: ${targets.omega3_min_g ?? 0}-${targets.omega3_max_g ?? 0} g`,
  ].join("\n");
}

function buildTodaysTotalsSummary(totals: DailyReportMetrics): string {
  return [
    `calories so far: ${totals.caloriesKcal} kcal`,
    `protein so far: ${totals.proteinG} g`,
    `carbs so far: ${totals.carbsG} g`,
    `fats so far: ${totals.fatG} g`,
    `fiber so far: ${totals.fiberG} g`,
    `water so far: ${totals.waterMl} ml`,
    `sodium so far: ${totals.sodiumMg} mg`,
    `added sugar so far: ${totals.addedSugarG} g`,
    `calcium so far: ${totals.calciumMg} mg`,
    `vitamin C so far: ${totals.vitCMg} mg`,
    `vitamin B12 so far: ${totals.vitB12Mcg} mcg`,
    `vitamin D so far: ${totals.vitDMcg} mcg`,
    `saturated fat so far: ${totals.satFatG} g`,
    `omega-3 so far: ${totals.omega3G} g`,
    `exercise so far: ${totals.exerciseMinutes} minutes, ~${totals.estimatedBurnKcal} kcal burned`,
  ].join("\n");
}

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
  profile,
  targets,
  todaysTotals,
}: {
  config: AiExtractionConfig;
  locale: AppLocale;
  chatHistory: ChatMessage[];
  userMessage: string;
  /** A photo attached to this specific turn, if any - not resent on later
   * turns since the reflection already happened once. */
  imageBase64?: string;
  mimeType?: string;
  profile: DailyReportChatProfile;
  targets: DailyReportChatTargets;
  todaysTotals: DailyReportMetrics;
}): Promise<Response> {
  const languageName = locale === "he" ? "Hebrew" : "English";

  const userContentText = [
    `Reply in ${languageName} only.`,
    "user_profile_summary:",
    buildProfileSummary(profile),
    "daily_targets_summary:",
    buildTargetsSummary(targets),
    "todays_logged_totals_summary (already logged today, computed by the app - trust these numbers, don't ask the user to repeat them):",
    buildTodaysTotalsSummary(todaysTotals),
    "user_message:",
    userMessage.slice(0, 1000) || "(no text, see attached photo)",
  ].join("\n");

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
          "You are a warm, concise assistant helping a user log what they ate, drank, or exercised today in a Personal Health Companion app, and helping them plan the rest of their day to meet their targets. This is a conversation only - your reply never saves anything by itself; the user saves whenever they choose using a separate Save button.",
          "CONTEXT: every message includes user_profile_summary (dietary preference, allergies, medical conditions, pregnancy/lactation status), daily_targets_summary (this user's target ranges), and todays_logged_totals_summary (what they've already logged today so far, computed by the app). Always use this context instead of asking the user to repeat it - e.g. if they ask what to eat for lunch, compute their remaining needs yourself from daily_targets_summary minus todays_logged_totals_summary and suggest something concrete that fits, taking dietary_preference and allergies/medical_conditions into account.",
          "SCOPE: in scope is (a) logging what the user ate/drank/exercised, and (b) planning/suggestion questions about nutrition, meals, hydration, or exercise for the rest of today, grounded in the context above. If the user asks about something unrelated to nutrition/exercise/health (e.g. a career goal, general chit-chat, changing their targets), warmly redirect them to describe something they ate/drank/did, or ask a nutrition/exercise planning question instead.",
          "CLARIFYING QUESTIONS: ask brief clarifying questions when a food/drink/exercise item is missing a rough quantity or detail needed to estimate nutrition (e.g. how much, what size, how long) - one or two questions at a time, not a long checklist. Every time you ask such a question, also explicitly tell the user in the same reply that they don't have to answer - they can just save now and you'll use a reasonable estimate. Never leave a reply as a bare question with no mention that saving now is already fine.",
          "PHOTO CHECK: if this message includes an attached photo, look at it and identify each distinct food or drink item you can see, with a rough portion-size estimate, then ask only if something is genuinely unclear or you'd like the user to confirm a detail (again, making clear saving now is already an option) - otherwise say plainly that they can save it now as is. If the photo is too blurry, dark, cropped, or otherwise unclear to identify reliably, say so plainly and ask for a clearer photo or a text description instead - do not guess at an unreadable photo.",
          "SAFETY CHECK: if the user describes or the photo shows consuming something that is not actually food/drink and would be dangerous or harmful (e.g. fuel, cleaning products, poison, batteries, or other inedible/hazardous items), do not treat it as a loggable item - tell them plainly it is not food and, if they actually consumed it, to seek medical attention or contact a poison control center right away. Also take medical_conditions and allergies into account: flag plainly if a food they mention or you suggest conflicts with a listed allergy or condition.",
          "MARKER (required): your response must start with exactly one of the two literal tokens 'ACTIONABLE ' or 'INFO ' (the word, then a single space), before anything else - no exceptions, this is machine-parsed and stripped before the user ever sees it. Use 'ACTIONABLE ' when the conversation so far (this message plus prior turns, including any photo) describes at least one concrete food, drink, or exercise item with enough detail (item + rough quantity/duration, or a clear photo) to log right now, even if you're also asking an optional follow-up question. Use 'INFO ' for everything else: an unclear/unreadable photo, a clarifying question with no loggable detail yet, a planning/suggestion answer with nothing new to log, an off-topic redirect, a safety warning, or small talk. Never write the word ACTIONABLE or INFO anywhere else in your reply.",
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
