"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** TCK-161: the shared shell every chat panel opens in - a full-screen
 * scrim behind a turquoise-framed panel (styles in app/chat-overlay.css).
 * Tapping the scrim or pressing Escape calls onClose, the same handler the
 * caller's own X button uses. Callers keep their own messages and open
 * state, and pass the panel's position, size and background via className. */
export function ChatOverlay({
  isOpen,
  onClose,
  ariaLabel,
  closeOnEscape = true,
  className,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  // false while a popover inside the panel (e.g. the saved-list picker)
  // should get Escape first instead of the whole chat closing.
  closeOnEscape?: boolean;
  className: string;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, closeOnEscape]);

  if (!isOpen) return null;

  return (
    <>
      <div role="presentation" className="chat-overlay-scrim" onClick={onClose} />
      <div role="dialog" aria-label={ariaLabel} className={`chat-overlay-panel ${className}`}>
        {children}
      </div>
    </>
  );
}
