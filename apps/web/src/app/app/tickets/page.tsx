import { NavLink as Link } from "@/components/nav-link";
import { redirect } from "next/navigation";

import { AdminTicketsTable } from "@/components/admin-tickets-table";
import { ReviewBanner } from "@/components/review-banner";
import { CancelTicketDialog } from "@/components/cancel-ticket-dialog";
import { LocalDate } from "@/components/local-time";
import { formatTicketStatus, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCancellableTicketStatus, isCurrentUserAdmin, isEditableTicketStatus, isReopenableTicketStatus, ticketStatusBadgeClass, type TicketAutoHandle, type TicketStatus } from "@/lib/tickets";

export const dynamic = "force-dynamic";

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

  const isAdmin = await isCurrentUserAdmin(supabase, user.id);

  // Admins see every user's tickets (RLS's own tickets_select_admin policy
  // already allows this - see db/migrations/048_phase22_ticket_admin.sql);
  // a plain user's query stays scoped to their own, exactly as before.
  let ticketsQuery = supabase
    .from("tickets")
    .select("id, ticket_seq, subject, status, created_at, ticket_type, area, priority, created_by")
    .order("created_at", { ascending: false });
  if (!isAdmin) {
    ticketsQuery = ticketsQuery.eq("created_by", user.id);
  }
  const { data: tickets, error } = await ticketsQuery;

  if (error) {
    throw new Error(error.message);
  }

  // Ticket rows only carry created_by (a bare user id) - resolving that to
  // a display name means a second query against user_profile, since
  // tickets.created_by and user_profile.user_id both reference auth.users
  // independently rather than each other (no FK PostgREST could embed
  // through directly). Only fetched for admins - a plain user's own
  // tickets are all theirs, so a "submitted by" name would be redundant.
  let userNamesById = new Map<string, string>();
  if (isAdmin && tickets && tickets.length > 0) {
    const creatorIds = [...new Set(tickets.map((ticket) => ticket.created_by))];
    const { data: creators } = await supabase.from("user_profile").select("user_id, first_name, last_name").in("user_id", creatorIds);
    userNamesById = new Map(
      (creators ?? []).map((row) => [row.user_id, [row.first_name, row.last_name].filter(Boolean).join(" ")]),
    );
    // TCK-83 follow-up: most tickets in this pilot were filed by one
    // account whose profile never got a first/last name, so the raw id
    // (falling back here previously) was showing up in the User column for
    // nearly every row. Email is a far more recognizable fallback for an
    // admin trying to identify who filed something - user_profile has no
    // email column (it lives on the auth user, not this table), so this
    // needs the service-role admin client, fetched only for the ids that
    // actually need it rather than every creator.
    const missingNameIds = creatorIds.filter((id) => !userNamesById.get(id));
    if (missingNameIds.length > 0) {
      const adminClient = createAdminClient();
      const emailById = await Promise.all(
        missingNameIds.map(async (id) => {
          const { data } = await adminClient.auth.admin.getUserById(id);
          return [id, data.user?.email ?? id] as const;
        }),
      );
      for (const [id, email] of emailById) {
        userNamesById.set(id, email);
      }
    }
  }

  // auto_handle is an admin-only flag: fetched in its own query, and only for
  // admins, so it is never part of the rows a plain user's page receives.
  let autoHandleById = new Map<string, TicketAutoHandle | null>();
  // What is really waiting on the admin: a pending proposal / questions / fix row on a ticket that
  // is still live. (Old tickets carry a leftover "D" flag from before this existed.)
  const waitingCounts = { waiting: 0, returned: 0, fixReady: 0, onDev: 0, approved: 0 };
  if (isAdmin) {
    const { data: flags } = await supabase.from("tickets").select("id, auto_handle");
    autoHandleById = new Map((flags ?? []).map((row) => [row.id, row.auto_handle as TicketAutoHandle | null]));
    const liveIds = new Set((tickets ?? []).filter((ticket) => !["resolved", "closed", "cancelled", "duplicate"].includes(ticket.status)).map((ticket) => ticket.id));
    const { data: pendingRows } = await supabase.from("ticket_proposals").select("ticket_id, kind, status").in("status", ["pending", "merged", "approved"]);
    const seen = new Set<string>();
    for (const row of pendingRows ?? []) {
      const flag = autoHandleById.get(row.ticket_id);
      const key = `${row.ticket_id}:${row.kind}`;
      if (!liveIds.has(row.ticket_id) || seen.has(key)) continue;
      seen.add(key);
      if (row.kind === "proposal" && flag === "A") waitingCounts.waiting += 1;
      else if (row.kind === "questions" && flag === "P") waitingCounts.returned += 1;
      else if (row.kind === "fix" && flag === "D" && row.status === "pending") waitingCounts.fixReady += 1;
      else if (row.kind === "fix" && flag === "M" && row.status === "merged") waitingCounts.onDev += 1;
      else if (row.kind === "fix" && flag === "R" && row.status === "approved") waitingCounts.approved += 1;
    }
  }

  if (isAdmin) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
        <ReviewBanner
          locale={locale}
          waiting={waitingCounts.waiting}
          returned={waitingCounts.returned}
          fixReady={waitingCounts.fixReady}
          onDev={waitingCounts.onDev}
          approved={waitingCounts.approved}
        />
        <AdminTicketsTable
          locale={locale}
          tickets={(tickets ?? []).map((ticket) => ({
            ...ticket,
            status: ticket.status as TicketStatus,
            userName: userNamesById.get(ticket.created_by) ?? ticket.created_by,
            auto_handle: autoHandleById.get(ticket.id) ?? null,
          }))}
          notice={resolvedSearchParams.notice ? true : false}
        />
      </main>
    );
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
                    <td className="py-3 pe-3 text-slate-600 dark:text-slate-400">
                      <LocalDate value={ticket.created_at} locale={locale} />
                    </td>
                    <td className="py-3 pe-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ticketStatusBadgeClass(ticket.status as TicketStatus)}`}>
                        {formatTicketStatus(ticket.status, locale)}
                      </span>
                    </td>
                    <td className="py-3 ps-3 text-end">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/app/tickets/${ticket.id}`} className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400">
                          {tr(locale, "View", "צפייה")}
                        </Link>
                        {isEditableTicketStatus(ticket.status) ? (
                          <Link
                            href={`/app/tickets/${ticket.id}?edit=1`}
                            aria-label={tr(locale, "Edit ticket", "עריכת הפנייה")}
                            title={tr(locale, "Edit ticket", "עריכת הפנייה")}
                            className="text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                            </svg>
                          </Link>
                        ) : null}
                        {isReopenableTicketStatus(ticket.status) ? (
                          <Link
                            href={`/app/tickets/${ticket.id}?reopen=1`}
                            aria-label={tr(locale, "Reopen ticket", "פתיחת הפנייה מחדש")}
                            title={tr(locale, "Reopen ticket", "פתיחת הפנייה מחדש")}
                            className="text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                              <path d="M21 3v6h-6" />
                            </svg>
                          </Link>
                        ) : null}
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
