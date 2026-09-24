"use server";

import { redirect } from "next/navigation";

import { negotiateProfileChatChangeAction } from "@/app/app/profile/chat-actions";
import { negotiateActiveTargetsAction } from "@/app/app/targets/plan-actions";
import { classifyChatDomain, type ChatDomain } from "@/lib/ai/chat-router";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { parseDailyReportWithAi } from "@/lib/ai/daily-report";
import { answerHelpQuestion, type HelpTicketDraft } from "@/lib/ai/help-chat";
import { detectDangerousSubstance, parseDailyReportText } from "@/lib/daily-report";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import type { ProfileDiffRow, TargetGenerationPayload } from "@/lib/targets";

export type ChatRouterResult =
  | { error: string }
  | {
      domain: "targets";
      reply: string;
      changed: boolean;
      quickApplied?: boolean;
      payload?: TargetGenerationPayload;
      source?: "ai" | "heuristic";
      goalText?: string;
    }
  | {
      domain: "daily_report";
      reply: string;
      /** Whether this actually got saved as a new entry - false for a
       * declined dangerous-substance report, or a message that turned out
       * to have nothing loggable in it (matches saveDailyReportAction's
       * own "add something" behavior, just answered conversationally
       * instead of as a form validation error). */
      logged: boolean;
    }
  | {
      domain: "profile";
      reply: string;
      changed: boolean;
      /** Present only when changed - the caller shows this as a diff card
       * with Apply/Discard, then sends patch back via
       * applyProfileChatChangeAction verbatim if the user taps Apply. */
      patch?: Record<string, unknown>;
      diffRows?: ProfileDiffRow[];
    }
  | {
      domain: "help";
      reply: string;
      /** A whitelisted in-app path (see HELP_LINK_PATHS) the caller can
       * render as a clickable link, or null. */
      link: string | null;
      /** Present when the message read as a bug report or feature
       * request - the caller shows this as a preview card with a Submit
       * button, then sends it back verbatim to submitTicketFromChatAction
       * if the user taps it. */
      ticketDraft: HelpTicketDraft | null;
    };

/**
 * The unified chat's own router (see the app-wide-chat redesign
 * discussion): classifies which domain a message belongs to, then
 * delegates to that domain's own already-hardened handler -
 * negotiateActiveTargetsAction for targets and negotiateProfileChatChangeAction
 * for profile, both reused as-is; a deliberately minimal daily-report
 * logger here (parse + insert only - no weight-sync-to-profile, no
 * custom-target reconciliation, no editing an existing entry; those stay
 * the full Daily Report page's own features, not duplicated here); and
 * answerHelpQuestion for how-to questions and conversational ticket
 * filing.
 */
export async function routeChatMessageAction({
  message,
  currentScreen,
}: {
  message: string;
  currentScreen: ChatDomain;
}): Promise<ChatRouterResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const trimmed = message.trim();
  const { data: profileRow } = await supabase
    .from("user_profile")
    .select("preferred_language, weight_kg")
    .eq("user_id", user.id)
    .maybeSingle();
  const locale = normalizeLocale(profileRow?.preferred_language);

  if (!trimmed) {
    return { error: tr(locale, "Type a message first.", "יש להקליד הודעה קודם.") };
  }

  const aiConfig = getAiExtractionConfig();
  const domain: ChatDomain = aiConfig
    ? (await classifyChatDomain({ config: aiConfig, message: trimmed, currentScreen, locale })).domain
    : currentScreen; // No AI configured at all - fall back to wherever the chat was opened from rather than failing outright.

  if (domain === "targets") {
    const result = await negotiateActiveTargetsAction({ message: trimmed });
    if ("error" in result) return { error: result.error };
    return {
      domain: "targets",
      reply: result.reply,
      changed: result.changed,
      quickApplied: result.quickApplied,
      payload: result.payload,
      source: result.source,
      goalText: trimmed,
    };
  }

  if (domain === "profile") {
    const result = await negotiateProfileChatChangeAction({ message: trimmed });
    if ("error" in result) return { error: result.error };
    return { domain: "profile", reply: result.reply, changed: result.changed, patch: result.patch, diffRows: result.diffRows };
  }

  if (domain === "help") {
    if (!aiConfig) {
      return { error: tr(locale, "AI is not available right now. Please try again later.", "בינה מלאכותית אינה זמינה כעת. יש לנסות שוב מאוחר יותר.") };
    }
    try {
      const result = await answerHelpQuestion({ config: aiConfig, message: trimmed, locale, currentScreen });
      return { domain: "help", reply: result.reply, link: result.link, ticketDraft: result.ticketDraft };
    } catch (err) {
      logServerError("chat.answerHelp", "ai_call_failed", {
        userId: user.id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
      return { error: tr(locale, "Something went wrong answering that. Please try again.", "משהו השתבש במענה. יש לנסות שוב.") };
    }
  }

  return logDailyReportFromChat({ supabase, userId: user.id, locale, weightKg: Number(profileRow?.weight_kg ?? 0), message: trimmed, aiConfig });
}

/**
 * Deliberately minimal: parses the message the same way the full Daily
 * Report save flow does (AI when available, heuristic fallback otherwise)
 * and inserts one straightforward entry - no merging with saved-list
 * picks, no custom-target values, no weight-sync-back-to-profile. Those
 * stay page-specific features on Daily Report itself; this covers the
 * common "log this from wherever I am" case the unified chat is for.
 */
async function logDailyReportFromChat({
  supabase,
  userId,
  locale,
  weightKg,
  message,
  aiConfig,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  locale: AppLocale;
  weightKg: number;
  message: string;
  aiConfig: ReturnType<typeof getAiExtractionConfig>;
}): Promise<ChatRouterResult> {
  const dangerousTerm = detectDangerousSubstance(message);
  if (dangerousTerm) {
    return {
      domain: "daily_report",
      logged: false,
      reply: tr(
        locale,
        `⚠️ "${dangerousTerm}" is not food or a beverage and can be dangerous to consume. This wasn't logged. If you actually consumed this, please seek medical attention or contact a poison control center right away.`,
        `⚠️ "${dangerousTerm}" אינו מזון או משקה ועלול להיות מסוכן לצריכה. הפריט לא נרשם. אם אכן צרכת זאת, פנה/י מיד לעזרה רפואית או למרכז המידע לארס והרעלות.`,
      ),
    };
  }

  const parsed = aiConfig
    ? await parseDailyReportWithAi({ config: aiConfig, reportText: message, weightKg, locale }).catch((error) => {
        logServerError("chat.logDailyReport", "ai_parse_failed", { userId, error: error instanceof Error ? error.message : String(error) });
        return null;
      })
    : null;
  const result = parsed ?? parseDailyReportText({ reportText: message, weightKg });

  if (result.isDangerous) {
    return {
      domain: "daily_report",
      logged: false,
      reply:
        result.dangerReason ||
        tr(
          locale,
          "This wasn't logged - it describes something that isn't food or a beverage and could be dangerous. If you actually consumed this, please seek medical attention right away.",
          "הפריט לא נרשם - הוא מתאר משהו שאינו מזון או משקה ועלול להיות מסוכן. אם אכן צרכת זאת, יש לפנות מיד לעזרה רפואית.",
        ),
    };
  }

  if (result.foodItems.length === 0 && result.exerciseItems.length === 0) {
    return {
      domain: "daily_report",
      logged: false,
      reply: tr(
        locale,
        "I couldn't find anything to log in that - try describing what you ate, drank, or did for exercise.",
        "לא הצלחתי למצוא משהו לרישום בהודעה הזו - נסו לתאר מה אכלתם, שתיתם או עשיתם כפעילות גופנית.",
      ),
    };
  }

  const m = result.metrics;
  const { error: insertError } = await supabase.from("user_daily_reports").insert({
    user_id: userId,
    raw_report_text: message,
    report_at: new Date().toISOString(),
    status: result.requiresConfirmation ? "needs_confirmation" : "confirmed",
    parse_confidence: result.confidence,
    requires_confirmation: result.requiresConfirmation,
    confirmed_at: result.requiresConfirmation ? null : new Date().toISOString(),
    calories_kcal: Math.round(m.caloriesKcal),
    protein_g: Math.round(m.proteinG),
    carbs_g: Math.round(m.carbsG),
    fat_g: Math.round(m.fatG),
    fiber_g: Math.round(m.fiberG),
    water_ml: Math.round(m.waterMl),
    magnesium_mg: Math.round(m.magnesiumMg),
    potassium_mg: Math.round(m.potassiumMg),
    iron_mg: Math.round(m.ironMg),
    zinc_mg: Math.round(m.zincMg),
    sodium_mg: Math.round(m.sodiumMg),
    added_sugar_g: Math.round(m.addedSugarG),
    calcium_mg: Math.round(m.calciumMg),
    vit_c_mg: Math.round(m.vitCMg),
    vit_b12_mcg: Math.round(m.vitB12Mcg),
    vit_d_mcg: Math.round(m.vitDMcg),
    sat_fat_g: Math.round(m.satFatG),
    omega3_g: Math.round(m.omega3G),
    cholesterol_mg: Math.round(m.cholesterolMg),
    exercise_minutes: Math.round(m.exerciseMinutes),
    estimated_burn_kcal: Math.round(m.estimatedBurnKcal),
    parsed_items: result.foodItems,
    parsed_exercises: result.exerciseItems,
  });

  if (insertError) {
    logServerError("chat.logDailyReport", "insert_failed", { userId, error: insertError.message });
    return { error: tr(locale, "Could not save that. Please try again.", "לא ניתן היה לשמור זאת. יש לנסות שוב.") };
  }

  const loggedNames = [...result.foodItems.map((item) => item.name), ...result.exerciseItems.map((item) => item.name)];
  return {
    domain: "daily_report",
    logged: true,
    reply: tr(
      locale,
      `✓ Logged: ${loggedNames.join(", ")}.`,
      `✓ נרשם: ${loggedNames.join(", ")}.`,
    ),
  };
}
