import { NavLink as Link } from "@/components/nav-link";
import { redirect } from "next/navigation";

import { ReviewNav } from "@/components/ticket-review-panels";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import type { PromoteReport } from "@/lib/promotion-email";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

type ReleaseRow = {
  id: string;
  requested_at: string;
  completed_at: string | null;
  result: string | null;
  details: { report?: PromoteReport; tickets?: { ticketSeq: number; subject: string }[] } | null;
};

function formatWhen(iso: string | null, locale: AppLocale): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(locale === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function releaseState(row: ReleaseRow, locale: AppLocale): { label: string; className: string } {
  const report = row.details?.report;
  if (!row.completed_at) return { label: tr(locale, "Running", "רץ"), className: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300" };
  if (report?.ok) return { label: tr(locale, "Released", "שוחרר"), className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" };
  if (report?.rolledBack) return { label: tr(locale, "Rolled back", "הוחזר לאחור"), className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" };
  return { label: tr(locale, "Stopped - nothing changed", "נעצר - דבר לא השתנה"), className: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" };
}

/** Home of everything about Ticket Automation (admin only). For now: a way into the review screen and the
 * release history; the rest of the automation overview is designed from a mockup next. */
export default async function TicketAutomationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");
  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );
  if (!(await isCurrentUserAdmin(supabase, user.id))) redirect("/app/tickets");

  const { data } = await supabase
    .from("automation_requests")
    .select("id, requested_at, completed_at, result, details")
    .eq("kind", "promote")
    .order("requested_at", { ascending: false })
    .limit(30);
  const releases = (data ?? []) as ReleaseRow[];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <ReviewNav locale={locale} backLabel={tr(locale, "All tickets", "כל הפניות")} />
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Ticket Automation", "אוטומציית פניות")}</h1>
      <p className="mb-5 mt-1 text-sm text-slate-600 dark:text-slate-400">
        {tr(locale, "Everything about how tickets are analysed, fixed and released automatically.", "כל מה שקשור לאופן שבו פניות מנותחות, מתוקנות ומשוחררות אוטומטית.")}
      </p>

      <Link
        href="/app/tickets/review"
        className="mb-8 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Review & approvals", "סקירה ואישורים")}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {tr(locale, "Proposals to approve, fixes to test on dev and what is ready to promote to production.", "הצעות לאישור, תיקונים לבדיקה בפיתוח ומה שמוכן להעלאה לייצור.")}
          </span>
        </span>
        <span aria-hidden="true" className="text-teal-700 dark:text-teal-400">
          {tr(locale, "→", "←")}
        </span>
      </Link>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Release history", "היסטוריית שחרורים")}</h2>
        {releases.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr(locale, "No promotion has been requested yet.", "עדיין לא התבקשה העלאה לייצור.")}</p>
        ) : (
          <ul className="space-y-2">
            {releases.map((release) => {
              const report = release.details?.report;
              const state = releaseState(release, locale);
              const tickets = report?.tickets ?? release.details?.tickets?.map((t) => ({ seq: t.ticketSeq, subject: t.subject, commit: null, status: "pending", reason: "" })) ?? [];
              return (
                <li key={release.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-baseline gap-x-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <span dir="ltr">{report?.version ? `v${report.version}` : tr(locale, "No version", "ללא גרסה")}</span>
                      <span dir="auto" className="text-xs font-normal text-slate-500 dark:text-slate-400">{formatWhen(release.requested_at, locale)}</span>
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${state.className}`}>{state.label}</span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
                    {tickets.map((ticket) => (
                      <li key={ticket.seq} dir="auto">
                        <span className="me-2 font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{ticket.seq}</span>
                        {ticket.subject}
                        {ticket.status === "skipped" ? <span className="ms-2 text-xs text-amber-700 dark:text-amber-400">({tr(locale, "not shipped", "לא שוחרר")}: {ticket.reason})</span> : null}
                      </li>
                    ))}
                  </ul>
                  {report?.steps?.length ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-teal-700 dark:text-teal-400">{tr(locale, "Every step", "כל השלבים")}</summary>
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                        {report.steps.map((step, index) => (
                          <li key={index} dir="ltr">
                            <span aria-hidden="true" className={step.ok ? "font-bold text-emerald-600" : "font-bold text-rose-600"}>{step.ok ? "✓" : "✗"}</span> {step.name}
                            {step.detail ? <span className="text-slate-500"> - {step.detail.split("\n").pop()?.slice(0, 140)}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : release.result ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{release.result}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
