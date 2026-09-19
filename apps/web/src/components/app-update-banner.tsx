"use client";

import { startTransition, useCallback, useEffect, useState } from "react";

import { tr, type AppLocale } from "@/lib/locale";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The real update-detection mechanism for the installed PWA - not the
 * service worker's own update lifecycle. iOS home-screen apps cache
 * aggressively and don't reliably re-check a service worker on their own
 * schedule, and even on Android a new SW only takes over once activated and
 * still leaves stale JS running in the open tab until a reload. Polling
 * this app's own already-existing NEXT_PUBLIC_APP_VERSION badge value
 * (baked into this bundle at build time) against a live /api/version
 * response sidesteps all of that: it works identically on iOS and Android,
 * and only needs a plain reload to pick up the new deploy, since Next's
 * content-hashed asset filenames do the actual cache-busting for JS/CSS.
 */
export function AppUpdateBanner({ locale }: { locale: AppLocale }) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

  const checkVersion = useCallback(async () => {
    if (!currentVersion) return;
    try {
      const response = await fetch("/api/version", { cache: "no-store" });
      if (!response.ok) return;
      const data: { version: string | null } = await response.json();
      if (data.version && data.version !== currentVersion) {
        startTransition(() => setUpdateAvailable(true));
      }
    } catch {
      // A failed check just means we stay quiet this time, not an error worth surfacing.
    }
  }, [currentVersion]);

  useEffect(() => {
    checkVersion();
    const interval = setInterval(checkVersion, CHECK_INTERVAL_MS);
    function onVisibilityChange() {
      if (document.visibilityState === "visible") checkVersion();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [checkVersion]);

  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-teal-700 px-4 py-2 text-sm text-white shadow-md dark:bg-teal-600">
      <span>{tr(locale, "A new version of Daffy is available.", "גרסה חדשה של Daffy זמינה.")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-md bg-white/20 px-3 py-1 font-semibold hover:bg-white/30"
      >
        {tr(locale, "Refresh", "רענון")}
      </button>
    </div>
  );
}
