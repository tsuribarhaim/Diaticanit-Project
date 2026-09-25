"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { reopenTicketAction, type TicketFormState } from "@/app/app/tickets/actions";
import { QuickEditSheet, useQuickEditSuccessEffect } from "@/components/profile-quick-edit";
import { tr, type AppLocale } from "@/lib/locale";

const initialState: TicketFormState = {};

function ConfirmReopenButton({ locale, disabled }: { locale: AppLocale; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="flex-1 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-amber-700"
    >
      {pending ? tr(locale, "Reopening...", "פותח מחדש...") : tr(locale, "Reopen ticket", "פתיחה מחדש")}
    </button>
  );
}

/**
 * Self-service reopen - shown only while isReopenableTicketStatus(status)
 * (resolved only; see lib/tickets.ts's own comment on why closed stays
 * tester/admin-only). Same QuickEditSheet shell as CancelTicketDialog,
 * except the text box here is REQUIRED, not optional: reopening without
 * saying what's still wrong would leave support with nothing to act on
 * (this becomes the ticket's next dated history entry - see
 * appendTicketDescriptionEntry). The button stays disabled until there's
 * actually something typed, mirrored client-side so the requirement is
 * obvious before a submit round-trip, not just enforced after one.
 */
export function ReopenTicketDialog({
  locale,
  ticketId,
  ticketSeq,
  autoOpen = false,
}: {
  locale: AppLocale;
  ticketId: string;
  ticketSeq: number;
  /** Opens the dialog immediately on mount - see EditTicketDialog's own
   * identical prop for why (the My Tickets list's Reopen icon deep-links
   * here via `?reopen=1`). */
  autoOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [note, setNote] = useState("");
  const [state, formAction] = useActionState(reopenTicketAction, initialState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNote("");
          setIsOpen(true);
        }}
        className="text-sm font-semibold text-amber-700 hover:underline dark:text-amber-400"
      >
        {tr(locale, "Reopen Ticket", "פתיחת הפנייה מחדש")}
      </button>
      <QuickEditSheet
        locale={locale}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={tr(locale, `Reopen Ticket TCK-${ticketSeq}?`, `לפתוח מחדש את הפנייה TCK-${ticketSeq}?`)}
        helpText={tr(
          locale,
          "Tell us what's still wrong or what you found when you tested it - this is required so support knows exactly what to look at again.",
          "ספרו לנו מה עדיין לא תקין או מה מצאתם כשבדקתם - זה שדה חובה כדי שהתמיכה תדע בדיוק מה לבדוק שוב.",
        )}
      >
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="ticket_id" value={ticketId} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{tr(locale, "What's still wrong", "מה עדיין לא תקין")}</span>
            <textarea
              name="note"
              required
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={tr(
                locale,
                "e.g. Tried again after the update - still happens the same way...",
                "לדוגמה: ניסיתי שוב אחרי העדכון - זה עדיין קורה באותו אופן...",
              )}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {tr(locale, "Cancel", "ביטול")}
            </button>
            <ConfirmReopenButton locale={locale} disabled={note.trim().length === 0} />
          </div>
        </form>
      </QuickEditSheet>
    </>
  );
}
