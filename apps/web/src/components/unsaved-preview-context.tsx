"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";

import { PendingOverlay } from "@/components/nav-link";
import { Spinner } from "@/components/spinner";
import { tr, type AppLocale } from "@/lib/locale";

type PendingNavigation = { href: string; confirmMessage: string };

type UnsavedPreviewContextValue = {
  hasUnsavedPreview: boolean;
  setHasUnsavedPreview: (value: boolean) => void;
  /** Used by GuardedLink instead of window.confirm() - see the note on
   * UnsavedPreviewProvider for why a native confirm() can't be styled. */
  requestNavigation: (navigation: PendingNavigation) => void;
};

const UnsavedPreviewContext = createContext<UnsavedPreviewContextValue | null>(null);

/**
 * Tracks whether unsaved work exists anywhere on the page (a chat
 * conversation or a generated-but-not-yet-locked target preview), so
 * navigation away from it can warn the user first.
 *
 * In-app link clicks (GuardedLink) are confirmed with the in-app modal
 * rendered below, fully styled by this app - `window.confirm()` is a
 * *native* browser/OS dialog, and browsers deliberately forbid a page from
 * customizing its title, layout, or colors (a security measure, so a page
 * can't spoof a native OS dialog). Closing the tab or typing a new URL is a
 * true browser-level navigation, which is a different case entirely: the
 * `beforeunload` handler below is the only hook available for it, and every
 * modern browser shows its own fixed, generic "changes may not be saved"
 * text for that - a page cannot supply or style its own message there
 * either, so that specific prompt is outside what any web app can change.
 */
export function UnsavedPreviewProvider({ children, locale }: { children: ReactNode; locale: AppLocale }) {
  const [hasUnsavedPreview, setHasUnsavedPreview] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const router = useRouter();
  // "Leave anyway" navigates via router.push, not a <Link> - useLinkStatus
  // only works for actual Link transitions, so this imperative one needs
  // its own pending signal for the same "give every tap visible feedback"
  // reason as PendingOverlay elsewhere in this app.
  const [isLeaving, startLeaveTransition] = useTransition();

  useEffect(() => {
    if (!hasUnsavedPreview) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedPreview]);

  // Closes the modal once "Leave anyway"'s router.push transition actually
  // finishes (isLeaving flips back to false) - deferred a tick to satisfy
  // this codebase's react-hooks/set-state-in-effect rule, same idiom used
  // elsewhere in this app for the same rule.
  useEffect(() => {
    if (isLeaving) return;
    const timeoutId = setTimeout(() => setPendingNavigation(null), 0);
    return () => clearTimeout(timeoutId);
  }, [isLeaving]);

  return (
    <UnsavedPreviewContext.Provider
      value={{ hasUnsavedPreview, setHasUnsavedPreview, requestNavigation: setPendingNavigation }}
    >
      {children}
      {pendingNavigation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-center gap-2 bg-teal-50 px-5 py-4 dark:bg-teal-950/30">
              <span className="text-lg">📝</span>
              <h2 className="text-sm font-semibold text-teal-900 dark:text-teal-300">{tr(locale, "Notice", "הודעה")}</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-700 dark:text-slate-300">{pendingNavigation.confirmMessage}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPendingNavigation(null)}
                disabled={isLeaving}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {tr(locale, "Stay on this page", "השארות בדף")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const href = pendingNavigation.href;
                  // Modal stays open (button spinning) for the duration of
                  // the transition, closed by the effect below once it
                  // actually completes - closing it immediately here would
                  // unmount the spinner before anyone could see it.
                  startLeaveTransition(() => {
                    router.push(href);
                  });
                }}
                disabled={isLeaving}
                className="flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-80 dark:bg-teal-600 dark:hover:bg-teal-500"
              >
                {isLeaving ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null}
                {tr(locale, "Leave anyway", "עזיבה בכל זאת")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </UnsavedPreviewContext.Provider>
  );
}

export function useUnsavedPreview(): UnsavedPreviewContextValue {
  const context = useContext(UnsavedPreviewContext);
  if (!context) {
    throw new Error("useUnsavedPreview must be used within an UnsavedPreviewProvider");
  }
  return context;
}

/** A normal in-app `Link` that confirms (via the in-app modal above, not a
 * native confirm()) before navigating away from unsaved work - also shows
 * PendingOverlay's own spinner while its (unguarded) transition is in
 * flight, same as NavLink, since this is what the app's own top nav uses
 * for every link. */
export function GuardedLink({
  confirmMessage,
  onClick,
  href,
  children,
  className,
  ...linkProps
}: LinkProps & { confirmMessage: string; children: ReactNode; className?: string }) {
  const { hasUnsavedPreview, requestNavigation } = useUnsavedPreview();

  return (
    <Link
      {...linkProps}
      href={href}
      className={`relative ${className ?? ""}`}
      onClick={(event) => {
        if (hasUnsavedPreview) {
          event.preventDefault();
          requestNavigation({ href: href.toString(), confirmMessage });
          return;
        }
        onClick?.(event);
      }}
    >
      <PendingOverlay>{children}</PendingOverlay>
    </Link>
  );
}
