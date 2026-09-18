"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { directionForLocale, type AppLocale } from "@/lib/locale";

/**
 * True only once the client has actually mounted (same pattern used for
 * the Weight/Sleep portal in daily-report-form.tsx) - unlike a confirm
 * dialog whose portal only ever activates from a real client-side click
 * (never true on the very first, server-rendered pass), notice/error here
 * come straight from the URL and can already be truthy on that very first
 * render, INCLUDING the server one - document doesn't exist there, so
 * calling createPortal(..., document.body) unconditionally crashed the
 * whole page render with "document is not defined" the moment a ?notice=
 * URL was actually hit. Gating the portal on this instead of a one-shot
 * `typeof document !== "undefined"` check guarantees a real re-render once
 * the client value differs from the server one, rather than depending on
 * exactly when this component happens to first run.
 */
function subscribeMounted() {
  return () => {};
}
function getMountedSnapshot() {
  return true;
}
function getServerMountedSnapshot() {
  return false;
}

const NOTICE_DURATION_MS = 2000;
// Errors get longer on screen than a plain confirmation - still
// self-dismissing (matches what was actually asked for: nothing on this
// page should sit there indefinitely), just enough extra time to actually
// read what went wrong before it's gone.
const ERROR_DURATION_MS = 5000;

/**
 * Centered, self-dismissing replacement for the page-level notice/error
 * banner that several daily-report actions still produce via a server
 * redirect carrying ?notice=/?error= (add to saved list, adjust item
 * quantities, chart preferences, and others - plain <form action={...}>
 * without useActionState, so there's no in-memory result to read instead
 * the way the main Save flow now does - see DailyReportSuccessToast).
 * Read once per notice/error from the URL, shown as a fixed overlay (so it
 * never depends on scroll position), then auto-dismissed and stripped from
 * the URL via router.replace(..., { scroll: false }) - matches the same
 * complaint already fixed for Save: reported as "the message stays at the
 * top of the screen."
 */
export function DailyReportPageNotice({
  locale,
  notice,
  error,
  clearedHref,
}: {
  locale: AppLocale;
  notice?: string;
  error?: string;
  /** Where to settle once the notice/error has been shown - same page,
   * same date, just without the notice/error query params. */
  clearedHref: string;
}) {
  const router = useRouter();
  const isMounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getServerMountedSnapshot);
  const [dismissed, setDismissed] = useState(false);
  // Adjusted during render (React's documented pattern for reacting to a
  // prop change, used the same way elsewhere in this app) rather than in
  // the effect below - setState directly inside an effect body is a lint
  // error here. A genuinely new notice/error resets dismissed back to
  // false so it shows again even if the text happens to repeat.
  const key = `${notice ?? ""}|${error ?? ""}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setDismissed(false);
  }

  useEffect(() => {
    if (dismissed || (!notice && !error)) return;
    const timeoutId = setTimeout(() => {
      setDismissed(true);
      router.replace(clearedHref, { scroll: false });
    }, error ? ERROR_DURATION_MS : NOTICE_DURATION_MS);
    return () => clearTimeout(timeoutId);
  }, [notice, error, dismissed, clearedHref, router]);

  if (!isMounted || dismissed || (!notice && !error)) return null;

  return createPortal(
    <div dir={directionForLocale(locale)} className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className={`pointer-events-auto max-w-sm rounded-2xl px-5 py-3 text-center text-sm font-medium shadow-2xl ${
          error ? "bg-rose-700 text-white" : "bg-slate-900/90 text-white"
        }`}
      >
        {error ?? notice}
      </div>
    </div>,
    document.body,
  );
}
