"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { submitTicketDraftAction, type TicketFormState } from "@/app/app/tickets/actions";
import { tr, type AppLocale } from "@/lib/locale";

const initialState: TicketFormState = {};

function SubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
    >
      {pending ? tr(locale, "Submitting...", "שולח...") : tr(locale, "Submit ticket", "שליחת הפנייה")}
    </button>
  );
}

/**
 * Self-service draft -> open, shown only while status is "draft" (mirrors
 * tickets_submit_own). No confirm dialog, unlike Cancel/Reopen - nothing
 * destructive happens and the full ticket content is already visible right
 * above this button, so there's nothing extra worth a modal interrupting
 * for. submitTicketDraftAction itself still validates subject/type/area/
 * description are all filled in before flipping the status, surfacing a
 * plain "choose a type"-style error inline below if something's missing.
 */
export function SubmitTicketDraftButton({ locale, ticketId }: { locale: AppLocale; ticketId: string }) {
  const [state, formAction] = useActionState(submitTicketDraftAction, initialState);
  const router = useRouter();

  // Re-renders this Server Component page with the now-"open" status -
  // revalidatePath alone (already called server-side in the action)
  // doesn't repaint an already-mounted page on its own, same pattern as
  // useQuickEditSuccessEffect elsewhere in this app.
  useEffect(() => {
    if (state.success) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="ticket_id" value={ticketId} />
      {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
      <SubmitButton locale={locale} />
    </form>
  );
}
