"use client";

import { useSyncExternalStore } from "react";

/**
 * The browser's own IANA timezone (e.g. "Asia/Jerusalem") - the correct
 * timezone to format a saved timestamp in, since it's the visitor's own.
 * useSyncExternalStore (not useState+useEffect, same reasoning as
 * useIsDesktopViewport in lib/use-viewport.ts) so a server render and the
 * first client paint can agree on a safe placeholder ("UTC" - deliberately
 * not a guess) without a hydration mismatch, and the real value takes over
 * as soon as this resolves on the client. Built after a real bug: server
 * components format every timestamp with lib/locale.ts's own
 * formatTimeForLocale/formatDateTimeForLocale, which fall back to the
 * *server's* local timezone (UTC on Vercel) whenever no explicit
 * `timeZone` is passed - a report saved at 13:13 Israel time (stored
 * correctly as 10:13 UTC) was displayed as "10:13", as if that were local
 * time. See the LocalTime/LocalDateTime components in
 * components/local-time.tsx for where this is actually used.
 */
function subscribeToTimeZone() {
  return () => {};
}
function getTimeZoneSnapshot(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
function getServerTimeZoneSnapshot(): string {
  return "UTC";
}

export function useLocalTimeZone(): string {
  return useSyncExternalStore(subscribeToTimeZone, getTimeZoneSnapshot, getServerTimeZoneSnapshot);
}
