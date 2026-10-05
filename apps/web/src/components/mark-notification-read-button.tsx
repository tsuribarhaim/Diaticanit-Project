"use client";

import { useFormStatus } from "react-dom";

import { markNotificationReadAction } from "@/app/app/notifications/actions";
import { tr, type AppLocale } from "@/lib/locale";

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function SubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {pending ? <Spinner className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}
      {pending ? tr(locale, "Marking...", "מסמן...") : tr(locale, "Mark as read", "סמן כנקרא")}
    </button>
  );
}

function CheckIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Shown for any unread notification, concern or info (see TCK-96 /
 * nav-chrome.ts's own comment) - reading it clears the nav badge either
 * way now. For a concern specifically this only means "reviewed", not
 * "fixed" - resolved_at is untouched and still drives its own separate
 * "Resolved" label and the Discuss-with-AI-coach button on the
 * Notifications page. */
export function MarkNotificationReadButton({ locale, notificationId }: { locale: AppLocale; notificationId: string }) {
  return (
    <form action={markNotificationReadAction}>
      <input type="hidden" name="notification_id" value={notificationId} />
      <SubmitButton locale={locale} />
    </form>
  );
}
