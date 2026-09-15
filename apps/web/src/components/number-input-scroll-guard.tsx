"use client";

import { useEffect } from "react";

/**
 * Chrome/Edge (and some other browsers) treat a focused <input
 * type="number"> as a spinner: scrolling the mouse wheel over the page
 * while it still has focus silently nudges its value up/down by one
 * `step`, with no visual cue that anything changed. Someone who types a
 * value and then scrolls anywhere on the page (perfectly normal - e.g.
 * scrolling down to the next field or the submit button) can end up
 * submitting a quietly-altered number they never intended to change (this
 * is exactly how a typed "45" turns into a saved "44.8": two stray scroll
 * ticks at step="0.1" each subtract 0.1). Intercepting wheel events in the
 * capture phase - before the input's own native handling runs - and
 * cancelling them for a focused number input restores default page-scroll
 * behavior, matching how every other input type already behaves.
 */
export function NumberInputScrollGuard() {
  useEffect(() => {
    function handleWheel(event: WheelEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.type === "number") {
        event.preventDefault();
        active.blur();
      }
    }

    document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => document.removeEventListener("wheel", handleWheel, { capture: true });
  }, []);

  return null;
}
