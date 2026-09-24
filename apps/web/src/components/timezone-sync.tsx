"use client";

import { useEffect } from "react";

import { setUserTimezoneAction } from "@/app/app/actions";

/**
 * Captures the browser's own IANA timezone onto the profile once per
 * mismatch (ticket #31) - there's no server-side way to know a user's real
 * timezone, so this compares what's already stored (passed down from the
 * server-rendered layout) against what the browser reports and only calls
 * the action when they differ, covering a brand-new account, an existing
 * one that predates this column, and genuine travel to a new zone alike.
 * Renders nothing - purely a side effect, same shape as
 * ServiceWorkerRegister/NavChromeRefresher elsewhere in this layout.
 */
export function TimezoneSync({ currentTimezone }: { currentTimezone: string | null }) {
  useEffect(() => {
    let detected: string;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!detected || detected === currentTimezone) return;
    void setUserTimezoneAction(detected);
    // Only re-check when the server-known value changes (e.g. after the
    // action above causes a revalidation) - not on every render.
  }, [currentTimezone]);

  return null;
}
