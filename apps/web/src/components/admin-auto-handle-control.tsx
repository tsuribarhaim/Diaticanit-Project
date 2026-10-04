"use client";

import { useState, useTransition } from "react";

import { updateTicketAutoHandleAdminAction } from "@/app/app/tickets/actions";
import { formatTicketAutoHandle, tr, type AppLocale } from "@/lib/locale";
import { ticketAutoHandleOptions, type TicketAutoHandle } from "@/lib/tickets";

const NOT_OPTED_IN = "none";

/**
 * Admin-only control for the auto_handle flag (see docs/design/
 * auto-ticket-handling.md) - same optimistic-select pattern as
 * AdminStatusDropdown: the pill updates the instant a value is picked,
 * then reverts and shows an error if updateTicketAutoHandleAdminAction
 * actually fails. Y/P/D are all pickable manually (not just Y) so an admin
 * can reset a stuck ticket back to Y to retry, or clear one entirely,
 * without needing direct DB access.
 */
export function AdminAutoHandleControl({
  locale,
  ticketId,
  autoHandle,
}: {
  locale: AppLocale;
  ticketId: string;
  autoHandle: TicketAutoHandle | null;
}) {
  const [current, setCurrent] = useState<TicketAutoHandle | null>(autoHandle);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const raw = event.target.value;
    const next: TicketAutoHandle | null = raw === NOT_OPTED_IN ? null : (raw as TicketAutoHandle);
    const previous = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      const result = await updateTicketAutoHandleAdminAction(ticketId, next);
      if (result.error) {
        setCurrent(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <select
        value={current ?? NOT_OPTED_IN}
        onChange={handleChange}
        disabled={isPending}
        aria-label={tr(locale, "Auto-handle", "טיפול אוטומטי")}
        className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 outline-none ring-teal-600 focus:ring-2 disabled:cursor-wait disabled:opacity-60 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-400"
      >
        <option value={NOT_OPTED_IN}>{formatTicketAutoHandle(null, locale)}</option>
        {ticketAutoHandleOptions.map((option) => (
          <option key={option} value={option}>
            {formatTicketAutoHandle(option, locale)}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-rose-600 dark:text-rose-400">{error}</span> : null}
    </div>
  );
}
