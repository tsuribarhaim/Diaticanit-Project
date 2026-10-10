"use client";

import { useActionState, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";

import { addPilotUserAction, type AddUserState } from "@/app/app/tickets/invite-actions";
import { directionForLocale, tr, type AppLocale } from "@/lib/locale";

const initialState: AddUserState = {};

function AddButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-600 dark:hover:bg-teal-500"
    >
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
          {tr(locale, "Adding...", "מוסיף...")}
        </>
      ) : (
        tr(locale, "Add user", "הוספת משתמש")
      )}
    </button>
  );
}

const okButtonClass =
  "flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500";

/** Admin only (the caller renders it only in the admin view, and addPilotUserAction checks again on the server): a button that opens a
 * small popup asking for a new user's email and adds it to the pilot invite list. The close (x) is always at the top left. */
export function AddUserDialog({ locale }: { locale: AppLocale }) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, formAction] = useActionState(addPilotUserAction, initialState);
  // The message the admin has already clicked OK on. useActionState keeps its last result, so "dismissed" is remembered per result.
  const [dismissed, setDismissed] = useState<AddUserState | null>(null);
  // The app sets data-theme on its own wrapper, which a popup rendered into document.body sits outside of: carry it over so dark mode applies.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<string | undefined>(undefined);

  const showError = isOpen && Boolean(state.error) && state !== dismissed;
  const showSuccess = isOpen && Boolean(state.added) && state !== dismissed;

  function close() {
    setDismissed(state);
    setIsOpen(false);
    setEmail("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setTheme(triggerRef.current?.closest("[data-theme]")?.getAttribute("data-theme") ?? undefined);
          setDismissed(state);
          setEmail("");
          setIsOpen(true);
        }}
        className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {tr(locale, "+ Add new user", "+ הוספת משתמש חדש")}
      </button>
      {isOpen
        ? createPortal(
            <div dir={directionForLocale(locale)} data-theme={theme} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div role="presentation" onClick={close} className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={tr(locale, "Add new user", "הוספת משתמש חדש")}
                className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
              >
                {/* Always top left, in English and in Hebrew (left-3 is physical, not logical). */}
                <button
                  type="button"
                  onClick={close}
                  aria-label={tr(locale, "Close", "סגירה")}
                  className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>

                {showSuccess ? (
                  <div className="pt-4 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" aria-hidden="true">
                      ✓
                    </div>
                    <h3 className="mt-3 text-base font-bold text-slate-900 dark:text-slate-100">
                      {state.alreadyThere ? tr(locale, "Already on the list", "כבר ברשימה") : tr(locale, "User added", "המשתמש נוסף")}
                    </h3>
                    <p role="status" className="mt-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
                      {state.alreadyThere
                        ? tr(locale, `${state.added} was already allowed to sign up. Nothing was changed.`, `${state.added} כבר הורשה להירשם. לא בוצע שינוי.`)
                        : tr(
                            locale,
                            `${state.added} can now download Daffy, sign up and go through onboarding.`,
                            `${state.added} יכול/ה עכשיו להוריד את Daffy, להירשם ולעבור את תהליך ההצטרפות.`,
                          )}
                    </p>
                    <div className="mt-4 flex">
                      <button type="button" onClick={close} className={okButtonClass} autoFocus>
                        {tr(locale, "OK", "אישור")}
                      </button>
                    </div>
                  </div>
                ) : showError ? (
                  <div className="pt-4">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Could not add this user", "לא ניתן להוסיף את המשתמש")}</h3>
                    <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-400">
                      {state.error}
                    </p>
                    {/* OK goes back to the same popup with the typed text still there; the x closes everything. */}
                    <div className="mt-4 flex">
                      <button type="button" onClick={() => setDismissed(state)} className={okButtonClass} autoFocus>
                        {tr(locale, "OK", "אישור")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <form action={formAction} className="pt-4">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Add new user", "הוספת משתמש חדש")}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {tr(
                        locale,
                        "Type the email of the person to invite. They can then download Daffy, sign up and go through onboarding.",
                        "יש להקליד את האימייל של האדם להזמנה. הוא/היא יוכלו להוריד את Daffy, להירשם ולעבור את תהליך ההצטרפות.",
                      )}
                    </p>
                    <label htmlFor="add-user-email" className="mt-4 mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      {tr(locale, "Email address", "כתובת אימייל")}
                    </label>
                    <input
                      id="add-user-email"
                      name="email"
                      type="text"
                      inputMode="email"
                      autoComplete="off"
                      autoFocus
                      dir="ltr"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={close}
                        className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        {tr(locale, "Cancel", "ביטול")}
                      </button>
                      <AddButton locale={locale} />
                    </div>
                  </form>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
