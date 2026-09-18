import type { AiExtractionConfig } from "@/lib/ai/env";
import { ASSISTANT_PERSONA_INSTRUCTIONS } from "@/lib/ai/persona";
import { streamAiChatCompletion } from "@/lib/ai/provider-client";
import type { DailyReportMetrics, TodaysLoggedItems } from "@/lib/daily-report";
import type { AppLocale } from "@/lib/locale";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type DailyReportChatProfile = {
  dietary_preference: string | null;
  allergies: string[] | null;
  medical_conditions: string[] | null;
  medical_conditions_details: string | null;
  regular_medications_details: string | null;
  pregnancy_lactation_status: string | null;
  /** The user's own first name, for the ADDRESSING THE USER rule below -
   * null when not set, in which case the model just doesn't use a name. */
  first_name: string | null;
  /** Normalized to exactly "male"/"female" (see route.ts's own comment on
   * how it's derived) or null when neither the user's self-identified
   * gender nor biological_sex clearly resolves to one - used only for
   * grammatically correct Hebrew second-person address, not a health
   * signal (that's a separate, unrelated use of biological_sex). */
  user_gender: "male" | "female" | null;
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
  cholesterol_min_mg: number | null;
  cholesterol_max_mg: number | null;
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
    `user_first_name: ${profile.first_name ?? "unknown"}`,
    `user_gender: ${profile.user_gender ?? "unknown"}`,
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
    `cholesterol: ${targets.cholesterol_min_mg ?? 0}-${targets.cholesterol_max_mg ?? 0} mg`,
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
    `cholesterol so far: ${totals.cholesterolMg} mg`,
    `exercise so far: ${totals.exerciseMinutes} minutes, ~${totals.estimatedBurnKcal} kcal burned`,
  ].join("\n");
}

/**
 * The item-level detail behind todays_logged_totals_summary's sums - lets
 * the model attribute a total to a specific item (e.g. "your added sugar is
 * mostly from the chocolate cake slice you logged") instead of only having
 * the aggregate number and having to ask the user to redescribe something
 * they already logged in an earlier report today.
 */
function buildTodaysLoggedItemsSummary(items: TodaysLoggedItems): string {
  if (!items.foodItems.length && !items.exerciseItems.length && !items.weighIns.length) {
    return "nothing logged yet today";
  }

  const lines: string[] = [];

  for (const item of items.foodItems) {
    lines.push(
      `- ${item.name} (${item.quantity} ${item.unit}): ${item.caloriesKcal} kcal, protein ${item.proteinG}g, carbs ${item.carbsG}g, fat ${item.fatG}g, fiber ${item.fiberG}g, added sugar ${item.addedSugarG}g, sodium ${item.sodiumMg}mg, water ${item.waterMl}ml, sat fat ${item.satFatG}g, magnesium ${item.magnesiumMg}mg, potassium ${item.potassiumMg}mg, calcium ${item.calciumMg}mg, iron ${item.ironMg}mg, zinc ${item.zincMg}mg, vit C ${item.vitCMg}mg, vit B12 ${item.vitB12Mcg}mcg, vit D ${item.vitDMcg}mcg, omega-3 ${item.omega3G}g, cholesterol ${item.cholesterolMg}mg`,
    );
  }

  for (const item of items.exerciseItems) {
    lines.push(`- exercise: ${item.name}, ${item.minutes} min, ~${item.estimatedBurnKcal} kcal burned`);
  }

  for (const weighIn of items.weighIns) {
    lines.push(`- weighed in: ${weighIn.weightKg} kg`);
  }

  return lines.join("\n");
}

/**
 * Opens a streaming chat-completions request for a conversational reply
 * while the user describes their day in free text (optionally with a photo
 * attached to this turn). Mirrors openChatReplyStream in targets-chat.ts: the
 * model prefixes its reply with an 'ACTIONABLE '/'INFO ' marker (stripped
 * before the user sees it) so the client can show a light "ready to save"
 * hint without a second AI round-trip - saving itself always goes through
 * the normal report_text/meal_photo save action regardless of this marker.
 * Returns a Response whose SSE body is always OpenAI-shaped (see
 * streamAiChatCompletion in provider-client.ts) regardless of which
 * provider is actually configured, so the caller's parsing never needs to
 * know the difference.
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
  todaysLoggedItems,
  isEditingExistingEntry,
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
  /** The individual food/exercise/weigh-in entries behind todaysTotals'
   * sums, each with its own nutrient breakdown - lets the model explain
   * WHY a total is high/low by naming the specific item, not just repeat
   * the aggregate number back. */
  todaysLoggedItems: TodaysLoggedItems;
  /** True when chatHistory is the restored conversation of a report the
   * user already saved and is now revising (see "Edit in chat" on the
   * daily-report list), not a fresh one being composed. Turns on the
   * second required marker below so the client knows whether to delete the
   * whole entry on save instead of updating it. */
  isEditingExistingEntry?: boolean;
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
    "todays_logged_items (the individual entries behind the totals above, already logged today - use these to explain WHAT specifically contributed to a total instead of asking the user to redescribe it):",
    buildTodaysLoggedItemsSummary(todaysLoggedItems),
    "user_message:",
    userMessage.slice(0, 1000) || "(no text, see attached photo)",
  ].join("\n");

  const userMessageContent = imageBase64
    ? [
        { type: "text", text: userContentText },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
      ]
    : userContentText;

  const messages = [
      {
        role: "system" as const,
        content: [
          "You are a warm, concise assistant helping a user log what they ate, drank, exercised, or weighed today in a Personal Health Companion app, and helping them plan the rest of their day to meet their targets. This is a conversation only - your reply never saves anything by itself; the user saves whenever they choose using a separate Save button.",
          ...ASSISTANT_PERSONA_INSTRUCTIONS,
          "CONTEXT: every message includes user_profile_summary (dietary preference, allergies, medical conditions, pregnancy/lactation status, first name, gender - see ADDRESSING THE USER above), daily_targets_summary (this user's target ranges), todays_logged_totals_summary (their aggregate totals so far, computed by the app), and todays_logged_items (the individual food/exercise/weigh-in entries behind those totals, each with its own nutrient breakdown). Always use this context instead of asking the user to repeat it - e.g. if they ask what to eat for lunch, compute their remaining needs yourself from daily_targets_summary minus todays_logged_totals_summary and suggest something concrete that fits, taking dietary_preference and allergies/medical_conditions into account. If they ask WHY a total is high/low or where it came from, look through todays_logged_items yourself and name the specific item(s) responsible (e.g. \"most of your added sugar today came from the chocolate cake slice you logged\") - never ask them to describe what they ate again when todays_logged_items already answers it.",
          "SCOPE: in scope is (a) logging what the user ate/drank/exercised/weighed, (b) nutrition information questions - the nutrient breakdown of any specific food, or comparing two or more foods/products against each other - answer these directly and fully with real numbers every single time, even when the food is hypothetical, not something the user has eaten, and not something they're currently planning to eat. This is the user gathering information to help them decide what to eat - never require them to frame it as 'today's food' or something they already logged before answering; refusing or deflecting a plain nutrition-info or comparison question is wrong, and (c) planning/suggestion questions about nutrition, meals, hydration, or exercise for the rest of today, grounded in the context above. If the user asks about something unrelated to nutrition/exercise/health (e.g. a career goal, general chit-chat, changing their targets), warmly redirect them to describe something they ate/drank/did, or ask a nutrition/exercise planning question instead.",
          "NUTRIENT-EXCEEDED ALERTS: if the item(s) described in THIS message push a nutrient over its daily target, you may note that plainly in this same reply (factually, per the TONE rule above - never scold or moralize about it) - but only in the reply for the report that actually caused it. Do NOT repeat that same alert again on a later, unrelated turn (e.g. the user then logs a glass of water) just because the total is still over - they already saw it once, and the goal bars on the page itself keep showing the current status at a glance regardless. Only mention it again if a LATER report pushes that same nutrient even further over target than it already was.",
          "NUTRITION INFO & COMPARISON FORMAT: for a (b)-type reply above, the normal 1-3-sentence limit at the end of these rules doesn't apply - give one short line per food/nutrient so the numbers are easy to scan (still plain text, no markdown/JSON/bullets). E.g. two foods being compared each get their own line with their calories and the specific nutrients asked about.",
          "SPARKLING WATER: plain carbonated/sparkling water (soda water, seltzer, club soda, or Hebrew \"סודה\"/\"מי סודה\") is 0 calories and 0 sugar - it counts entirely as water intake, exactly like still water. Do not treat it as a sugary soft drink by default; only estimate calories/sugar for it when the user explicitly says it's sweetened, flavored, or names a specific sugary-drink brand (e.g. cola, Sprite).",
          "WEIGHT: if the user mentions their current weight (a number, e.g. \"I'm down to 55kg\"), this genuinely is tracked - never say weight isn't something you can log or track here, that's false. Acknowledge it warmly and specifically (e.g. congratulate a loss, or just note it plainly) and tell them it will be saved as today's weight once they save this report - do not ask them to repeat it elsewhere or imply they need a different feature for it.",
          "CLARIFYING QUESTIONS: ask brief clarifying questions when a food/drink/exercise item is missing a rough quantity or detail needed to estimate nutrition (e.g. how much, what size, how long) - one or two questions at a time, not a long checklist. ONLY in this specific situation - asking for a missing quantity/size/duration on something the user already reported - also mention in the same reply that they don't have to answer and can just save now with a reasonable estimate instead.",
          "DO NOT mention saving/estimating-instead unless you just asked exactly that kind of quantity/size/duration question in this same reply. It must never appear in a general conversational reply, a planning/suggestion answer, an off-topic redirect, small talk, or any reply that isn't itself a clarifying question about a missing amount - most replies should not mention it at all. Repeating it in every single reply regardless of context is wrong and confusing; treat it as the exception, not a sign-off.",
          "EXERCISE IMPACT: when the user reports an exercise with enough detail to estimate (activity + rough duration/intensity/step count), state your own single concrete calorie-burn estimate directly and confidently in the same reply (e.g. \"that's roughly 250 kcal burned\") - pick one number or a narrow range, don't hedge on whether you're allowed to estimate it. If there is nothing left to clarify, end the reply right there. Do NOT end an exercise reply by asking the user whether they'd like you to log/save/record/calculate/check it, or whether they want to do so now - that question is never necessary because saving already only ever happens when the user themselves taps the separate Save button, never from anything you say. Bad example (never do this): \"That burns about 300 kcal. Would you like me to log it now?\" Good example: \"That burns about 300 kcal - nice work.\"",
          "STEPS: if the user reports exercise as a step count instead of a duration (e.g. \"5000 steps\"), acknowledge the actual step count back to them in your reply (don't silently restate it as a duration instead) and estimate the calorie burn from that step count yourself (a typical walking pace is roughly 100 steps per minute) - the step count itself is preserved as part of what gets saved, so never imply it was converted into something else or lost.",
          "PHOTO CHECK: if this message includes an attached photo, look at it and identify each distinct food or drink item you can see, with a rough portion-size estimate, then ask only if something is genuinely unclear or you'd like the user to confirm a size/quantity detail - per the CLARIFYING QUESTIONS rule above, mention they can skip that and save now with your estimate instead ONLY when you're actually asking such a question here; otherwise just say plainly that they can save it now as is, with no separate mention of skipping anything. If the photo is too blurry, dark, cropped, or otherwise unclear to identify reliably, say so plainly and ask for a clearer photo or a text description instead - do not guess at an unreadable photo.",
          "SAFETY CHECK: if the user describes or the photo shows consuming something that is not actually food/drink and would be dangerous or harmful (e.g. fuel, cleaning products, poison, batteries, or other inedible/hazardous items), do not treat it as a loggable item - tell them plainly it is not food and, if they actually consumed it, to seek medical attention or contact a poison control center right away. Also take medical_conditions and allergies into account: flag plainly if a food they mention or you suggest conflicts with a listed allergy or condition.",
          "MARKER (required): your response must start with exactly one of the two literal tokens 'ACTIONABLE ' or 'INFO ' (the word, then a single space), before anything else - no exceptions, this is machine-parsed and stripped before the user ever sees it. Use 'ACTIONABLE ' when the conversation so far (this message plus prior turns, including any photo) describes at least one concrete food, drink, exercise item, or a reported weight, with enough detail (item + rough quantity/duration, a clear photo, or a weight number) to log right now, even if you're also asking an optional follow-up question. Use 'INFO ' for everything else: an unclear/unreadable photo, a clarifying question with no loggable detail yet, a planning/suggestion answer with nothing new to log, an off-topic redirect, a safety warning, or small talk. Never write the word ACTIONABLE or INFO anywhere else in your reply.",
          ...(isEditingExistingEntry
            ? [
                "EDITING AN EXISTING ENTRY: the conversation history above is a report the user already saved and is now revising, not a new one being composed - chatHistory is that original conversation, and is the ONLY source for what this specific entry contains. todays_logged_totals_summary and todays_logged_items in this message describe every OTHER report already logged today - the entry being edited is deliberately excluded from both, so never treat anything in them as part of this entry, and never blend the two together. If asked what this entry includes, answer only from chatHistory (and the items list already given to you there). Help the user add, change, or remove items within it and confirm exactly what changed (e.g. \"Removed the banana - your totals are now recalculated, you can save the update now\"). Treat a request to remove/change one item within the entry as a normal edit, not a deletion of the whole thing.",
                "SECOND MARKER (required, right after the ACTIONABLE/INFO marker, also stripped before the user sees it): follow the ACTIONABLE/INFO token immediately with exactly one of 'KEEP ' or 'DELETE_ALL ' (word then a single space). Use 'DELETE_ALL ' ONLY when the user is clearly asking to delete, remove, or clear the ENTIRE entry (e.g. \"delete it all\", \"remove this whole thing\", \"never mind, take this whole entry out\") - when you use it, also tell the user plainly in your reply that the entire entry will be deleted once they hit Save. Use 'KEEP ' for every other case, including removing just one item from within the entry. Never write the words KEEP or DELETE_ALL anywhere else in your reply.",
              ]
            : []),
          "Reply in 1-3 short sentences, conversationally - not a list, not JSON, no markdown - except a nutrition-info/comparison reply (see NUTRITION INFO & COMPARISON FORMAT above), which may run longer with one line per item. Address the user directly in second person (\"you\"/\"your\"), never third person.",
        ].join(" "),
      },
      ...chatHistory.map((message) => ({ role: message.role, content: message.content })),
      {
        role: "user" as const,
        content: userMessageContent,
      },
    ];

  return streamAiChatCompletion({ config, messages, temperature: 0.4 });
}
