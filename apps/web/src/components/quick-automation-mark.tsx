"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateTicketAutoHandleAdminAction } from "@/app/app/tickets/actions";
import { Spinner } from "@/components/spinner";
import { tr, type AppLocale } from "@/lib/locale";

/** One click in the admin ticket list marks a ticket for automation (the analyst picks it up at its next run),
 * without opening the ticket. Same step as setting Auto-handle to "Spec requested" on the ticket itself. */
export function QuickAutomationMark({ locale, ticketId }: { locale: AppLocale; ticketId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await updateTicketAutoHandleAdminAction(ticketId, "S");
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-teal-600 px-2.5 py-0.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-teal-500 dark:text-teal-300 dark:hover:bg-teal-950/40"
      >
        {pending ? <Spinner className="h-3 w-3 animate-spin" /> : null}
        {tr(locale, "Mark for automation", "סימון לאוטומציה")}
      </button>
      {error ? <span className="text-[11px] text-rose-600 dark:text-rose-400">{error}</span> : null}
    </span>
  );
}
