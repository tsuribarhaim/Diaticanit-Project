import { z } from "zod";

import { APP_HELP_CONTENT } from "@/lib/ai/help-content";
import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";
import type { AppLocale } from "@/lib/locale";
import { ticketAreaOptions, ticketPriorityOptions, ticketTypeOptions } from "@/lib/tickets";

/** Paths this chat is allowed to point a user to - a fixed whitelist
 * (rather than letting the AI invent any string) so a hallucinated route
 * never gets rendered as a clickable link. Keep in sync with
 * help-content.ts's own screen list. */
export const HELP_LINK_PATHS = [
  "/app",
  "/app/daily-report",
  "/app/daily-report/defaults",
  "/app/targets",
  "/app/profile",
  "/app/notifications",
  "/app/settings",
  "/app/tickets",
  "/app/tickets/new",
] as const;

const ticketDraftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  ticket_type: z.enum(ticketTypeOptions),
  area: z.enum(ticketAreaOptions),
  priority: z.enum(ticketPriorityOptions),
  description: z.string().trim().min(1).max(5000),
});

const answerSchema = z.object({
  reply: z.string().trim().min(1),
  link: z.string().trim().nullable().optional().default(null),
  ticketDraft: ticketDraftSchema.nullable().optional().default(null),
});

export type HelpTicketDraft = z.infer<typeof ticketDraftSchema>;

export type AnswerHelpQuestionResult = {
  reply: string;
  /** Validated against HELP_LINK_PATHS below - null if the AI didn't
   * suggest one, or suggested something outside the whitelist. */
  link: string | null;
  ticketDraft: HelpTicketDraft | null;
};

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

/**
 * The "help" domain's own negotiate step (Phase D) - answers "how do I..."
 * / "what is..." questions grounded in APP_HELP_CONTENT (never improvised),
 * and doubles as the entry point for filing a support ticket
 * conversationally: when the message reads as a bug report or feature
 * request, this drafts a full ticket (subject/type/area/priority/
 * description) for the caller to show as a preview card, rather than just
 * asking a clarifying question and stopping there (see the
 * ai-chat-context-grounding standing rule - always ground/attempt
 * something useful, never dead-end on a bare question). The user reviews
 * and submits it themselves via submitTicketFromChatAction below - this
 * function never writes anything.
 */
export async function answerHelpQuestion({
  config,
  message,
  locale,
  currentScreen,
}: {
  config: AiExtractionConfig;
  message: string;
  locale: AppLocale;
  /** Which app area the chat was opened from - used both as a hint for
   * link relevance and as the default `area` for a drafted ticket when
   * the message doesn't clearly point elsewhere. */
  currentScreen: string;
}): Promise<AnswerHelpQuestionResult> {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are Daffy, a health-tracking app's AI coach, answering a question about how the app itself works, or handling a bug report / feature request. Return strict JSON only, no markdown. Ground every factual claim about the app ONLY in the reference material given - never invent a screen, route, or feature that isn't listed.",
    },
    {
      role: "user" as const,
      content: [
        `Reply in ${locale === "he" ? "Hebrew" : "English"}, in Daffy's normal warm, concise voice.`,
        "Reference material - the ONLY source of truth about what the app can do and where:",
        APP_HELP_CONTENT,
        `The user opened this chat from: ${currentScreen}`,
        "Decide which of these two things this message is:",
        "1) A QUESTION about how to use the app, or what a feature does, or how to request something (\"how do I change my password\", \"where do I upload lab results\", \"how do I ask for a new feature\"). Answer directly and concisely from the reference material. If a specific screen is the answer, set \"link\" to its path exactly as written in the reference material (e.g. \"/app/settings\") - otherwise null.",
        "2) A BUG REPORT or FEATURE REQUEST (\"this isn't working\", \"the app crashed when I...\", \"it would be great if...\", \"can you add...\"). For these, ALWAYS draft a ticket - even from a vague description, make your best reasonable guess rather than only asking a clarifying question with nothing else: write a short clear subject, ticket_type (\"bug\" or \"feature_request\"), area (one of: " + JSON.stringify(ticketAreaOptions) + ", defaulting to the current screen above when the message doesn't point elsewhere), priority (one of: " + JSON.stringify(ticketPriorityOptions) + " - \"urgent\" only for something that blocks basic use like a crash or data loss, \"low\" for a cosmetic nitpick, \"medium\" otherwise), and a description that expands the user's own words into a few clear sentences a support person can act on. In reply, briefly confirm you've drafted it and that they can review/submit it below; if the message was too vague to be confident about details, say what you assumed, but STILL include the draft.",
        "Only set ticketDraft for case 2. Never draft a ticket for a plain how-to question.",
        "Return strict JSON with exactly this shape: {\"reply\":\"string\",\"link\":\"string\"|null,\"ticketDraft\":{\"subject\":\"string\",\"ticket_type\":\"bug\"|\"feature_request\",\"area\":\"string\",\"priority\":\"string\",\"description\":\"string\"}|null}",
        "message:",
        message,
      ].join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    temperature: 0.2,
    jsonMode: true,
    timeoutMs: 30_000,
  });

  const parsed = answerSchema.parse(parseJson(contentText));
  const link = parsed.link && (HELP_LINK_PATHS as readonly string[]).includes(parsed.link) ? parsed.link : null;

  return { reply: parsed.reply, link, ticketDraft: parsed.ticketDraft ?? null };
}
