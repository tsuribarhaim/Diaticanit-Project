"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/client";

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/**
 * The password-reset email link lands here with a code in the URL that the
 * Supabase browser client (createClient, detectSessionInUrl on by default)
 * exchanges for a "recovery" session automatically as soon as it's
 * instantiated client-side - there's no server-side callback route for
 * this, which is also why this whole page has to be a client component
 * rather than a plain server-action form like sign-in/sign-up: a server
 * render happens before that browser-side exchange has had any chance to
 * run, so a server action here would see no session yet.
 *
 * onAuthStateChange's own "PASSWORD_RECOVERY" event is the documented
 * signal that the exchange landed - also checking getSession() directly on
 * mount covers the (unlikely but possible) case where the exchange
 * resolved before this listener was attached.
 */
export function ResetPasswordForm({ locale }: { locale: AppLocale }) {
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const supabase = supabaseRef.current;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStatus("ready");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus((previous) => (previous === "checking" ? "ready" : previous));
    });

    // The exchange (or a genuinely invalid/expired link) should resolve
    // within a couple of seconds - if neither the event nor an existing
    // session shows up by then, treat the link as invalid rather than
    // leaving the user staring at "Verifying..." indefinitely.
    const timeoutId = setTimeout(() => {
      setStatus((previous) => (previous === "checking" ? "invalid" : previous));
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(tr(locale, "Password must be at least 8 characters.", "הסיסמה חייבת להיות באורך 8 תווים לפחות."));
      return;
    }
    if (password !== confirmPassword) {
      setError(tr(locale, "Passwords don't match.", "הסיסמאות אינן תואמות."));
      return;
    }

    setIsSubmitting(true);
    const { error: updateError } = await supabaseRef.current.auth.updateUser({ password });
    setIsSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // A full navigation, not router.push - the updated session's cookie
    // needs to be visible to the server-rendered layout and middleware on
    // the very next request, same reasoning as every other post-auth
    // redirect in this app (see sign-in-form.tsx's own comment).
    window.location.href = "/app";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Set a new password", "קביעת סיסמה חדשה")}</h1>

        {status === "checking" ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-600">
            <Spinner className="h-4 w-4 animate-spin" />
            {tr(locale, "Verifying your reset link...", "מאמת את קישור האיפוס...")}
          </div>
        ) : status === "invalid" ? (
          <>
            <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {tr(
                locale,
                "This reset link is invalid or has expired. Please request a new one.",
                "קישור האיפוס אינו תקין או שפג תוקפו. יש לבקש קישור חדש.",
              )}
            </p>
            <p className="mt-5 text-sm text-slate-600">
              <Link href="/auth/forgot-password" className="font-semibold text-teal-700">
                {tr(locale, "Request a new link", "בקשת קישור חדש")}
              </Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4" autoComplete="off">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "New password", "סיסמה חדשה")}</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 placeholder:text-slate-400 focus:ring-2"
                placeholder={tr(locale, "At least 8 characters", "לפחות 8 תווים")}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Confirm new password", "אימות סיסמה חדשה")}</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 placeholder:text-slate-400 focus:ring-2"
                placeholder={tr(locale, "Re-type your new password", "יש להקליד שוב את הסיסמה החדשה")}
              />
            </label>

            {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
            >
              {isSubmitting ? <Spinner className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting
                ? tr(locale, "Setting password...", "קובע סיסמה...")
                : tr(locale, "Set new password", "קביעת סיסמה חדשה")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
