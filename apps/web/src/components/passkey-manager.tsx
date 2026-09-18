"use client";

import { useEffect, useState } from "react";

import { formatDateForLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/client";

type PasskeyListItem = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };

/**
 * Lets the user add/remove passkeys (Face ID/Touch ID/Windows Hello/a
 * hardware key) on the Settings page - the always-available counterpart to
 * the one-time enroll prompt shown right after a fresh password login (see
 * PasskeyEnrollPrompt), for adding a passkey on a second device, adding one
 * after initially declining the prompt, or removing one from a lost device.
 * A client component throughout (not SSR'd) since supabase.auth.passkey.*
 * only exists on a client created with the experimental passkey flag (see
 * lib/supabase/client.ts) - the server client doesn't have it.
 */
export function PasskeyManager({ locale }: { locale: AppLocale }) {
  const [passkeys, setPasskeys] = useState<PasskeyListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{ status: "idle" | "adding" | "removing"; error?: string }>({
    status: "idle",
  });

  async function refreshPasskeys() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setPasskeys(data ?? []);
  }

  useEffect(() => {
    // setTimeout, not a direct call - refreshPasskeys eventually calls
    // setState, and this codebase's react-hooks/set-state-in-effect rule
    // flags that even through an async function reference called directly
    // at the top of an effect body. Scheduling it instead (same idiom used
    // elsewhere in this app for the same rule) satisfies the lint without
    // changing behavior - this still only ever runs once, right after
    // mount.
    const timeoutId = setTimeout(() => {
      void refreshPasskeys();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  async function handleAdd() {
    setActionState({ status: "adding" });
    const supabase = createClient();
    const { error } = await supabase.auth.registerPasskey();
    if (error) {
      setActionState({ status: "idle", error: error.message });
      return;
    }
    setActionState({ status: "idle" });
    await refreshPasskeys();
  }

  async function handleDelete(passkeyId: string) {
    setActionState({ status: "removing" });
    const supabase = createClient();
    const { error } = await supabase.auth.passkey.delete({ passkeyId });
    if (error) {
      setActionState({ status: "idle", error: error.message });
      return;
    }
    setActionState({ status: "idle" });
    await refreshPasskeys();
  }

  return (
    <div className="flex flex-col gap-3">
      {passkeys === null && !loadError ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{tr(locale, "Loading...", "טוען...")}</p>
      ) : null}

      {loadError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
          {loadError}
        </p>
      ) : null}

      {passkeys && passkeys.length > 0 ? (
        <ul className="space-y-2">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-800/60"
            >
              <span className="text-slate-700 dark:text-slate-300">
                {passkey.friendly_name || tr(locale, "Passkey", "מפתח גישה")}
                <span className="ms-2 text-xs text-slate-500 dark:text-slate-400">
                  {tr(locale, "Added", "נוסף")} {formatDateForLocale(passkey.created_at, locale)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void handleDelete(passkey.id)}
                disabled={actionState.status === "removing"}
                className="text-xs font-medium text-rose-700 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-70 dark:text-rose-400 dark:hover:text-rose-300"
              >
                {tr(locale, "Remove", "הסרה")}
              </button>
            </li>
          ))}
        </ul>
      ) : passkeys && passkeys.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {tr(locale, "No passkeys set up on this account yet.", "טרם הוגדרו מפתחות גישה בחשבון זה.")}
        </p>
      ) : null}

      {actionState.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
          {actionState.error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleAdd()}
        disabled={actionState.status === "adding"}
        className="w-fit rounded-lg border border-teal-300 px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-teal-700 dark:text-teal-400 dark:hover:bg-teal-950/40"
      >
        {actionState.status === "adding"
          ? tr(locale, "Waiting for Face ID / Touch ID...", "ממתין לזיהוי פנים / טביעת אצבע...")
          : tr(locale, "+ Add a passkey on this device", "+ הוספת מפתח גישה במכשיר זה")}
      </button>
    </div>
  );
}
