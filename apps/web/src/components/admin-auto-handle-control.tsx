"use client";

import { useState, useTransition } from "react";

import { updateTicketAutoHandleAdminAction } from "@/app/app/tickets/actions";
import { formatTicketAutoHandle, tr, type AppLocale } from "@/lib/locale";
import { canMarkForAutomation, type TicketAutoHandle } from "@/lib/tickets";

const NOT_OPTED_IN = "none";

/** 'S' (ask for a spec first) and 'Y' (queue for the night run) are the
 * decisions an admin deliberately makes. Picking 'Y' while the ticket is 'A'
 * is the approval of the analyst's proposal. 'A', 'P' and 'D' are outcomes
 * the automation itself reports back
 * (see the auto-handle-result API route) - they used to also be pickable
 * here, which let an admin select "Plan ready" or "Fix ready" as if
 * choosing them made it so, when really only the bridge reporting back
 * ever means that. */
const ADMIN_PICKABLE_OPTIONS: TicketAutoHandle[] = ["S", "Y"];

/**
 * Admin-only control for the auto_handle flag (see docs/design/
 * auto-ticket-handling.md) - same optimistic-select pattern as
 * AdminStatusDropdown: the pill updates the instant a value is picked,
 * then reverts and shows an error if updateTicketAutoHandleAdminAction
 * actually fails. When the current value is 'P' or 'D' (automation-set),
 * it's still shown so the admin can see the real state, but as a disabled
 * option - not something this control offers as a choice to pick again.
 */
export function AdminAutoHandleControl({
  locale,
  ticketId,
  autoHandle,
  status,
}: {
  locale: AppLocale;
  ticketId: string;
  autoHandle: TicketAutoHandle | null;
  status: string;
}) {
  const [current, setCurrent] = useState<TicketAutoHandle | null>(autoHandle);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Not marked yet and not open / reopened: it cannot be a candidate, so the control is switched off.
  const notEligible = current === null && !canMarkForAutomation(status);

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
        disabled={isPending || notEligible}
        title={notEligible ? tr(locale, "Only open or reopened tickets can be marked for automation", "אפשר לסמן לאוטומציה רק פניות פתוחות או שנפתחו מחדש") : undefined}
        aria-label={tr(locale, "Auto-handle", "טיפול אוטומטי")}
        className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 outline-none ring-teal-600 focus:ring-2 disabled:cursor-wait disabled:opacity-60 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-400"
      >
        <option value={NOT_OPTED_IN}>{formatTicketAutoHandle(null, locale)}</option>
        {ADMIN_PICKABLE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {formatTicketAutoHandle(option, locale)}
          </option>
        ))}
        {current && !ADMIN_PICKABLE_OPTIONS.includes(current) ? (
          <option value={current} disabled>
            {formatTicketAutoHandle(current, locale)}
          </option>
        ) : null}
      </select>
      {notEligible ? <span className="text-[11px] text-slate-500 dark:text-slate-400">{tr(locale, "Only open or reopened tickets", "רק פניות פתוחות או שנפתחו מחדש")}</span> : null}
      {error ? <span className="text-[11px] text-rose-600 dark:text-rose-400">{error}</span> : null}
    </div>
  );
}
