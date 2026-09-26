"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A "?" trigger that reveals a floating info panel - explicit click-to-
 * open/close state, plus a full-screen invisible backdrop to catch "tap
 * elsewhere", not the CSS-only :hover/:focus-within reveal both call sites
 * used before this. That worked fine with a mouse (hover ends the instant
 * the pointer leaves), but broke down on touch: tapping the "?" again
 * doesn't reliably blur it, so :focus-within stayed true across several
 * taps before anything actually lost focus - reported as "I need to hit it
 * several times to close it." Real state has none of that ambiguity: one
 * tap opens it, one tap on the trigger, the backdrop, or anywhere else
 * closes it immediately, every time, on every device.
 *
 * The panel itself is a fixed, viewport-centered overlay below the `sm`
 * breakpoint (capped to the viewport's own width and height, scrolling
 * internally if its content is tall) rather than a small box anchored to
 * the trigger's own edge - anchoring there could push a fixed-width panel
 * past the side of a narrow phone screen with no way to reach the clipped
 * portion, since the page itself doesn't scroll sideways. `sm:` and up
 * reverts to a small dropdown-style panel anchored just below the trigger,
 * where there's normally enough room either way.
 *
 * Always portaled to document.body (both the mobile and desktop variants) -
 * confirmed live: nesting this inside a table wrapper that's itself
 * overflow-hidden (for its own rounded corners - see targets-plan-editor.tsx's
 * nutrient table) silently clipped the desktop dropdown, the same class of
 * bug already found and fixed for the saved-list picker. The desktop
 * position is measured off the trigger's own rect on open (a fixed page
 * layout doesn't move under the trigger while a popover is open, so one
 * measurement suffices), reading the trigger's own computed direction
 * rather than assuming one, so panelSide's start/end still resolve to the
 * correct physical side in both locales.
 */
export function InfoPopoverButton({
  ariaLabel,
  title,
  triggerClassName,
  panelWidthClassName,
  panelSide = "end",
  children,
}: {
  ariaLabel: string;
  /** Shown centered at the top of the panel, in its own row above
   * everything else, set off with a divider - lets a popover reused once
   * per row (e.g. one per nutrient) say plainly which row it belongs to.
   * Matters most on the phone-width layout, where the panel becomes a
   * viewport-centered overlay no longer sitting right next to its own
   * trigger the way the desktop dropdown does, so that context would
   * otherwise be lost the moment it opens. Optional - a popover that only
   * ever appears once on the page (not repeated per row) doesn't need it. */
  title?: ReactNode;
  triggerClassName: string;
  /** Desktop dropdown width (e.g. "sm:w-64") - the only thing that
   * meaningfully differs between call sites beyond their content. */
  panelWidthClassName: string;
  /** Which edge the desktop dropdown anchors to, relative to the trigger -
   * mirrors naturally with locale since it's logical start/end, not
   * left/right. */
  panelSide?: "start" | "end";
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [desktopAnchor, setDesktopAnchor] = useState<{ top: number; left?: number; right?: number } | null>(null);
  // A portal attaches straight to document.body, escaping the app's own
  // dir="rtl"/"ltr" wrapper (see app/app/layout.tsx's own comment on why
  // that's a div, not html/body) - read the trigger's own computed
  // direction instead of assuming one, same fix already applied to the
  // saved-list picker's own mobile sheet.
  const [dir, setDir] = useState<"ltr" | "rtl" | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const timeout = setTimeout(() => {
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const isRtl = getComputedStyle(trigger).direction === "rtl";
      setDir(isRtl ? "rtl" : "ltr");
      const anchorToPhysicalRight = (panelSide === "end") !== isRtl;
      setDesktopAnchor(
        anchorToPhysicalRight
          ? { top: rect.bottom + 8, right: window.innerWidth - rect.right }
          : { top: rect.bottom + 8, left: rect.left },
      );
    }, 0);
    return () => clearTimeout(timeout);
  }, [isOpen, panelSide]);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={triggerClassName}
      >
        ?
      </button>
      {isOpen
        ? createPortal(
            <div dir={dir ?? undefined}>
              <div role="presentation" onClick={() => setIsOpen(false)} className="fixed inset-0 z-30" />
              <div
                style={desktopAnchor ? { top: desktopAnchor.top, left: desktopAnchor.left, right: desktopAnchor.right } : undefined}
                className={`fixed inset-x-4 top-1/2 z-40 max-h-[70vh] -translate-y-1/2 overflow-y-auto rounded-xl border border-amber-300 bg-amber-50 p-3 text-start text-xs text-amber-900 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 ${
                  desktopAnchor ? "sm:inset-x-auto sm:top-auto sm:translate-y-0" : "sm:hidden"
                } ${panelWidthClassName}`}
              >
                {title ? (
                  <p className="mb-2 border-b border-amber-200 pb-2 text-center text-sm font-bold text-amber-950 dark:border-slate-700 dark:text-amber-300">
                    {title}
                  </p>
                ) : null}
                {children}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
