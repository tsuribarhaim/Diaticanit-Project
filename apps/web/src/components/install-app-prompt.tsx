"use client";

import { startTransition, useEffect, useState } from "react";

import { tr, type AppLocale } from "@/lib/locale";

const DISMISS_KEY = "daffy_install_prompt_dismissed_at";
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
// Set server-side by signInAction/signUpAction (app/auth/actions.ts) right
// after a user's very first successful login - overrides the normal
// dismissal cooldown below for that one page load, since a brand-new tester
// who never sees an install prompt just reads as "this didn't work."
const INSTALL_PROMPT_DUE_COOKIE = "phc_prompt_install";

/**
 * Chrome's own native install prompt is heuristic-gated (visit count/
 * engagement time) and easy to miss even when it does fire - reported as a
 * tester who signed in and used the app fine but "never got it installed."
 * Capturing beforeinstallprompt ourselves and offering an explicit, always-
 * visible Install button removes that guesswork entirely. iOS Safari has no
 * programmatic install API at all (no beforeinstallprompt ever fires there),
 * so that platform instead gets a plain instructional banner for the manual
 * Share -> Add to Home Screen flow.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    return raw !== null && Date.now() - Number(raw) < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function consumeInstallPromptDueCookie(): boolean {
  const isDue = document.cookie.split("; ").some((entry) => entry === `${INSTALL_PROMPT_DUE_COOKIE}=1`);
  if (isDue) {
    document.cookie = `${INSTALL_PROMPT_DUE_COOKIE}=; path=/; max-age=0`;
  }
  return isDue;
}

export function InstallAppPrompt({ locale }: { locale: AppLocale }) {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const justLoggedInFirstTime = consumeInstallPromptDueCookie();
    if (!justLoggedInFirstTime && wasRecentlyDismissed()) return;

    if (isIos()) {
      startTransition(() => setShowIosInstructions(true));
      return;
    }

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferredEvent(null);
      setDismissed(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Per-viewer convenience only - fine if it can't persist.
    }
  }

  async function handleInstallClick() {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    setDeferredEvent(null);
  }

  if (dismissed || (!showIosInstructions && !deferredEvent)) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(3.25rem+env(safe-area-inset-bottom)+0.5rem)] z-40 flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 shadow-lg sm:bottom-3 dark:border-teal-800 dark:bg-teal-950/90 dark:text-teal-200">
      <span>
        {showIosInstructions
          ? // Opened from a messaging/email app's in-app browser (very
            // common - a tester who tapped this link from WhatsApp/iMessage/
            // Mail reported never seeing an install option at all) often
            // has no "Add to Home Screen" in its share sheet at all, even
            // though it looks like ordinary Safari. Naming "open in Safari"
            // as the first step covers that case and costs nothing for
            // someone already in Safari, where it's a no-op.
            tr(
              locale,
              'To install: open this page in Safari, then tap Share and choose "Add to Home Screen".',
              'להתקנה: יש לפתוח את העמוד בספארי, להקיש על שיתוף ולבחור "הוספה למסך הבית".',
            )
          : tr(locale, "Install Daffy for quicker access.", "התקינו את Daffy לגישה מהירה יותר.")}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {!showIosInstructions ? (
          <button
            type="button"
            onClick={handleInstallClick}
            className="rounded-md bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800 dark:bg-teal-600"
          >
            {tr(locale, "Install", "התקנה")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          aria-label={tr(locale, "Dismiss", "סגירה")}
          className="rounded-md px-2 py-1.5 text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-900"
        >
          {"✕"}
        </button>
      </div>
    </div>
  );
}
