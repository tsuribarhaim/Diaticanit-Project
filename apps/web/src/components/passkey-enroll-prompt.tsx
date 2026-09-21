"use client";

import { useState, useSyncExternalStore } from "react";

import { dismissPasskeyOfferAction } from "@/app/app/actions";
import { tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/client";

function subscribePasskeySupport() {
  return () => {};
}
function getPasskeySupportSnapshot() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}
function getServerPasskeySupportSnapshot() {
  return false;
}

/**
 * The one-time, dismissible "set up Face ID/Touch ID" offer shown right
 * after a fresh password login (see the user's own agreed design: offered
 * once, not buried only in Settings) - gated on passkeyOfferDismissed so it
 * never shows again once the user has responded either way (see
 * dismissPasskeyOfferAction), and on WebAuthn actually being supported in
 * this browser so it never appears somewhere it couldn't possibly work.
 * Declining here doesn't remove the option - PasskeyManager on the Settings
 * page stays available afterward for setting one up later or on another
 * device.
 */
export function PasskeyEnrollPrompt({ locale, passkeyOfferDismissed }: { locale: AppLocale; passkeyOfferDismissed: boolean }) {
  const supportsPasskey = useSyncExternalStore(
    subscribePasskeySupport,
    getPasskeySupportSnapshot,
    getServerPasskeySupportSnapshot,
  );
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "pending" | "error" | "success"; error?: string }>({
    status: "idle",
  });

  if (!supportsPasskey || passkeyOfferDismissed || dismissed) return null;

  async function handleSetUp() {
    setState({ status: "pending" });
    const supabase = createClient();
    const { error } = await supabase.auth.registerPasskey();

    if (error) {
      setState({ status: "error", error: error.message });
      return;
    }

    await dismissPasskeyOfferAction();
    setState({ status: "success" });
  }

  async function handleDismiss() {
    await dismissPasskeyOfferAction();
    setDismissed(true);
  }

  if (state.status === "success") {
    return (
      <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
        <p>
          {tr(locale, "Passkey set up - you can now sign in with Face ID / Touch ID on this device.", "מפתח הגישה הוגדר - כעת ניתן להתחבר עם זיהוי פנים / טביעת אצבע במכשיר זה.")}
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={tr(locale, "Close", "סגירה")}
          className="shrink-0 rounded-md p-1 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 dark:border-teal-800 dark:bg-teal-950/30">
      <div>
        <p className="text-sm font-medium text-teal-900 dark:text-teal-200">
          {tr(locale, "Set up Face ID / Touch ID for faster sign-in?", "להגדיר זיהוי פנים / טביעת אצבע לכניסה מהירה יותר?")}
        </p>
        <p className="mt-0.5 text-xs text-teal-800/80 dark:text-teal-300/80">
          {tr(
            locale,
            "Skip typing your password next time on this device. You can manage this later in Settings.",
            "דלגו על הקלדת הסיסמה בפעם הבאה במכשיר זה. ניתן לנהל זאת מאוחר יותר בהגדרות.",
          )}
        </p>
        {state.status === "error" ? <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">{state.error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void handleDismiss()}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-900/40"
        >
          {tr(locale, "Not now", "לא עכשיו")}
        </button>
        <button
          type="button"
          onClick={() => void handleSetUp()}
          disabled={state.status === "pending"}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-600 dark:hover:bg-teal-500"
        >
          {state.status === "pending" ? tr(locale, "Waiting...", "ממתין...") : tr(locale, "Set up", "הגדרה")}
        </button>
      </div>
    </div>
  );
}
