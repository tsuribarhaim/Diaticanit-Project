"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

  useEffect(() => {
    if (!hasUnsavedPreview) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedPreview]);

  return (
    <UnsavedPreviewContext.Provider
      value={{ hasUnsavedPreview, setHasUnsavedPreview, requestNavigation: setPendingNavigation }}
    >
      {children}
      {pendingNavigation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center gap-2 bg-teal-50 px-5 py-4">
              <span className="text-lg">📝</span>
              <h2 className="text-sm font-semibold text-teal-900">{tr(locale, "Notice", "הודעה")}</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-700">{pendingNavigation.confirmMessage}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setPendingNavigation(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {tr(locale, "Stay on this page", "השארות בדף")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const href = pendingNavigation.href;
                  setPendingNavigation(null);
                  router.push(href);
                }}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
              >
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
 * native confirm()) before navigating away from unsaved work. */
export function GuardedLink({
  confirmMessage,
  onClick,
  href,
  ...linkProps
}: LinkProps & { confirmMessage: string; children: ReactNode; className?: string }) {
  const { hasUnsavedPreview, requestNavigation } = useUnsavedPreview();

  return (
    <Link
      {...linkProps}
      href={href}
      onClick={(event) => {
        if (hasUnsavedPreview) {
          event.preventDefault();
          requestNavigation({ href: href.toString(), confirmMessage });
          return;
        }
        onClick?.(event);
      }}
    />
  );
}
