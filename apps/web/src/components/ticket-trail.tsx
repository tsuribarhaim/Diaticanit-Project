import { NavLink as Link } from "@/components/nav-link";
import { tr, type AppLocale } from "@/lib/locale";

/** "Automation > TCK-57 proposal": where you are, every earlier step a link. The last item is the current screen. */
export function TicketTrail({ locale, items }: { locale: AppLocale; items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label={tr(locale, "You are here", "המיקום שלך")} className="mb-3">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">{tr(locale, "›", "‹")}</span> : null}
            {item.href && index < items.length - 1 ? (
              <Link href={item.href} className="font-semibold text-teal-700 hover:underline dark:text-teal-400">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-bold text-slate-900 dark:text-slate-100">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
