"use client";

import { useState, useTransition } from "react";

import { updateTicketStatusAdminAction } from "@/app/app/tickets/actions";
import { QuickEditSheet } from "@/components/profile-quick-edit";
import { formatTicketStatus, tr, type AppLocale } from "@/lib/locale";
import { ticketStatusBadgeClass, ticketStatusOptions, type TicketStatus } from "@/lib/tickets";

const STATUSES_NEEDING_REASON: readonly TicketStatus[] = ["cancelled", "deferred"];

/**
 * The admin-only free status dropdown (see docs/design/
 * user-support-tickets-design.md's own follow-up on the admin role) -
 * used both inline in the ticket list's Status column and at the top of
 * the ticket detail view. Optimistic: the pill recolors the instant a new
 * status is picked, then reverts and shows an error if
 * updateTicketStatusAdminAction actually fails (e.g. a stale admin
 * session) - not called through useActionState/a <form>, since a bare
 * <select> has no form to submit.
 *
 * Three statuses (cancelled/deferred/duplicate) each have their own
 * required companion column, enforced by a DB check constraint - picking
 * one used to always fail with a generic "could not update status" (no
 * indication why), reported live as "some I can update, some I can't".
 * Those three now open a small prompt for the required reason (or, for
 * duplicate, the other ticket's number) before submitting, instead of
 * writing status alone and letting the database reject it.
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
  const [pendingStatus, setPendingStatus] = useState<TicketStatus | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [duplicateSeqDraft, setDuplicateSeqDraft] = useState("");

  function submitStatus(next: TicketStatus, extra?: { reason?: string; duplicateOfTicketSeq?: number }) {
    const previous = currentStatus;
    setCurrentStatus(next);
    setError(null);
    startTransition(async () => {
      const result = await updateTicketStatusAdminAction(ticketId, next, extra);
      if (result.error) {
        setCurrentStatus(previous);
        setError(result.error);
      }
    });
  }

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as TicketStatus;
    if (STATUSES_NEEDING_REASON.includes(next) || next === "duplicate") {
      setReasonDraft("");
      setDuplicateSeqDraft("");
      setPendingStatus(next);
      return;
    }
    submitStatus(next);
  }

  function confirmPendingStatus() {
    if (!pendingStatus) return;
    if (pendingStatus === "duplicate") {
      const seq = Number(duplicateSeqDraft.trim());
      if (!seq) {
        setError(tr(locale, "Enter the ticket number this duplicates.", "יש להזין את מספר הפנייה שאליה זו כפולה."));
        return;
      }
      submitStatus(pendingStatus, { duplicateOfTicketSeq: seq });
    } else {
      submitStatus(pendingStatus, { reason: reasonDraft });
    }
    setPendingStatus(null);
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

      {pendingStatus ? (
        <QuickEditSheet
          locale={locale}
          isOpen
          onClose={() => setPendingStatus(null)}
          title={
            pendingStatus === "duplicate"
              ? tr(locale, "Mark as duplicate", "סימון ככפולה")
              : tr(locale, `Set status to ${formatTicketStatus(pendingStatus, locale)}`, `שינוי סטטוס ל${formatTicketStatus(pendingStatus, locale)}`)
          }
          helpText={
            pendingStatus === "duplicate"
              ? tr(locale, "Which ticket is this a duplicate of?", "לאיזו פנייה זו כפולה?")
              : tr(locale, "A reason is required for this status.", "נדרשת סיבה עבור סטטוס זה.")
          }
        >
          <div className="space-y-3">
            {pendingStatus === "duplicate" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{tr(locale, "Ticket number", "מספר פנייה")}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">TCK-</span>
                  <input
                    type="number"
                    value={duplicateSeqDraft}
                    onChange={(event) => setDuplicateSeqDraft(event.target.value)}
                    autoFocus
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </label>
            ) : (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{tr(locale, "Reason", "סיבה")}</span>
                <textarea
                  value={reasonDraft}
                  onChange={(event) => setReasonDraft(event.target.value)}
                  autoFocus
                  rows={3}
                  maxLength={500}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingStatus(null)}
                className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {tr(locale, "Cancel", "ביטול")}
              </button>
              <button
                type="button"
                onClick={confirmPendingStatus}
                className="flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
              >
                {tr(locale, "Confirm", "אישור")}
              </button>
            </div>
          </div>
        </QuickEditSheet>
      ) : null}
    </div>
  );
}
