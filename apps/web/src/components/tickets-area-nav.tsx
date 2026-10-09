"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { NavLink as Link } from "@/components/nav-link";
import { tr, type AppLocale } from "@/lib/locale";
import { NAV_HREF, navLabel, parseFrom, type NavFrom } from "@/lib/tickets-nav";

/** Which of the three main screens a page belongs to: a ticket or proposal opened from the dashboard still counts as Automation. */
function activeTab(pathname: string, from: string | null): NavFrom {
  if (pathname.startsWith("/app/tickets/automation")) return "automation";
  if (pathname === "/app/tickets/review") return "review";
  if (pathname.startsWith("/app/tickets/review/")) return parseFrom(from, "review");
  if (pathname === "/app/tickets") return "tickets";
  return parseFrom(from, "tickets");
}

/** The bar on every admin ticket screen: the three main places, one click away, with what is waiting for you. */
export function TicketsAreaNav({ locale, waiting }: { locale: AppLocale; waiting: number }) {
  const pathname = usePathname();
  const active = activeTab(pathname, useSearchParams().get("from"));
  const tabs: { key: NavFrom; badge: number }[] = [
    { key: "tickets", badge: 0 },
    { key: "automation", badge: 0 },
    { key: "review", badge: waiting },
  ];
  return (
    <nav aria-label={tr(locale, "Tickets sections", "אזורי הפניות")} className="flex flex-wrap gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={NAV_HREF[tab.key]}
          aria-current={active === tab.key ? "page" : undefined}
          className={`inline-flex items-center gap-2 border-b-[3px] px-3 py-2.5 text-sm font-semibold ${
            active === tab.key
              ? "border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-300"
              : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          {navLabel(locale, tab.key)}
          {tab.badge > 0 ? <span className="rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-bold leading-none text-white">{tab.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
