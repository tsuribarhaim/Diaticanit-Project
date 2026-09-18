"use client";

import Link from "next/link";
import { useActionState, useState, useSyncExternalStore } from "react";

import {
  recordLoginAction,
  signInAction,
  type AuthActionState,
} from "@/app/auth/actions";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { EnvironmentBadge } from "@/components/environment-badge";
import { tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/client";

const initialState: AuthActionState = {};

/**
 * Whether this browser supports WebAuthn at all - read via
 * useSyncExternalStore (see subscribePasskeySupport below) rather than a
 * useState+useEffect pair, since `PublicKeyCredential` doesn't exist during
 * SSR at all (referencing it outside a browser context would throw) and
 * this is a one-time synchronous capability check, not state that changes
 * over the component's lifetime - exactly what useSyncExternalStore's
 * server/client snapshot split exists for, the same pattern already used
 * elsewhere in this app for "is this definitely running on the client yet."
 */
function subscribePasskeySupport() {
  return () => {};
}
function getPasskeySupportSnapshot() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}
function getServerPasskeySupportSnapshot() {
  return false;
}

export function SignInForm({
  locale,
  nextPath,
  recentEmails,
  environmentBadgeLabel,
  sessionExpired = false,
}: {
  locale: AppLocale;
  nextPath: string;
  recentEmails: string[];
  environmentBadgeLabel: string | null;
  sessionExpired?: boolean;
}) {
  const [state, formAction] = useActionState(signInAction, initialState);
  const [email, setEmail] = useState("");
  const [showEmailSuggestions, setShowEmailSuggestions] = useState(false);

  const supportsPasskey = useSyncExternalStore(
    subscribePasskeySupport,
    getPasskeySupportSnapshot,
    getServerPasskeySupportSnapshot,
  );
  const [passkeyState, setPasskeyState] = useState<{ status: "idle" | "pending" | "error"; error?: string }>({
    status: "idle",
  });

  async function handlePasskeySignIn() {
    setPasskeyState({ status: "pending" });
    const supabase = createClient();
    // No email needed here - unlike the password form, a passkey ceremony
    // identifies the account from the credential the device's own
    // authenticator already has stored for it.
    const { error } = await supabase.auth.signInWithPasskey();

    if (error) {
      setPasskeyState({ status: "error", error: error.message });
      return;
    }

    // Starts this device's session-policy clocks the same way a password
    // sign-in does (see markSuccessfulLogin's own comment) - there's no
    // form submission here for the server to hook that into directly, so
    // it's recorded explicitly right after the ceremony succeeds.
    await recordLoginAction();
    // A full navigation (not router.push) so the server-rendered layout and
    // middleware both see the session cookie signInWithPasskey just set,
    // cleanly, on the very next request - the same reasoning already
    // applied to every other post-auth redirect in this app.
    window.location.href = nextPath;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const filteredRecentEmails = recentEmails.filter((item) =>
    normalizedEmail ? item.toLowerCase().includes(normalizedEmail) : true,
  );

  const shouldShowSuggestions = showEmailSuggestions && filteredRecentEmails.length > 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {environmentBadgeLabel ? (
          <div className="mb-3 flex justify-end">
            <EnvironmentBadge label={environmentBadgeLabel} />
          </div>
        ) : null}
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Sign in", "כניסה")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {tr(locale, "Continue to your secure health workspace.", "המשיכו למרחב הבריאות המאובטח שלכם.")}
        </p>

        {sessionExpired ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {tr(
              locale,
              "You were signed out after a period without activity. Please sign in again.",
              "התנתקת אוטומטית בעקבות תקופה ללא פעילות. יש להתחבר מחדש.",
            )}
          </p>
        ) : null}

        {supportsPasskey ? (
          <div className="mt-5">
            <button
              type="button"
              onClick={handlePasskeySignIn}
              disabled={passkeyState.status === "pending"}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-300 px-3 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 12.5a3 3 0 1 1 6 0c0 1.5-.5 2.5-1.5 4" />
                <path d="M12 2a10 10 0 0 0-10 10c0 2 .5 3.5 1 4.5" />
                <path d="M12 2a10 10 0 0 1 10 10c0 3-.5 5-1.5 7" />
                <path d="M6.5 17.5C7.5 16 8 14.5 8 12.5a4 4 0 0 1 4-4" />
                <path d="M12 8.5a4 4 0 0 1 4 4c0 3-1 5-3 7" />
              </svg>
              {passkeyState.status === "pending"
                ? tr(locale, "Waiting for Face ID / Touch ID...", "ממתין לזיהוי פנים / טביעת אצבע...")
                : tr(locale, "Sign in with Face ID / Touch ID", "כניסה עם זיהוי פנים / טביעת אצבע")}
            </button>
            {passkeyState.status === "error" ? (
              <p className="mt-2 text-xs text-rose-700">{passkeyState.error}</p>
            ) : null}
            <div className="my-5 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              {tr(locale, "or", "או")}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>
        ) : null}

        <form action={formAction} className={supportsPasskey ? "space-y-4" : "mt-6 space-y-4"} autoComplete="off">
          <input type="hidden" name="next" value={nextPath} />

          <label className="block relative">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {tr(locale, "Email", "אימייל")}
            </span>
            <input
              type="email"
              name="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onFocus={() => setShowEmailSuggestions(true)}
              onBlur={() => setTimeout(() => setShowEmailSuggestions(false), 120)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 placeholder:text-slate-400 focus:ring-2"
              placeholder={tr(locale, "you@example.com", "you@example.com")}
            />

            {shouldShowSuggestions ? (
              <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {filteredRecentEmails.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setEmail(item);
                        setShowEmailSuggestions(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                    >
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {tr(locale, "Password", "סיסמה")}
            </span>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 placeholder:text-slate-400 focus:ring-2"
              placeholder={tr(locale, "At least 8 characters", "לפחות 8 תווים")}
            />
          </label>

          {state.error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          ) : null}

          <AuthSubmitButton idleLabel={tr(locale, "Sign in", "כניסה")} pendingLabel={tr(locale, "Signing in...", "נכנסים...")} />
        </form>

        <p className="mt-5 text-sm text-slate-600">
          {tr(locale, "New here?", "חדשים כאן?")} {" "}
          <Link href="/auth/sign-up" className="font-semibold text-teal-700">
            {tr(locale, "Create an account", "יצירת חשבון")}
          </Link>
        </p>
      </section>
    </main>
  );
}
