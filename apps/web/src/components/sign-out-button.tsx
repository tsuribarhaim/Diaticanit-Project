"use client";

import { useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

import { signOutAction } from "@/app/app/actions";
import { Spinner } from "@/components/spinner";
import { directionForLocale, tr, type AppLocale } from "@/lib/locale";

function SignOutConfirmSubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-rose-600 dark:hover:bg-rose-500"
    >
      {pending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null}
      {tr(locale, "Log Out", "התנתקות")}
    </button>
  );
}

/** Settings & Support's Log Out button - asks for confirmation first so a stray tap doesn't log the user out (TCK-178). */
export function SignOutButton({ locale }: { locale: AppLocale }) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // The app sets data-theme on its own wrapper, which a popup rendered into document.body sits outside of: carry it over so dark mode applies.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<string | undefined>(undefined);
  const message = tr(locale, "Log out of your account?", "להתנתק מהחשבון?");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setTheme(triggerRef.current?.closest("[data-theme]")?.getAttribute("data-theme") ?? undefined);
          setIsConfirmOpen(true);
        }}
        className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-center text-sm font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50"
      >
        {tr(locale, "Log Out", "התנתקות")}
      </button>

      {isConfirmOpen
        ? createPortal(
            <div
              dir={directionForLocale(locale)}
              data-theme={theme}
              className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
              role="presentation"
              onClick={() => {
                if (!isSigningOut) setIsConfirmOpen(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={message}
                className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-5 py-4">
                  <p className="text-sm text-slate-700 dark:text-slate-300">{message}</p>
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={isSigningOut}
                    onClick={() => setIsConfirmOpen(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {tr(locale, "Cancel", "ביטול")}
                  </button>
                  <form action={signOutAction} onSubmit={() => setIsSigningOut(true)}>
                    <SignOutConfirmSubmitButton locale={locale} />
                  </form>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
