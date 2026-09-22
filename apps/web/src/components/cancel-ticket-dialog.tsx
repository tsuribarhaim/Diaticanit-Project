"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { cancelTicketAction, type TicketFormState } from "@/app/app/tickets/actions";
import { QuickEditSheet, useQuickEditSuccessEffect } from "@/components/profile-quick-edit";
import { tr, type AppLocale } from "@/lib/locale";

const initialState: TicketFormState = {};

function ConfirmCancelButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-rose-700"
    >
      {pending ? tr(locale, "Cancelling...", "מבטל...") : tr(locale, "Confirm", "אישור")}
    </button>
  );
}

/** The Cancel button + confirm dialog, shared by both the My Tickets table
 * row action and the Ticket Detail screen's own Cancel button - same
 * underlying cancelTicketAction either way. */
export function CancelTicketDialog({ locale, ticketId, ticketSeq }: { locale: AppLocale; ticketId: string; ticketSeq: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction] = useActionState(cancelTicketAction, initialState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  return (
    <>
      {/* "Cancel Ticket", not just "Cancel" - a bare "Cancel" next to a
          "Close" button on the same screen reads as ambiguous between
          cancelling the ticket and dismissing/closing this screen. */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-sm font-semibold text-rose-600 hover:underline dark:text-rose-400"
      >
        {tr(locale, "Cancel Ticket", "ביטול הפנייה")}
      </button>
      <QuickEditSheet
        locale={locale}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={tr(locale, `Cancel Ticket TCK-${ticketSeq}?`, `לבטל את הפנייה TCK-${ticketSeq}?`)}
      >
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="ticket_id" value={ticketId} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{tr(locale, "Reason", "סיבה")}</span>
            <input
              type="text"
              name="reason"
              defaultValue={tr(locale, "User request", "בקשת המשתמש")}
              maxLength={255}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {tr(locale, "Keep Ticket", "השארת הפנייה")}
            </button>
            <ConfirmCancelButton locale={locale} />
          </div>
        </form>
      </QuickEditSheet>
    </>
  );
}
