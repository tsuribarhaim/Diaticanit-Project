"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js - purely for PWA installability on Android/Chrome
 * (a manifest alone is enough for iOS Safari to allow "Add to Home
 * Screen"). Re-checks for a new service worker whenever the app is
 * foregrounded, since the browser otherwise only checks on its own
 * schedule (often not for many hours) - this is a secondary signal
 * alongside AppUpdateBanner's own version polling, not the primary update
 * mechanism (see that component's own comment for why).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
      })
      .catch(() => {
        // Installability is a nice-to-have, not a hard requirement - never
        // let a failed registration affect the rest of the app.
      });

    function checkForUpdate() {
      if (document.visibilityState !== "visible") return;
      registration?.update().catch(() => {});
    }

    document.addEventListener("visibilitychange", checkForUpdate);
    return () => document.removeEventListener("visibilitychange", checkForUpdate);
  }, []);

  return null;
}
