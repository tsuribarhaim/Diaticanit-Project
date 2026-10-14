"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { promoteBatchAction } from "@/app/app/tickets/review-actions";
import { Spinner } from "@/components/spinner";
import { tr, type AppLocale } from "@/lib/locale";

/** The ready batch: an optional "I tested on dev" tick, then one promotion for every fix of the batch (lib/daily-batch-progress.ts). */
export function DailyBatchPromote({ locale, batchId, count }: { locale: AppLocale; batchId: string; count: number }) {
  const router = useRouter();
  const [devTested, setDevTested] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  return (
    <div className="space-y-3 rounded-2xl border border-teal-300 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/30">
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" checked={devTested} disabled={pending} onChange={(event) => setDevTested(event.target.checked)} className="h-4 w-4 accent-teal-700" />
        {tr(locale, "I tested on dev (optional)", "בדקתי בסביבת הפיתוח (לא חובה)")}
      </label>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {tr(
          locale,
          "Promotion checks that production did not change, applies database changes first, deploys, runs the smoke test and resolves the tickets (the reporters are told). To leave one fix out, send it back from its fix card first.",
          "ההעלאה בודקת שהייצור לא השתנה, מחילה קודם שינויים במסד הנתונים, פורסת, מריצה בדיקת עשן ומסמנת את הפניות כפתורות (המדווחים מקבלים הודעה). כדי להשאיר תיקון בחוץ, יש להחזיר אותו קודם מכרטיס התיקון.",
        )}
      </p>
      {message ? <p role="status" className={`text-sm ${message.error ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{message.text}</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await promoteBatchAction(batchId, devTested);
            setMessage(result.error ? { text: result.error, error: true } : { text: result.success ?? "", error: false });
            if (!result.error) router.refresh();
          })
        }
        className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 dark:bg-teal-600 dark:hover:bg-teal-500"
      >
        {pending ? <Spinner className="h-4 w-4 animate-spin" /> : null}
        {tr(locale, `Approve and promote ${count === 1 ? "the fix" : `${count} fixes`}`, count === 1 ? "אישור והעלאת התיקון לייצור" : `אישור והעלאת ${count} תיקונים לייצור`)}
      </button>
    </div>
  );
}
