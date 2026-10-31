"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

// TCK-170: the opt-in exit animation's length - matches the transition in
// app/chat-overlay.css.
const EXIT_DURATION_MS = 220;
const SWIPE_CLOSE_DISTANCE_PX = 80;
const SWIPE_CLOSE_VELOCITY_PX_PER_MS = 0.5;
const KEYBOARD_MIN_HEIGHT_PX = 150;
// TCK-170: marks the same-URL history entry closeOnBack pushes, so we can
// tell whether it is still on top (a router.replace swaps it out for a fresh
// state without this key) and adopt it instead of stacking a second one when
// a chat remounts already open.
const HISTORY_MARKER = "__daffyChatOverlay";

let releasingHistoryEntry = false;
let skipHistoryBackOnce = false;

function hasChatHistoryEntry(): boolean {
  return Boolean((window.history.state as Record<string, unknown> | null)?.[HISTORY_MARKER]);
}

function pushChatHistoryEntry() {
  window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_MARKER]: true }, "", window.location.href);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** TCK-170: call right before closing a chat whose screen is about to be left
 * through router.replace / <Link replace>. The navigation replaces the chat's
 * Back entry, so the overlay must not also pop it with history.back(). */
export function leaveChatHistoryEntryForNavigation() {
  if (hasChatHistoryEntry()) skipHistoryBackOnce = true;
}

/** TCK-170: closes an open closeOnBack chat by popping its Back entry first,
 * then runs `then` once the pop has landed (history.back() is async) - for a
 * router.replace that must replace the real page entry, not the chat's. */
export function popChatHistoryEntry(then: () => void) {
  if (!hasChatHistoryEntry()) {
    then();
    return;
  }
  releasingHistoryEntry = true;
  function handlePop() {
    window.removeEventListener("popstate", handlePop);
    then();
    setTimeout(() => {
      releasingHistoryEntry = false;
    }, 0);
  }
  window.addEventListener("popstate", handlePop);
  window.history.back();
}

/** TCK-161: the shared shell every chat panel opens in - a full-screen
 * scrim behind a turquoise-framed panel (styles in app/chat-overlay.css).
 * Tapping the scrim or pressing Escape calls onClose, the same handler the
 * caller's own X button uses. Callers keep their own messages and open
 * state, and pass the panel's position, size and background via className.
 * TCK-170: opt-in slide animation (animated/onExited), Android Back
 * (closeOnBack), swipe-down on a [data-chat-drag-handle] (swipeToClose), and
 * "hide the soft keyboard first" for Back/swipe/scrim (keyboardFirst). */
export function ChatOverlay({
  isOpen,
  onClose,
  ariaLabel,
  closeOnEscape = true,
  closeOnOutside = true,
  animated = false,
  onExited,
  closeOnBack = false,
  swipeToClose = false,
  keyboardFirst = false,
  className,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  // false while a popover inside the panel (e.g. the saved-list picker)
  // should get Escape first instead of the whole chat closing.
  closeOnEscape?: boolean;
  // Same gate for the scrim, Back and swipe.
  closeOnOutside?: boolean;
  animated?: boolean;
  // Called once the overlay has fully unmounted (after the exit animation).
  onExited?: () => void;
  closeOnBack?: boolean;
  swipeToClose?: boolean;
  keyboardFirst?: boolean;
  className: string;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  const onExitedRef = useRef(onExited);
  const closeOnOutsideRef = useRef(closeOnOutside);
  const keyboardFirstRef = useRef(keyboardFirst);
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    closeRef.current = onClose;
    onExitedRef.current = onExited;
    closeOnOutsideRef.current = closeOnOutside;
    keyboardFirstRef.current = keyboardFirst;
    isOpenRef.current = isOpen;
  }, [onClose, onExited, closeOnOutside, keyboardFirst, isOpen]);
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, closeOnEscape]);

  const panelRef = useRef<HTMLDivElement | null>(null);

  // True (and the soft keyboard is hidden) when a keyboardFirst close
  // request should only blur the focused field this time.
  function hideKeyboardInstead(): boolean {
    if (!keyboardFirstRef.current) return false;
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return false;
    if (!panelRef.current?.contains(active)) return false;
    const viewport = window.visualViewport;
    if (!viewport || window.innerHeight - viewport.height <= KEYBOARD_MIN_HEIGHT_PX) return false;
    active.blur();
    return true;
  }
  const hideKeyboardInsteadRef = useRef(hideKeyboardInstead);
  useEffect(() => {
    hideKeyboardInsteadRef.current = hideKeyboardInstead;
  });

  function requestOutsideClose() {
    // Ignore taps on the scrim while it is still fading out.
    if (!isOpenRef.current || !closeOnOutsideRef.current) return;
    if (hideKeyboardInsteadRef.current()) return;
    closeRef.current();
  }

  // --- Back (closeOnBack) ---
  const ownsHistoryEntryRef = useRef(false);
  const pendingBackRef = useRef(false);
  useEffect(() => {
    if (!isOpen || !closeOnBack) return;
    skipHistoryBackOnce = false;
    if (!ownsHistoryEntryRef.current && !pendingBackRef.current) {
      if (!hasChatHistoryEntry()) pushChatHistoryEntry();
      ownsHistoryEntryRef.current = true;
    }
    function handlePop() {
      // Our own history.back() from a close that was reopened before it
      // landed - handled by its one-shot listener below.
      if (pendingBackRef.current || !ownsHistoryEntryRef.current || hasChatHistoryEntry()) return;
      ownsHistoryEntryRef.current = false;
      if (releasingHistoryEntry) {
        closeRef.current();
        return;
      }
      if (!closeOnOutsideRef.current || hideKeyboardInsteadRef.current()) {
        pushChatHistoryEntry();
        ownsHistoryEntryRef.current = true;
        return;
      }
      closeRef.current();
    }
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [isOpen, closeOnBack]);
  // Closed by any other means (X, scrim, swipe, Escape, discard-and-close)
  // while our entry is still on top: pop it exactly once.
  useEffect(() => {
    if (isOpen || !ownsHistoryEntryRef.current) return;
    ownsHistoryEntryRef.current = false;
    if (skipHistoryBackOnce) {
      skipHistoryBackOnce = false;
      return;
    }
    if (!hasChatHistoryEntry()) return;
    pendingBackRef.current = true;
    function handlePop() {
      window.removeEventListener("popstate", handlePop);
      pendingBackRef.current = false;
      // Reopened before the pop landed - re-arm Back for the new session.
      if (isOpenRef.current) {
        pushChatHistoryEntry();
        ownsHistoryEntryRef.current = true;
      }
    }
    window.addEventListener("popstate", handlePop);
    window.history.back();
  }, [isOpen]);

  // --- Mount / exit animation ---
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isShown, setIsShown] = useState(false);
  if (isOpen && !isMounted) setIsMounted(true);
  if (!animated && !isOpen && isMounted) setIsMounted(false);
  useEffect(() => {
    if (!animated || !isMounted) return;
    if (isOpen) {
      let innerFrame = 0;
      const outerFrame = requestAnimationFrame(() => {
        innerFrame = requestAnimationFrame(() => setIsShown(true));
      });
      return () => {
        cancelAnimationFrame(outerFrame);
        cancelAnimationFrame(innerFrame);
      };
    }
    const timeoutId = setTimeout(
      () => {
        setIsShown(false);
        setIsMounted(false);
      },
      prefersReducedMotion() ? 0 : EXIT_DURATION_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [animated, isOpen, isMounted]);
  const wasMountedRef = useRef(isMounted);
  useEffect(() => {
    if (wasMountedRef.current && !isMounted) onExitedRef.current?.();
    wasMountedRef.current = isMounted;
  }, [isMounted]);

  // --- Swipe down (swipeToClose) ---
  const dragRef = useRef<{ pointerId: number; startY: number; lastY: number; lastTime: number; velocity: number } | null>(null);
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!swipeToClose || !isOpen) return;
    const target = event.target as HTMLElement;
    if (!target.closest("[data-chat-drag-handle]") || target.closest("button")) return;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.style.transition = "none";
  }
  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const elapsed = event.timeStamp - drag.lastTime;
    if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    event.currentTarget.style.transform = `translateY(${Math.max(0, event.clientY - drag.startY)}px)`;
  }
  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const panel = event.currentTarget;
    if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId);
    // Clearing the inline styles lets the class transition carry the panel
    // from where it was dragged to either its open spot or its exit spot.
    panel.style.transition = "";
    panel.style.transform = "";
    const distance = event.clientY - drag.startY;
    if (event.type === "pointerup" && (distance >= SWIPE_CLOSE_DISTANCE_PX || drag.velocity > SWIPE_CLOSE_VELOCITY_PX_PER_MS)) {
      requestOutsideClose();
    }
  }

  if (!isMounted) return null;

  const stateClass = animated ? (isOpen && isShown ? " is-open" : "") : "";

  return (
    <>
      <div
        role="presentation"
        className={`chat-overlay-scrim${animated ? " chat-overlay-scrim--animated" : ""}${stateClass}`}
        onClick={requestOutsideClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={ariaLabel}
        className={`chat-overlay-panel ${className}${animated ? " chat-overlay-panel--animated" : ""}${swipeToClose ? " chat-overlay-panel--swipe" : ""}${stateClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        {children}
      </div>
    </>
  );
}
