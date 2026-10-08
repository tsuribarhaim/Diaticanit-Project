"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { takeTicketOutAction } from "@/app/app/tickets/review-actions";
import { updateTicketAutoHandleAdminAction } from "@/app/app/tickets/actions";
import { Spinner } from "@/components/spinner";
import { formatTicketAutoHandle, tr, type AppLocale } from "@/lib/locale";
import { canMarkForAutomation } from "@/lib/tickets";

/** The little box in the admin ticket list's Automation column. Unticked = not in automation: tick it and the ticket is
 * marked for automation (the analyst picks it up at its next run), without opening the ticket. A ticked box means it is in
 * automation; the dot beside it is the stage (hover for its name). While the ticket is still only marked ("Spec requested")
 * you can untick it to take it out again; once anything has happened to it, the box is locked and the Ticket Automation page
 * is where it is managed. */

const DOT: Record<string, string> = {
  S: "bg-sky-500",
  A: "bg-amber-500",
  Y: "bg-indigo-500",
  P: "bg-rose-500",
  D: "bg-emerald-500",
  M: "bg-blue-500",
  R: "bg-teal-500",
};

export function AutomationCheckbox({
  locale,
  ticketId,
  autoHandle,
  settled,
  status,
  withText = false,
}: {
  locale: AppLocale;
  ticketId: string;
  autoHandle: string | null;
  settled: boolean;
  status: string;
  /** On the ticket page the box comes with its words ("Auto Handle", the stage, any reason it is switched off); the list keeps it bare. */
  withText?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A finished ticket: nothing to tick. If automation fixed it, a quiet check says so.
  if (settled && withText) {
    const text = autoHandle === "D" ? tr(locale, "Fixed by automation", "תוקן על ידי האוטומציה") : formatTicketAutoHandle(autoHandle, locale);
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        {autoHandle === "D" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-emerald-600 dark:text-emerald-400">
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        ) : null}
        {text}
      </span>
    );
  }
  if (settled) {
    return autoHandle === "D" ? (
      <span title={tr(locale, "Fixed by automation", "תוקן על ידי האוטומציה")} aria-label={tr(locale, "Fixed by automation", "תוקן על ידי האוטומציה")} className="inline-flex h-5 w-5 items-center justify-center text-emerald-600 dark:text-emerald-400">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      </span>
    ) : null;
  }

  const marked = autoHandle !== null;
  // Only open / reopened tickets can become candidates: the box is switched off for any other status.
  const notEligible = !marked && !canMarkForAutomation(status);
  const canUntick = autoHandle === "S";
  const stage = formatTicketAutoHandle(autoHandle, locale);
  const label = notEligible
    ? tr(locale, "Only open or reopened tickets can be marked for automation", "אפשר לסמן לאוטומציה רק פניות פתוחות או שנפתחו מחדש")
    : marked
    ? canUntick
      ? tr(locale, `In automation: ${stage}. Untick to take it out.`, `באוטומציה: ${stage}. להסיר סימון כדי להוציא.`)
      : tr(locale, `In automation: ${stage}. Manage it on the Ticket Automation page.`, `באוטומציה: ${stage}. מנהלים בדף אוטומציית פניות.`)
    : tr(locale, "Mark for automation", "סימון לאוטומציה");

  const Wrapper = withText ? "label" : "span";
  return (
    <Wrapper className={withText ? "inline-flex cursor-pointer flex-wrap items-center gap-1.5 text-sm text-slate-900 dark:text-slate-100" : "inline-flex items-center gap-1.5"} title={label}>
      {pending ? (
        <Spinner className="h-4 w-4 animate-spin" />
      ) : (
        <input
          type="checkbox"
          checked={marked}
          disabled={notEligible || (marked && !canUntick)}
          aria-label={label}
          onChange={(event) => {
            setError(null);
            startTransition(async () => {
              const result = event.target.checked ? await updateTicketAutoHandleAdminAction(ticketId, "S") : await takeTicketOutAction(ticketId);
              if (result.error) setError(result.error);
              else router.refresh();
            });
          }}
          className="h-4 w-4 cursor-pointer accent-teal-700 disabled:cursor-not-allowed"
        />
      )}
      {withText ? <span>{tr(locale, "Auto Handle", "טיפול אוטומטי")}</span> : null}
      {marked ? <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${DOT[autoHandle] ?? "bg-slate-400"}`} /> : null}
      {withText && marked ? <span className="text-xs text-slate-500 dark:text-slate-400">{stage}</span> : null}
      {withText && notEligible ? <span className="text-xs text-slate-500 dark:text-slate-400">{tr(locale, "Only open or reopened tickets", "רק פניות פתוחות או שנפתחו מחדש")}</span> : null}
      {error ? <span className="text-[11px] text-rose-600 dark:text-rose-400">{error}</span> : null}
    </Wrapper>
  );
}
