"use client";

import Link from "next/link";
import { useActionState } from "react";

import { forgotPasswordAction, type AuthActionState } from "@/app/auth/actions";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { tr, type AppLocale } from "@/lib/locale";

const initialState: AuthActionState = {};

export function ForgotPasswordForm({ locale }: { locale: AppLocale }) {
  const [state, formAction] = useActionState(forgotPasswordAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Reset your password", "איפוס סיסמה")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {tr(
            locale,
            "Enter your account email and we'll send you a link to set a new password.",
            "יש להזין את כתובת האימייל של החשבון שלכם ונשלח לכם קישור לקביעת סיסמה חדשה.",
          )}
        </p>

        {state.success ? (
          <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p>
        ) : (
          <form action={formAction} className="mt-6 space-y-4" autoComplete="off">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Email", "אימייל")}</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="off"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 placeholder:text-slate-400 focus:ring-2"
                placeholder={tr(locale, "you@example.com", "you@example.com")}
              />
            </label>

            <AuthSubmitButton
              idleLabel={tr(locale, "Send reset link", "שליחת קישור לאיפוס")}
              pendingLabel={tr(locale, "Sending...", "שולח...")}
            />
          </form>
        )}

        <p className="mt-5 text-sm text-slate-600">
          <Link href="/auth/sign-in" className="font-semibold text-teal-700">
            {tr(locale, "Back to sign in", "חזרה להתחברות")}
          </Link>
        </p>
      </section>
    </main>
  );
}
