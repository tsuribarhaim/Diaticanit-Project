import { NavLink as Link } from "@/components/nav-link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AutoHandlePill } from "@/components/auto-handle-pill";
import { ReviewNav, RunAnalysisButton } from "@/components/ticket-review-panels";
import { formatTicketArea, formatTicketPriority, formatTicketType, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

type ReviewTicket = {
  id: string;
  ticket_seq: number;
  subject: string;
  ticket_type: string | null;
  area: string | null;
  priority: string;
  status: string;
  auto_handle: string | null;
};

/** Everything the automation needs from the admin, in one place (admin only). */
export default async function TicketReviewPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");

  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );
  if (!(await isCurrentUserAdmin(supabase, user.id))) redirect("/app/tickets");

  const { notice } = await searchParams;

  const { data: rows, error } = await supabase
    .from("tickets")
    .select("id, ticket_seq, subject, ticket_type, area, priority, status, auto_handle")
    .in("auto_handle", ["S", "A", "P", "D", "Y"])
    .not("status", "in", "(resolved,closed,cancelled,duplicate)")
    .order("ticket_seq", { ascending: false });
  if (error) throw new Error(error.message);
  const tickets = (rows ?? []) as ReviewTicket[];

  const ids = tickets.map((ticket) => ticket.id);
  const mergedByTicket = new Set<string>();
  if (ids.length > 0) {
    const { data: merged } = await supabase.from("ticket_proposals").select("ticket_id").in("ticket_id", ids).eq("kind", "fix").eq("status", "merged");
    for (const row of merged ?? []) mergedByTicket.add(row.ticket_id);
  }
  const { data: openRequests } = await supabase.from("automation_requests").select("id, kind").is("completed_at", null);
  const analysisRequested = (openRequests ?? []).some((request) => request.kind === "analyze");

  const by = (flag: string) => tickets.filter((ticket) => ticket.auto_handle === flag);
  const section = (title: string, flag: string, note?: string, extra?: ReactNode) => {
    const list = by(flag);
    return (
      <section className="mb-6">
        <h2 className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
          <span className="rounded-full border border-slate-200 bg-slate-100 px-2 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{list.length}</span>
          {extra}
        </h2>
        {note ? <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{note}</p> : null}
        {list.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr(locale, "Nothing here.", "אין כאן כלום.")}</p>
        ) : (
          <ul className="space-y-2">
            {list.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/app/tickets/review/${ticket.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500"
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <span className="me-2 font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{ticket.ticket_seq}</span>
                      <span dir="auto">{ticket.subject}</span>
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {ticket.ticket_type ? formatTicketType(ticket.ticket_type, locale) : tr(locale, "Not set yet", "טרם נבחר")} {"·"}{" "}
                      {ticket.area ? formatTicketArea(ticket.area, locale) : tr(locale, "Not set yet", "טרם נבחר")} {"·"} {formatTicketPriority(ticket.priority, locale)}
                    </span>
                  </span>
                  {flag === "D" && mergedByTicket.has(ticket.id) ? (
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600 dark:text-emerald-400">
                      {tr(locale, "Merged on dev", "מוזג בפיתוח")}
                    </span>
                  ) : (
                    <AutoHandlePill locale={locale} value={ticket.auto_handle} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <ReviewNav locale={locale} backLabel={tr(locale, "All tickets", "כל הפניות")} />
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Spec review", "סקירת אפיונים")}</h1>
      <p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-400">
        {tr(locale, "Everything the automation needs from you, in one place.", "כל מה שהאוטומציה צריכה ממך, במקום אחד.")}
      </p>
      {notice ? (
        <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}
      {section(tr(locale, "Waiting for your approval", "ממתינות לאישורך"), "A", tr(locale, "Approve queues the ticket for the night run.", "אישור מכניס את הפנייה לתור של ריצת הלילה."))}
      {section(tr(locale, "Returned with questions", "חזרו עם שאלות"), "P", tr(locale, "The night run read the real code and stopped. Answer and re-queue.", "ריצת הלילה קראה את הקוד האמיתי ונעצרה. יש לענות ולהכניס לתור."))}
      {section(tr(locale, "Fix ready - merge to dev", "תיקון מוכן - מיזוג לפיתוח"), "D", tr(locale, "Built on a branch by the night run. Nothing is merged until you say so.", "נבנה בענף על ידי ריצת הלילה. שום דבר לא ימוזג עד שתאשר."))}
      {section(
        tr(locale, "Spec requested", "התבקש אפיון"),
        "S",
        tr(locale, "The analyst runs every evening.", "האנליסט רץ כל ערב."),
        <RunAnalysisButton locale={locale} disabled={by("S").length === 0} requested={analysisRequested} />,
      )}
      {section(tr(locale, "Queued for the night run", "בתור לריצת הלילה"), "Y")}
    </main>
  );
}
