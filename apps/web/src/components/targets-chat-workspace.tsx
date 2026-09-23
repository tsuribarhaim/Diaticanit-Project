"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { approveTargetsDraftAction, discardTargetsDraftAction } from "@/app/app/targets/actions";
import { TargetsDiffTable } from "@/components/targets-diff-table";
import { TargetsSectionTabs, type TargetsHistoryInfo } from "@/components/targets-section-tabs";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import type { HomeOverviewData, HomeRange } from "@/lib/home-overview";
import { directionForLocale, tr, trGendered, type AppLocale } from "@/lib/locale";
import type { ProfileDiffRow, TargetGenerationPayload } from "@/lib/targets";
import type { MetricDiffRow } from "@/lib/targets-diff";
import { useIsDesktopViewport, useVisualViewportHeight } from "@/lib/use-viewport";

type ChatMessage = { role: "user" | "assistant"; content: string };
type SseEvent =
  | { type: "token"; text: string }
  | { type: "actionable"; value: boolean }
  | { type: "status"; status: "generating_targets" }
  | { type: "quick_apply"; weightKg: number | null; durationDays: number | null }
  | { type: "queued" }
  | { type: "error"; message: string }
  /** No data of its own - see withHeartbeat in api/targets/chat/route.ts.
   * Received like any other frame in runStream's read loop below, which is
   * what actually matters: just arriving at all resets the client's own
   * inactivity timeout, the same way a token or status event would. */
  | { type: "heartbeat" }
  | { type: "done" };

type Decision = {
  messageIndex: number;
  actionable: boolean;
  /** "applying" hides the pending decision banner the instant the user
   * clicks "Update Targets" - without it, the banner (and its still-live
   * buttons) stayed visible for the whole classification call. "quick_applied"
   * and "queued" reflect which of the two save-flow-redesign outcomes this
   * request landed in (see requestTargetsUpdate) - both revert back to
   * "pending" if the request failed outright, so the banner reappears and
   * the user can try again. */
  status: "pending" | "applying" | "quick_applied" | "queued" | "ignored";
};

const STREAM_INACTIVITY_TIMEOUT_MS = 20000;

/** Approving a draft locks in a new active target profile, which changes
 * key={activeTargetProfile.id} in targets/page.tsx and remounts this whole
 * component with fresh state - a plain in-memory flag set right before
 * that router.refresh() would be wiped out by the remount before it could
 * ever be read. sessionStorage survives the remount (same tab, same
 * session) while still being read exactly once - see the effect below,
 * which clears this key the instant it's consumed. */
const TARGETS_JUST_SAVED_STORAGE_KEY = "daffy:targetsJustSaved";

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
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

function NewChatIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** A plain horizontal line - the universal "minimize window" glyph, not an
 * "X" - matches the same reasoning already applied to the Daily Report
 * chat's own title bar (see that file's own comment): an "X" reads as
 * delete/close to most people, which is exactly wrong for a control that
 * only ever hides the sheet without losing anything. */
function MinimizeIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
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

function ChatSendButton({ locale, disabled }: { locale: AppLocale; disabled: boolean }) {
  return (
    <button
      type="submit"
      // Not the native `disabled` attribute: if this button ever holds
      // focus at the moment it flips on (e.g. reached via Tab+Enter instead
      // of a mouse click, which onMouseDown's preventDefault below doesn't
      // cover), disabling a focused element forces the browser to blur it -
      // and with nothing else to take focus, that resets scroll to the top
      // of the page. aria-disabled plus the pointer/opacity styling gives
      // the same look and the form's own submit guard (sendMessage no-ops
      // when isStreaming) already prevents a real double-send.
      aria-disabled={disabled}
      onClick={(event) => {
        if (disabled) event.preventDefault();
      }}
      onMouseDown={(event) => event.preventDefault()}
      className={`inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
    >
      {tr(locale, "Send", "שליחה")}
    </button>
  );
}

export function TargetsChatWorkspace({
  locale,
  maintenanceCalories,
  currentPayload,
  profileChanges,
  bmiWarning,
  firstName,
  userGender,
  history,
  overview,
  range,
  seedConcernMessage,
  pendingDraft,
  openChatForProfileChange,
}: {
  locale: AppLocale;
  maintenanceCalories: number;
  currentPayload: TargetGenerationPayload;
  profileChanges?: ProfileDiffRow[];
  /** Deterministic BMI safety message (lib/bmi.ts), computed server-side
   * from the profile change that just landed - shown immediately, without
   * waiting on the AI to notice it when asked to recalculate. */
  bmiWarning?: string;
  firstName?: string | null;
  /** For this workspace's own static UI copy (not AI-generated) -
   * grammatically correct Hebrew addressing, same rules/normalization the
   * AI chat itself follows (see lib/ai/persona.ts). null/unknown falls
   * back to the male form, same convention used everywhere else. */
  userGender?: "male" | "female" | null;
  history?: TargetsHistoryInfo | null;
  /** The Overview tab's data (rings, exercise consistency, AI coach) -
   * fetched server-side via lib/home-overview.ts and passed straight
   * through to TargetsSectionTabs, same as the Home page's own use of it. */
  overview: HomeOverviewData;
  range: HomeRange;
  /** Set when the user arrived here from a Notifications entry (see
   * app/app/targets/page.tsx's own ?concern= handling) - seeds that
   * notification's message into the conversation and opens the chat
   * automatically, so the concern is resolved collaboratively with the AI
   * rather than dead-ending on a static notification (see the Targets
   * save-flow redesign's own decision on this). */
  seedConcernMessage?: string;
  /** A background review (runBackgroundTargetsCheck) already ran and saved
   * a computed replacement plan - see user_target_profile_drafts. Rendered
   * as its own always-visible review card (approve/discard) rather than
   * folded into the chat thread, since it has to survive a fresh page load
   * (arriving via the notification, chat history long gone) exactly as
   * well as it survives staying on this same tab the whole time. */
  pendingDraft?: { goalText: string; diffRows: MetricDiffRow[] };
  /** Set only by the "Go to Targets" button on the profile-change prompt
   * (targets-stale-modal.tsx's own ?fromProfileChange=1) - the one
   * deliberate click, besides an actual notification, allowed to open the
   * chat on its own. There's nothing to show yet at this exact moment
   * (the background check this same profile edit already triggered is
   * just starting) - this only opens the chat to its own "reviewing this
   * now" status, same as the request to stop the chat surfacing itself on
   * every plain revisit still applies to the actual diff/draft. */
  openChatForProfileChange?: boolean;
}) {
  const router = useRouter();
  // Seeded (not fetched) so the BMI concern is visible in the conversation
  // itself the moment the page renders - not only once the user asks about
  // it or clicks "Recalculate now" and the AI's own update_targets pass
  // happens to mention it. This is the same deterministic bmiWarning text
  // as the red banner above; the AI is not involved in producing it. Also
  // reused by confirmClearChat below (a "New chat" always returns to this
  // same starting point, not a blank slate that would drop the BMI notice).
  function buildInitialMessages(): ChatMessage[] {
    const seeded: ChatMessage[] = [];
    if (bmiWarning) {
      seeded.push({
        role: "assistant",
        content: `${tr(locale, "Before you ask - I noticed something important:", "לפני שתשאלו - שמתי לב למשהו חשוב:")}\n\n${bmiWarning}`,
      });
    }
    if (seedConcernMessage) {
      seeded.push({
        role: "assistant",
        content: `${tr(locale, "Following up on a recent review of your targets:", "בהמשך לבדיקה שנעשתה לאחרונה ביעדים שלך:")}\n\n${seedConcernMessage}`,
      });
    }
    return seeded;
  }

  const [messages, setMessages] = useState<ChatMessage[]>(buildInitialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [isGeneratingTargets, setIsGeneratingTargets] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  // Separate from `decision`, which the "quick applied/queued" auto-fade
  // effect below resets to null after 2.5s for purely cosmetic reasons
  // (so the acknowledgment pill doesn't linger forever) - that fade used
  // to also silently re-enable the manual "Try updating..." button, even
  // though the actual background review (runBackgroundTargetsCheck) is
  // still genuinely running for anywhere up to a couple of minutes after
  // that, with no way for this client to know when it's actually done
  // short of a fresh page load. Real testing caught this directly: the
  // pill vanished, the button came back, while the persistent "still
  // checking" message sat right above it - a plainly contradictory
  // screen. Set true the moment a request resolves to quick_applied/
  // queued and never auto-cleared - only a genuinely fresh mount (a
  // resolved draft, an approval/discard, or simply revisiting) starts
  // this false again.
  const [isBackgroundReviewPending, setIsBackgroundReviewPending] = useState(false);
  // Which draft action (if any) is currently in flight - tracked as which
  // one, not just whether, so the button actually clicked can show real
  // "Updating..."/"Discarding..." text instead of a small spinner icon
  // easy to miss, per real feedback that the existing spinner-only state
  // wasn't a clear enough sign anything was happening.
  const [submittingDraftAction, setSubmittingDraftAction] = useState<"approve" | "discard" | null>(null);
  const [draftActionError, setDraftActionError] = useState<string | null>(null);
  const { setHasUnsavedPreview } = useUnsavedPreview();
  const abortRef = useRef<AbortController | null>(null);
  // Guards the auto-triggered profile-change check so it only ever fires
  // once per mount - a fresh mount happens exactly when there's a new,
  // not-yet-reviewed profile change to check (a genuinely new active
  // target profile ID, per the key={} on this component in targets/
  // page.tsx), not on every re-render or router.refresh() while a check
  // for THIS SAME change is still in flight.
  const hasAutoTriggeredProfileChangeRef = useRef(false);
  // Desktop only: the chat is an always-visible inline card, but it sits
  // below the tabs/rings section (TargetsSectionTabs), off-screen on a
  // normal-height viewport - unlike mobile, where opening the portaled
  // sheet already makes it appear, nothing here otherwise brings it into
  // view when the profile-change check auto-triggers, so "redirected to
  // Targets" would in practice mean landing at the top of the page with
  // no visible sign anything is happening until scrolling down manually.
  const desktopChatCardRef = useRef<HTMLDivElement | null>(null);

  // "Minimized to an icon + expandable box" - the same floating-bubble/
  // portal-sheet pattern as the Daily Report chat (see that file's own
  // comments for the full reasoning), reused here via lib/use-viewport.ts
  // instead of a second copy of the same detection code.
  const [isOpen, setIsOpen] = useState(Boolean(seedConcernMessage) || Boolean(pendingDraft) || Boolean(openChatForProfileChange));
  const [pendingClearConfirm, setPendingClearConfirm] = useState(false);
  const [closeAfterClear, setCloseAfterClear] = useState(false);
  const isDesktopViewport = useIsDesktopViewport();
  const visualViewportHeight = useVisualViewportHeight();
  const threadRef = useRef<HTMLDivElement | null>(null);
  // "Pinned to bottom unless the user scrolled up" auto-scroll, the same
  // fix already built for the Daily Report chat this session (see that
  // file's own handleThreadScroll) - a ref, not state, since it's written
  // from a high-frequency scroll listener and must never itself cause a
  // re-render.
  const isPinnedToBottomRef = useRef(true);
  const hasDoneInitialScrollRef = useRef(false);

  useEffect(() => {
    // Guards navigation away only while there's something a page-leave
    // could actually still lose: a request genuinely in flight
    // (isStreaming - covers both the chat-reply call and the
    // classification/quick-apply call in requestTargetsUpdate), or an
    // ACTIONABLE suggestion the user hasn't acted on yet (decision.status
    // "pending"). Once a request reaches "quick_applied" or "queued", the
    // server already has it - the fast field is patched, and the full
    // review keeps running via after() regardless of whether this tab
    // stays open (see runBackgroundTargetsCheck) - so leaving the page at
    // that point loses nothing, and warning anyway was reported as exactly
    // this: the fast save had already landed, but the user was told they'd
    // lose it if they left. Plain conversation with no pending suggestion
    // (an INFO reply, or the seeded BMI-warning bubble shown on mount) was
    // never something a page-leave could lose either way.
    const hasPendingActionableSuggestion = decision?.status === "pending" && decision.actionable;
    setHasUnsavedPreview(isStreaming || Boolean(hasPendingActionableSuggestion));
  }, [isStreaming, decision, setHasUnsavedPreview]);

  useEffect(() => {
    return () => {
      setHasUnsavedPreview(false);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desktop: arriving via a notification's "Discuss with AI coach" link
  // (seedConcernMessage) has the exact same gap as the profile-change
  // auto-trigger above - the chat card is already open, just not
  // necessarily on screen. Same for landing here with a pendingDraft
  // already computed (the "Go to Targets" notification link), or via the
  // profile-change prompt's own "Go to Targets" button
  // (openChatForProfileChange) - the review card now lives inside the
  // chat surface itself (see chatBodyContent), so bringing the chat into
  // view IS bringing the diff (or, for openChatForProfileChange, the
  // "reviewing this now" status) into view. Not affected by the
  // Strict-Mode/abort issue that motivated deferring the OTHER trigger
  // (this only scrolls, it doesn't start any network request), so a
  // direct call is fine here.
  useEffect(() => {
    if (!seedConcernMessage && !pendingDraft && !openChatForProfileChange) return;
    desktopChatCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Picks up handleApproveDraft's own sessionStorage flag on the fresh
  // mount its router.refresh() causes (a new active target profile means a
  // new key={} in targets/page.tsx) - this is what actually answers "when
  // saving, the chat should tell me targets updated successfully" from
  // real feedback, since nothing about the OLD instance survives that
  // remount to show a success message itself.
  useEffect(() => {
    // Both the read/clear AND the setState happen inside the deferred
    // callback together, not just the setState - checking (and clearing)
    // the flag synchronously in the effect body would let React Strict
    // Mode's dev-only double-invoke (mount -> cleanup -> mount again)
    // consume/clear it on the doomed first pass, before the real second
    // pass ever got to see it still set. Matches the profile-change
    // auto-trigger effect's own reasoning above for the identical
    // Strict-Mode class of bug; a synchronous setState here would also
    // cascade into an extra render pass during the same commit regardless.
    const timeoutId = setTimeout(() => {
      if (!window.sessionStorage.getItem(TARGETS_JUST_SAVED_STORAGE_KEY)) return;
      window.sessionStorage.removeItem(TARGETS_JUST_SAVED_STORAGE_KEY);
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: tr(locale, "Your targets have been updated successfully.", "היעדים שלך עודכנו בהצלחה."),
        },
      ]);
    }, 0);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Locks the Targets page behind the sheet from scrolling while it's open
  // - without this, a touch-scroll gesture starting anywhere the sheet
  // doesn't fully cover gets routed to the page underneath instead of the
  // sheet's own scrollable thread, confirmed directly in testing ("the
  // page of Targets was scrolling in the background but not the chat").
  // Ported from daily-report-chat-panel.tsx's own identical fix (see that
  // file's fuller comment) - plain `overflow: hidden` on body alone isn't
  // enough on iOS Safari, which still lets background touch-scroll/
  // rubber-banding through regardless; pinning the body via position:fixed
  // (capturing the current scroll offset so nothing visibly jumps) is the
  // reliable cross-browser fix, restored exactly on close.
  //
  // !isDesktopViewport is required, not optional: `isOpen` isn't scoped to
  // "the mobile sheet is visible" - it stays whatever it was (often true,
  // e.g. seeded true by a pendingDraft) even on desktop, where there is no
  // sheet at all and the chat is just a plain inline card. Without this
  // check, this locked the ENTIRE page's scroll on desktop any time isOpen
  // happened to be true - confirmed directly in testing ("now the full
  // page of Targets on the laptop is not scrolling").
  useEffect(() => {
    if (!isOpen || isDesktopViewport) return;
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
  }, [isOpen, isDesktopViewport]);

  // Ticket #1 (Aggregated Tickets): the "quick applied"/"queued" banner
  // was staying up indefinitely - reads as something still needing the
  // user's attention when it's really just a brief acknowledgment. Fades
  // on its own after a couple of seconds; the chat message history is
  // still the durable record, nothing is lost by clearing the banner.
  useEffect(() => {
    if (decision?.status !== "quick_applied" && decision?.status !== "queued") return;
    const timeoutId = setTimeout(() => {
      setDecision((previous) =>
        previous && (previous.status === "quick_applied" || previous.status === "queued") ? null : previous,
      );
    }, 2500);
    return () => clearTimeout(timeoutId);
  }, [decision]);

  // Deprecates the old amber "profile changed" banner's manual Recalculate
  // button: the moment there's a fresh, unreviewed profile change, the
  // check just runs on its own - the user lands in chat already showing
  // what changed and that it's being reviewed, instead of a banner asking
  // them to make it happen. Skipped entirely if a draft is already sitting
  // here waiting on a decision, since that means a check for this same
  // change already ran and re-running it would only replace an unreviewed
  // answer with another one.
  //
  // The setTimeout (not a direct call) works around a real bug hit in
  // testing: React's dev-only Strict Mode double-invokes a fresh effect
  // (mount -> cleanup -> mount again, synchronously, specifically to catch
  // non-idempotent effects like this one) - a direct call here would
  // already have an actual fetch in flight by the time that synthetic
  // cleanup runs, and the OTHER cleanup effect above (`abortRef.current?.
  // abort()`) would kill it, permanently, since hasAutoTriggeredProfileChangeRef
  // marks it "done" either way - this is exactly what produced a stuck
  // request and a false "something went wrong" error in practice. Deferring
  // the real call to a macrotask lets that first, doomed invocation's
  // cleanup cancel the pending *timeout* instead, before anything has
  // actually started, so only the second (real) invocation ever fires it -
  // hasAutoTriggeredProfileChangeRef is set inside the timeout itself, not
  // the effect body, so the first invocation never marks this "done"
  // without ever having run.
  useEffect(() => {
    if (hasAutoTriggeredProfileChangeRef.current) return;
    if (!profileChanges?.length || pendingDraft) return;
    const timeoutId = setTimeout(() => {
      hasAutoTriggeredProfileChangeRef.current = true;
      void handleRecalculateFromProfileChange();
    }, 0);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleThreadScroll() {
    const container = threadRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom < 80;
  }

  // Jumps straight to bottom on the very first load (tracked separately so
  // a long seeded BMI-warning message doesn't need an animated scroll), and
  // on every later change - a message, the generating-targets spinner
  // appearing, or its text swapping to the "saving" phase all belong to the
  // same "new thing arrived" case - only if the user hasn't scrolled away to
  // read something earlier.
  useEffect(() => {
    const container = threadRef.current;
    if (!container) return;
    if (!hasDoneInitialScrollRef.current) {
      // A pendingDraft renders as this same container's first item (see
      // chatBodyContent) specifically so it's reachable by scrolling - but
      // jumping straight to the bottom on open would defeat that by
      // immediately scrolling past it to whatever's below. Leaving scroll
      // at the top here shows the draft first, which is exactly the "land
      // on the diff" landing this is meant to produce.
      if (!pendingDraft) {
        container.scrollTop = container.scrollHeight;
      }
      hasDoneInitialScrollRef.current = true;
      return;
    }
    if (isPinnedToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, isGeneratingTargets, pendingDraft]);

  async function runStream(
    requestBody: Record<string, unknown>,
    handlers: {
      onToken?: (text: string) => void;
      onActionable?: (value: boolean) => void;
      onStatus?: (status: string) => void;
      onQuickApply?: (weightKg: number | null, durationDays: number | null) => void;
      onQueued?: () => void;
      onErrorEvent?: (message: string) => void;
    },
  ): Promise<{ ok: boolean; receivedAnything: boolean; errorMessage: string | null }> {
    const controller = new AbortController();
    abortRef.current = controller;

    let timeoutId: ReturnType<typeof setTimeout>;
    const armTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort("timeout"), STREAM_INACTIVITY_TIMEOUT_MS);
    };

    let receivedAnything = false;

    try {
      armTimeout();
      const response = await fetch("/api/targets/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(
          response.status === 409
            ? tr(locale, "AI chat is unavailable. Approve AI consent in your profile to enable it.", "צ'אט ה-AI אינו זמין. יש לאשר הסכמת AI בפרופיל שלך כדי להפעיל אותו.")
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
            handlers.onToken?.(event.text);
          } else if (event.type === "actionable") {
            handlers.onActionable?.(event.value);
          } else if (event.type === "status" && event.status === "generating_targets") {
            handlers.onStatus?.(event.status);
          } else if (event.type === "quick_apply") {
            handlers.onQuickApply?.(event.weightKg, event.durationDays);
          } else if (event.type === "queued") {
            handlers.onQueued?.();
          } else if (event.type === "error") {
            handlers.onErrorEvent?.(event.message);
          }
        }
      }

      clearTimeout(timeoutId!);
      abortRef.current = null;
      return { ok: true, receivedAnything, errorMessage: null };
    } catch (error) {
      clearTimeout(timeoutId!);
      abortRef.current = null;

      const isTimeout = (error as Error).name === "AbortError" && controller.signal.reason === "timeout";
      const isUserAbort = (error as Error).name === "AbortError" && !isTimeout;
      if (isUserAbort) {
        return { ok: false, receivedAnything, errorMessage: null };
      }

      const isNetworkError = error instanceof TypeError;
      // Singular, gender-correct Hebrew (both used plural forms - "אתם
      // משתמשים"/"ודאו"/"נסו" - originally) - see lib/ai/persona.ts for
      // the same addressing convention used elsewhere in this app.
      const errorMessage = isTimeout
        ? trGendered(
            locale,
            userGender,
            "This is taking longer than expected. If you're on a phone, make sure it's on the same Wi-Fi network as this computer — tap retry to try again.",
            "זה לוקח יותר זמן מהצפוי. אם אתה משתמש בטלפון, ודא שהוא מחובר לאותה רשת Wi-Fi כמו המחשב הזה - יש ללחוץ על ניסיון חוזר.",
            "זה לוקח יותר זמן מהצפוי. אם את משתמשת בטלפון, ודאי שהוא מחובר לאותה רשת Wi-Fi כמו המחשב הזה - יש ללחוץ על ניסיון חוזר.",
          )
        : isNetworkError
          ? trGendered(
              locale,
              userGender,
              "Couldn't reach the server. If you're on a phone, make sure it's on the same Wi-Fi network as this computer, then retry.",
              "לא ניתן להתחבר לשרת. אם אתה משתמש בטלפון, ודא שהוא מחובר לאותה רשת Wi-Fi כמו המחשב הזה, ולאחר מכן נסה שוב.",
              "לא ניתן להתחבר לשרת. אם את משתמשת בטלפון, ודאי שהוא מחובר לאותה רשת Wi-Fi כמו המחשב הזה, ולאחר מכן נסי שוב.",
            )
          : error instanceof Error
            ? error.message
            : tr(locale, "The chat request failed. Please try again.", "בקשת הצ'אט נכשלה. יש לנסות שוב.");

      return { ok: false, receivedAnything, errorMessage };
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    isPinnedToBottomRef.current = true;
    setStreamError(null);
    setRetryAction(null);
    setDecision(null);
    const historyForRequest = messages;
    const assistantIndex = messages.length + 1;
    setMessages((previous) => [...previous, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    setInputValue("");
    setIsStreaming(true);

    let assistantText = "";
    let actionable = false;
    const result = await runStream(
      { action: "chat", message: trimmed, chatHistory: historyForRequest },
      {
        onToken: (text) => {
          assistantText += text;
          setMessages((previous) => {
            const next = [...previous];
            next[next.length - 1] = { role: "assistant", content: assistantText };
            return next;
          });
        },
        onActionable: (value) => {
          actionable = value;
        },
      },
    );

    if (!result.ok) {
      if (result.errorMessage) {
        setStreamError(result.errorMessage);
      }
      if (!assistantText && !result.receivedAnything) {
        setMessages((previous) => previous.slice(0, -1));
        if (result.errorMessage) {
          setRetryAction(() => () => sendMessage(trimmed));
        }
      }
    } else if (assistantText) {
      setDecision({ messageIndex: assistantIndex, actionable, status: "pending" });
    }

    setIsStreaming(false);
  }

  type UpdateOutcome =
    | { kind: "quick_applied"; weightKg: number | null; durationDays: number | null }
    | { kind: "queued" }
    /** Covers two genuinely different situations that used to be merged
     * into one ambiguous "semanticErrorMessage" field: a real answer from
     * the server (a safety rejection, or a save failure) and a client-side
     * connection/timeout failure where nothing was actually reviewed at
     * all. Both now carry their own real, honest message instead of a
     * caller ever having to guess or substitute a generic "you're fine"
     * text - see handleRecalculateFromProfileChange's own history with
     * exactly that bug. */
    | { kind: "failed"; message: string };

  /**
   * Save-flow redesign (docs/design/targets-save-performance-redesign.md):
   * a fast classification call on the server either quick-applies a
   * literal weight/duration change immediately (kind: "quick_applied") or
   * queues the full careful review to run in the background (kind:
   * "queued") - either way this resolves in a couple of seconds, not the
   * old 20-90s wait, since the actual save already happened server-side by
   * the time this returns (see route.ts's update_targets handler).
   */
  async function requestTargetsUpdate(history: ChatMessage[]): Promise<UpdateOutcome> {
    if (isStreaming || history.length === 0) {
      return { kind: "failed", message: tr(locale, "Nothing to send yet.", "אין עדיין מה לשלוח.") };
    }

    setStreamError(null);
    setRetryAction(null);
    setIsStreaming(true);
    setIsGeneratingTargets(true);

    let outcome: UpdateOutcome | null = null;
    let serverErrorMessage: string | null = null;

    const result = await runStream(
      { action: "update_targets", chatHistory: history },
      {
        onQuickApply: (weightKg, durationDays) => {
          outcome = { kind: "quick_applied", weightKg, durationDays };
        },
        onQueued: () => {
          outcome = { kind: "queued" };
        },
        onErrorEvent: (message) => {
          serverErrorMessage = message;
        },
      },
    );

    setIsStreaming(false);
    setIsGeneratingTargets(false);

    if (!outcome) {
      // Either a real, server-explained rejection (a safety concern, or a
      // save failure) or - if neither arrived - a connection/timeout
      // failure where nothing was actually reviewed. Either way, this is
      // the one place that decides what the user sees, so it's shown
      // here (not left to whichever caller happens to invoke this) -
      // guarantees the red error banner below always appears on any
      // failure, not only the callers that remembered to check for one.
      const message =
        serverErrorMessage ??
        result.errorMessage ??
        tr(locale, "Something went wrong. Please try again.", "משהו השתבש. יש לנסות שוב.");
      setStreamError(message);
      return { kind: "failed", message };
    }

    isPinnedToBottomRef.current = true;
    // Both outcomes mean the full background review (runBackgroundTargets
    // Check) is now running server-side and will keep running for well
    // beyond this call's own return - see isBackgroundReviewPending's own
    // comment on why this is tracked separately from the transient
    // decision-pill state.
    setIsBackgroundReviewPending(true);
    // The active target row already has whatever changed (a quick-applied
    // field, or nothing yet if queued) - refresh so the page's own
    // server-fetched numbers catch up. Not a remount (same profile id
    // unless/until the background pass later replaces it), so chat state
    // and scroll position are preserved.
    router.refresh();
    return outcome;
  }

  async function handleUpdateTargetsDecision() {
    if (!decision || decision.status !== "pending" || !decision.actionable) return;
    // Hides the decision banner (and its buttons) the instant the request
    // starts, instead of leaving it up and clickable for the whole call -
    // the isGeneratingTargets spinner takes over as the "something is
    // happening" indicator from here.
    setDecision((previous) => (previous ? { ...previous, status: "applying" } : previous));
    const history = messages;
    const outcome = await requestTargetsUpdate(history);
    if (outcome.kind === "quick_applied" || outcome.kind === "queued") {
      setDecision((previous) => (previous ? { ...previous, status: outcome.kind } : previous));
      return;
    }
    // Generation/classification failure - bring the banner back so the
    // user can try again. The red error banner with the real message is
    // already showing by this point (see requestTargetsUpdate's own
    // setStreamError) - this just adds a retry that re-runs this exact
    // request.
    setDecision((previous) => (previous ? { ...previous, status: "pending" } : previous));
    setRetryAction(() => () => handleUpdateTargetsDecision());
  }

  /** The decision banner only appears when the AI itself marks a reply
   * ACTIONABLE - across a longer back-and-forth it can keep answering
   * informationally without ever committing to that marker, leaving the
   * user with no way to move forward at all. This lets them ask for an
   * update explicitly regardless of how any single reply was classified;
   * if there's genuinely nothing concrete to apply yet, that comes back as
   * a normal, visible message rather than the conversation just going
   * nowhere. */
  async function handleManualUpdateRequest() {
    if (isStreaming || messages.length === 0) return;
    const outcome = await requestTargetsUpdate(messages);
    if (outcome.kind === "failed") {
      setRetryAction(() => () => handleManualUpdateRequest());
    }
  }

  function handleIgnoreDecision() {
    setDecision((previous) => (previous ? { ...previous, status: "ignored" } : previous));
  }

  async function handleRecalculateFromProfileChange() {
    if (isStreaming || !profileChanges?.length) return;
    // Deliberately does NOT open the sheet or scroll anything into view -
    // this check runs quietly in the background regardless of whether the
    // user is even looking at this page right now. Per the redesign's own
    // simplification (repeated real-device testing found the "try to
    // surface the chat automatically" behavior unreliable, especially on
    // mobile): the notification is now the ONE reliable, single channel
    // for "your review is ready" - see the nav badge fix (AppBottomNav)
    // that makes that channel actually visible on mobile too. If the user
    // happens to already be sitting in this chat when it resolves, they'll
    // see it update; otherwise they'll get there via the notification,
    // same as arriving fresh.
    const changesText = profileChanges
      .map((row) => `${tr(locale, row.labelEn, row.labelHe)}: ${row.before} → ${row.after}`)
      .join("; ");
    const noteText = tr(
      locale,
      `My profile changed (${changesText}). Please review whether this affects my targets - especially any medical, safety, or dietary implications - and update accordingly.`,
      `הפרופיל שלי השתנה (${changesText}). נא לבדוק אם יש לכך השפעה על היעדים שלי - בפרט השלכות רפואיות, בטיחותיות או תזונתיות - ולעדכן בהתאם.`,
    );
    const updatedHistory: ChatMessage[] = [...messages, { role: "user", content: noteText }];
    setMessages(updatedHistory);
    // Reuses the same Decision state (and its existing "quick_applied"/
    // "queued" status pills, and the manual-update button's hide condition
    // below) that a user-typed request already goes through, rather than
    // this auto-triggered path needing its own separate in-flight flag.
    setDecision({ messageIndex: updatedHistory.length - 1, actionable: true, status: "applying" });
    const outcome = await requestTargetsUpdate(updatedHistory);
    if (outcome.kind === "quick_applied" || outcome.kind === "queued") {
      setDecision((previous) => (previous ? { ...previous, status: outcome.kind } : previous));
      // A persistent transcript entry, since the status pill above fades on
      // its own after a couple of seconds (see the "quick applied/queued"
      // fade effect) - without this, nothing in the thread would still
      // explain what happened once that pill is gone. The full review is
      // still running in the background (see runBackgroundTargetsCheck);
      // its own completion is what surfaces the actual result, via a
      // notification and the draft-review card below.
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: tr(
            locale,
            "Reviewing this profile change now - I'll notify you once your updated plan is ready to review.",
            "בודק/ת כעת את שינוי הפרופיל הזה - אודיע לך ברגע שהתכנית המעודכנת שלך תהיה מוכנה לבדיקה.",
          ),
        },
      ]);
      return;
    }
    // Used to show a hardcoded "no adjustment needed, you're fine" message
    // here whenever the request didn't quick-apply/queue - including on a
    // plain connection timeout, where nothing had actually been reviewed
    // at all. The real message (a genuine rejection, or a real connection
    // failure) is now shown honestly via the red error banner below (see
    // requestTargetsUpdate's own setStreamError) instead of being replaced
    // with a reassurance that may not be true - this just offers a retry
    // on top of that.
    setDecision(null);
    setRetryAction(() => () => handleRecalculateFromProfileChange());
  }

  async function handleApproveDraft() {
    if (submittingDraftAction) return;
    setSubmittingDraftAction("approve");
    setDraftActionError(null);
    // finally, not just a line after the await: both actions are expected
    // to fail closed (return { error }, never throw) - but a genuinely
    // uncaught server-action exception was exactly what produced a
    // spinner stuck "processing" forever in real testing (the reassign-
    // schema-mismatch bug this session), since the code after a rejected
    // await never runs. This guarantees the spinner always clears either
    // way, regardless of what actually goes wrong.
    try {
      const result = await approveTargetsDraftAction();
      if (result.error) {
        setDraftActionError(result.error);
        return;
      }
      // Read back by the fresh mount this refresh triggers (see the
      // TARGETS_JUST_SAVED_STORAGE_KEY effect below) - a plain success
      // message set on THIS instance would just be wiped out by that same
      // remount before ever being seen.
      window.sessionStorage.setItem(TARGETS_JUST_SAVED_STORAGE_KEY, "1");
      router.refresh();
    } catch {
      setDraftActionError(
        tr(locale, "Something went wrong updating your targets. Please try again.", "משהו השתבש בעדכון היעדים שלך. יש לנסות שוב."),
      );
    } finally {
      setSubmittingDraftAction(null);
    }
  }

  async function handleDiscardDraft() {
    if (submittingDraftAction) return;
    setSubmittingDraftAction("discard");
    setDraftActionError(null);
    try {
      const result = await discardTargetsDraftAction();
      if (result.error) {
        setDraftActionError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setDraftActionError(
        tr(locale, "Something went wrong discarding this update. Please try again.", "משהו השתבש בהתעלמות מהעדכון הזה. יש לנסות שוב."),
      );
    } finally {
      setSubmittingDraftAction(null);
    }
  }

  // Whether "New chat" has anything to actually lose - a fresh, never-
  // typed-in panel just clears silently instead of prompting over nothing.
  const hasChatContent = messages.some((message) => message.role === "user") || inputValue.trim().length > 0;

  function handleNewChatClick() {
    if (hasChatContent) {
      setCloseAfterClear(false);
      setPendingClearConfirm(true);
    } else {
      confirmClearChat(false);
    }
  }

  /** "Forget about it and close" - shares the exact same confirm dialog and
   * clear logic as New chat (see confirmClearChat below); the only
   * difference is closeAfterClear, which tells it to also minimize once
   * it's done. Mirrors the same control the Daily Report chat has. */
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
   * chatting). closeAfterClear additionally minimizes the sheet once
   * cleared, for the discard-and-close case - defaults to whatever
   * closeAfterClear was last set to (by whichever button opened the
   * confirm dialog), but takes an explicit override too, for the two
   * "nothing to lose, skip the dialog" shortcuts above, which call this
   * directly before any state update from setCloseAfterClear would
   * actually be visible yet. */
  function confirmClearChat(shouldCloseAfter: boolean = closeAfterClear) {
    setPendingClearConfirm(false);
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(buildInitialMessages());
    setInputValue("");
    setStreamError(null);
    setRetryAction(null);
    setDecision(null);
    hasDoneInitialScrollRef.current = false;
    isPinnedToBottomRef.current = true;
    if (shouldCloseAfter) {
      setIsOpen(false);
    }
  }

  const hasThreadContent = messages.length > 0 || isStreaming;

  // Hides the manual "Try updating..." button for the whole span where a
  // check is genuinely in flight, still running in the background
  // (isBackgroundReviewPending), or already has an answer waiting on the
  // user (pendingDraft) - matching the user's own "only once we return ...
  // and the validation ended" call on this. isBackgroundReviewPending
  // specifically (not just decision.status) is what makes this hold for
  // the whole review, not just the few seconds until its acknowledgment
  // pill fades - see that state's own comment for the bug this fixes.
  const isDecisionActive =
    isBackgroundReviewPending ||
    Boolean(pendingDraft) ||
    (decision != null && (decision.status === "applying" || (decision.status === "pending" && decision.actionable)));

  // Reserved gap between the open sheet's bottom edge and the true viewport
  // bottom - unlike the Daily Report chat, there's no floating action
  // button competing for that corner here once the sheet is open (Lock In
  // lives inside the thread itself, not as a separate floating control), so
  // this only needs to clear the safe-area inset, not a whole button row.
  const sheetHeightPx = visualViewportHeight !== null ? Math.round(visualViewportHeight * 0.82) : null;
  const sheetTopPx =
    visualViewportHeight !== null && sheetHeightPx !== null ? Math.round(visualViewportHeight - sheetHeightPx) : null;

  // Shared between the desktop inline card and the mobile portaled sheet -
  // same header/thread/composer JSX either way, the sm: classes sprinkled
  // through it already resolve correctly in both render modes since
  // whichever mode is active only ever renders at a viewport where those
  // classes would resolve the same way CSS breakpoints already made them
  // resolve.
  const chatBodyContent = (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800 sm:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white dark:bg-teal-600">
            <ChatBubbleBadgeIcon className="h-3.5 w-3.5" />
          </span>
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Chat about your targets", "צ'אט על היעדים שלך")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3.5">
          <button
            type="button"
            onClick={handleNewChatClick}
            aria-label={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
            title={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40"
          >
            <NewChatIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleDiscardAndCloseClick}
            aria-label={tr(locale, "Discard and close", "התעלמות וסגירה")}
            title={tr(locale, "Discard and close", "התעלמות וסגירה")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label={tr(locale, "Minimize chat", "מזעור הצ'אט")}
            title={tr(locale, "Minimize chat", "מזעור הצ'אט")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <MinimizeIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="hidden items-center justify-end border-b border-slate-200 px-3 py-1.5 dark:border-slate-800 sm:flex">
        <button
          type="button"
          onClick={handleNewChatClick}
          aria-label={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
          title={tr(locale, "Start a new chat", "התחלת צ'אט חדש")}
          className="flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <NewChatIcon className="h-3.5 w-3.5" />
          {tr(locale, "New chat", "צ'אט חדש")}
        </button>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col sm:flex-none ${hasThreadContent ? "sm:h-[420px]" : ""}`}>
        <div ref={threadRef} onScroll={handleThreadScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {pendingDraft ? (
            // Inside the scrollable thread itself, as its first item, NOT
            // pinned outside it - real-device testing found the outside-
            // the-scroll-area version could get its own bottom (the Update/
            // Discard buttons) clipped and permanently unreachable whenever
            // this card was taller than the sheet's fixed height had room
            // for, since nothing about that outer position was itself
            // scrollable ("I couldn't scroll down to the save"). Now
            // anything below it, including its own buttons, is reachable
            // by scrolling the one shared thread area - the initial-scroll
            // effect below is adjusted to land here instead of jumping
            // past it to the latest message.
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 dark:border-teal-800 dark:bg-teal-950/30">
              <p className="text-sm font-semibold text-teal-900 dark:text-teal-300">
                {tr(locale, "Your updated plan is ready to review", "התכנית המעודכנת שלך מוכנה לבדיקה")}
              </p>
              <p className="mt-1 text-sm italic text-teal-800 dark:text-teal-400">{pendingDraft.goalText}</p>
              <div className="mt-3">
                <TargetsDiffTable rows={pendingDraft.diffRows} locale={locale} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleApproveDraft}
                  disabled={submittingDraftAction !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                >
                  {submittingDraftAction === "approve" ? <Spinner className="h-4 w-4 animate-spin" /> : null}
                  {submittingDraftAction === "approve"
                    ? tr(locale, "Updating your targets...", "מעדכן את היעדים שלך...")
                    : tr(locale, "Update my targets", "עדכון היעדים שלי")}
                </button>
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  disabled={submittingDraftAction !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-300 bg-white px-4 py-2 text-sm font-semibold text-teal-800 disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-100 dark:border-teal-800 dark:bg-slate-900 dark:text-teal-400 dark:hover:bg-teal-950/40"
                >
                  {submittingDraftAction === "discard" ? <Spinner className="h-4 w-4 animate-spin" /> : null}
                  {submittingDraftAction === "discard" ? tr(locale, "Discarding...", "מתעלם...") : tr(locale, "Discard", "התעלמות")}
                </button>
              </div>
              {draftActionError ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{draftActionError}</p> : null}
              <p className="mt-2 text-xs text-teal-700 dark:text-teal-500">
                {tr(locale, "You can also discuss this below before deciding.", "אפשר גם לדון בכך למטה לפני קבלת ההחלטה.")}
              </p>
            </div>
          ) : null}
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {/* Singular, gender-correct Hebrew - see lib/ai/persona.ts
                  for the same addressing convention used elsewhere. */}
              {trGendered(
                locale,
                userGender,
                "Ask a question or describe a change, e.g. \"reduce my workout days to 2 times a week\". Chatting won't change anything by itself - you'll always get to choose.",
                "שאל שאלה או תאר שינוי, לדוגמה \"להפחית את ימי האימון שלי לפעמיים בשבוע\". שיחה בלבד לא תשנה דבר - תמיד תוכל לבחור בעצמך.",
                "שאלי שאלה או תארי שינוי, לדוגמה \"להפחית את ימי האימון שלי לפעמיים בשבוע\". שיחה בלבד לא תשנה דבר - תמיד תוכלי לבחור בעצמך.",
              )}
            </p>
          ) : null}
          {messages.map((message, index) => (
            <div key={index} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  message.role === "user" ? "bg-teal-700 text-white dark:bg-teal-600" : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {message.content || (isStreaming && index === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
          {isGeneratingTargets ? (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <Spinner className="h-3.5 w-3.5 animate-spin" />
                {tr(locale, "Checking your request...", "בודק/ת את הבקשה שלך...")}
              </div>
            </div>
          ) : null}

          {decision && decision.status === "pending" && decision.actionable ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 dark:border-teal-800 dark:bg-teal-950/30">
              <p className="text-sm text-teal-900 dark:text-teal-300">
                {tr(locale, "Apply the change from your last message?", "להחיל את השינוי מההודעה האחרונה שלך?")}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleUpdateTargetsDecision}
                  disabled={isStreaming}
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-600 dark:hover:bg-teal-500"
                >
                  {tr(locale, "Update Targets", "עדכון היעדים")}
                </button>
                <button
                  type="button"
                  onClick={handleIgnoreDecision}
                  disabled={isStreaming}
                  className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-teal-800 dark:bg-slate-900 dark:text-teal-400 dark:hover:bg-teal-950/40"
                >
                  {tr(locale, "Ignore", "התעלמות")}
                </button>
              </div>
            </div>
          ) : decision && decision.status === "quick_applied" ? (
            <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
              <Spinner className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>{tr(locale, "Applied - reviewing your full plan in the background now.", "הוחל - בודק/ת כעת את התכנית המלאה שלך ברקע.")}</span>
            </div>
          ) : decision && decision.status === "queued" ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <Spinner className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>{tr(locale, "Reviewing your full plan in the background - we'll let you know if anything needs your attention.", "בודק/ת כעת את התכנית המלאה שלך ברקע - נעדכן אותך אם יש צורך בתשומת לבך.")}</span>
            </div>
          ) : decision && decision.status === "ignored" ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">{tr(locale, "Suggestion ignored.", "ההצעה נדחתה.")}</p>
          ) : null}

          {messages.length > 0 && !isDecisionActive ? (
            <div className="flex flex-col items-start gap-1.5">
              <button
                type="button"
                onClick={handleManualUpdateRequest}
                disabled={isStreaming}
                className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300 dark:hover:bg-teal-950/50"
              >
                {trGendered(locale, userGender, "Try updating targets from this conversation", "נסה לעדכן את היעדים לפי השיחה", "נסי לעדכן את היעדים לפי השיחה")}
              </button>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  locale,
                  "This re-checks your whole conversation above - if it actually changes anything, it's saved automatically and you'll be taken back to Overview.",
                  "פעולה זו בודקת מחדש את כל השיחה למעלה - אם יש שינוי בפועל, הוא יישמר אוטומטית ותועברו חזרה למסך הסקירה הכללית.",
                )}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {streamError ? (
        <div className="flex items-center justify-between gap-2 border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
          <span>{streamError}</span>
          {retryAction ? (
            <button
              type="button"
              onClick={() => retryAction()}
              className="shrink-0 rounded-lg border border-rose-300 bg-white px-2 py-1 font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              {tr(locale, "Retry", "ניסיון חוזר")}
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage(inputValue);
        }}
      >
        <textarea
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          rows={2}
          maxLength={500}
          // readOnly, not disabled: disabling an element that currently
          // has focus (which this does, right after the user clicks Send
          // with the mouse - ChatSendButton's onMouseDown keeps focus on
          // this textarea rather than moving it to the button) forces
          // the browser to blur it, and with nothing else to take focus,
          // the browser resets scroll to the top of the page - happening
          // on every single message. readOnly blocks editing during the
          // request without touching focus, so scroll position stays put.
          readOnly={isStreaming}
          placeholder={trGendered(locale, userGender, "Type a message...", "כתוב הודעה...", "כתבי הודעה...")}
          className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <ChatSendButton locale={locale} disabled={isStreaming || !inputValue.trim()} />
      </form>
    </>
  );

  return (
    <div className="space-y-4">
      {bmiWarning ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/30">
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-400">
            {tr(locale, "Your new weight is outside the healthy BMI range", "המשקל החדש שלך מחוץ לטווח ה-BMI הבריא")}
          </p>
          <p className="mt-2 text-sm text-rose-800 dark:text-rose-400">{bmiWarning}</p>
        </div>
      ) : null}
      <TargetsSectionTabs
        payload={currentPayload}
        locale={locale}
        maintenanceCalories={maintenanceCalories}
        firstName={firstName}
        history={history}
        overview={overview}
        range={range}
      />

      {/* Desktop: an always-visible inline card, same as the Daily Report
          chat's own desktop treatment. */}
      {isDesktopViewport ? (
        <div
          ref={desktopChatCardRef}
          className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          {chatBodyContent}
        </div>
      ) : null}

      {/* Mobile: the floating trigger + backdrop + sheet, portaled straight
          to document.body - same reasoning as the Daily Report chat's own
          mobile portal (see that file's comment): position:fixed inside a
          deeply nested tree can silently break on real devices, and
          portaling sidesteps the ancestry question entirely. */}
      {!isDesktopViewport
        ? createPortal(
            <div dir={directionForLocale(locale)}>
              {!isOpen ? (
                <button
                  type="button"
                  onClick={() => setIsOpen(true)}
                  aria-label={tr(locale, "Open chat", "פתיחת הצ'אט")}
                  // Same fixed physical-right position as the Daily Report
                  // chat's own bubble (see that file's comment for the full
                  // reasoning) - not a flat `end-4` - so the two bubbles sit
                  // at the identical screen point across pages instead of
                  // each picking its own corner offset.
                  className="fixed bottom-[calc(3.25rem+env(safe-area-inset-bottom)+0.75rem)] right-[calc(12.5vw_-_2rem)] z-50 flex h-16 w-16 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                >
                  <ChatBubbleBadgeIcon className="h-7 w-7" />
                </button>
              ) : null}

              {isOpen ? (
                <div role="presentation" onClick={() => setIsOpen(false)} className="fixed inset-0 z-40 bg-slate-900/40" />
              ) : null}

              <div
                style={sheetTopPx !== null && sheetHeightPx !== null ? { top: `${sheetTopPx}px`, height: `${sheetHeightPx}px` } : undefined}
                className={`${isOpen ? "flex" : "hidden"} fixed inset-x-0 z-40 ${
                  sheetHeightPx === null ? "bottom-[calc(9rem+env(safe-area-inset-bottom))] h-[70svh]" : ""
                } flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900`}
              >
                {chatBodyContent}
              </div>
            </div>,
            document.body,
          )
        : null}

      {pendingClearConfirm
        ? createPortal(
            <div dir={directionForLocale(locale)} className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
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
    </div>
  );
}
