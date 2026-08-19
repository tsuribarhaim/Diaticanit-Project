"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  signInAction,
  type AuthActionState,
} from "@/app/auth/actions";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { tr, type AppLocale } from "@/lib/locale";

const initialState: AuthActionState = {};

export function SignInForm({
  locale,
  nextPath,
  recentEmails,
}: {
  locale: AppLocale;
  nextPath: string;
  recentEmails: string[];
}) {
  const [state, formAction] = useActionState(signInAction, initialState);
  const [email, setEmail] = useState("");
  const [showEmailSuggestions, setShowEmailSuggestions] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();
  const filteredRecentEmails = recentEmails.filter((item) =>
    normalizedEmail ? item.toLowerCase().includes(normalizedEmail) : true,
  );

  const shouldShowSuggestions = showEmailSuggestions && filteredRecentEmails.length > 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Sign in", "כניסה")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {tr(locale, "Continue to your secure health workspace.", "המשיכו למרחב הבריאות המאובטח שלכם.")}
        </p>

        <form action={formAction} className="mt-6 space-y-4" autoComplete="off">
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
