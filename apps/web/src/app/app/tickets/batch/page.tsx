import { redirect } from "next/navigation";

import { DailyBatchApprove } from "@/components/daily-batch-approve";
import { NavLink as Link } from "@/components/nav-link";
import { loadLatestBatch, type Batch, type BatchTicketState } from "@/lib/daily-batch";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/**
 * The daily batch (lib/daily-batch.ts): what the 16:00 triage picked and why, the approval, and then each ticket's way
 * through the analyst and the night run. While it is in progress, manual agent runs are locked - this page says so.
 */
const STEPS: { key: Batch["status"][]; en: string; he: string }[] = [
  { key: ["proposed"], en: "Approval", he: "אישור" },
  { key: ["approved"], en: "Analysis 18:00", he: "ניתוח 18:00" },
  { key: ["building"], en: "Fix 02:15", he: "תיקון 02:15" },
  { key: ["ready", "promoting"], en: "Approve promotion", he: "אישור העלאה" },
  { key: ["done"], en: "Released", he: "הועלה" },
];

const STATE_LABEL: Record<BatchTicketState, { en: string; he: string; tone: string }> = {
  proposed: { en: "Suggested", he: "הוצעה", tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  unselected: { en: "Not ticked", he: "לא סומנה", tone: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
  queued: { en: "Waiting", he: "בתור", tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  analysing: { en: "Analysis", he: "בניתוח", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  building: { en: "Being built", he: "בבנייה", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  built: { en: "Fixed, on dev", he: "תוקן, בפיתוח", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
  out: { en: "Left the batch", he: "יצאה מהחבילה", tone: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300" },
  released: { en: "Released", he: "הועלתה", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
};

const ddmm = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

function Steps({ locale, status }: { locale: AppLocale; status: Batch["status"] }) {
  const current = STEPS.findIndex((step) => step.key.includes(status));
  return (
    <ol className="mt-3 flex flex-wrap gap-1.5">
      {STEPS.map((step, i) => (
        <li key={step.en} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${i < current || status === "done" ? "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300" : i === current ? "bg-teal-700 text-white dark:bg-teal-600" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
          {tr(locale, step.en, step.he)}
        </li>
      ))}
    </ol>
  );
}

export default async function DailyBatchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");
  const locale: AppLocale = normalizeLocale((await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language);
  if (!(await isCurrentUserAdmin(supabase, user.id))) redirect("/app/tickets");

  const batch = await loadLatestBatch(supabase);
  const inProgress = batch && ["approved", "building", "ready", "promoting"].includes(batch.status);
  const visible = batch ? batch.tickets.filter((t) => batch.status === "proposed" || t.state !== "unselected") : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          {batch ? tr(locale, `Daily batch ${ddmm(batch.batch_date)}`, `חבילה יומית ${ddmm(batch.batch_date)}`) : tr(locale, "Daily batch", "חבילה יומית")}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {!batch
            ? tr(locale, "Every day at 16:00 the triage picks up to 8 clear, small tickets and emails you to approve them here.", "בכל יום ב-16:00 הסריקה בוחרת עד 8 פניות ברורות וקטנות ושולחת לך מייל לאשר אותן כאן.")
            : batch.status === "proposed"
              ? tr(locale, `The triage read ${batch.scanned_count} open tickets and suggests these. Untick any you would rather handle yourself.`, `הסריקה קראה ${batch.scanned_count} פניות פתוחות ומציעה את אלה. אפשר לבטל סימון של כל פנייה שתעדיף לטפל בה בעצמך.`)
              : batch.status === "done"
                ? tr(locale, `Released${batch.version ? ` in version ${batch.version}` : ""}. The batch is closed.`, `הועלתה${batch.version ? ` בגרסה ${batch.version}` : ""}. החבילה נסגרה.`)
                : batch.status === "rejected"
                  ? tr(locale, "You rejected this batch. Nothing ran for it.", "החבילה נדחתה. שום דבר לא רץ עבורה.")
                  : batch.status === "expired"
                    ? tr(locale, "This batch was not approved before the next scan, so it expired.", "החבילה לא אושרה עד הסריקה הבאה, ולכן בוטלה.")
                    : batch.status === "failed"
                      ? tr(locale, `The batch stopped: ${batch.note ?? "see the automation page"}.`, `החבילה נעצרה: ${batch.note ?? "ראו בדף האוטומציה"}.`)
                      : tr(locale, `${visible.length} ticket${visible.length === 1 ? "" : "s"} in the batch.`, visible.length === 1 ? "פנייה אחת בחבילה." : `${visible.length} פניות בחבילה.`)}
        </p>
        {batch && !["rejected", "expired", "failed"].includes(batch.status) ? <Steps locale={locale} status={batch.status} /> : null}
      </section>

      {inProgress ? (
        <p className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span aria-hidden="true">🔒</span>
          {tr(
            locale,
            "Batch in progress: the analyst and the night run cannot be started by hand now, so fixes and files never overlap. You can still mark tickets for automation - they wait until the batch closes.",
            "חבילה בתהליך: אי אפשר להפעיל עכשיו ידנית את האנליסט או את ריצת הלילה, כדי שתיקונים וקבצים לא יתנגשו. אפשר להמשיך לסמן פניות לאוטומציה, והן ימתינו עד שהחבילה תיסגר.",
          )}
        </p>
      ) : null}

      {batch && batch.status === "proposed" ? (
        <DailyBatchApprove locale={locale} batchId={batch.id} tickets={batch.tickets} />
      ) : batch && visible.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {visible.map((t) => (
            <li key={t.ticketId} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span dir="ltr" className="rounded bg-slate-100 px-1.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">TCK-{t.seq}</span>
                  <Link href={`/app/tickets/${t.ticketId}?from=batch`} dir="auto" className="text-sm font-semibold text-slate-900 hover:underline dark:text-slate-100">{t.subject}</Link>
                </span>
                {t.note ? <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{t.note}</span> : null}
              </span>
              <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_LABEL[t.state].tone}`}>{tr(locale, STATE_LABEL[t.state].en, STATE_LABEL[t.state].he)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
