import { tr, type AppLocale } from "@/lib/locale";

/** Where a ticket sub-screen was opened from. It travels in the link (?from=...), so Close and Back return there
 * whatever the browser history looks like (after an approval, a refresh, a link from an email). */
export type NavFrom = "tickets" | "automation" | "review" | "batch" | "control" | "aiusage";

export const NAV_HREF: Record<NavFrom, string> = {
  tickets: "/app/tickets",
  automation: "/app/tickets/automation",
  review: "/app/tickets/review",
  batch: "/app/tickets/batch",
  control: "/app/tickets/control",
  aiusage: "/app/tickets/ai-usage",
};

export function parseFrom(value: string | string[] | null | undefined, fallback: NavFrom): NavFrom {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "tickets" || first === "automation" || first === "review" || first === "batch" || first === "control" || first === "aiusage" ? first : fallback;
}

export function navLabel(locale: AppLocale, from: NavFrom): string {
  if (from === "automation") return tr(locale, "Automation", "אוטומציה");
  if (from === "review") return tr(locale, "Review & approvals", "סקירה ואישורים");
  if (from === "batch") return tr(locale, "Daily batch", "חבילה יומית");
  if (from === "control") return tr(locale, "Control room", "מרכז בקרה");
  if (from === "aiusage") return tr(locale, "AI usage", "שימוש ב-AI");
  return tr(locale, "Tickets", "פניות");
}

/** Adds ?from=... to a link (keeps any query it already has). */
export function withFrom(href: string, from: NavFrom): string {
  return `${href}${href.includes("?") ? "&" : "?"}from=${from}`;
}
