"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync, useFormStatus } from "react-dom";

import { deleteDailyReportAction } from "@/app/app/daily-report/actions";
import { DailyReportDefaultsPicker, type DailyReportDefaultItem, type SelectedSavedListItem } from "@/components/daily-report-defaults-picker";
import { SubmitButton } from "@/components/daily-report-submit-button";
import { directionForLocale, formatDefaultUnit, tr, trGendered, type AppLocale } from "@/lib/locale";

export type { DailyReportDefaultItem };

/**
 * The `sm` breakpoint (640px), read live off matchMedia - the canonical way
 * to subscribe to a browser API that can change on its own (window resize,
 * device rotation) is useSyncExternalStore, not useEffect+setState (which
 * both trips the react-hooks/set-state-in-effect lint rule and, more
 * importantly, doesn't have a built-in answer for what to render during SSR/
 * first hydration). getServerSnapshot deliberately returns true ("assume
 * desktop") rather than a "not yet known" placeholder: the desktop render
 * path is a plain inline div, safe to produce with no client-only APIs, so
 * SSR and the first client paint can safely agree on it - the real value
 * (and the mobile portal path, which does need `document`) only takes over
 * once this resolves on the client, which is also the earliest point
 * `document` is guaranteed to exist anyway.
 */
function subscribeToViewport(callback: () => void) {
  const mql = window.matchMedia("(min-width: 640px)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
function getViewportSnapshot(): boolean {
  return window.matchMedia("(min-width: 640px)").matches;
}
function getServerViewportSnapshot(): boolean {
  return true;
}

/**
 * The actual visible height in CSS pixels, per window.visualViewport - the
 * one API iOS Safari itself provides specifically to answer "how much
 * screen can the user currently see", built to solve exactly this class of
 * problem. Used instead of svh/dvh for the mobile chat sheet's height:
 * three rounds of CSS-viewport-unit adjustments (82dvh, then 78dvh, then
 * 70svh with extra safe-area padding) all still left the composer/Send
 * button below the visible area on a real device, meaning this browser's
 * dvh/svh weren't tracking the actual visible viewport the way the spec
 * describes here. Measuring the real value directly removes the guesswork
 * (and the unit) entirely - falls back to a fixed 70svh via CSS only for
 * the instant before this first measurement lands, or on a browser too old
 * to have visualViewport at all.
 */
function subscribeToVisualViewport(callback: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", callback);
  return () => vv.removeEventListener("resize", callback);
}
function getVisualViewportHeight(): number | null {
  return window.visualViewport?.height ?? null;
}
function getServerVisualViewportHeight(): number | null {
  return null;
}

type ChatMessage = { role: "user" | "assistant"; content: string; imagePreviewUrl?: string };
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
          pending ? "cursor-not-allowed bg-slate-200 text-slate-400 shadow-none" : "bg-rose-700 text-white hover:bg-rose-800"
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
      className="inline-flex w-full items-center justify-center rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-rose-800"
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
      `${namePrefix}you're editing this saved entry.${includesEn}Tell me what to add, change, or remove, and I'll update it - you can save once you're happy with it.`,
      `${namePrefix}אתה עורך את הרשומה השמורה הזו.${includesHe}ספר לי מה להוסיף, לשנות או להסיר, ואעדכן אותה - תוכל לשמור ברגע שתהיה מרוצה מהתוצאה.`,
      `${namePrefix}את עורכת את הרשומה השמורה הזו.${includesHe}ספרי לי מה להוסיף, לשנות או להסיר, ואעדכן אותה - תוכלי לשמור ברגע שתהיי מרוצה מהתוצאה.`,
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
  const [selectedSavedListItems, setSelectedSavedListItems] = useState<SelectedSavedListItem[]>([]);
  // Edit mode only - true once the model's latest reply confirmed the user
  // wants to delete this whole entry (see the "delete_intent" SSE event and
  // isEditingExistingEntry below), swapping Save for a delete action so
  // hitting the same button removes the entry instead of updating it.
  const [pendingDeleteOnSave, setPendingDeleteOnSave] = useState(false);
  // "New chat" - shown only while there's actually something to lose (see
  // hasChatContent below); otherwise the button clears immediately with no
  // prompt. Deliberately false-by-default and only ever flipped true from a
  // real click handler, never during the initial render - a portal keyed on
  // it further below (see pendingClearConfirm's own JSX) can therefore
  // never fire during SSR/hydration, no separate "is this mounted yet" gate
  // needed the way isDesktopViewport's portal requires one.
  const [pendingClearConfirm, setPendingClearConfirm] = useState(false);
  // Tracks "a save was just triggered" independently of useFormStatus's own
  // pending flag - see the effect below for why. Purely a visual signal
  // (spinner + disabled) for the save buttons; it never gates what actually
  // gets submitted.
  const [isSaving, setIsSaving] = useState(false);
  // Drives the desktop-inline-card vs. mobile-portal-cluster split near the
  // bottom of this component - see subscribeToViewport/getViewportSnapshot
  // above for why this needs a definite yes/no rather than relying on CSS
  // breakpoints to hide one of two simultaneously-mounted copies (a
  // portaled copy's form fields would otherwise double up with the desktop
  // copy's on desktop - same `name` attributes, both actually mounted,
  // both submitting).
  const isDesktopViewport = useSyncExternalStore(subscribeToViewport, getViewportSnapshot, getServerViewportSnapshot);
  // See getVisualViewportHeight's own comment - drives the mobile sheet's
  // actual pixel height below instead of a CSS viewport-unit guess.
  const visualViewportHeight = useSyncExternalStore(
    subscribeToVisualViewport,
    getVisualViewportHeight,
    getServerVisualViewportHeight,
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const hasDoneInitialScrollRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasSentOnceRef = useRef(false);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Locks the page behind the sheet from scrolling while it's open - without
  // this, a touch-scroll gesture that starts anywhere the sheet doesn't
  // fully cover (or that the browser routes to the page underneath for its
  // own reasons) scrolls the REPORT PAGE itself, not the sheet. Since the
  // sheet is fixed in place, that made the page's own content (the goal
  // bars, entries list) visibly slide up through/behind it while the sheet
  // stayed put - confirmed as the cause of the weight/macro chart appearing
  // to overlay the chat sheet on scroll.
  //
  // Plain `overflow: hidden` on body is NOT enough on iOS Safari - it's a
  // well-known iOS quirk that background touch-scroll/rubber-banding still
  // gets through regardless. The reliable cross-browser fix also pins the
  // body in place via position:fixed (capturing the current scroll offset
  // as a negative `top` so nothing visibly jumps) and restores the exact
  // scroll position on close.
  useEffect(() => {
    if (!isOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

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
  const feedbackKey = `${saveError ?? ""}|${saveSuccess ?? ""}|${bmiWarning ?? ""}`;
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
   * Runs on every token while streaming (messages gets a new array on each
   * one - see the SSE loop below), so it used to unconditionally re-run
   * scrollIntoView({behavior:"smooth"}) dozens of times per reply: each call
   * interrupts the previous still-animating scroll and starts a new one,
   * which is the actual source of the jumpiness, not just the refocus above.
   * Two fixes: only auto-scroll when the thread was already scrolled at (or
   * very near) its own bottom - so reading back through earlier messages
   * isn't fought by every incoming token - and use an instant jump instead
   * of an animated one, since a token-by-token smooth-scroll never finishes
   * settling before the next token retriggers it anyway. The first message
   * load (e.g. re-opening a report being edited, with its full prior
   * transcript) always jumps to the bottom once, regardless of scroll
   * position, since there's nothing to "stay near" yet.
   */
  useEffect(() => {
    const container = threadRef.current;
    if (!container) return;

    if (!hasDoneInitialScrollRef.current) {
      hasDoneInitialScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 100) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [messages, selectedSavedListItems]);

  useEffect(() => {
    const transcript = messages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n");
    onTranscriptChange(transcript);
    // onTranscriptChange is a fresh closure each render (it wraps setState in the parent) -
    // depending only on messages keeps this from re-firing on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  async function sendMessage(text: string, image?: { base64: string; mimeType: string; previewUrl: string }) {
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
    const historyForRequest = messages;
    const userContent = trimmed || tr(locale, "(attached a photo)", "(תמונה מצורפת)");
    setMessages((previous) => [
      ...previous,
      { role: "user", content: userContent, imagePreviewUrl: image?.previewUrl },
      { role: "assistant", content: "" },
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
              next[next.length - 1] = { role: "assistant", content: assistantText };
              return next;
            });
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
        setRetryAction(() => () => sendMessage(text, image));
      }
    }

    setIsStreaming(false);
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
    const transcript = finalMessages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n");

    flushSync(() => {
      setMessages(finalMessages);
      onTranscriptChange(transcript);
    });
    setInputValue("");
  }

  // Whether "New chat" has anything to actually lose - a fresh, never-typed-
  // in panel just clears silently instead of prompting over nothing.
  const hasChatContent =
    messages.length > 0 || inputValue.trim().length > 0 || photoPreviewUrl !== null || selectedSavedListItems.length > 0;

  function handleNewChatClick() {
    if (hasChatContent) {
      setPendingClearConfirm(true);
    } else {
      confirmClearChat();
    }
  }

  /** Resets every piece of this panel's own state back to a fresh start -
   * in place, not via a remount (a remount would also reset `isOpen`,
   * silently closing the mobile sheet right when the user asked to keep
   * chatting - reported as "New chat closes the chat box instead of
   * clearing it"). messages resetting is enough on its own to clear
   * report_text too - see the onTranscriptChange effect above, which fires
   * on every messages change including down to empty. */
  function confirmClearChat() {
    setPendingClearConfirm(false);
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(buildInitialMessages());
    setInputValue("");
    setPhotoPreviewUrl(null);
    setPhotoError(null);
    setSelectedSavedListItems([]);
    setPendingDeleteOnSave(false);
    setStreamError(null);
    setRetryAction(null);
    hasSentOnceRef.current = false;
    hasDoneInitialScrollRef.current = false;
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

  function clearAttachedPhoto() {
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (photoGalleryInputRef.current) photoGalleryInputRef.current.value = "";
    setPhotoPreviewUrl(null);
  }

  const hasThreadContent = messages.length > 0 || isStreaming;
  // Whether there's actually anything to save right now - hasChanges covers
  // weight/custom-targets/already-sent chat text (tracked by the parent
  // form), extended here with this panel's own in-progress signals that the
  // parent can't see yet: text typed but not sent, a photo attached this
  // turn, or a saved-list item picked but not folded into a message.
  const canSave = hasChanges || inputValue.trim().length > 0 || Boolean(photoPreviewUrl) || selectedSavedListItems.length > 0;

  // Reserved gap (flat px, not a CSS calc with env(safe-area-inset-bottom)
  // like the button row below uses - this needs to already be baked into a
  // plain JS-computed pixel offset) between the open sheet's bottom edge and
  // the true viewport bottom, so the sheet stops above the floating
  // save/close button row instead of running flush underneath it. Both used
  // to be fixed to that same physical corner independently, which put the
  // buttons visually on top of the sheet's own bottom content (the
  // saved-list picker row) since the sheet's z-40 sits under the buttons'
  // z-50 - reported as the buttons "blocking the list of saved items".
  // Generous on purpose (comfortably covers the button row's own
  // height/offset/safe-area on any real device) rather than trying to
  // compute an exact fit. 144, not 128: the chat toggle button grew from
  // h-14 (56px) to h-16 (64px), so 128 (offset ~64px + old 56px button, no
  // spare margin) stopped leaving any real buffer above it.
  const SHEET_BUTTON_CLEARANCE_PX = 144;
  // 72% of the actually-measured visible height (see getVisualViewportHeight)
  // for the mobile sheet - null until that measurement lands, in which case
  // the sheet falls back to a fixed CSS height for that brief instant (see
  // its own comment below). The sheet's own height is unchanged by
  // SHEET_BUTTON_CLEARANCE_PX (shrinking it instead of shifting it up used
  // to leave too little room for the thread, clipping the composer below a
  // long AI reply instead of properly scrolling past it - see the min-h-0
  // fix in chatBodyContent, which was the other half of that bug) - only
  // sheetTopPx moves further up, opening the clearance gap below the sheet
  // rather than eating into it.
  const sheetHeightPx = visualViewportHeight !== null ? Math.round(visualViewportHeight * 0.72) : null;
  const sheetTopPx =
    visualViewportHeight !== null && sheetHeightPx !== null
      ? Math.round(visualViewportHeight - sheetHeightPx - SHEET_BUTTON_CLEARANCE_PX)
      : null;

  // Shared between the desktop inline card and the mobile portaled sheet -
  // same thread/banners/composer JSX either way (the sm: classes sprinkled
  // through it already resolve correctly in both render modes, since
  // whichever mode is active only ever renders at a viewport where those
  // classes would resolve the same way CSS breakpoints already made them
  // resolve). form="daily-report-form" on every form-associated control
  // below (the saved-list picker's checkboxes, the submit button) is what
  // keeps them working once the mobile copy is portaled out from under the
  // <form> in the DOM - native form submission is DOM-ancestry-based, so
  // without it a portaled control would silently stop submitting anything.
  const chatBodyContent = (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:hidden">
          <div>
            <p className="text-sm font-semibold text-slate-900">{tr(locale, "Chat about your day", "צ'אט על היום שלך")}</p>
            <p className="text-xs text-slate-500">
              {/* Singular, gender-correct Hebrew imperative (רשום/רשמי) -
                  the original used the plural form ("רשמו"), inconsistent
                  with the app's one-user addressing and the persona rules
                  elsewhere (see lib/ai/persona.ts). */}
              {trGendered(
                locale,
                userGender,
                "Log meals, activity, and weight in one conversation",
                "רשום ארוחות, פעילות ומשקל בשיחה אחת",
                "רשמי ארוחות, פעילות ומשקל בשיחה אחת",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleNewChatClick}
            aria-label={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
            title={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
            className="flex shrink-0 items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <NewChatIcon className="h-3.5 w-3.5" />
            {tr(locale, "New chat", "צ'אט חדש")}
          </button>
        </div>

        {/* Desktop only - the mobile header above already carries this
            button, but desktop's own "Chat about your day" title lives in
            DailyReportForm (outside this shared JSX), so this thin bar is
            the only place left for it there. */}
        <div className="hidden items-center justify-end border-b border-slate-200 px-3 py-1.5 sm:flex">
          <button
            type="button"
            onClick={handleNewChatClick}
            aria-label={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
            title={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
            className="flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <NewChatIcon className="h-3.5 w-3.5" />
            {tr(locale, "New chat", "צ'אט חדש")}
          </button>
        </div>

        {/* min-h-0 on both this wrapper and threadRef below: without it, a
            flex item defaults to a content-based auto min-height, so a long
            AI reply grew this column taller than the sheet's own fixed
            height (see sheetHeightPx above) instead of being constrained to
            it - threadRef's own overflow-y-auto never got a chance to
            scroll, and the composer/save-list row after it got pushed below
            the sheet's visible bounds and clipped by its overflow-hidden,
            reading as "the reply covers the compose area and nothing
            scrolls". The classic flexbox-scroll-area fix. */}
        <div className={`flex min-h-0 flex-1 flex-col sm:flex-none ${hasThreadContent ? "sm:h-[380px]" : ""}`}>
          <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {messages.map((message, index) => (
            <div key={index} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  message.role === "user" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-800"
                }`}
              >
                {message.imagePreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={message.imagePreviewUrl} alt="" className="mb-1.5 h-28 w-28 rounded-lg object-cover" />
                ) : null}
                {message.content || (isStreaming && index === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
          {selectedSavedListItems.length ? (
            <div className="flex flex-col items-end">
              <div className="max-w-[85%] rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-700">
                  {tr(locale, "From your saved list", "מהרשימה השמורה")}
                </p>
                {selectedSavedListItems
                  .map((item) => `${item.name} (${item.quantity} ${formatDefaultUnit(item.unit, locale)})`)
                  .join(", ")}
              </div>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {photoError ? (
        <div className="border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{photoError}</div>
      ) : null}

      {streamError ? (
        <div className="flex items-center justify-between gap-2 border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <span>{streamError}</span>
          {retryAction ? (
            <button
              type="button"
              onClick={() => retryAction()}
              className="shrink-0 rounded-lg border border-rose-300 bg-white px-2 py-1 font-semibold text-rose-700 hover:bg-rose-100"
            >
              {tr(locale, "Retry", "ניסיון חוזר")}
            </button>
          ) : null}
        </div>
      ) : null}

      {photoPreviewUrl ? (
        <div className="flex items-center justify-between gap-2 border-t border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          <span>
            {tr(
              locale,
              "A photo is attached and will be analyzed by AI when you save.",
              "תמונה מצורפת ותנותח על ידי AI בעת השמירה.",
            )}
          </span>
          <button
            type="button"
            onClick={clearAttachedPhoto}
            className="shrink-0 rounded-full border border-teal-300 bg-white px-2 py-1 font-semibold text-teal-700 hover:bg-teal-100"
          >
            {tr(locale, "Remove", "הסרה")}
          </button>
        </div>
      ) : null}

      <div className="border-t border-slate-200 p-3 empty:hidden">
        {showFeedback && saveError ? (
          <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</p>
        ) : null}
        {showFeedback && saveSuccess ? (
          <p className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{saveSuccess}</p>
        ) : null}
        {showFeedback && bmiWarning ? (
          <div className="mb-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2">
            <p className="text-sm font-semibold text-rose-900">
              {tr(locale, "Your weight is outside the healthy BMI range", "המשקל שלך מחוץ לטווח ה-BMI הבריא")}
            </p>
            <p className="mt-1 text-sm text-rose-800">{bmiWarning}</p>
          </div>
        ) : null}
      </div>

      {/* No longer independently fixed/pinned - it's now just the bottom
          portion of the sheet div above (which is itself fixed on mobile
          when open, static at `sm` and up), so this only needs its own
          border/spacing, not its own positioning. The safe-area bottom
          padding below is still needed even so: the sheet's own bottom edge
          sits flush against the actual viewport edge on mobile, same as the
          old pinned dock did, so this still needs to clear the home
          indicator on notched phones. */}
      <div className="border-t border-slate-200 bg-white sm:border-t-0 sm:bg-transparent">
        <div className="space-y-2 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 sm:space-y-0 sm:p-0">
          <div className="flex items-center gap-1.5 overflow-x-auto sm:border-t sm:border-slate-200 sm:px-3 sm:pt-3">
            <DailyReportDefaultsPicker
              locale={locale}
              defaultItems={defaultItems}
              onSelectionChange={setSelectedSavedListItems}
              dropDirection="up"
              showQuickAdd
              formId="daily-report-form"
              // Only on mobile: the desktop inline card isn't nested inside
              // any overflow-hidden/transform ancestor, so its own plain
              // absolute-positioned popover already opens correctly there -
              // portalPopover exists specifically for the mobile sheet's
              // clipping problem (see that prop's own comment). Tied to
              // isDesktopViewport (not a plain `true`) so this is `false`
              // during SSR too (getServerViewportSnapshot assumes desktop),
              // the same trick this file's own sheet portal below already
              // relies on to avoid touching `document` before the client
              // has actually mounted.
              portalPopover={!isDesktopViewport}
            />
          </div>

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
            <p className="px-0 text-xs text-slate-500 sm:px-3">
              {/* Singular, gender-correct Hebrew (את/אתה + matching verb
                  forms) - see buildInitialMessages' own comment on why the
                  original plural/formal conjugations were wrong here.
                  userGender "unknown"/null falls back to the male forms via
                  trGendered, same fallback the AI system prompts use. */}
              {trGendered(
                locale,
                userGender,
                `${userFirstName ? `Hi ${userFirstName}, tell` : "Tell"} me what you ate, drank, or did for exercise today (or attach a photo), and I'll help fill in the details. When you're ready, save to add it to today's log.`,
                `${userFirstName ? `היי ${userFirstName}, ` : ""}ספר לי מה אכלת, שתית או עשית מבחינת פעילות גופנית היום (או צרף תמונה), ואעזור להשלים את הפרטים. כשתהיה מוכן, שמור כדי להוסיף זאת ליומן של היום.`,
                `${userFirstName ? `היי ${userFirstName}, ` : ""}ספרי לי מה אכלת, שתית או עשית מבחינת פעילות גופנית היום (או צרפי תמונה), ואעזור להשלים את הפרטים. כשתהיי מוכנה, שמרי כדי להוסיף זאת ליומן של היום.`,
              )}
            </p>
          ) : null}

          {/* On a narrow portrait phone, three 36px icon buttons plus the Send
              button leave almost no width for the textarea itself. Below the
              `sm` breakpoint (roughly: narrower than a phone turned
              sideways), the icons wrap onto their own row via `sm:contents`
              un-wrapping them back into this same flex row once there's
              enough width - so landscape/tablet/desktop keep the original
              single-row layout unchanged. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:px-3">
            <div className="flex items-center gap-2 sm:contents">
              <label
                htmlFor="daily-report-chat-photo-input"
                aria-label={tr(locale, "Take a photo of your plate", "צילום תמונה של הצלחת")}
                title={tr(locale, "Take a photo of your plate", "צילום תמונה של הצלחת")}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-teal-300 text-teal-700 hover:bg-teal-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <path d="M9 3h6l1.5 3H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5L9 3Z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </label>
              <label
                aria-label={tr(locale, "Choose an existing photo or file", "בחירת תמונה או קובץ קיים")}
                title={tr(locale, "Choose an existing photo or file", "בחירת תמונה או קובץ קיים")}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-teal-300 text-teal-700 hover:bg-teal-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-600"
                onClick={() => photoGalleryInputRef.current?.click()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </label>
              <button
                type="button"
                disabled
                aria-disabled="true"
                title={tr(locale, "Voice input (coming soon)", "קלט קולי (בקרוב)")}
                className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-full border border-slate-200 text-slate-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
            </div>

            <div className="flex items-end gap-2 sm:contents">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                rows={2}
                maxLength={500}
                disabled={isStreaming}
                // Singular, gender-correct Hebrew imperative (כתוב/כתבי) -
                // see the subtitle above for why the original plural form
                // ("כתבו") was wrong here too.
                placeholder={trGendered(locale, userGender, "Type a message...", "כתוב הודעה...", "כתבי הודעה...")}
                className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 disabled:opacity-70"
              />
              <button
                type="button"
                disabled={isStreaming || !inputValue.trim()}
                onClick={() => void sendMessage(inputValue)}
                onMouseDown={(event) => event.preventDefault()}
                className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
              >
                {isStreaming ? <Spinner className="h-4 w-4 animate-spin" /> : tr(locale, "Send", "שליחה")}
              </button>
            </div>
          </div>

          {/* Desktop only (sm: and up) - mobile now has the single floating
              save icon above instead, so this full-width button inside the
              sheet would just be a second, differently-styled way to do the
              exact same submit. Desktop never had that duplication problem
              (there's no sheet there, no separate floating icon to collide
              with), so it keeps its original always-visible button. */}
          <div className="hidden sm:block sm:px-3 sm:pb-3">
            {isEditing && pendingDeleteOnSave ? (
              <DeleteEntrySubmitButton locale={locale} variant="text" />
            ) : (
              <SubmitButton
                locale={locale}
                onClick={handleQuickSave}
                isEditing={isEditing}
                fullWidth
                busy={isSaving}
                form="daily-report-form"
              />
            )}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
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

      {/* Desktop: exactly the original always-visible inline card, rendered
          in its normal place in the tree - never portaled, so its layout
          inside the daily-report page's card is unaffected by any of this. */}
      {isDesktopViewport ? (
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">{chatBodyContent}</div>
      ) : null}

      {/* Mobile: the floating trigger + bubble + backdrop + sheet, portaled
          straight to document.body instead of rendering inline here. They
          used to be nested many levels deep (page -> section -> form ->
          div -> this component), and on at least one real device that
          nesting broke position:fixed entirely - the bubble rendered
          wherever its calc() offset happened to land within the page's own
          layout instead of pinned to the true viewport, the sheet inherited
          the same problem (making its composer unreachable), and neither
          behaved as a real fixed overlay (letting the page scroll behind
          it). Portaling sidesteps the ancestry question entirely: these
          elements become siblings of everything else at the body level,
          the same place AppBottomNav already lives and already positions
          correctly. The form-associated controls inside (the save icon,
          and everything in chatBodyContent) reconnect to the real form via
          form="daily-report-form" instead of DOM nesting - see the inline
          notes on chatBodyContent and DailyReportForm's <form id=...>. */}
      {!isDesktopViewport
        ? createPortal(
            // dir set explicitly here - the app only applies dir="rtl"/"ltr"
            // on a wrapper <div> inside app/app/layout.tsx, not on
            // <html>/<body> - portaling straight to document.body (see the
            // big comment above) escapes that wrapper entirely, so without
            // this the whole sheet/bubble silently fell back to the
            // document's default LTR direction on mobile even in Hebrew,
            // left-aligning Hebrew text instead of right-aligning it
            // (confirmed: desktop, which renders chatBodyContent inline and
            // stays inside that wrapper, never had this problem). The
            // fixed-position buttons inside are unaffected either way -
            // they're deliberately pinned with physical left-4/right-4
            // classes, not logical ones (see their own comment).
            <div dir={directionForLocale(locale)}>
              {/* Opposite corners on purpose - having Save right next to the
                  chat open/close toggle (they used to sit side by side at
                  bottom-right) made it too easy to hit Save by mistake while
                  reaching for the toggle. left-4/right-4 are physical (not
                  logical/RTL-mirrored) in Tailwind's defaults, so these stay
                  in their literal screen corners regardless of locale with
                  no dir override needed - same reasoning as everywhere else
                  in this file that pins something to a physical corner. Both
                  keep the same bottom offset (above AppBottomNav) they had
                  before, so SHEET_BUTTON_CLEARANCE_PX's reserved gap (full
                  page width) still clears both without needing its own
                  adjustment. */}
              <div className="fixed bottom-[calc(3.25rem+env(safe-area-inset-bottom)+0.75rem)] left-4 z-50 transform-gpu">
                {isEditing && pendingDeleteOnSave ? (
                  <DeleteEntrySubmitButton locale={locale} variant="icon" />
                ) : (
                  <SubmitButton
                    locale={locale}
                    onClick={handleQuickSave}
                    isEditing={isEditing}
                    variant="icon"
                    disabled={!canSave}
                    busy={isSaving}
                    form="daily-report-form"
                  />
                )}
              </div>

              {/* Fixed at the screen's actual physical bottom-right
                  regardless of RTL - a chat bubble's corner doesn't mirror
                  with locale the way reading-direction content does
                  (WhatsApp/Messenger/Intercom all keep theirs bottom-right
                  in Hebrew/Arabic too) - and positioned above AppBottomNav
                  using the same safe-area-aware offset established for the
                  composer dock this replaced.
                  right: calc(12.5vw - 2rem), not a flat right-4 - AppBottomNav
                  lays its 4 tabs out as equal flex-1 quarters (justify-around,
                  no horizontal padding of its own on mobile), so the
                  rightmost tab (Home, first in its array - see that
                  component's own RTL-order comment) is centered 1/8 of the
                  screen width (12.5vw) in from the right edge. Centering
                  this h-16 (2rem radius) button on that same point - not
                  just "near" the corner - is what actually puts it directly
                  above the Home icon on any phone width, instead of a fixed
                  px offset that only lines up by coincidence on some widths
                  and drifts on others. Only matters below `sm` (this button
                  never renders at/above that breakpoint, where AppBottomNav
                  itself is hidden and max-w-6xl would break the 100vw
                  assumption anyway).
                  The underscores in calc(12.5vw_-_2rem) are load-bearing,
                  not stylistic - Tailwind needs them to represent the actual
                  spaces around the `-`, and the browser's own CSS tokenizer
                  needs THAT whitespace to parse "-" as subtraction: written
                  without it, "12.5vw-2rem" tokenizes as two back-to-back
                  values ("12.5vw" then a separate, sign-absorbed "-2rem")
                  with no operator between them, which is invalid and makes
                  the whole calc() (and therefore `right`) silently fail -
                  exactly what happened here on a real device (the button
                  rendered with no horizontal offset at all instead of
                  dropping the intended centering). The `+`-only calc()s
                  elsewhere in this file never hit this: a bare "+" can't be
                  absorbed as a number's sign the way "-" can, so it stays
                  unambiguous even without surrounding whitespace. */}
              <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                aria-expanded={isOpen}
                aria-label={isOpen ? tr(locale, "Close chat", "סגירת הצ'אט") : tr(locale, "Open chat", "פתיחת הצ'אט")}
                className="fixed bottom-[calc(3.25rem+env(safe-area-inset-bottom)+0.75rem)] right-[calc(12.5vw_-_2rem)] z-50 flex h-16 w-16 transform-gpu items-center justify-center rounded-full bg-teal-700 text-white shadow-lg hover:bg-teal-800"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isOpen ? "hidden" : "block"} aria-hidden="true">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={isOpen ? "block" : "hidden"} aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>

              {isOpen ? (
                <div
                  role="presentation"
                  onClick={() => setIsOpen(false)}
                  className="fixed inset-0 z-40 transform-gpu bg-slate-900/40"
                />
              ) : null}

              {/* Positioned from `top` with a measured pixel height, not
                  `bottom-0` with a CSS viewport-unit height - three rounds
                  of viewport-unit adjustments (82dvh, 78dvh, 70svh) all
                  still left the composer/Send button below the visible
                  area on a real device, meaning `bottom: 0` on this browser
                  isn't anchoring to the same edge visualViewport.height
                  measures as "visible". `top: 0` is the more trustworthy
                  anchor (the layout and visual viewports share the same top
                  edge; they only diverge at the bottom, which is exactly
                  the edge Safari's own toolbar eats into) - computing this
                  sheet's top/height purely from the measured, always-
                  correct visible height sidesteps the `bottom` ambiguity
                  entirely instead of continuing to guess at it. Falls back
                  to the old bottom-0/70svh CSS for the brief instant before
                  the first measurement lands. */}
              <div
                style={
                  sheetTopPx !== null && sheetHeightPx !== null
                    ? { top: `${sheetTopPx}px`, height: `${sheetHeightPx}px` }
                    : undefined
                }
                className={`${isOpen ? "flex" : "hidden"} fixed inset-x-0 z-40 ${
                  sheetHeightPx === null ? "bottom-[calc(9rem+env(safe-area-inset-bottom))] h-[70svh]" : ""
                } transform-gpu flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl`}
              >
                {chatBodyContent}
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Portaled to document.body regardless of desktop/mobile - even the
          desktop inline card sits inside an overflow-hidden wrapper (see
          DailyReportForm), the exact ancestor shape that already silently
          clipped a fixed-positioned confirmation elsewhere in this form.
          pendingClearConfirm only ever flips true from a real click, never
          during the initial render, so this never runs during SSR/hydration
          - no separate mounted-gate needed the way the sheet above needs
          isDesktopViewport's. */}
      {pendingClearConfirm
        ? createPortal(
            // dir set explicitly - see the sheet portal's own comment above
            // on why a portal to document.body can't rely on inheriting it.
            <div dir={directionForLocale(locale)} className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
              <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="px-5 py-4">
                  <p className="text-sm text-slate-700">
                    {tr(
                      locale,
                      "Start a new chat? This clears the current conversation - anything not yet saved will be lost.",
                      "להתחיל צ'אט חדש? פעולה זו מנקה את השיחה הנוכחית - כל מה שלא נשמר עדיין יאבד.",
                    )}
                  </p>
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setPendingClearConfirm(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {tr(locale, "Cancel", "ביטול")}
                  </button>
                  <button
                    type="button"
                    onClick={confirmClearChat}
                    className="rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800"
                  >
                    {tr(locale, "Start new chat", "התחלת צ'אט חדש")}
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
