import Link from "next/link";
import { redirect } from "next/navigation";

import { CancelTicketDialog } from "@/components/cancel-ticket-dialog";
import { formatDateForLocale, formatTicketStatus, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCancellableTicketStatus, type TicketStatus } from "@/lib/tickets";

export const dynamic = "force-dynamic";

function statusBadgeClass(status: TicketStatus): string {
  if (status === "open") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400";
  if (status === "in_progress" || status === "reopened")
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400";
  if (status === "resolved")
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400";
  return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("id, ticket_seq, subject, status, created_at")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "My Tickets", "הפניות שלי")}</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {tr(locale, "Bugs and feature requests you've submitted to support.", "תקלות ובקשות לתכונות חדשות ששלחתם לתמיכה.")}
            </p>
          </div>
          <Link
            href="/app/tickets/new"
            className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            {tr(locale, "+ New Ticket", "+ פנייה חדשה")}
          </Link>
        </div>

        {resolvedSearchParams.notice ? (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
            {tr(locale, "Your ticket was submitted. Our support team will review it.", "הפנייה שלך נשלחה. צוות התמיכה שלנו יבדוק אותה.")}
          </p>
        ) : null}

        {!tickets?.length ? (
          <p className="mt-5 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {tr(locale, "You haven't submitted any tickets yet.", "עדיין לא שלחתם פניות.")}
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pe-3">{tr(locale, "Ticket", "פנייה")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Subject", "נושא")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Date", "תאריך")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Status", "סטטוס")}</th>
                  <th className="py-2 ps-3 text-end">{tr(locale, "Action", "פעולה")}</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-3 pe-3 font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{ticket.ticket_seq}</td>
                    <td className="py-3 pe-3">
                      <Link href={`/app/tickets/${ticket.id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
                        {ticket.subject}
                      </Link>
                    </td>
                    <td className="py-3 pe-3 text-slate-600 dark:text-slate-400">{formatDateForLocale(ticket.created_at, locale)}</td>
                    <td className="py-3 pe-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(ticket.status as TicketStatus)}`}>
                        {formatTicketStatus(ticket.status, locale)}
                      </span>
                    </td>
                    <td className="py-3 ps-3 text-end">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/app/tickets/${ticket.id}`} className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400">
                          {tr(locale, "View", "צפייה")}
                        </Link>
                        {isCancellableTicketStatus(ticket.status) ? (
                          <CancelTicketDialog locale={locale} ticketId={ticket.id} ticketSeq={ticket.ticket_seq} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
