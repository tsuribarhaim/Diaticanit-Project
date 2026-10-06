import { formatTicketAutoHandle, tr, type AppLocale } from "@/lib/locale";
import { AUTO_HANDLE_NEEDS_ADMIN, AUTO_HANDLE_PILL_CLASS } from "@/lib/ticket-proposals";

/** The colored auto-handle state pill shown in the admin ticket list, the review screens and
 * on a ticket. A state that is waiting on the admin also says so ("needs you"). Admin-only. */
export function AutoHandlePill({ locale, value, showNeeds = true }: { locale: AppLocale; value: string | null | undefined; showNeeds?: boolean }) {
  const key = value && value in AUTO_HANDLE_PILL_CLASS ? value : "none";
  const needsAdmin = showNeeds && (AUTO_HANDLE_NEEDS_ADMIN as readonly string[]).includes(key);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${AUTO_HANDLE_PILL_CLASS[key]}`}>
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        {formatTicketAutoHandle(value, locale)}
      </span>
      {needsAdmin ? <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">{tr(locale, "needs you", "דרוש אישורך")}</span> : null}
    </span>
  );
}
