"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal, flushSync, useFormStatus } from "react-dom";

import { deleteDailyReportAction, getDailyReportBreakdownAction, type DailyReportBreakdownItem } from "@/app/app/daily-report/actions";
import { logSavedItemFromChatAction } from "@/app/app/daily-report/quick-log-actions";
import type { DailyReportDefaultItem } from "@/components/daily-report-defaults-picker";
import { SAVE_TOAST_DURATION_MS } from "@/components/daily-report-form";
import { DailyReportSuccessToast } from "@/components/daily-report-success-toast";
import { SavedListQuickPicker } from "@/components/saved-list-quick-picker";
import { SubmitButton } from "@/components/daily-report-submit-button";
import { directionForLocale, formatDefaultItemName, formatDefaultUnit, tr, trGendered, type AppLocale } from "@/lib/locale";

export type { DailyReportDefaultItem };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  imagePreviewUrl?: string;
  /** Purely a UI confirmation (e.g. "✓ Added Coffee to today's log" after a
   * saved-list quick-log) - shown in the thread like any other message,
   * but excluded from the transcript this panel reports up to the parent
   * (see the onTranscriptChange effect below), since a quick-logged item
   * is already its own separate, already-saved report row - it must never
   * also get folded into whatever this compose box's own Save/Conclude
   * submits next, which would duplicate it or confuse the AI parser. */
  localOnly?: boolean;
  /** TCK-94: the structured item-by-item breakdown card shown under a
   * reply once the conversation signals there's something concrete to log
   * (see getDailyReportBreakdownAction's own comment) - display only,
   * computed separately from the save itself, which still works exactly
   * as before off the free-text transcript. */
  breakdown?: DailyReportBreakdownItem[];
};
type SseEvent =
  | { type: "token"; text: string }
  | { type: "actionable"; value: boolean }
  /** Edit-mode only (see isEditingExistingEntry in the request body) - true
   * once the model's reply confirms the user wants to delete this entire
   * entry rather than change part of it, so Save can swap to a delete
   * action instead. Always false outside edit mode. */
  | { type: "delete_intent"; value: boolean }
  | { type: "error"; message: string }
  | { type: "done" };

const STREAM_INACTIVITY_TIMEOUT_MS = 20000;
const ALLOWED_MEAL_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Inverse of the "User: ...\nAssistant: ..." transcript this panel builds
 * (see the messages -> transcript effect below) - reconstructs chat bubbles
 * from a previously saved report's raw_report_text so editing continues the
 * same conversation. Each line is matched against the same "User: "/
 * "Assistant: " prefixes the transcript itself always uses (regardless of
 * UI locale - see the hardcoded English role labels below), consistent with
 * how the report list's "View full conversation" toggle parses the same
 * text. A line with neither prefix is treated as a continuation of the
 * previous message's content rather than dropped, so a multi-line message
 * round-trips too.
 */
function parseTranscriptToMessages(rawText: string): ChatMessage[] {
  if (!rawText.trim()) return [];

  const messages: ChatMessage[] = [];
  // Browsers normalize a <textarea>'s value to CRLF ("\r\n") on form
  // submission regardless of what JS wrote into it (the transcript is
  // joined with plain "\n"), so raw_report_text as read back from the
  // database has a trailing "\r" on every line - normalize it away first,
  // since a line like "User: ...\r" otherwise fails to match /^User: (.*)$/
  // entirely ("." excludes line terminators including "\r", and non-
  // multiline "$" only matches true end-of-string), silently discarding
  // every message and leaving the chat looking blank.
  const normalizedText = rawText.replace(/\r\n/g, "\n");
  for (const line of normalizedText.split("\n")) {
    const userMatch = line.match(/^User: (.*)$/);
    const assistantMatch = line.match(/^Assistant: (.*)$/);

    if (userMatch) {
      messages.push({ role: "user", content: userMatch[1] });
    } else if (assistantMatch) {
      messages.push({ role: "assistant", content: assistantMatch[1] });
    } else if (messages.length > 0) {
      messages[messages.length - 1].content += `\n${line}`;
    }
  }

  return messages;
}

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function TrashIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6h14Z" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function NewChatIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function ChatBubbleBadgeIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/**
 * Edit mode's Save button becomes this instead of SubmitButton once the AI
 * has confirmed (via the delete_intent marker) that the user wants the
 * whole entry gone - same position, same submit gesture, but formAction
 * overrides the shared form's normal save action with the already-existing
 * deleteDailyReportAction for this one click, reusing report_id (see the
 * hidden input DailyReportForm renders for it whenever an edit is live)
 * rather than re-deriving anything new.
 */
function DeleteEntrySubmitButton({
  locale,
  variant,
  busy = false,
}: {
  locale: AppLocale;
  variant: "icon" | "text";
  busy?: boolean;
}) {
  const { pending } = useFormStatus();
  const isBusy = pending || busy;
  const label = tr(locale, "Delete entry", "מחיקת רשומה");
  const pendingLabel = tr(locale, "Deleting...", "מוחק...");

  if (variant === "icon") {
    return (
      <button
        type="submit"
        form="daily-report-form"
        formAction={deleteDailyReportAction}
        disabled={pending}
        aria-label={isBusy ? pendingLabel : label}
        title={isBusy ? pendingLabel : label}
        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-colors ${
          pending
            ? "cursor-not-allowed bg-slate-200 text-slate-400 shadow-none dark:bg-slate-800 dark:text-slate-600"
            : "bg-rose-700 text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500"
        }`}
      >
        {isBusy ? <Spinner className="h-5 w-5 animate-spin" /> : <TrashIcon className="h-6 w-6" />}
      </button>
    );
  }

  return (
    <button
      type="submit"
      form="daily-report-form"
      formAction={deleteDailyReportAction}
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500"
    >
      {isBusy ? pendingLabel : label}
    </button>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Describing a day's food/drink/exercise, either as a back-and-forth
 * conversation with the AI (which can also see an attached photo and
 * reflect on it immediately), or as a quick one-shot save for something
 * simple that needs no discussion (e.g. "a cup of water") - a compact
 * picker for quick-adding saved-list items is also available either way.
 * This panel never saves anything itself for the "Send" path - it
 * continuously reports the full transcript up to the parent via
 * onTranscriptChange, which keeps a hidden report_text field (and whatever
 * photo/defaults are attached here) in sync so "Conclude & Report" - and
 * everything it already does (safety gate, AI parsing) - handles it exactly
 * as if this had been typed/attached directly into that field. The
 * "Conclude & Report" button itself is rendered here too (right under the
 * compose row) so the fast path never requires a Send round-trip first: its
 * click handler folds in whatever's currently typed but not yet sent before
 * the form submits, so typing something and immediately saving just works.
 */
export function DailyReportChatPanel({
  locale,
  defaultItems,
  onTranscriptChange,
  saveError,
  saveSuccess,
  bmiWarning,
  menuPhotoReply,
  goalBarRequest,
  initialTranscriptText,
  isEditing = false,
  editingReportId,
  editingEntrySummary,
  hasChanges = false,
  saveBlockedSignal,
  userFirstName,
  userGender,
}: {
  locale: AppLocale;
  defaultItems: DailyReportDefaultItem[];
  onTranscriptChange: (text: string) => void;
  saveError?: string;
  saveSuccess?: string;
  /** Deterministic BMI safety message (lib/bmi.ts) from a just-saved
   * reported weight - shown here too, since this AI-chat panel (not the
   * plain-text fallback below it) is the primary Daily Report path and
   * previously never received this prop at all. */
  bmiWarning?: string;
  /** Ticket #4: set instead of saveSuccess when a submitted photo turned
   * out to be a menu, not a plate of food - shown as a real assistant chat
   * bubble (see its own push below), not the saveError banner treatment,
   * since nothing went wrong and the point is to keep the conversation
   * going. */
  menuPhotoReply?: string;
  /** TCK-41: set by DailyReportForm each time a goal bar is tapped - nonce
   * always increments (even on the same bar/value twice in a row, where the
   * text alone wouldn't change) so the effect below reliably fires again.
   * `askedText` is always shown as the "asked" bubble, so the exchange
   * always reads as question-and-answer. `question` is sent to the AI
   * exactly like a typed message, for a metric with something logged;
   * `notice` is a pre-built, already-localized sentence pushed directly
   * with no AI call, for an empty metric - there's nothing for the AI to
   * explain about zero logged items. */
  goalBarRequest?: { nonce: number; askedText: string; question?: string; notice?: string } | null;
  /** The "User: ...\nAssistant: ..." transcript of a previously saved
   * report, when arriving via "Edit entry" - parsed back into chat bubbles
   * so a correction reads as a continuation of that same conversation
   * instead of starting from a blank slate with no memory of what was
   * already logged (which is what silently created a second, incomplete
   * report instead of amending the first). */
  initialTranscriptText?: string;
  /** True when Send/Conclude will update that same previously saved report
   * rather than create a new one - see SubmitButton's isEditing. */
  isEditing?: boolean;
  /** The report id being edited, straight from the live URL (see
   * DailyReportForm's own liveEditReportId) - sent with every chat request
   * so the server can exclude this report's own contribution from
   * todays_logged_totals_summary/todays_logged_items (see route.ts), which
   * otherwise describe every report logged today INCLUDING this one, easily
   * read by the model as "what's in the entry being edited" and blending in
   * whatever else the user logged the same day. */
  editingReportId?: string;
  /** Plain-text, locale-formatted recap of exactly what this report
   * currently contains (see page.tsx) - shown as part of the edit-mode
   * intro message below instead of a generic "you're editing this" line, so
   * the user sees the actual contents immediately without scrolling up
   * through the original conversation. */
  editingEntrySummary?: string;
  /** Whether anything outside this panel (weight, a custom target like
   * sleep duration, or a previously-sent chat message already folded into
   * the parent's report_text) has changed since the last save - drives the
   * floating save icon's enabled/disabled state below. This panel adds its
   * own in-progress signals (unsent typed text, an attached photo, a picked
   * saved-list item) on top of this when deciding whether the icon should
   * actually be enabled. */
  hasChanges?: boolean;
  /** Bumped by DailyReportForm every time it blocks a submit to show its
   * own out-of-range confirmation dialog (e.g. reporting more than 12 hours
   * for an hour-denominated custom target like Sleep duration). The click
   * that triggers a submit always flips isSaving on optimistically first
   * (see handleQuickSave - it has to, since it can't know in advance
   * whether the browser is about to actually submit or DailyReportForm is
   * about to intercept it), and normally isSaving only clears once
   * saveError/saveSuccess/bmiWarning arrive back from a real save that
   * happened - which never comes if the submit was blocked before it ever
   * reached the server action. Without this signal the spinner would just
   * sit there until the 20-second safety-net timeout below, reading as a
   * hung save that silently did nothing. */
  saveBlockedSignal?: number;
  /** For this panel's own static greeting/intro copy below (not AI-
   * generated) - an occasional first-name mention and grammatically
   * correct Hebrew addressing, mirroring the rules the AI chat itself now
   * follows (see lib/ai/persona.ts, which resolveUserGenderForAddressing's
   * normalization is shared with). */
  userFirstName?: string | null;
  userGender?: "male" | "female" | null;
}) {
  // Editing an existing report reopens its original conversation instead of
  // starting blank - appends one local (non-AI) prompt so it's obvious this
  // is a continuation to edit, not a fresh log, and so there's somewhere for
  // the user to look to see what to type next. Includes the entry's own
  // computed items recap (see editingEntrySummary) rather than just a
  // generic "you're editing this" line, so what's actually in the entry is
  // visible immediately without scrolling up through its original
  // conversation. A named function (not inlined into useState below) since
  // "New chat" needs this exact same construction again - see
  // confirmClearChat, which resets back to it in place rather than
  // remounting the whole panel (a remount would also reset `isOpen`,
  // closing the mobile sheet right when the user asked to keep chatting).
  function buildInitialMessages(): ChatMessage[] {
    const parsed = parseTranscriptToMessages(initialTranscriptText ?? "");
    const trimmedSummary = editingEntrySummary?.trim();
    // Singular, gender-correct Hebrew (את/אתה + matching verb forms) - the
    // original wording used plural/formal conjugations throughout
    // ("ספרו"/"תוכלו"), inconsistent with the app's actual one-user-at-a-
    // time addressing and with the AI chat's own persona rules (see
    // lib/ai/persona.ts). userGender "unknown"/null falls back to the male
    // forms via trGendered, same fallback the AI system prompts use.
    const namePrefix = userFirstName ? `${userFirstName}, ` : "";
    const includesEn = trimmedSummary ? ` It currently includes:\n${trimmedSummary}\n\n` : " ";
    const includesHe = trimmedSummary ? ` היא כוללת כרגע:\n${trimmedSummary}\n\n` : " ";
    const introLine = trGendered(
      locale,
      userGender,
      `${namePrefix}you're editing this saved entry.${includesEn}Tell me what to add, change, or remove, and I'll update it - tap the save icon once you're happy with it.`,
      `${namePrefix}אתה עורך את הרשומה השמורה הזו.${includesHe}ספר לי מה להוסיף, לשנות או להסיר, ואעדכן אותה - לחץ על סמל השמירה ברגע שתהיה מרוצה מהתוצאה.`,
      `${namePrefix}את עורכת את הרשומה השמורה הזו.${includesHe}ספרי לי מה להוסיף, לשנות או להסיר, ואעדכן אותה - לחצי על סמל השמירה ברגע שתהיי מרוצה מהתוצאה.`,
    );
    return isEditing
      ? [
          ...parsed,
          {
            role: "assistant",
            content: introLine,
          },
        ]
      : parsed;
  }

  const [messages, setMessages] = useState<ChatMessage[]>(buildInitialMessages);
  // Mobile-only: the whole panel (thread + composer) collapses behind a
  // floating bubble instead of always occupying page space - see the
  // trigger button and sheet in the JSX below. Irrelevant at `sm` and up,
  // where the panel is always visible inline as before. Starts open when
  // editing an existing report so its just-restored conversation (above) is
  // actually visible immediately - previously this always started closed
  // regardless of isEditing, so on mobile the transcript was silently
  // restored into state but stayed hidden behind the unopened sheet, which
  // read as "the chat history isn't being copied over" even though it was.
  const [isOpen, setIsOpen] = useState(() => isEditing);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // The saved-list icon's popover (restyled to match the global chat
  // widget's simple "tap the icon, tap an item, it's logged" flow - see
  // handleLogSavedItem below) - no separate loading/fetch state needed
  // since defaultItems already arrives as a prop from the page's own load.
  const [isSavedListOpen, setIsSavedListOpen] = useState(false);
  const savedListTriggerRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();
  // handleLogSavedItem's success toast (null hides it) and its auto-hide
  // timer - reset on every tap, so two identical taps in a row still each
  // get their full display time.
  const [savedItemToast, setSavedItemToast] = useState<{ message: string | null }>({ message: null });
  const savedItemToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (savedItemToastTimerRef.current) clearTimeout(savedItemToastTimerRef.current);
    };
  }, []);
  // Edit mode only - true once the model's latest reply confirmed the user
  // wants to delete this whole entry (see the "delete_intent" SSE event and
  // isEditingExistingEntry below), swapping Save for a delete action so
  // hitting the same button removes the entry instead of updating it.
  const [pendingDeleteOnSave, setPendingDeleteOnSave] = useState(false);
  // "New chat" - shown only while there's actually something to lose (see
  // hasChatContent below); otherwise the button clears immediately with no
  // prompt. Deliberately false-by-default and only ever flipped true from a
  // real click handler, never during the initial render - the portal keyed
  // on it further below (see pendingClearConfirm's own JSX) can therefore
  // never fire during SSR/hydration.
  const [pendingClearConfirm, setPendingClearConfirm] = useState(false);
  // Which of the two clear-triggering buttons opened the confirm dialog -
  // "New chat" (stays open, see handleNewChatClick) or the discard-and-
  // close title-bar icon (also minimizes once confirmed, see
  // handleDiscardAndCloseClick) - so confirmClearChat knows whether to
  // close the panel afterward, and the dialog can show the right wording
  // for which one the user actually asked for.
  const [closeAfterClear, setCloseAfterClear] = useState(false);
  // Tracks "a save was just triggered" independently of useFormStatus's own
  // pending flag - see the effect below for why. Purely a visual signal
  // (spinner + disabled) for the save buttons; it never gates what actually
  // gets submitted.
  const [isSaving, setIsSaving] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const hasDoneInitialScrollRef = useRef(false);
  // Standard "sticky autoscroll" chat pattern (WhatsApp/ChatGPT etc.) - true
  // whenever the thread is scrolled at/near its own bottom, kept in a ref
  // (not state) since it's updated from a scroll listener that can fire very
  // often and must never itself trigger a re-render. Read by the
  // messages-changed effect below to decide whether streamed tokens should
  // keep pulling the view down, or leave it alone because the user
  // deliberately scrolled up to read earlier messages.
  const isPinnedToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasSentOnceRef = useRef(false);
  // ProtectedAppLayout stamps data-theme="dark"/"light" on its own wrapper
  // div (see app/app/layout.tsx), and every dark: utility class in this
  // app is scoped to that attribute via a custom Tailwind variant (see
  // globals.css: `@custom-variant dark (&:where([data-theme="dark"],
  // [data-theme="dark"] *))`) - NOT the standard prefers-color-scheme
  // media query. Since this panel is portaled straight to document.body
  // (see the bottom of this file), it renders OUTSIDE that wrapper and
  // never inherits the attribute, so every dark: class here would
  // silently never apply, no matter the user's actual theme - confirmed
  // live as "the chat isn't dark like the rest of the app." Mirroring the
  // real value onto the portaled root below is the fix; read once on
  // mount (before this panel's own data-theme is ever set, so the query
  // can't accidentally match itself) rather than threading a new prop
  // through page.tsx -> DailyReportForm -> here alongside locale.
  const [mirroredTheme] = useState<string | null>(() =>
    typeof document === "undefined" ? null : (document.querySelector("[data-theme]")?.getAttribute("data-theme") ?? null),
  );
  // The bubble/panel portal below (unlike pendingClearConfirm's own portal
  // further down, which only ever flips true from a real click) renders
  // unconditionally on every pass, including the very first server render -
  // where document.body doesn't exist. Confirmed live: this crashed SSR
  // with "document is not defined" and silently fell back to full
  // client-side rendering for the whole page. useEffect only ever runs
  // client-side, so gating the portal on it - true only after mount - keeps
  // the server pass from ever reaching document.body.
  const [isMounted, setIsMounted] = useState(false);
  // See the handoff effect below, which these two gate.
  const handoffReadRef = useRef(false);
  const pendingHandoffRef = useRef<ChatMessage[] | null>(null);
  useEffect(() => {
    // setTimeout, not a direct call - this codebase's react-hooks/set-state-in-effect
    // rule flags a synchronous setState at the top of an effect body even
    // for a one-time mount flag like this; scheduling it instead (same
    // idiom used elsewhere in this app for the same rule) satisfies the
    // lint without changing behavior - it still only ever runs once, right
    // after mount.
    const timeoutId = setTimeout(() => setIsMounted(true), 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // TCK-94: "continue to full report" handoff from the floating chat -
  // see handleContinueToFullReport in global-chat-widget.tsx. That widget
  // hands its transcript over as plain text via sessionStorage (it has no
  // server-side session of its own), using the exact "User: ...\nAssistant:
  // ..." format parseTranscriptToMessages above already parses for the
  // "Edit entry" flow - reused here rather than a second transcript format.
  // Runs once on mount, after buildInitialMessages has already seeded the
  // greeting - a real handoff is never expected to coincide with isEditing
  // (editing a saved report has its own, different transcript source), so
  // this only ever overwrites the generic greeting case. Removed from
  // storage immediately so navigating back to this page later doesn't
  // resurrect a stale conversation.
  //
  // handoffReadRef/pendingHandoffRef split the destructive sessionStorage
  // read from the actual setState: React 18 dev StrictMode runs this effect
  // (and its cleanup) twice on mount, and a plain single-pass version loses
  // the handoff entirely - the first pass's cleanup clears its own setTimeout
  // before it fires, and by the second pass sessionStorage has already been
  // emptied by the first pass's own read, leaving nothing to restore. Reading
  // and removing the item happens at most once (guarded by handoffReadRef,
  // which - like the parsed result it gates - survives across both passes
  // since refs aren't reset by a cleanup/re-run), while the setState itself
  // is safely rescheduled on every pass, so whichever pass is the real one
  // (never cleaned up) is the one that actually commits it.
  useEffect(() => {
    if (isEditing) return;
    if (!handoffReadRef.current) {
      handoffReadRef.current = true;
      try {
        const handoff = window.sessionStorage.getItem("daffy:chat-handoff");
        if (handoff) {
          window.sessionStorage.removeItem("daffy:chat-handoff");
          const parsed = parseTranscriptToMessages(handoff);
          if (parsed.length > 0) pendingHandoffRef.current = parsed;
        }
      } catch {
        // Storage can throw (private browsing) - nothing to restore.
      }
    }
    const pending = pendingHandoffRef.current;
    if (!pending) return;
    // setTimeout, not a direct call - same react-hooks/set-state-in-effect
    // idiom used by the isMounted effect just above.
    const timeoutId = setTimeout(() => {
      setMessages(pending);
      setIsOpen(true);
    }, 0);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Last-resort safety net: the render-time reset below already clears
  // isSaving the moment saveError/saveSuccess/bmiWarning changes (i.e. the
  // instant the save action actually resolves), but if a save genuinely
  // never resolves at all (a true network failure with no server action
  // response) there'd be nothing to trigger that reset - this guarantees
  // the spinner can't stay stuck forever regardless of cause.
  useEffect(() => {
    if (!isSaving) return;
    const timeoutId = setTimeout(() => setIsSaving(false), 20000);
    return () => clearTimeout(timeoutId);
  }, [isSaving]);

  // A save error, success notice, or BMI warning is important feedback the
  // user must see - if the bubble happened to be closed when "Conclude &
  // Report" was clicked (the button lives inside the same sheet), silently
  // hiding it behind a closed bubble would be worse than the panel it
  // replaced, where this text was always on-screen. Adjusted during render
  // (React's documented pattern for reacting to a prop change - see
  // DailyReportForm's own state/prevState comparison) rather than in an
  // effect, since setState directly inside an effect body is a lint error
  // here (react-hooks/set-state-in-effect) and would trigger an extra,
  // avoidable render pass anyway.
  const feedbackKey = `${saveError ?? ""}|${saveSuccess ?? ""}|${bmiWarning ?? ""}|${menuPhotoReply ?? ""}`;
  const [prevFeedbackKey, setPrevFeedbackKey] = useState(feedbackKey);
  // Whether the error/success/BMI banner below is still worth showing -
  // see its own read at the bottom of this component and setShowFeedback(false)
  // in sendMessage for why this exists. saveError/saveSuccess/bmiWarning are
  // whatever the LAST save action returned, in the parent's useActionState -
  // that object doesn't clear itself on its own, so without this, "Daily
  // report saved" from an earlier save (e.g. a saved-list quick-add) kept
  // being shown through every later, genuinely-unsaved chat turn, reading as
  // confirmation that whatever was *just* typed had already been saved too
  // when it hadn't been - reported as "as soon as I hit Send I get the
  // notification it was added but I could not see it in the log."
  const [showFeedback, setShowFeedback] = useState(true);
  if (feedbackKey !== prevFeedbackKey) {
    setPrevFeedbackKey(feedbackKey);
    setShowFeedback(true);
    if (saveError || saveSuccess || bmiWarning) {
      setIsOpen(true);
    }
    // Ticket #4 fallback: the live chat reply (see MENU CHECK in
    // lib/ai/daily-report-chat.ts) is the normal way a menu photo gets
    // caught, before the user ever saves - this only fires if they saved
    // anyway (e.g. ignored that reply, or it failed to stream). Pushed as a
    // real, non-localOnly bubble so a follow-up question in this same panel
    // has it in context, same as any other assistant turn.
    if (menuPhotoReply) {
      setMessages((previous) => [...previous, { role: "assistant", content: menuPhotoReply }]);
      setIsOpen(true);
    }
    // The save actually finished (however it resolved) - clear the "saving"
    // spinner here rather than relying solely on useFormStatus's own
    // pending flag. A successful save on a NEW report also increments
    // chatResetKey in the parent, remounting this whole component fresh
    // (which resets isSaving to false on its own) - but that remount and
    // this render-time reset both stem from the exact same state update, so
    // there's no meaningful ordering to get wrong between them. This one
    // additionally covers the paths that DON'T remount - an error, or
    // editing an existing report (isEditing redirects instead) - where
    // nothing else would otherwise clear it.
    setIsSaving(false);
  }

  // See saveBlockedSignal's own comment - same render-time-reset pattern as
  // feedbackKey just above, for the same reason (an effect would trip
  // react-hooks/set-state-in-effect and add an avoidable extra render).
  const [prevSaveBlockedSignal, setPrevSaveBlockedSignal] = useState(saveBlockedSignal);
  if (saveBlockedSignal !== prevSaveBlockedSignal) {
    setPrevSaveBlockedSignal(saveBlockedSignal);
    setIsSaving(false);
  }

  /** TCK-41: react to a goal-bar tap (see goalBarRequest's own comment). A
   * real useEffect, not the render-time-reset pattern used elsewhere in
   * this file - the `question` branch calls sendMessage, which fetches the
   * streaming endpoint, and a genuine side effect like that must not run
   * directly in the render body (React may call render more than once
   * before committing). setTimeout(..., 0) is this codebase's established
   * way to still satisfy the react-hooks/set-state-in-effect lint rule
   * (see isMounted's own effect above) despite the setState calls below. */
  const [prevGoalBarNonce, setPrevGoalBarNonce] = useState(goalBarRequest?.nonce ?? 0);
  useEffect(() => {
    if (!goalBarRequest || goalBarRequest.nonce === prevGoalBarNonce) return;
    const timeoutId = setTimeout(() => {
      setPrevGoalBarNonce(goalBarRequest.nonce);
      setIsOpen(true);
      if (goalBarRequest.notice) {
        setMessages((previous) => [
          ...previous,
          { role: "user", content: goalBarRequest.askedText, localOnly: true },
          { role: "assistant", content: goalBarRequest.notice!, localOnly: true },
        ]);
      } else if (goalBarRequest.question) {
        void sendMessage(goalBarRequest.question, undefined, { localOnly: true });
      }
    }, 0);
    return () => clearTimeout(timeoutId);
    // sendMessage is a fresh closure every render (same as onTranscriptChange
    // below) - including it would refire this effect on every unrelated
    // render. The condition above only ever actually calls it once per
    // distinct nonce, milliseconds after that render, so the closure it
    // captures is never meaningfully stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalBarRequest, prevGoalBarNonce]);

  /** Once the assistant's reply finishes streaming, the textarea re-enables
   * (it's disabled while streaming) - focus needs to wait for that same
   * render to commit, so this can't just call .focus() inline after
   * setIsStreaming(false). Skipped on mount (hasSentOnceRef starts false)
   * so opening the page doesn't unexpectedly steal focus.
   *
   * preventScroll stopped this from scrolling the page itself (see below),
   * but on a touch device a programmatic .focus() on a text input also pops
   * the on-screen keyboard regardless of preventScroll - shrinking the
   * visible viewport right as the reply finishes, which hid the tail of it
   * behind the keyboard until it was dismissed. There's no virtual keyboard
   * on a mouse/trackpad device, so the convenience of auto-focus (jump
   * straight back into typing without an extra tap) is worth keeping there;
   * "(pointer: coarse)" is the standard signal for "primary input is a
   * finger, not a mouse" and is a better test than touch-capability alone,
   * which would also wrongly skip this on touch-enabled laptops that are
   * typed on with a physical keyboard. */
  useEffect(() => {
    const isTouchPrimary = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (!isStreaming && hasSentOnceRef.current && !isTouchPrimary) {
      textareaRef.current?.focus({ preventScroll: true });
    }
  }, [isStreaming]);

  /**
   * Keeps the thread pinned to its own bottom while isPinnedToBottomRef is
   * true - i.e. while streamed tokens are arriving, the view keeps
   * following them down exactly like any other AI chat, right up until the
   * user manually scrolls up to read something earlier (see the onScroll
   * handler on threadRef below, which is what actually flips that ref).
   * Runs on every token while streaming (messages gets a new array on each
   * one - see the SSE loop below); it used to re-check "is the thread near
   * its bottom" from scroll geometry on every single run, but that read is
   * only accurate relative to wherever the container's scrollTop was left
   * after the LAST scroll - a single update that grows the content by more
   * than that stale-geometry threshold (a multi-line chunk, not just one
   * token) reads as "not near bottom" even though the user never scrolled
   * away, silently stopping autoscroll for the rest of that reply -
   * confirmed as the cause of "new text gets hidden as the conversation
   * continues." Tracking pinned/not-pinned explicitly via user scroll intent
   * (not re-derived from geometry every render) is the standard fix. Sets
   * scrollTop directly rather than messagesEndRef.scrollIntoView(), which
   * scrolls whatever it decides is the nearest scrollable ancestor - direct
   * and unambiguous. The first message load (e.g. re-opening a report being
   * edited, with its full prior transcript) always jumps to the bottom
   * once, regardless of pinned state, since there's nothing to "stay near"
   * yet.
   */
  useEffect(() => {
    const container = threadRef.current;
    if (!container) return;

    if (!hasDoneInitialScrollRef.current) {
      hasDoneInitialScrollRef.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }

    if (isPinnedToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  /** Updates isPinnedToBottomRef from real scroll position - a generous
   * threshold (not 0px) since the user landing back within a few dozen
   * pixels of the bottom (a small deliberate nudge, or momentum settling)
   * should resume following, not require pixel-perfect precision. Cheap on
   * purpose (a ref write, no setState) since scroll fires far more often
   * than this component should ever re-render. */
  function handleThreadScroll() {
    const container = threadRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const transcript = messages
      .filter((message) => !message.localOnly)
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n");
    onTranscriptChange(transcript);
    // onTranscriptChange is a fresh closure each render (it wraps setState in the parent) -
    // depending only on messages keeps this from re-firing on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  /**
   * TCK-111: options.localOnly marks this entire turn (question, streamed
   * answer, and any retry of it) as never counting toward a real report -
   * for the goal-bar "explain this value" flow specifically, which asks
   * the AI a question but isn't the user actually reporting anything new.
   * Without this, the exchange fed into reportText (via the transcript
   * effect below, which already filters out localOnly messages) made
   * isDirty/hasChanges true from a tap that never should have looked like
   * an edit - triggering the unsaved-changes warning, enabling the save
   * icon, and on an actual save, re-submitting the AI's own explanation
   * text as new report content (re-logging items already logged). Mirrors
   * the same localOnly treatment the empty-metric notice branch above
   * already uses - this just extends it to the branch that calls the AI.
   */
  async function sendMessage(
    text: string,
    image?: { base64: string; mimeType: string; previewUrl: string },
    options?: { localOnly?: boolean },
  ) {
    const trimmed = text.trim();
    if ((!trimmed && !image) || isStreaming) return;

    setStreamError(null);
    setRetryAction(null);
    hasSentOnceRef.current = true;
    // A real new turn is starting - any error/success/BMI banner still
    // showing is necessarily about an earlier save, not this one (sending a
    // chat message never itself saves anything - see showFeedback's own
    // comment above), so it stops being shown until the *next* save actually
    // produces new feedback of its own.
    setShowFeedback(false);
    // Actively sending is a clear signal the user wants to be at the
    // bottom again - re-pins even if they'd scrolled up to read earlier
    // messages, same as any other chat app snapping back down on send.
    isPinnedToBottomRef.current = true;
    const historyForRequest = messages.filter((message) => !message.localOnly);
    const userContent = trimmed || tr(locale, "(attached a photo)", "(תמונה מצורפת)");
    setMessages((previous) => [
      ...previous,
      { role: "user", content: userContent, imagePreviewUrl: image?.previewUrl, localOnly: options?.localOnly },
      { role: "assistant", content: "", localOnly: options?.localOnly },
    ]);
    setInputValue("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let timeoutId: ReturnType<typeof setTimeout>;
    const armTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort("timeout"), STREAM_INACTIVITY_TIMEOUT_MS);
    };

    let assistantText = "";
    let receivedAnything = false;
    let errorMessage: string | null = null;
    // TCK-94: set from the stream's own "actionable" event (already
    // computed server-side, previously never read by this client at all)
    // - true once the model's reply contains something concrete to log,
    // which is the trigger for fetching the structured breakdown card
    // below, after the stream itself finishes.
    let isActionable = false;

    try {
      armTimeout();
      const response = await fetch("/api/daily-report/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          chatHistory: historyForRequest.map((message) => ({ role: message.role, content: message.content })),
          imageBase64: image?.base64,
          mimeType: image?.mimeType,
          isEditingExistingEntry: isEditing,
          editingReportId: isEditing ? editingReportId : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(
          response.status === 409
            ? tr(locale, "AI chat is currently unavailable.", "צ'אט ה-AI אינו זמין כרגע.")
            : tr(locale, "The chat request failed. Please try again.", "בקשת הצ'אט נכשלה. יש לנסות שוב."),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armTimeout();
        receivedAnything = true;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const jsonText = line.slice("data:".length).trim();
          if (!jsonText) continue;

          const event = JSON.parse(jsonText) as SseEvent;

          if (event.type === "token") {
            assistantText += event.text;
            setMessages((previous) => {
              const next = [...previous];
              next[next.length - 1] = { role: "assistant", content: assistantText, localOnly: options?.localOnly };
              return next;
            });
          } else if (event.type === "actionable") {
            isActionable = event.value;
          } else if (event.type === "delete_intent") {
            setPendingDeleteOnSave(event.value);
          } else if (event.type === "error") {
            errorMessage = event.message;
          }
        }
      }

      clearTimeout(timeoutId!);
      abortRef.current = null;
    } catch (error) {
      clearTimeout(timeoutId!);
      abortRef.current = null;

      const isTimeout = (error as Error).name === "AbortError" && controller.signal.reason === "timeout";
      const isUserAbort = (error as Error).name === "AbortError" && !isTimeout;

      if (!isUserAbort) {
        const isNetworkError = error instanceof TypeError;
        errorMessage = isTimeout
          ? tr(locale, "This is taking longer than expected. Please retry.", "זה לוקח יותר זמן מהצפוי. יש לנסות שוב.")
          : isNetworkError
            ? tr(locale, "Couldn't reach the server. Please retry.", "לא ניתן להתחבר לשרת. יש לנסות שוב.")
            : error instanceof Error
              ? error.message
              : tr(locale, "The chat request failed. Please try again.", "בקשת הצ'אט נכשלה. יש לנסות שוב.");
      }
    }

    if (errorMessage) {
      setStreamError(errorMessage);
      if (!assistantText && !receivedAnything) {
        setMessages((previous) => previous.slice(0, -1));
        setRetryAction(() => () => sendMessage(text, image, options));
      }
    }

    setIsStreaming(false);

    // TCK-94: fire-and-forget, deliberately AFTER setIsStreaming(false) -
    // never blocks the user from continuing the conversation while this
    // resolves (it's a second AI call, on top of the one that just
    // finished). historyForRequest + this turn's own two messages is the
    // exact same transcript shape "Conclude & Report" itself builds
    // (see handleQuickSave below) - just computed one turn earlier.
    if (isActionable && assistantText && !errorMessage && !options?.localOnly) {
      const transcriptSoFar = [...historyForRequest, { role: "user" as const, content: userContent }, { role: "assistant" as const, content: assistantText }]
        .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
        .join("\n");
      void getDailyReportBreakdownAction(transcriptSoFar).then((result) => {
        if ("items" in result && result.items.length > 0) {
          setMessages((previous) => {
            const next = [...previous];
            const lastIndex = next.length - 1;
            if (next[lastIndex]?.role === "assistant" && next[lastIndex].content === assistantText) {
              next[lastIndex] = { ...next[lastIndex], breakdown: result.items };
            }
            return next;
          });
        }
      });
    }
  }

  /**
   * "Conclude & Report" reads report_text from the parent's `reportText`
   * state, which is only ever updated (via onTranscriptChange) when
   * `messages` changes - i.e. after a real Send round-trip. Typing
   * something and clicking Save without ever hitting Send would otherwise
   * submit whatever was typed in *previous* messages while silently
   * dropping the not-yet-sent text sitting in the box. This folds that
   * pending text in as one final line right before the native form
   * submission fires, so a plain type-then-save works without needing a
   * conversational reply first. flushSync is required here (not just
   * setState) because the button is a native type="submit" - the browser
   * reads the form's current field values immediately after this onClick
   * returns, so the hidden report_text textarea's DOM value must already
   * reflect the merged text by then, not on React's next scheduled render.
   */
  function handleQuickSave() {
    // A native HTML constraint failing (e.g. the weight field's min/max/
    // step) makes the browser silently cancel the submit before it ever
    // reaches handleFormSubmit/saveBlockedSignal in the parent - neither of
    // those ever runs, so nothing would ever clear an optimistically-set
    // spinner (confirmed: reported as "the save icon spins forever" after
    // typing an out-of-range/too-precise weight). reportValidity() both
    // checks and - if something fails - shows the browser's own inline
    // validation bubble on the offending field, exactly like a normal
    // failed submit attempt would, so bailing out here needs no extra
    // messaging of its own.
    const form = document.getElementById("daily-report-form") as HTMLFormElement | null;
    if (form && !form.reportValidity()) {
      return;
    }

    // Set regardless of whether there's unsent text to fold below - a
    // click here always means a real submit is about to happen (there's
    // nothing else this button does), so the spinner should reflect that
    // either way, not just the fold-then-submit case.
    setIsSaving(true);
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    const finalMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    const transcript = finalMessages
      .filter((message) => !message.localOnly)
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n");

    flushSync(() => {
      setMessages(finalMessages);
      onTranscriptChange(transcript);
    });
    setInputValue("");
  }

  // Whether "New chat" has anything to actually lose - a fresh, never-typed-
  // in panel just clears silently instead of prompting over nothing.
  const hasChatContent = messages.length > 0 || inputValue.trim().length > 0 || photoPreviewUrl !== null;

  function handleNewChatClick() {
    if (hasChatContent) {
      setCloseAfterClear(false);
      setPendingClearConfirm(true);
    } else {
      confirmClearChat(false);
    }
  }

  /** The missing fourth option, alongside Save, New chat (clears, stays
   * open), and the floating bubble's X (closes, keeps everything) - "forget about it and
   * close", reported as absent once those other three existed. Shares the
   * exact same confirm dialog and clear logic as New chat - the only
   * difference is closeAfterClear, which tells confirmClearChat to also
   * minimize once it's done. */
  function handleDiscardAndCloseClick() {
    if (hasChatContent) {
      setCloseAfterClear(true);
      setPendingClearConfirm(true);
    } else {
      confirmClearChat(true);
    }
  }

  /** Resets every piece of this panel's own state back to a fresh start -
   * in place, not via a remount (a remount would also reset `isOpen`,
   * silently closing the mobile sheet right when the user asked to keep
   * chatting - reported as "New chat closes the chat box instead of
   * clearing it"). messages resetting is enough on its own to clear
   * report_text too - see the onTranscriptChange effect above, which fires
   * on every messages change including down to empty. closeAfterClear
   * additionally minimizes the sheet once cleared, for the
   * discard-and-close case - defaults to whatever closeAfterClear was last
   * set to (by whichever button opened the confirm dialog), but takes an
   * explicit override too, for the two "nothing to lose, skip the dialog"
   * shortcuts in handleNewChatClick/handleDiscardAndCloseClick above,
   * which call this directly before any state update from setCloseAfterClear
   * would actually be visible yet. */
  function confirmClearChat(shouldCloseAfter: boolean = closeAfterClear) {
    setPendingClearConfirm(false);
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(buildInitialMessages());
    setInputValue("");
    setPhotoPreviewUrl(null);
    setPhotoError(null);
    setPendingDeleteOnSave(false);
    setStreamError(null);
    setRetryAction(null);
    hasSentOnceRef.current = false;
    hasDoneInitialScrollRef.current = false;
    isPinnedToBottomRef.current = true;
    if (shouldCloseAfter) {
      setIsOpen(false);
    }
  }

  /**
   * Logs one saved item immediately at its default quantity - same
   * action, same one-tap-and-done behavior as the global chat widget's
   * own saved-list icon (see global-chat-widget.tsx's handleLogSavedItem
   * for the identical pattern). Deliberately NOT folded into this panel's
   * own compose/transcript flow the way the old checkbox picker's
   * selections were - this creates its own separate report row right
   * away. Success shows only a brief toast (nothing is added to the
   * thread, so nothing lingers on screen - same as a manual save); a
   * failure still lands as a localOnly bubble (shown in the thread,
   * excluded from what Send/Conclude or the AI ever sees).
   */
  async function handleLogSavedItem(item: DailyReportDefaultItem) {
    setIsSavedListOpen(false);
    const result = await logSavedItemFromChatAction(item.id);
    isPinnedToBottomRef.current = true;
    if (result.error) {
      setMessages((previous) => [...previous, { role: "assistant", content: result.error!, localOnly: true }]);
      return;
    }
    const name = formatDefaultItemName(item.name, locale);
    const unit = formatDefaultUnit(item.default_unit, locale);
    // "was saved", not "sent"/"reported" - this already created its own
    // report row via logSavedItemFromChatAction above, so it's done, not
    // something still waiting on the chat's own Send. Hebrew keeps
    // "הדיווח" (the report, always masculine) as the sentence's own subject
    // rather than conjugating a verb to agree with the item name's own
    // gender, which this component has no way to know for an arbitrary
    // saved-list entry.
    if (savedItemToastTimerRef.current) clearTimeout(savedItemToastTimerRef.current);
    setSavedItemToast({
      message: tr(
        locale,
        `The report for ${name} (${item.default_quantity} ${unit}) was saved to today's log.`,
        `הדיווח של ${name} (${item.default_quantity} ${unit}) נשמר ביומן היום.`,
      ),
    });
    savedItemToastTimerRef.current = setTimeout(() => {
      savedItemToastTimerRef.current = null;
      setSavedItemToast({ message: null });
    }, SAVE_TOAST_DURATION_MS);
    router.refresh();
  }

  async function handlePhotoSelected(file: File | null) {
    setPhotoError(null);
    if (!file) return;

    if (!ALLOWED_MEAL_PHOTO_TYPES.includes(file.type)) {
      setPhotoError(tr(locale, "Photo must be a JPEG, PNG, or WEBP image.", "התמונה חייבת להיות מסוג JPEG, PNG או WEBP."));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError(tr(locale, "Photo must be 10 MB or smaller.", "התמונה חייבת להיות עד 10MB."));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPhotoPreviewUrl(previewUrl);
    const base64 = await readFileAsBase64(file);
    const textToSend = inputValue;
    setInputValue("");
    void sendMessage(textToSend, { base64, mimeType: file.type, previewUrl });
  }

  /**
   * The "choose from gallery/files" input intentionally has no `name` of its
   * own, since a second same-named file input would add a second, empty
   * FormData entry that could shadow the real one. Instead, its selection is
   * copied into the canonical meal_photo input via DataTransfer so form
   * submission always reads the right file regardless of which picker the
   * user used.
   */
  function handleGalleryPhotoSelected(file: File | null) {
    if (file && photoInputRef.current) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      photoInputRef.current.files = transfer.files;
    }
    void handlePhotoSelected(file);
  }

  // Whether there's actually anything to save right now - hasChanges covers
  // weight/custom-targets/already-sent chat text (tracked by the parent
  // form), extended here with this panel's own in-progress signals that the
  // parent can't see yet: text typed but not sent, a photo attached this
  // turn, or a saved-list item picked but not folded into a message.
  const canSave = hasChanges || inputValue.trim().length > 0 || Boolean(photoPreviewUrl);

  // The panel's own thread/banners/composer JSX - a fixed-size floating
  // panel now (see the bottom of this file), not a desktop inline card
  // plus a differently-shaped mobile sheet, so there's only ever one copy
  // of this to render. form="daily-report-form" on every form-associated
  // control below (the saved-list icon, the submit button) is what keeps
  // them working since the whole panel is portaled out from under the
  // <form> in the DOM - native form submission is DOM-ancestry-based, so
  // without it a portaled control would silently stop submitting anything.
  const chatBodyContent = (
    <>
      {/* Same header shape as the app-wide global chat widget (avatar +
          title + action icons) - one window's worth of chrome, unified
          across every screen size now that this panel is the same fixed
          floating size everywhere (see the bottom of this file), not a
          full-width desktop card plus a separately-shaped mobile sheet
          that each needed their own header treatment. */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white dark:bg-teal-600">
          <ChatBubbleBadgeIcon className="h-3 w-3" />
        </span>
        <p className="flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Chat about your day", "צ'אט על היום שלך")}</p>
        {/* gap-3.5: same "keep two adjacent icons comfortably apart"
            reasoning already applied to the entry-row quick actions -
            New chat and Discard-and-close are two adjacent destructive-ish
            actions (both clear, after confirming), so a mis-tap here is
            worth avoiding the same way. */}
        <div className="flex shrink-0 items-center gap-3.5">
          <button
            type="button"
            onClick={handleNewChatClick}
            aria-label={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
            title={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
            className="flex h-7 w-7 items-center justify-center rounded-full text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40"
          >
            <NewChatIcon className="h-4 w-4" />
          </button>
          {/* The missing fourth option, alongside Save, New chat (clears,
              stays open), and the floating bubble's X (closes, keeps
              everything) - "forget about it and close". Grouped next to
              New chat (both are "clear the conversation" variants, just
              with a different outcome afterward). Closing without clearing
              is done through the floating bubble's X, not a header
              button (TCK-89 removed the duplicate Minimize). */}
          <button
            type="button"
            onClick={handleDiscardAndCloseClick}
            aria-label={tr(locale, "Discard and close", "התעלמות וסגירה")}
            title={tr(locale, "Discard and close", "התעלמות וסגירה")}
            className="flex h-7 w-7 items-center justify-center rounded-full text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

        {/* min-h-0: without it, a flex item defaults to a content-based
            auto min-height, so a long AI reply grew this column taller
            than the panel's own max-height instead of being constrained to
            it - threadRef's own overflow-y-auto never got a chance to
            scroll, and the composer/save-list row after it got pushed
            below the panel's visible bounds and clipped by its
            overflow-hidden, reading as "the reply covers the compose area
            and nothing scrolls". The classic flexbox-scroll-area fix. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={threadRef} onScroll={handleThreadScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {messages.map((message, index) => (
            <div key={index} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  message.role === "user" ? "bg-teal-700 text-white dark:bg-teal-600" : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {message.imagePreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={message.imagePreviewUrl} alt="" className="mb-1.5 h-28 w-28 rounded-lg object-cover" />
                ) : null}
                {message.content || (isStreaming && index === messages.length - 1 ? "…" : "")}
                {/* TCK-94: structured breakdown card, matching the design
                    from the ticket - display only, computed separately
                    (see getDailyReportBreakdownAction's own comment); what
                    actually gets saved still comes from the free-text
                    transcript exactly as before. */}
                {message.breakdown && message.breakdown.length > 0 ? (
                  <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    {message.breakdown.map((item, itemIndex) => (
                      <div
                        key={itemIndex}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs ${
                          itemIndex > 0 ? "border-t border-slate-100 dark:border-slate-800" : ""
                        }`}
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{formatDefaultItemName(item.name, locale)}</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {item.quantity} {formatDefaultUnit(item.unit, locale)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {photoError ? (
        <div className="border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">{photoError}</div>
      ) : null}

      {streamError ? (
        <div className="flex items-center justify-between gap-2 border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
          <span>{streamError}</span>
          {retryAction ? (
            <button
              type="button"
              onClick={() => retryAction()}
              className="shrink-0 rounded-lg border border-rose-300 bg-white px-2 py-1 font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/50"
            >
              {tr(locale, "Retry", "ניסיון חוזר")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-slate-200 p-3 empty:hidden dark:border-slate-800">
        {showFeedback && saveError ? (
          <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">{saveError}</p>
        ) : null}
        {/* saveSuccess itself isn't rendered here - DailyReportForm now
            shows it as a brief centered toast (see DailyReportSuccessToast)
            instead of a banner that stuck around inline until the user's
            next action. saveSuccess is still passed into this component and
            still feeds feedbackKey below, which is what actually clears the
            save spinner once a save resolves - only the old inline
            <p> banner was removed. */}
        {showFeedback && bmiWarning ? (
          <div className="mb-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 dark:border-rose-800 dark:bg-rose-950/30">
            <p className="text-sm font-semibold text-rose-900 dark:text-rose-300">
              {tr(locale, "Your weight is outside the healthy BMI range", "המשקל שלך מחוץ לטווח ה-BMI הבריא")}
            </p>
            <p className="mt-1 text-sm text-rose-800 dark:text-rose-400">{bmiWarning}</p>
          </div>
        ) : null}
      </div>

      {/* No longer independently fixed/pinned - it's now just the bottom
          portion of the floating panel below, so this only needs its own
          border/spacing, not its own positioning. The safe-area bottom
          padding below is still needed even so: the panel's own bottom
          edge can sit close to the true viewport edge on a phone, same as
          the old pinned dock did, so this still needs to clear the home
          indicator on notched phones. */}
      <div className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="space-y-2 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2">
          {/* A plain div, not a <form>: this panel is always mounted inside the
              page's own report <form>, and a nested <form> is invalid HTML
              that Next.js silently repairs by moving/dropping it, breaking
              this input after the first re-render. The Send button's onClick
              covers submission without needing form semantics - Enter is
              deliberately left as the textarea's own default behavior (insert
              a newline) rather than intercepted to send, so composing a
              multi-line message doesn't risk firing it off mid-thought. */}
          {/* Moved here from the message thread above (where it used to sit
              styled like an assistant reply, which it isn't - it's guidance
              about using the composer below it, so it reads more naturally
              next to the composer it's actually describing) - shown only
              before the first message, same as before. */}
          {messages.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {/* TCK-38: the disclaimer sentence up front, every time a
                  fresh conversation starts (this whole block resets on New
                  chat - see confirmClearChat) - not gendered like the rest
                  of this sentence since it's about Daffy, not the user. */}
              {tr(
                locale,
                "Daffy is an AI companion, not a substitute for professional medical or nutrition advice. ",
                "דפי היא מלווה מבוססת AI ואינה תחליף לייעוץ רפואי או תזונתי מקצועי. ",
              )}
              {/* Singular, gender-correct Hebrew (את/אתה + matching verb
                  forms) - see buildInitialMessages' own comment on why the
                  original plural/formal conjugations were wrong here.
                  userGender "unknown"/null falls back to the male forms via
                  trGendered, same fallback the AI system prompts use. */}
              {trGendered(
                locale,
                userGender,
                `${userFirstName ? `Hi ${userFirstName}, tell` : "Tell"} me what you ate, drank, or did for exercise today (or attach a photo), and I'll help fill in the details. When you're ready, tap the report icon to add it to today's log.`,
                `${userFirstName ? `היי ${userFirstName}, ` : ""}ספר לי מה אכלת, שתית או עשית מבחינת פעילות גופנית היום (או צרף תמונה), ואעזור להשלים את הפרטים. כשתהיה מוכן, לחץ על סמל הדיווח כדי להוסיף זאת ליומן של היום.`,
                `${userFirstName ? `היי ${userFirstName}, ` : ""}ספרי לי מה אכלת, שתית או עשית מבחינת פעילות גופנית היום (או צרפי תמונה), ואעזור להשלים את הפרטים. כשתהיי מוכנה, לחצי על סמל הדיווח כדי להוסיף זאת ליומן של היום.`,
              )}
            </p>
          ) : null}

          {/* Icons sit on their own row above the compose box (not
              alongside it) - three icon buttons plus Send crammed onto one
              row next to the textarea left almost no room for typing on a
              phone-width panel. This is now the ONE layout at every
              width, matching the global chat widget's own input row
              shape, rather than a row that only wrapped below a
              breakpoint. */}
          <div className="relative flex items-center gap-2">
            {/* Same generic icon-button style as the global chat widget's
                saved-list icon (rounded-lg, neutral border, teal only on
                hover/active) - applied to all icons here too, per the
                restyle to look "almost like the main one." */}
            <button
              ref={savedListTriggerRef}
              type="button"
              onClick={() => setIsSavedListOpen((open) => !open)}
              aria-label={tr(locale, "Add from saved list", "הוספה מהרשימה השמורה")}
              title={tr(locale, "Add from saved list", "הוספה מהרשימה השמורה")}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                isSavedListOpen
                  ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-400"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </button>
            <label
              htmlFor="daily-report-chat-photo-input"
              aria-label={tr(locale, "Take a photo of your plate", "צילום תמונה של הצלחת")}
              title={tr(locale, "Take a photo of your plate", "צילום תמונה של הצלחת")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <path d="M9 3h6l1.5 3H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5L9 3Z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </label>
            <label
              aria-label={tr(locale, "Choose an existing photo or file", "בחירת תמונה או קובץ קיים")}
              title={tr(locale, "Choose an existing photo or file", "בחירת תמונה או קובץ קיים")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => photoGalleryInputRef.current?.click()}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </label>

            <SavedListQuickPicker
              isOpen={isSavedListOpen}
              onClose={() => setIsSavedListOpen(false)}
              items={defaultItems.map((item) => ({ id: item.id, name: item.name, kind: item.kind, quantity: item.default_quantity, unit: item.default_unit }))}
              locale={locale}
              onSelect={(id) => {
                const item = defaultItems.find((entry) => entry.id === id);
                if (item) void handleLogSavedItem(item);
              }}
              triggerRef={savedListTriggerRef}
            />

            {/* Report, moved here from a full-width button under Send
                (reported as "too big, wrongly placed, keeps getting hit
                instead of Send" - a full-width action right under Send,
                tapped on every message, is exactly backwards: the rare,
                session-ending action had the easiest-to-hit spot on the
                whole panel). A small, permanently filled circle at the far
                end of this row - opposite the neutral attach icons, so it
                doesn't blend in - puts real distance between it and
                wherever a thumb lands to hit Send. Skipped entirely during
                the delete-entry-confirmation state below, which keeps its
                own full-width warning treatment - that one's a deliberate,
                already-confirmed destructive action, not a routine save,
                so it doesn't carry the same "too easy to hit by accident"
                risk this change is fixing. */}
            {isEditing && pendingDeleteOnSave ? null : (
              <>
                <span className="flex-1" />
                {/* disabled={!canSave}: this icon is always visible now (a
                    fixed, learnable spot - unlike the floating quick-save
                    trigger elsewhere in this file, which instead skips
                    rendering entirely while canSave is false), so it needs
                    its own guard against the same case that trigger
                    already avoids by not existing yet. Without this, a tap
                    with nothing typed/attached fired a real save attempt
                    that correctly failed validation ("add free text, a
                    photo, ...") - live and reproducible - and that error
                    banner then sat there stale through whatever the user
                    did next (e.g. a saved-list quick-add), reading as if
                    THAT had failed. Disabling it here prevents the
                    avoidable failure outright instead of just explaining
                    it after the fact. */}
                <SubmitButton
                  locale={locale}
                  onClick={handleQuickSave}
                  isEditing={isEditing}
                  variant="icon"
                  size="sm"
                  disabled={!canSave}
                  busy={isSaving}
                  form="daily-report-form"
                />
              </>
            )}
          </div>

          {/* Bigger than before (4 rows, not 2) now that it has the whole
              row to itself instead of sharing one with three icon
              buttons. */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            rows={4}
            maxLength={500}
            disabled={isStreaming}
            // Singular, gender-correct Hebrew imperative (כתוב/כתבי) -
            // see the subtitle above for why the original plural form
            // ("כתבו") was wrong here too.
            placeholder={trGendered(locale, userGender, "Type a message...", "כתוב הודעה...", "כתבי הודעה...")}
            className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 disabled:opacity-70 dark:border-slate-700"
            // Inline style, not dark:bg-slate-900/dark:text-slate-100 -
            // confirmed live (DevTools computed-style check) that this
            // specific textarea keeps a plain white background under
            // data-theme="dark" even with ONLY the dark: class applied
            // and nothing competing for specificity, while an inline
            // style on the exact same element takes effect immediately.
            // Root cause not fully pinned down (a textarea/form-control-
            // specific quirk with this Tailwind build, not the general
            // theme-mirroring issue this panel already works around for
            // being portaled - every other dark: class here, including
            // this same textarea's own dark:border-slate-700, applies
            // correctly) - inline style sidesteps it outright rather
            // than leaving the compose box the one visibly broken
            // element after everything else in the panel is already
            // properly dark.
            style={mirroredTheme === "dark" ? { backgroundColor: "#0f172a", color: "#f1f5f9" } : undefined}
          />
          {/* Send is now the composer's own full-width primary action - the
              one actually tapped on every single message - instead of
              sharing a cramped row with the textarea next to a big Report
              button right below it. Report itself moved up into the
              attach-icon row above (see its own comment there). */}
          <button
            type="button"
            disabled={isStreaming || !inputValue.trim()}
            onClick={() => void sendMessage(inputValue)}
            onMouseDown={(event) => event.preventDefault()}
            className="flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            {isStreaming ? <Spinner className="h-4 w-4 animate-spin" /> : tr(locale, "Send", "שליחה")}
          </button>

          {/* TCK-38's standing disclaimer, now also the short save reminder
              for every turn after the first (see buildInitialMessages'
              own comment above, in the same vein, for the fuller one-time
              version shown before any message exists). Deliberately no
              directional wording ("above"/"below") - which spot in the
              text this reads next to isn't fixed relative to the icon
              once the thread scrolls, so a direction would sometimes be
              wrong. isEditing branches the icon's own name - SubmitButton's
              idleLabel is "Report" for a new entry but "Save changes" once
              editing an existing one (see its own definition), so this
              stays accurate in both modes instead of picking one label and
              being wrong in the other. */}
          <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
            {tr(
              locale,
              `Daffy is an AI companion, not a substitute for professional medical or nutrition advice. Tap the ${isEditing ? "save" : "report"} icon to save.`,
              `דפי היא מלווה מבוססת AI ואינה תחליף לייעוץ רפואי או תזונתי מקצועי. לחצו על סמל ה${isEditing ? "שמירה" : "דיווח"} כדי לשמור.`,
            )}
          </p>

          {isEditing && pendingDeleteOnSave ? <DeleteEntrySubmitButton locale={locale} variant="text" /> : null}
        </div>
      </div>
    </>
  );

  return (
    <>
      <DailyReportSuccessToast locale={locale} message={savedItemToast.message} />
      <input
        ref={photoGalleryInputRef}
        type="file"
        accept="image/*"
        onChange={(event) => handleGalleryPhotoSelected(event.target.files?.[0] ?? null)}
        className="sr-only"
      />
      <input
        ref={photoInputRef}
        id="daily-report-chat-photo-input"
        name="meal_photo"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void handlePhotoSelected(event.target.files?.[0] ?? null)}
        className="sr-only"
      />

      {/* The floating trigger + bubble + panel, portaled straight to
          document.body instead of rendering inline here, on every screen
          size now (not mobile-only) - this used to be nested many levels
          deep (page -> section -> form -> div -> this component), and on
          at least one real device that nesting broke position:fixed
          entirely - the bubble rendered wherever its calc() offset
          happened to land within the page's own layout instead of pinned
          to the true viewport. Portaling sidesteps the ancestry question
          entirely: these elements become siblings of everything else at
          the body level, the same place AppBottomNav already lives and
          already positions correctly. The form-associated controls inside
          (the save icon, and everything in chatBodyContent) reconnect to
          the real form via form="daily-report-form" instead of DOM
          nesting - see the inline notes on chatBodyContent and
          DailyReportForm's <form id=...>.

          Same fixed floating bubble + compact panel footprint as the
          app-wide global chat widget everywhere else (see
          global-chat-widget.tsx) - this is still Daily Report's own
          separate chat instance underneath (photo parsing, editing an
          existing entry, weight sync, Report), just presented through the
          same small surface instead of an always-visible full-width
          desktop card or a large percentage-of-viewport mobile sheet. No
          dimming backdrop either, to match that widget - tap the bubble
          (X) again to close, rather than tapping
          outside. */}
      {isMounted && createPortal(
        // dir set explicitly here - the app only applies dir="rtl"/"ltr"
        // on a wrapper <div> inside app/app/layout.tsx, not on
        // <html>/<body> - portaling straight to document.body (see the
        // big comment above) escapes that wrapper entirely, so without
        // this the whole panel/bubble would fall back to the document's
        // default LTR direction even in Hebrew, left-aligning Hebrew text
        // instead of right-aligning it. The fixed-position buttons inside
        // are unaffected either way - they're deliberately pinned with
        // physical left-4/right-4 classes, not logical ones (see their
        // own comment).
        <div dir={directionForLocale(locale)} data-theme={mirroredTheme ?? undefined}>
          {/* end-4 (a logical inset, not right-4/left-4) mirrors naturally
              with locale via the dir set on this whole portaled tree
              above (unlike the physically-pinned bubble/panel corner
              below, which is deliberately NOT locale-mirrored - see its
              own comment). Only rendered while closed (once the panel is
              open, Report lives inside it instead - see chatBodyContent's
              own full-width SubmitButton) AND only while there's actually
              something to save: canSave already reflects LIVE dirty state
              (weight/report text compared against their saved baselines,
              not a one-way "was this ever touched" flag), so undoing a
              change - e.g. typing a weight then deleting it back to empty
              - correctly makes this disappear again, not just gray out. */}
          {!isOpen && (canSave || (isEditing && pendingDeleteOnSave)) ? (
            <div className="fixed top-[calc(2rem+env(safe-area-inset-top))] end-4 z-50 transform-gpu">
              {isEditing && pendingDeleteOnSave ? (
                <DeleteEntrySubmitButton locale={locale} variant="icon" />
              ) : (
                <SubmitButton
                  locale={locale}
                  onClick={handleQuickSave}
                  isEditing={isEditing}
                  variant="bare-icon"
                  busy={isSaving}
                  form="daily-report-form"
                />
              )}
            </div>
          ) : null}

          {/* Same physical bottom-right position, size, and safe-area
              handling as the global chat widget's own bubble (see that
              component's own comment for the calc()/underscore details) -
              deliberately NOT locale-mirrored, matching every other
              floating chat bubble in the app. */}
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-label={tr(locale, isOpen ? "Close chat" : "Open chat", isOpen ? "סגירת הצ'אט" : "פתיחת הצ'אט")}
            className="fixed bottom-[calc(3.25rem+env(safe-area-inset-bottom)+0.75rem)] right-[calc(12.5vw_-_2rem)] z-50 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            {isOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            )}
          </button>

          {isOpen ? (
            <div className="fixed bottom-[calc(8rem+env(safe-area-inset-bottom))] right-[calc(12.5vw_-_2rem)] z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
              {chatBodyContent}
            </div>
          ) : null}
        </div>,
        document.body,
      )}

      {/* Portaled to document.body - the panel itself sits inside an
          overflow-hidden wrapper (see DailyReportForm), the exact ancestor
          shape that already silently clipped a fixed-positioned
          confirmation elsewhere in this form. pendingClearConfirm only
          ever flips true from a real click, never during the initial
          render, so this never runs during SSR/hydration. */}
      {pendingClearConfirm
        ? createPortal(
            // dir set explicitly - see the sheet portal's own comment above
            // on why a portal to document.body can't rely on inheriting it.
            <div dir={directionForLocale(locale)} data-theme={mirroredTheme ?? undefined} className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
              <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
                <div className="px-5 py-4">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {closeAfterClear
                      ? tr(
                          locale,
                          "Discard this conversation and close the chat? Anything not yet saved will be lost.",
                          "להתעלם מהשיחה הזו ולסגור את הצ'אט? כל מה שלא נשמר עדיין יאבד.",
                        )
                      : tr(
                          locale,
                          "Start a new chat? This clears the current conversation - anything not yet saved will be lost.",
                          "להתחיל צ'אט חדש? פעולה זו מנקה את השיחה הנוכחית - כל מה שלא נשמר עדיין יאבד.",
                        )}
                  </p>
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setPendingClearConfirm(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {tr(locale, "Cancel", "ביטול")}
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmClearChat()}
                    className="rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500"
                  >
                    {closeAfterClear
                      ? tr(locale, "Discard and close", "התעלמות וסגירה")
                      : tr(locale, "Start new chat", "התחלת צ'אט חדש")}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
