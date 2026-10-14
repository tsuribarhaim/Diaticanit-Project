"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { changePasswordAction, requestOwnPasswordResetAction, type ChangePasswordState } from "@/app/app/actions";
import { tr, type AppLocale } from "@/lib/locale";

const initialState: ChangePasswordState = {};

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function ChangePasswordSubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-600 dark:hover:bg-teal-500"
    >
      {pending ? <Spinner className="h-4 w-4 animate-spin" /> : null}
      {pending ? tr(locale, "Updating...", "מעדכן...") : tr(locale, "Update password", "עדכון סיסמה")}
    </button>
  );
}

/** TCK-3: for someone who does not remember the current password - a reset link to their own email instead. */
function ForgotCurrentPassword({ locale }: { locale: AppLocale }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  if (message && !message.error) return <p className="max-w-xs text-xs text-emerald-700 dark:text-emerald-400">{message.text}</p>;
  return (
    <div className="max-w-xs">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requestOwnPasswordResetAction();
            setMessage(result.error ? { text: result.error, error: true } : { text: result.success ?? "", error: false });
          })
        }
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:underline disabled:opacity-60 dark:text-teal-400"
      >
        {pending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null}
        {tr(locale, "Forgot your current password? Email me a reset link", "שכחת את הסיסמה הנוכחית? שליחת קישור לאיפוס למייל")}
      </button>
      {message?.error ? <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">{message.text}</p> : null}
    </div>
  );
}

export function ChangePasswordForm({ locale }: { locale: AppLocale }) {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="mt-3 space-y-3" autoComplete="off">
      <label className="block max-w-xs">
        <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          {tr(locale, "Current password", "סיסמה נוכחית")}
        </span>
        <input
          type="password"
          name="current_password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </label>
      <label className="block max-w-xs">
        <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          {tr(locale, "New password", "סיסמה חדשה")}
        </span>
        <input
          type="password"
          name="new_password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder={tr(locale, "At least 8 characters", "לפחות 8 תווים")}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </label>

      {state.error ? <p className="max-w-xs text-xs text-rose-700 dark:text-rose-400">{state.error}</p> : null}
      {state.success ? <p className="max-w-xs text-xs text-emerald-700 dark:text-emerald-400">{state.success}</p> : null}

      <ChangePasswordSubmitButton locale={locale} />
      <ForgotCurrentPassword locale={locale} />
    </form>
  );
}
