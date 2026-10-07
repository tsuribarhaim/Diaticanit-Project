"use client";

import { useRouter } from "next/navigation";

import { tr, type AppLocale } from "@/lib/locale";

/** Round close (x) for the Notifications page title row. */
export function NotificationsCloseButton({ locale }: { locale: AppLocale }) {
  const router = useRouter();
  function close() {
    // TCK-77: go back to wherever Notifications was opened from (Profile row, nav pill, ring ⚠ link), Daily Report as the fallback (consistent with TCK-22).
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/app/daily-report");
  }
  return (
    <button
      type="button"
      onClick={close}
      aria-label={tr(locale, "Close", "סגירה")}
      title={tr(locale, "Close", "סגירה")}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
