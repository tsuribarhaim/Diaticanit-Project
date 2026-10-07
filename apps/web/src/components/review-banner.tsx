import { NavLink as Link } from "@/components/nav-link";

import { tr, type AppLocale } from "@/lib/locale";
import type { TicketAutoHandle } from "@/lib/tickets";

/** Top of the admin ticket list: what is waiting on the admin, with a way into the review page.
 * With nothing waiting it is just a quiet link, so the review page is always one click away. */
export function ReviewBanner({
  locale,
  waiting,
  returned,
  fixReady,
  onDev = 0,
  approved = 0,
}: {
  locale: AppLocale;
  waiting: number;
  returned: number;
  fixReady: number;
  onDev?: number;
  /** Fixes approved for production and waiting for the Promote button. */
  approved?: number;
}) {
  const total = waiting + returned + fixReady + onDev + approved;
  if (total === 0) {
    return (
      <p className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <Link href="/app/tickets/review" className="font-semibold text-teal-700 dark:text-teal-400">
          {tr(locale, "Open review & approvals", "פתיחת סקירה ואישורים")} {"→"}
        </Link>
        <Link href="/app/tickets/automation" className="font-semibold text-teal-700 dark:text-teal-400">
          {tr(locale, "Ticket Automation", "אוטומציית פניות")} {"→"}
        </Link>
      </p>
    );
  }
  const parts: string[] = [];
  if (waiting > 0) parts.push(tr(locale, `${waiting} proposal${waiting === 1 ? "" : "s"} waiting for your review`, waiting === 1 ? "הצעה אחת ממתינה לסקירה שלך" : `${waiting} הצעות ממתינות לסקירה שלך`));
  if (returned > 0) parts.push(tr(locale, `${returned} returned with questions`, returned === 1 ? "פנייה אחת חזרה עם שאלות" : `${returned} פניות חזרו עם שאלות`));
  if (fixReady > 0) parts.push(tr(locale, `${fixReady} fix${fixReady === 1 ? "" : "es"} ready to merge`, fixReady === 1 ? "תיקון אחד מוכן למיזוג" : `${fixReady} תיקונים מוכנים למיזוג`));
  if (onDev > 0) parts.push(tr(locale, `${onDev} fix${onDev === 1 ? "" : "es"} on dev waiting for your test`, onDev === 1 ? "תיקון אחד בפיתוח ממתין לבדיקה שלך" : `${onDev} תיקונים בפיתוח ממתינים לבדיקה שלך`));
  if (approved > 0) parts.push(tr(locale, `${approved} fix${approved === 1 ? "" : "es"} approved - ready to promote to production`, approved === 1 ? "תיקון אחד אושר - מוכן להעלאה לייצור" : `${approved} תיקונים אושרו - מוכנים להעלאה לייצור`));
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 border-s-4 border-s-amber-600 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:border-s-amber-500 dark:bg-amber-950/30">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{parts.join(" · ")}</p>
      <span className="flex flex-wrap items-center gap-3">
        <Link href="/app/tickets/automation" className="text-sm font-semibold text-amber-900 underline dark:text-amber-200">
          {tr(locale, "Ticket Automation", "אוטומציית פניות")}
        </Link>
        <Link href="/app/tickets/review" className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500">
          {tr(locale, "Open review & approvals", "פתיחת סקירה ואישורים")}
        </Link>
      </span>
    </div>
  );
}

/** On a ticket itself: the same hand-off, for the one state that is waiting on the admin. */
export function ReviewCallout({ locale, ticketId, autoHandle }: { locale: AppLocale; ticketId: string; autoHandle: TicketAutoHandle | null }) {
  if (autoHandle !== "A" && autoHandle !== "P" && autoHandle !== "D" && autoHandle !== "M") return null;
  const text =
    autoHandle === "A"
      ? tr(locale, "A proposal is waiting for your approval", "הצעה ממתינה לאישורך")
      : autoHandle === "P"
        ? tr(locale, "The night run stopped and has questions for you", "ריצת הלילה נעצרה ויש לה שאלות אליך")
        : autoHandle === "M"
          ? tr(locale, "A fix is on dev waiting for your test", "תיקון בפיתוח ממתין לבדיקה שלך")
          : tr(locale, "A fix is ready to merge on dev", "תיקון מוכן למיזוג בפיתוח");
  const cta = autoHandle === "A" ? tr(locale, "Review it", "לסקירה") : autoHandle === "P" ? tr(locale, "Open the questions", "לשאלות") : tr(locale, "Open the fix", "לתיקון");
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 border-s-4 border-s-amber-600 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:border-s-amber-500 dark:bg-amber-950/30">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{text}</p>
      <Link href={`/app/tickets/review/${ticketId}`} className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500">
        {cta}
      </Link>
    </div>
  );
}
