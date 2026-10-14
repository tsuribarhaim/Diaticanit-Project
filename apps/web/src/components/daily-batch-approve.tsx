"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { approveBatchAction, rejectBatchAction } from "@/app/app/tickets/review-actions";
import { Spinner } from "@/components/spinner";
import type { BatchTicket } from "@/lib/daily-batch";
import { tr, type AppLocale } from "@/lib/locale";

/** The proposed batch: tick the tickets to fix tonight, then approve - or reject the whole batch (see lib/daily-batch-review.ts). */
export function DailyBatchApprove({ locale, batchId, tickets }: { locale: AppLocale; batchId: string; tickets: BatchTicket[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tickets.map((t) => t.ticketId)));
  const [pending, startTransition] = useTransition();
  const [which, setWhich] = useState<"approve" | "reject" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  function run(kind: "approve" | "reject") {
    setWhich(kind);
    startTransition(async () => {
      const result = kind === "approve" ? await approveBatchAction(batchId, [...picked]) : await rejectBatchAction(batchId);
      setMessage(result.error ? { text: result.error, error: true } : { text: result.success ?? "", error: false });
      if (!result.error) router.refresh();
      setWhich(null);
    });
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {tickets.map((t) => (
          <li key={t.ticketId} className="py-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={picked.has(t.ticketId)}
                disabled={pending}
                onChange={(event) =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(t.ticketId);
                    else next.delete(t.ticketId);
                    return next;
                  })
                }
                className="mt-1 h-4 w-4 accent-teal-700"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span dir="ltr" className="rounded bg-slate-100 px-1.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">TCK-{t.seq}</span>
                  <span dir="auto" className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.subject}</span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{t.reason}</span>
                {t.needsMigration ? (
                  <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                    {tr(locale, "Database change", "שינוי במסד הנתונים")}
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {message ? <p role="status" className={`text-sm ${message.error ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{message.text}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-slate-600 dark:text-slate-400">{tr(locale, `${picked.size} of ${tickets.length} ticked`, `${picked.size} מתוך ${tickets.length} סומנו`)}</span>
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={() => run("reject")} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {pending && which === "reject" ? <Spinner className="h-4 w-4 animate-spin" /> : null}
            {tr(locale, "Reject the batch", "דחיית החבילה")}
          </button>
          <button type="button" disabled={pending || picked.size === 0} onClick={() => run("approve")} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 dark:bg-teal-600 dark:hover:bg-teal-500">
            {pending && which === "approve" ? <Spinner className="h-4 w-4 animate-spin" /> : null}
            {tr(locale, `Approve ${picked.size} ticket${picked.size === 1 ? "" : "s"}`, picked.size === 1 ? "אישור פנייה אחת" : `אישור ${picked.size} פניות`)}
          </button>
        </div>
      </div>
    </div>
  );
}
