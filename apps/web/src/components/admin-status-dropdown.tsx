"use client";

import { useState, useTransition } from "react";

import { updateTicketStatusAdminAction } from "@/app/app/tickets/actions";
import { formatTicketStatus, tr, type AppLocale } from "@/lib/locale";
import { ticketStatusBadgeClass, ticketStatusOptions, type TicketStatus } from "@/lib/tickets";

/**
 * The admin-only free status dropdown (see docs/design/
 * user-support-tickets-design.md's own follow-up on the admin role) -
 * used both inline in the ticket list's Status column and at the top of
 * the ticket detail view. Optimistic: the pill recolors the instant a new
 * status is picked, then reverts and shows an error if
 * updateTicketStatusAdminAction actually fails (e.g. a stale admin
 * session) - not called through useActionState/a <form>, since a bare
 * <select> has no form to submit.
 */
export function AdminStatusDropdown({
  locale,
  ticketId,
  status,
  size = "sm",
}: {
  locale: AppLocale;
  ticketId: string;
  status: TicketStatus;
  size?: "sm" | "md";
}) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as TicketStatus;
    const previous = currentStatus;
    setCurrentStatus(next);
    setError(null);
    startTransition(async () => {
      const result = await updateTicketStatusAdminAction(ticketId, next);
      if (result.error) {
        setCurrentStatus(previous);
        setError(result.error);
      }
    });
  }

  const sizeClass = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <select
        value={currentStatus}
        onChange={handleChange}
        disabled={isPending}
        aria-label={tr(locale, "Change status", "שינוי סטטוס")}
        className={`rounded-full border font-semibold outline-none ring-teal-600 focus:ring-2 disabled:cursor-wait disabled:opacity-60 ${sizeClass} ${ticketStatusBadgeClass(currentStatus)}`}
      >
        {ticketStatusOptions.map((option) => (
          <option key={option} value={option}>
            {formatTicketStatus(option, locale)}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-rose-600 dark:text-rose-400">{error}</span> : null}
    </div>
  );
}
