"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AdminStatusDropdown } from "@/components/admin-status-dropdown";
import { formatDateForLocale, formatTicketArea, formatTicketPriority, formatTicketStatus, formatTicketType, tr, type AppLocale } from "@/lib/locale";
import { ticketAreaOptions, ticketPriorityOptions, ticketStatusOptions, ticketTypeOptions, type TicketArea, type TicketPriority, type TicketStatus, type TicketType } from "@/lib/tickets";

type AdminTicketRow = {
  id: string;
  ticket_seq: number;
  subject: string;
  status: TicketStatus;
  created_at: string;
  ticket_type: TicketType;
  area: TicketArea;
  priority: TicketPriority;
  created_by: string;
  userName: string;
};

const priorityTextClass: Record<TicketPriority, string> = {
  low: "text-slate-500 dark:text-slate-400",
  medium: "text-slate-700 dark:text-slate-300",
  high: "text-amber-700 dark:text-amber-400 font-semibold",
  urgent: "text-rose-700 dark:text-rose-400 font-semibold",
};

/**
 * The admin-only view of /app/tickets (see docs/design/
 * user-support-tickets-design.md's admin follow-up) - every user's
 * tickets, filterable, with a free status dropdown per row (see
 * AdminStatusDropdown). Filtering is plain client-side state over the
 * full set the server already fetched - fine at this pilot's ticket
 * volume, and keeps every filter change instant with no round trip.
 */
export function AdminTicketsTable({ locale, tickets, notice }: { locale: AppLocale; tickets: AdminTicketRow[]; notice: boolean }) {
  const [userFilter, setUserFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");

  const users = useMemo(() => {
    const seen = new Map<string, string>();
    tickets.forEach((ticket) => seen.set(ticket.created_by, ticket.userName));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tickets]);

  const filtered = tickets.filter(
    (ticket) =>
      (!userFilter || ticket.created_by === userFilter) &&
      (!statusFilter || ticket.status === statusFilter) &&
      (!priorityFilter || ticket.priority === priorityFilter) &&
      (!typeFilter || ticket.ticket_type === typeFilter) &&
      (!areaFilter || ticket.area === areaFilter),
  );

  const hasActiveFilters = Boolean(userFilter || statusFilter || priorityFilter || typeFilter || areaFilter);

  function clearFilters() {
    setUserFilter("");
    setStatusFilter("");
    setPriorityFilter("");
    setTypeFilter("");
    setAreaFilter("");
  }

  const selectClassName =
    "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Support Tickets", "פניות תמיכה")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400">
              {tr(locale, "Admin view", "תצוגת מנהל")}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {tr(locale, "Every ticket, from every user.", "כל הפניות, מכל המשתמשים.")}
          </p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">{filtered.length}</span>{" "}
          {tr(locale, `of ${tickets.length} tickets`, `מתוך ${tickets.length} פניות`)}
        </p>
      </div>

      {notice ? (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
          {tr(locale, "Your ticket was submitted. Our support team will review it.", "הפנייה שלך נשלחה. צוות התמיכה שלנו יבדוק אותה.")}
        </p>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "User", "משתמש")}
            </span>
            <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)} className={selectClassName}>
              <option value="">{tr(locale, "All users", "כל המשתמשים")}</option>
              {users.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Status", "סטטוס")}
            </span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={selectClassName}>
              <option value="">{tr(locale, "All statuses", "כל הסטטוסים")}</option>
              {ticketStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {formatTicketStatus(option, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Priority", "עדיפות")}
            </span>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className={selectClassName}>
              <option value="">{tr(locale, "All priorities", "כל העדיפויות")}</option>
              {ticketPriorityOptions.map((option) => (
                <option key={option} value={option}>
                  {formatTicketPriority(option, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Type", "סוג")}
            </span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={selectClassName}>
              <option value="">{tr(locale, "All types", "כל הסוגים")}</option>
              {ticketTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {formatTicketType(option, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Area", "אזור")}
            </span>
            <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)} className={selectClassName}>
              <option value="">{tr(locale, "All areas", "כל האזורים")}</option>
              {ticketAreaOptions.map((option) => (
                <option key={option} value={option}>
                  {formatTicketArea(option, locale)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {tr(locale, "Clear filters", "ניקוי סינון")}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {tr(locale, "No tickets match these filters.", "אין פניות התואמות את הסינון הזה.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pe-3">{tr(locale, "Ticket", "פנייה")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Subject", "נושא")}</th>
                  <th className="py-2 pe-3">{tr(locale, "User", "משתמש")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Type", "סוג")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Area", "אזור")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Priority", "עדיפות")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Date", "תאריך")}</th>
                  <th className="py-2 pe-3">{tr(locale, "Status", "סטטוס")}</th>
                  <th className="py-2 ps-3 text-end">{tr(locale, "Action", "פעולה")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ticket) => (
                  <tr key={ticket.id} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-3 pe-3 font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{ticket.ticket_seq}</td>
                    <td className="max-w-[220px] truncate py-3 pe-3" dir="auto">
                      <Link href={`/app/tickets/${ticket.id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
                        {ticket.subject}
                      </Link>
                    </td>
                    <td className="py-3 pe-3 text-slate-600 dark:text-slate-400">{ticket.userName}</td>
                    <td className="py-3 pe-3 text-slate-600 dark:text-slate-400">{formatTicketType(ticket.ticket_type, locale)}</td>
                    <td className="py-3 pe-3 text-slate-600 dark:text-slate-400">{formatTicketArea(ticket.area, locale)}</td>
                    <td className={`py-3 pe-3 ${priorityTextClass[ticket.priority]}`}>{formatTicketPriority(ticket.priority, locale)}</td>
                    <td className="py-3 pe-3 text-slate-600 dark:text-slate-400">{formatDateForLocale(ticket.created_at, locale)}</td>
                    <td className="py-3 pe-3">
                      <AdminStatusDropdown locale={locale} ticketId={ticket.id} status={ticket.status} />
                    </td>
                    <td className="py-3 ps-3 text-end">
                      <Link href={`/app/tickets/${ticket.id}`} className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400">
                        {tr(locale, "View", "צפייה")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
