"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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

type MultiFilterKey = "status" | "priority" | "type" | "area";
type MultiFilterState = Record<MultiFilterKey, string[]>;
const EMPTY_MULTI_FILTERS: MultiFilterState = { status: [], priority: [], type: [], area: [] };

/** Per-admin, per-browser only (localStorage - same precedent already used
 * in this app for install-app-prompt.tsx's own dismissal flag) - not
 * synced across devices, and never read/written for a non-admin, since
 * this whole component only renders in the admin branch of
 * /app/tickets/page.tsx. */
const FILTER_STORAGE_KEY = "daffy_admin_ticket_filters";

type SortKey = "ticket_seq" | "subject" | "userName" | "ticket_type" | "area" | "priority" | "created_at";
type SortDir = "asc" | "desc";
type SortState = { key: SortKey; dir: SortDir };
const DEFAULT_SORT: SortState = { key: "created_at", dir: "desc" };

function isMultiFilterState(value: unknown): value is MultiFilterState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (["status", "priority", "type", "area"] as const).every((key) => Array.isArray(record[key]));
}

/**
 * A small checkbox-list popover for one filter attribute, letting the
 * admin select any number of values (e.g. Priority: High + Urgent) instead
 * of the single-value <select> this replaced. Defined at module scope
 * (not nested in AdminTicketsTable's render) so its component identity
 * stays stable across re-renders, the same reasoning already applied to
 * EditableValue/BannerView in targets-plan-editor.tsx.
 */
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  isOpen,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onToggle();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onToggle]);

  function toggleValue(value: string) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center justify-between gap-1.5 rounded-lg border px-2.5 py-2 text-sm ${
          selected.length > 0
            ? "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-300"
            : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          {label}
          {selected.length > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-700 px-1 text-[10px] font-bold text-white dark:bg-teal-500 dark:text-teal-950">
              {selected.length}
            </span>
          ) : null}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0 opacity-60">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {isOpen ? (
        <div className="absolute z-30 mt-1 max-h-64 w-full min-w-[180px] overflow-y-auto rounded-lg border border-slate-300 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggleValue(option.value)}
                className="h-3.5 w-3.5 accent-teal-700"
              />
              {option.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Small up/down chevron pair used by every sortable column header - the
 * active direction is filled in, the inactive one stays faint, so the
 * current sort is readable at a glance without extra text. */
function SortIcons({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="inline-flex flex-col gap-px leading-none">
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className={active && dir === "asc" ? "opacity-100" : "opacity-30"}>
        <path d="M12 5l7 10H5z" />
      </svg>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className={active && dir === "desc" ? "opacity-100" : "opacity-30"}>
        <path d="M12 19 5 9h14z" />
      </svg>
    </span>
  );
}

/**
 * The admin-only view of /app/tickets (see docs/design/
 * user-support-tickets-design.md's admin follow-up) - every user's
 * tickets, filterable, with a free status dropdown per row (see
 * AdminStatusDropdown). Filtering/sorting is plain client-side state over
 * the full set the server already fetched - fine at this pilot's ticket
 * volume, and keeps every change instant with no round trip.
 */
export function AdminTicketsTable({ locale, tickets, notice }: { locale: AppLocale; tickets: AdminTicketRow[]; notice: boolean }) {
  const [userFilter, setUserFilter] = useState("");
  const [multiFilters, setMultiFilters] = useState<MultiFilterState>(EMPTY_MULTI_FILTERS);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [openFilter, setOpenFilter] = useState<MultiFilterKey | null>(null);
  // Guards the save effect below from firing with the initial empty state
  // and clobbering whatever was already saved, before the load effect has
  // had a chance to run - both only ever run client-side (never during
  // SSR, where localStorage doesn't exist, the same class of bug just
  // fixed in daily-report-chat-panel.tsx's document access).
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // setTimeout, not a direct call - this codebase's react-hooks/set-state-in-effect
    // rule flags a synchronous setState at the top of an effect body even
    // for a one-time load-from-storage like this; scheduling it instead
    // (same idiom used elsewhere in this app for the same rule) satisfies
    // the lint without changing behavior - it still only ever runs once,
    // right after mount.
    const timeoutId = setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.userFilter === "string") setUserFilter(parsed.userFilter);
          if (isMultiFilterState(parsed.multiFilters)) setMultiFilters(parsed.multiFilters);
          if (parsed.sort && typeof parsed.sort.key === "string" && (parsed.sort.dir === "asc" || parsed.sort.dir === "desc")) {
            setSort(parsed.sort);
          }
        }
      } catch {
        // Corrupt/unreadable saved state - just start from the defaults
        // already in place rather than blocking the page on it.
      }
      setIsHydrated(true);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ userFilter, multiFilters, sort }));
    } catch {
      // Storage full/disabled - filters still work for this session, just
      // won't be remembered next visit.
    }
  }, [userFilter, multiFilters, sort, isHydrated]);

  const users = useMemo(() => {
    const seen = new Map<string, string>();
    tickets.forEach((ticket) => seen.set(ticket.created_by, ticket.userName));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tickets]);

  const filtered = useMemo(
    () =>
      tickets.filter(
        (ticket) =>
          (!userFilter || ticket.created_by === userFilter) &&
          (multiFilters.status.length === 0 || multiFilters.status.includes(ticket.status)) &&
          (multiFilters.priority.length === 0 || multiFilters.priority.includes(ticket.priority)) &&
          (multiFilters.type.length === 0 || multiFilters.type.includes(ticket.ticket_type)) &&
          (multiFilters.area.length === 0 || multiFilters.area.includes(ticket.area)),
      ),
    [tickets, userFilter, multiFilters],
  );

  const sorted = useMemo(() => {
    const priorityRank: Record<TicketPriority, number> = Object.fromEntries(
      ticketPriorityOptions.map((option, index) => [option, index]),
    ) as Record<TicketPriority, number>;

    function sortValue(ticket: AdminTicketRow): string | number {
      switch (sort.key) {
        case "ticket_seq":
          return ticket.ticket_seq;
        case "subject":
          return ticket.subject.toLowerCase();
        case "userName":
          return ticket.userName.toLowerCase();
        case "ticket_type":
          return formatTicketType(ticket.ticket_type, locale).toLowerCase();
        case "area":
          return formatTicketArea(ticket.area, locale).toLowerCase();
        case "priority":
          return priorityRank[ticket.priority];
        case "created_at":
          return new Date(ticket.created_at).getTime();
      }
    }

    return [...filtered].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sort, locale]);

  const hasActiveFilters = Boolean(
    userFilter || multiFilters.status.length || multiFilters.priority.length || multiFilters.type.length || multiFilters.area.length,
  );

  function clearFilters() {
    setUserFilter("");
    setMultiFilters(EMPTY_MULTI_FILTERS);
  }

  function toggleSort(key: SortKey) {
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function sortHeaderButton(key: SortKey, label: string) {
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={`inline-flex items-center gap-1 py-2 pe-3 text-xs font-semibold uppercase tracking-wide hover:text-slate-900 dark:hover:text-slate-100 ${
          sort.key === key ? "text-teal-700 dark:text-teal-400" : "text-slate-500 dark:text-slate-400"
        }`}
      >
        {label}
        <SortIcons active={sort.key === key} dir={sort.dir} />
      </button>
    );
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
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{filtered.length}</span>{" "}
            {tr(locale, `of ${tickets.length} tickets`, `מתוך ${tickets.length} פניות`)}
          </p>
          {/* An admin still submits a ticket as themself, same createTicketAction
              any user goes through - this button was simply missing from the
              admin view (the non-admin branch of /app/tickets/page.tsx already
              had one), which was the actual bug: nothing here needed a backend
              change, just a way in. */}
          <Link
            href="/app/tickets/new"
            className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            {tr(locale, "+ New Ticket", "+ פנייה חדשה")}
          </Link>
        </div>
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
          <div className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Status", "סטטוס")}
            </span>
            <MultiSelectFilter
              label={tr(locale, "All statuses", "כל הסטטוסים")}
              options={ticketStatusOptions.map((option) => ({ value: option, label: formatTicketStatus(option, locale) }))}
              selected={multiFilters.status}
              onChange={(next) => setMultiFilters((current) => ({ ...current, status: next }))}
              isOpen={openFilter === "status"}
              onToggle={() => setOpenFilter((current) => (current === "status" ? null : "status"))}
            />
          </div>
          <div className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Priority", "עדיפות")}
            </span>
            <MultiSelectFilter
              label={tr(locale, "All priorities", "כל העדיפויות")}
              options={ticketPriorityOptions.map((option) => ({ value: option, label: formatTicketPriority(option, locale) }))}
              selected={multiFilters.priority}
              onChange={(next) => setMultiFilters((current) => ({ ...current, priority: next }))}
              isOpen={openFilter === "priority"}
              onToggle={() => setOpenFilter((current) => (current === "priority" ? null : "priority"))}
            />
          </div>
          <div className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Type", "סוג")}
            </span>
            <MultiSelectFilter
              label={tr(locale, "All types", "כל הסוגים")}
              options={ticketTypeOptions.map((option) => ({ value: option, label: formatTicketType(option, locale) }))}
              selected={multiFilters.type}
              onChange={(next) => setMultiFilters((current) => ({ ...current, type: next }))}
              isOpen={openFilter === "type"}
              onToggle={() => setOpenFilter((current) => (current === "type" ? null : "type"))}
            />
          </div>
          <div className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Area", "אזור")}
            </span>
            <MultiSelectFilter
              label={tr(locale, "All areas", "כל האזורים")}
              options={ticketAreaOptions.map((option) => ({ value: option, label: formatTicketArea(option, locale) }))}
              selected={multiFilters.area}
              onChange={(next) => setMultiFilters((current) => ({ ...current, area: next }))}
              isOpen={openFilter === "area"}
              onToggle={() => setOpenFilter((current) => (current === "area" ? null : "area"))}
            />
          </div>
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
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {tr(
            locale,
            "Your filters are saved automatically and restored next time you open this screen.",
            "הסינון שלך נשמר אוטומטית ומשוחזר בפעם הבאה שתפתח מסך זה.",
          )}
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {tr(locale, "No tickets match these filters.", "אין פניות התואמות את הסינון הזה.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                  <th className="pe-3">{sortHeaderButton("ticket_seq", tr(locale, "Ticket", "פנייה"))}</th>
                  <th className="pe-3">{sortHeaderButton("subject", tr(locale, "Subject", "נושא"))}</th>
                  <th className="pe-3">{sortHeaderButton("userName", tr(locale, "User", "משתמש"))}</th>
                  <th className="pe-3">{sortHeaderButton("ticket_type", tr(locale, "Type", "סוג"))}</th>
                  <th className="pe-3">{sortHeaderButton("area", tr(locale, "Area", "אזור"))}</th>
                  <th className="pe-3">{sortHeaderButton("priority", tr(locale, "Priority", "עדיפות"))}</th>
                  <th className="pe-3">{sortHeaderButton("created_at", tr(locale, "Date", "תאריך"))}</th>
                  <th className="py-2 pe-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tr(locale, "Status", "סטטוס")}
                  </th>
                  <th className="py-2 ps-3 text-end text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tr(locale, "Action", "פעולה")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((ticket) => (
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
