"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { createTicketAction, type TicketFormState } from "@/app/app/tickets/actions";
import { formatTicketArea, formatTicketPriority, formatTicketType, tr, type AppLocale } from "@/lib/locale";
import { ticketAreaOptions, ticketPriorityOptions, ticketTypeOptions } from "@/lib/tickets";

const initialState: TicketFormState = {};

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function SubmitTicketButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
    >
      {pending ? <Spinner className="h-4 w-4 animate-spin" /> : null}
      {pending ? tr(locale, "Submitting...", "שולח...") : tr(locale, "Submit Ticket", "שליחת פנייה")}
    </button>
  );
}

const inputClassName =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none ring-teal-600 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

export function NewTicketForm({ locale }: { locale: AppLocale }) {
  const [state, formAction] = useActionState(createTicketAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Subject", "נושא")}</span>
        <input type="text" name="subject" required maxLength={200} className={inputClassName} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Type", "סוג")}</span>
          <select name="ticket_type" required defaultValue="" className={inputClassName}>
            <option value="" disabled>
              {tr(locale, "Select a type...", "בחרו סוג...")}
            </option>
            {ticketTypeOptions.map((option) => (
              <option key={option} value={option}>
                {formatTicketType(option, locale)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Priority", "עדיפות")}</span>
          <select name="priority" required defaultValue="medium" className={inputClassName}>
            {ticketPriorityOptions.map((option) => (
              <option key={option} value={option}>
                {formatTicketPriority(option, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Area", "אזור")}</span>
        <select name="area" required defaultValue="" className={inputClassName}>
          <option value="" disabled>
            {tr(locale, "Which part of the app is this about?", "לאיזה חלק באפליקציה זה קשור?")}
          </option>
          {ticketAreaOptions.map((option) => (
            <option key={option} value={option}>
              {formatTicketArea(option, locale)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Description", "תיאור")}</span>
        <textarea name="description" required rows={6} maxLength={5000} className={inputClassName} />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {tr(locale, "Attachment (optional)", "קובץ מצורף (אופציונלי)")}
        </span>
        <input
          type="file"
          name="attachment"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
          className="block w-full text-sm text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-teal-700 hover:file:bg-teal-100 dark:text-slate-400 dark:file:bg-teal-950/40 dark:file:text-teal-400"
        />
      </label>

      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
          {state.error}
        </p>
      ) : null}

      <SubmitTicketButton locale={locale} />
    </form>
  );
}
