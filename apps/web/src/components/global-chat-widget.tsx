"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { listQuickLogSavedItemsAction, logSavedItemFromChatAction, type QuickLogSavedItem } from "@/app/app/daily-report/quick-log-actions";
import { applyProfileChatChangeAction } from "@/app/app/profile/chat-actions";
import { applyActiveTargetsAction, clearTargetsReviewPendingAction, negotiateActiveTargetsAction } from "@/app/app/targets/plan-actions";
import { routeChatMessageAction, type ChatRouterResult } from "@/app/app/chat/actions";
import { submitTicketFromChatAction } from "@/app/app/tickets/chat-actions";
import { SavedListQuickPicker } from "@/components/saved-list-quick-picker";
import { formatDefaultItemName, formatDefaultUnit, formatTicketArea, formatTicketPriority, formatTicketType, tr, trGendered, type AppLocale } from "@/lib/locale";
import type { ChatDomain } from "@/lib/ai/chat-router";
import type { HelpTicketDraft } from "@/lib/ai/help-chat";
import type { ProfileDiffRow, TargetGenerationPayload } from "@/lib/targets";

type PendingTargetsChange = {
  payload: TargetGenerationPayload;
  source: "ai" | "heuristic";
  goalText: string;
  status: "pending" | "applied" | "discarded";
};

/** Profile domain's own preview-then-apply card (Phase C) - same
 * pending/applied/discarded lifecycle as PendingTargetsChange, just
 * carrying a raw field patch instead of a full targets payload, since
 * applyProfileChatChangeAction takes exactly what the AI proposed rather
 * than a whole-object replacement. */
type PendingProfileChange = {
  patch: Record<string, unknown>;
  diffRows: ProfileDiffRow[];
  status: "pending" | "applied" | "discarded";
};

/** Help domain's own preview-then-apply card (Phase D) - a ticket draft
 * the user reviews and submits with one tap, same lifecycle shape as the
 * other two pending-change types above. "applied" here means "submitted"
 * (the label the button/status text below actually uses is Submit, to
 * match how a new-ticket action reads, but the status field name stays
 * consistent with its siblings). */
type PendingTicketDraft = {
  draft: HelpTicketDraft;
  status: "pending" | "applied" | "discarded";
  ticketId?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Present only for a targets-domain reply with an actual change to
   * preview - same preview-then-apply shape the old Targets-only chat
   * used, now available from any screen. */
  pendingChange?: PendingTargetsChange;
  /** Profile domain's own equivalent of pendingChange - kept as a separate
   * field rather than a union on pendingChange since the two carry
   * differently-shaped data and are applied through different actions. */
  pendingProfileChange?: PendingProfileChange;
  /** Help domain's own equivalent - present only when the message read as
   * a bug report or feature request (see answerHelpQuestion). */
  pendingTicketDraft?: PendingTicketDraft;
  /** Help domain's own optional "go here" link - a whitelisted in-app
   * path (see HELP_LINK_PATHS), rendered as a real client-side link. */
  helpLink?: string | null;
  /** A softer visual tint for a daily-report confirmation ("✓ Logged...")
   * vs a plain informational reply - matches the approved mockup. */
  tone?: "confirm";
  /** Ticket #10's chat-opened reminder - migrated here from the old
   * Targets-only chat (see targets-page-client.tsx's git history) since
   * "the next time you open chat with Daffy" now means THIS chat,
   * regardless of screen. */
  reviewPrompt?: { changes: ProfileDiffRow[]; status: "pending" | "answered" };
};

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/** Which domain a screen maps to when a message is too ambiguous for the
 * classifier to resolve on its own (see chat-router.ts's own comment on
 * currentScreen being a tie-breaker, not the primary signal). Every page
 * not explicitly listed defaults to daily_report, the more general of the
 * two domains this first phase supports. */
function screenForPathname(pathname: string): ChatDomain {
  if (pathname.startsWith("/app/targets")) return "targets";
  if (pathname.startsWith("/app/profile")) return "profile";
  if (pathname.startsWith("/app/tickets")) return "help";
  return "daily_report";
}

/** Display label for a help-domain link chip - keep in sync with
 * HELP_LINK_PATHS (lib/ai/help-chat.ts), which is the actual whitelist
 * enforced server-side; this is presentation only. */
function labelForHelpLink(path: string, locale: AppLocale): string {
  const labels: Record<string, [string, string]> = {
    "/app": ["Home", "בית"],
    "/app/daily-report": ["Daily Report", "דיווח יומי"],
    "/app/daily-report/defaults": ["Manage Saved List", "ניהול רשימה שמורה"],
    "/app/targets": ["Targets", "יעדים"],
    "/app/profile": ["Profile", "פרופיל"],
    "/app/notifications": ["Notifications", "התראות"],
    "/app/settings": ["Settings", "הגדרות"],
    "/app/tickets": ["My Tickets", "הפניות שלי"],
    "/app/tickets/new": ["New Ticket", "פנייה חדשה"],
  };
  const entry = labels[path];
  return entry ? tr(locale, entry[0], entry[1]) : path;
}

/**
 * The unified, app-wide Daffy chat - mounted once in app/app/layout.tsx so
 * it persists across navigation instead of resetting per page, and routes
 * every message through routeChatMessageAction to whichever domain
 * (targets, daily_report, profile, or help) actually applies, regardless
 * of which screen it was opened from. Visually identical to the Targets
 * page's own former bubble, which this supersedes - see that component's
 * git history for the design this was lifted from.
 *
 * Deliberately NOT shown on /app/daily-report yet - that page's own
 * docked chat already covers everything this minimal router's
 * daily-report path does, plus photo upload, the saved-list picker, and
 * editing an existing entry, none of which this generalizes yet. Phase E
 * is where that page's chat gets retired in favor of this one too.
 */
export function GlobalChatWidget({
  locale,
  userGender,
  pendingReviewChanges,
}: {
  locale: AppLocale;
  userGender?: "male" | "female" | null;
  /** Set by TargetsStaleModal's OK button (ticket #10) after a profile
   * change anywhere in the app - null when nothing's pending. */
  pendingReviewChanges: ProfileDiffRow[] | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const currentScreen = screenForPathname(pathname ?? "");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(Boolean(pendingReviewChanges));
  // Phase E's saved-list popover - fetched lazily (null = not loaded yet)
  // the first time it's opened, not on mount, since most chat sessions
  // never touch it.
  const [isSavedListOpen, setIsSavedListOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<QuickLogSavedItem[] | null>(null);
  const [isSavedListLoading, setIsSavedListLoading] = useState(false);
  const savedListTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Injects the reminder at most once per session, the first time the
  // chat is actually opened - see targets-page-client.tsx's own former
  // comment on this (identical reasoning, just no longer Targets-specific).
  const [hasShownReviewPrompt, setHasShownReviewPrompt] = useState(false);

  if (pathname?.startsWith("/app/daily-report") || pathname?.startsWith("/app/onboarding")) {
    return null;
  }

  function pushMessage(message: ChatMessage) {
    setMessages((previous) => [...previous, message]);
    if (!isChatOpen) setHasUnread(true);
  }

  function updateReviewPromptStatus(index: number, status: "answered") {
    setMessages((previous) =>
      previous.map((message, i) => (i === index && message.reviewPrompt ? { ...message, reviewPrompt: { ...message.reviewPrompt, status } } : message)),
    );
  }

  async function handleReviewDecline(index: number) {
    updateReviewPromptStatus(index, "answered");
    pushMessage({
      role: "assistant",
      content: tr(locale, "No problem — just let me know whenever you'd like me to check.", "אין בעיה - פשוט תגיד/י לי מתי שתרצה/י שאבדוק."),
    });
    await clearTargetsReviewPendingAction();
  }

  async function handleReviewAccept(index: number, changes: ProfileDiffRow[]) {
    updateReviewPromptStatus(index, "answered");
    setIsSending(true);

    const summary = changes.map((row) => `${tr(locale, row.labelEn, row.labelHe)}: ${row.before} → ${row.after}`).join("; ");
    const goalText = tr(
      locale,
      `My profile changed (${summary}). Please review whether my targets still make sense and update anything that needs it.`,
      `הפרופיל שלי השתנה (${summary}). בדוק/י בבקשה אם היעדים שלי עדיין הגיוניים ועדכן/י מה שצריך.`,
    );

    // try/finally so a network failure or a request that outruns the
    // platform's function timeout (a real risk here - a targets
    // negotiation call routinely takes 30-90s) can never leave isSending
    // stuck true, which would permanently disable the chat input until the
    // user reloads the page.
    try {
      const result = await negotiateActiveTargetsAction({ message: goalText });
      await clearTargetsReviewPendingAction();

      if ("error" in result) {
        pushMessage({ role: "assistant", content: result.error });
        return;
      }

      if (result.quickApplied) {
        pushMessage({ role: "assistant", content: result.reply, tone: "confirm" });
        router.refresh();
        return;
      }

      pushMessage({
        role: "assistant",
        content: result.reply,
        pendingChange: result.changed
          ? { payload: result.payload, source: result.source, goalText, status: "pending" }
          : undefined,
      });
    } catch {
      pushMessage({
        role: "assistant",
        content: tr(locale, "Something went wrong checking that. Please try again.", "משהו השתבש בבדיקה. יש לנסות שוב."),
      });
    } finally {
      setIsSending(false);
    }
  }

  function updatePendingChangeStatus(index: number, status: PendingTargetsChange["status"]) {
    setMessages((previous) =>
      previous.map((message, i) =>
        i === index && message.pendingChange ? { ...message, pendingChange: { ...message.pendingChange, status } } : message,
      ),
    );
  }

  async function handleApply(index: number) {
    const target = messages[index];
    if (!target?.pendingChange || target.pendingChange.status !== "pending") return;
    const { payload, source, goalText } = target.pendingChange;

    const result = await applyActiveTargetsAction({ payload, source, goalText });
    if (result.error) {
      pushMessage({ role: "assistant", content: result.error as string });
      return;
    }

    updatePendingChangeStatus(index, "applied");
    // Whichever screen is currently showing (Targets itself, or anywhere
    // else that reads target-derived data) refetches its server data -
    // this component has no direct reference to those pages' own state,
    // so a refresh is the simple way to keep them in sync after a change
    // made from elsewhere.
    router.refresh();
  }

  function handleDiscard(index: number) {
    updatePendingChangeStatus(index, "discarded");
  }

  function updatePendingProfileChangeStatus(index: number, status: PendingProfileChange["status"]) {
    setMessages((previous) =>
      previous.map((message, i) =>
        i === index && message.pendingProfileChange ? { ...message, pendingProfileChange: { ...message.pendingProfileChange, status } } : message,
      ),
    );
  }

  async function handleApplyProfileChange(index: number) {
    const target = messages[index];
    if (!target?.pendingProfileChange || target.pendingProfileChange.status !== "pending") return;

    const result = await applyProfileChatChangeAction(target.pendingProfileChange.patch);
    if (result.error) {
      pushMessage({ role: "assistant", content: result.error });
      return;
    }

    updatePendingProfileChangeStatus(index, "applied");
    // Same reasoning as handleApply's own router.refresh() - whichever
    // screen is showing (Profile itself, or Targets if this change also
    // affects it) refetches fresh server data.
    router.refresh();
  }

  function handleDiscardProfileChange(index: number) {
    updatePendingProfileChangeStatus(index, "discarded");
  }

  function updatePendingTicketDraftStatus(index: number, status: PendingTicketDraft["status"], ticketId?: string) {
    setMessages((previous) =>
      previous.map((message, i) =>
        i === index && message.pendingTicketDraft ? { ...message, pendingTicketDraft: { ...message.pendingTicketDraft, status, ticketId } } : message,
      ),
    );
  }

  async function handleSubmitTicketDraft(index: number) {
    const target = messages[index];
    if (!target?.pendingTicketDraft || target.pendingTicketDraft.status !== "pending") return;

    // Silent - not something the user drafted, just the app build they were
    // on when they filed this, same as the plain ticket form's own hidden
    // field (new-ticket-form.tsx) - for an admin investigating a report to
    // know without having to ask.
    const result = await submitTicketFromChatAction({
      ...target.pendingTicketDraft.draft,
      current_version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    });
    if (result.error) {
      pushMessage({ role: "assistant", content: result.error });
      return;
    }

    updatePendingTicketDraftStatus(index, "applied", result.ticketId);
  }

  function handleDiscardTicketDraft(index: number) {
    updatePendingTicketDraftStatus(index, "discarded");
  }

  async function handleToggleSavedList() {
    const willOpen = !isSavedListOpen;
    setIsSavedListOpen(willOpen);
    if (willOpen && savedItems === null) {
      setIsSavedListLoading(true);
      const result = await listQuickLogSavedItemsAction();
      setIsSavedListLoading(false);
      setSavedItems("error" in result ? [] : result.items);
    }
  }

  /** One tap, no review step - matches the approved design exactly ("user
   * clicks the item, item is saved and added to his daily log, that's
   * it"): the popover closes immediately and a confirmation lands in the
   * chat, rather than a diff/preview card like the other three domains
   * use for something that changes standing state. Logging a meal is
   * already a routine, low-stakes action elsewhere in the app (the
   * Daily Report page's own saved-list picker works the same way), so
   * this doesn't need the extra friction those domains do. */
  async function handleLogSavedItem(item: QuickLogSavedItem) {
    setIsSavedListOpen(false);
    const result = await logSavedItemFromChatAction(item.id);
    if (result.error) {
      pushMessage({ role: "assistant", content: result.error });
      return;
    }
    const name = formatDefaultItemName(item.name, locale);
    const unit = formatDefaultUnit(item.unit, locale);
    pushMessage({
      role: "assistant",
      content: tr(locale, `✓ Added ${name} (${item.quantity} ${unit}) to today's log.`, `✓ נוסף ${name} (${item.quantity} ${unit}) ליומן היום.`),
      tone: "confirm",
    });
    router.refresh();
  }

  async function handleSendMessage() {
    const trimmed = chatInput.trim();
    if (!trimmed || isSending) return;

    setMessages((previous) => [...previous, { role: "user", content: trimmed }]);
    setChatInput("");
    setIsSending(true);

    // try/finally so a network failure or a request that outruns the
    // platform's function timeout (a real risk here - a targets
    // negotiation call routinely takes 30-90s) can never leave isSending
    // stuck true, which would permanently disable the chat input until the
    // user reloads the page.
    try {
      const result: ChatRouterResult = await routeChatMessageAction({ message: trimmed, currentScreen });

      if ("error" in result) {
        pushMessage({ role: "assistant", content: result.error });
        return;
      }

      if (result.domain === "daily_report") {
        pushMessage({ role: "assistant", content: result.reply, tone: result.logged ? "confirm" : undefined });
        if (result.logged) router.refresh();
        return;
      }

      if (result.domain === "profile") {
        pushMessage({
          role: "assistant",
          content: result.reply,
          pendingProfileChange:
            result.changed && result.patch && result.diffRows && result.diffRows.length > 0
              ? { patch: result.patch, diffRows: result.diffRows, status: "pending" }
              : undefined,
        });
        return;
      }

      if (result.domain === "help") {
        pushMessage({
          role: "assistant",
          content: result.reply,
          helpLink: result.link,
          pendingTicketDraft: result.ticketDraft ? { draft: result.ticketDraft, status: "pending" } : undefined,
        });
        return;
      }

      // domain === "targets"
      if (result.quickApplied) {
        pushMessage({ role: "assistant", content: result.reply, tone: "confirm" });
        router.refresh();
        return;
      }

      pushMessage({
        role: "assistant",
        content: result.reply,
        pendingChange:
          result.changed && result.payload && result.source && result.goalText
            ? { payload: result.payload, source: result.source, goalText: result.goalText, status: "pending" }
            : undefined,
      });
    } catch {
      pushMessage({
        role: "assistant",
        content: tr(locale, "Something went wrong sending that. Please try again.", "משהו השתבש בשליחה. יש לנסות שוב."),
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      {/* Same physical bottom-right position, safe-area handling, and
          RTL-independence as the app's other floating chat bubbles
          (daily-report-chat-panel.tsx, the old targets-page-client.tsx
          bubble this replaces) - see those files' own comments for the
          calc() and underscore-in-calc details. */}
      <button
        type="button"
        onClick={() => {
          setIsChatOpen((open) => !open);
          setHasUnread(false);
          if (!hasShownReviewPrompt && pendingReviewChanges && pendingReviewChanges.length > 0) {
            setHasShownReviewPrompt(true);
            const summary = pendingReviewChanges
              .map((row) => `${tr(locale, row.labelEn, row.labelHe)} (${row.before} → ${row.after})`)
              .join(", ");
            setMessages((previous) => [
              ...previous,
              {
                role: "assistant",
                content: tr(
                  locale,
                  `Hi! Since we last talked, your ${summary} changed — want me to check whether your targets still make sense, and adjust anything that needs it?`,
                  `היי! מאז שדיברנו לאחרונה, ${summary} השתנה - רוצה שאבדוק אם היעדים שלך עדיין הגיוניים, ואתאים מה שצריך?`,
                ),
                reviewPrompt: { changes: pendingReviewChanges, status: "pending" },
              },
            ]);
          }
        }}
        aria-label={tr(locale, "Chat with Daffy", "צ'אט עם Daffy")}
        className="fixed bottom-[calc(3.25rem+env(safe-area-inset-bottom)+0.75rem)] right-[calc(12.5vw_-_2rem)] z-50 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
      >
        {isChatOpen ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        )}
        {hasUnread && !isChatOpen ? (
          <span className="absolute end-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-rose-500 dark:border-slate-900" />
        ) : null}
      </button>

      {isChatOpen ? (
        <div className="fixed bottom-[calc(8rem+env(safe-area-inset-bottom))] right-[calc(12.5vw_-_2rem)] z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-white dark:bg-teal-600">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
            </span>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {tr(locale, "Chat with Daffy — your AI coach", "צ'אט עם Daffy - מאמן ה-AI שלך")}
            </p>
          </div>
          <div className="min-h-[6rem] flex-1 space-y-2.5 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {trGendered(
                  locale,
                  userGender,
                  "Ask anything, log what you ate, drank, or did, or get help with the app - from any screen.",
                  "שאל כל דבר, רשום מה אכלת, שתית או עשית, או קבל עזרה עם האפליקציה - מכל מסך.",
                  "שאלי כל דבר, רשמי מה אכלת, שתית או עשית, או קבלי עזרה עם האפליקציה - מכל מסך.",
                )}
              </p>
            ) : null}
            {messages.map((message, index) => (
              <div key={index} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    message.role === "user"
                      ? "bg-teal-700 text-white dark:bg-teal-600"
                      : message.tone === "confirm"
                        ? "border border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300"
                        : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                  }`}
                >
                  {message.content}
                </div>
                {message.pendingChange ? (
                  <div className="mt-1.5 max-w-[85%]">
                    {message.pendingChange.status === "pending" ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleApply(index)}
                          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                        >
                          {tr(locale, "Apply this change", "החל שינוי זה")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDiscard(index)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {tr(locale, "Discard", "בטל")}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {message.pendingChange.status === "applied"
                          ? tr(locale, "✓ Applied", "✓ הוחל")
                          : tr(locale, "Discarded", "בוטל")}
                      </p>
                    )}
                  </div>
                ) : null}
                {message.pendingProfileChange ? (
                  <div className="mt-1.5 max-w-[85%] space-y-1.5">
                    <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                      {message.pendingProfileChange.diffRows.map((row, rowIndex) => (
                        <div key={rowIndex} className="flex flex-wrap items-baseline gap-x-1">
                          <span className="font-medium">{tr(locale, row.labelEn, row.labelHe)}:</span>
                          <span>{row.before} → {row.after}</span>
                        </div>
                      ))}
                    </div>
                    {message.pendingProfileChange.status === "pending" ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleApplyProfileChange(index)}
                          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                        >
                          {tr(locale, "Apply this change", "החל שינוי זה")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDiscardProfileChange(index)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {tr(locale, "Discard", "בטל")}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {message.pendingProfileChange.status === "applied"
                          ? tr(locale, "✓ Applied", "✓ הוחל")
                          : tr(locale, "Discarded", "בוטל")}
                      </p>
                    )}
                  </div>
                ) : null}
                {message.helpLink ? (
                  <Link
                    href={message.helpLink}
                    onClick={() => setIsChatOpen(false)}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400"
                  >
                    {tr(locale, "Go to", "מעבר אל")} {labelForHelpLink(message.helpLink, locale)} →
                  </Link>
                ) : null}
                {message.pendingTicketDraft ? (
                  <div className="mt-1.5 max-w-[85%] space-y-1.5">
                    <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                      <div>
                        <span className="font-medium">{tr(locale, "Subject:", "נושא:")}</span> {message.pendingTicketDraft.draft.subject}
                      </div>
                      <div className="flex flex-wrap gap-x-3">
                        <span>{formatTicketType(message.pendingTicketDraft.draft.ticket_type, locale)}</span>
                        <span>{formatTicketArea(message.pendingTicketDraft.draft.area, locale)}</span>
                        <span>{formatTicketPriority(message.pendingTicketDraft.draft.priority, locale)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-400">{message.pendingTicketDraft.draft.description}</p>
                    </div>
                    {message.pendingTicketDraft.status === "pending" ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSubmitTicketDraft(index)}
                          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                        >
                          {tr(locale, "Submit ticket", "שלח פנייה")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDiscardTicketDraft(index)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {tr(locale, "Discard", "בטל")}
                        </button>
                      </div>
                    ) : message.pendingTicketDraft.status === "applied" ? (
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{tr(locale, "✓ Submitted", "✓ נשלח")}</p>
                        {message.pendingTicketDraft.ticketId ? (
                          <Link
                            href={`/app/tickets/${message.pendingTicketDraft.ticketId}`}
                            onClick={() => setIsChatOpen(false)}
                            className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400"
                          >
                            {tr(locale, "View ticket →", "צפה בפנייה →")}
                          </Link>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{tr(locale, "Discarded", "בוטל")}</p>
                    )}
                  </div>
                ) : null}
                {message.reviewPrompt ? (
                  <div className="mt-1.5 max-w-[85%]">
                    {message.reviewPrompt.status === "pending" ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReviewAccept(index, message.reviewPrompt!.changes)}
                          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                        >
                          {tr(locale, "Yes, please check", "כן, בדוק/י בבקשה")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewDecline(index)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {tr(locale, "Not right now", "לא כרגע")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            {isSending ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Spinner className="h-3.5 w-3.5 animate-spin" />
                {tr(locale, "Checking that for you…", "בודק/ת את זה בשבילך…")}
              </div>
            ) : null}
          </div>
          <div className="relative flex min-w-0 items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
            <button
              ref={savedListTriggerRef}
              type="button"
              onClick={() => void handleToggleSavedList()}
              aria-label={tr(locale, "Add from saved list", "הוספה מהרשימה השמורה")}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                isSavedListOpen
                  ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-400"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </button>

            <SavedListQuickPicker
              isOpen={isSavedListOpen}
              onClose={() => setIsSavedListOpen(false)}
              items={savedItems ?? []}
              isLoading={isSavedListLoading}
              locale={locale}
              onSelect={(id) => {
                const item = savedItems?.find((entry) => entry.id === id);
                if (item) void handleLogSavedItem(item);
              }}
              triggerRef={savedListTriggerRef}
            />

            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSendMessage();
                }
              }}
              readOnly={isSending}
              placeholder={tr(locale, "Type a message…", "כתוב הודעה…")}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => void handleSendMessage()}
              disabled={isSending || !chatInput.trim()}
              className="shrink-0 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
            >
              {tr(locale, "Send", "שליחה")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
