"use client";

import { createPortal } from "react-dom";

import { directionForLocale, type AppLocale } from "@/lib/locale";

/**
 * A brief, centered, self-dismissing "saved" confirmation - unlike the
 * inline saveError/bmiWarning banners in DailyReportChatPanel (which stay
 * until the user's next action, since they're actionable), a plain "saved
 * successfully" message doesn't need to linger or claim page space; it
 * just needs to be seen once. Purely presentational - the caller (see
 * DailyReportForm) owns the show/auto-hide timing, since it already tracks
 * "is this a genuinely new success" (a plain message string isn't enough
 * on its own - two consecutive saves can produce the identical text).
 *
 * Portaled to document.body, with dir set explicitly - the app only
 * applies dir="rtl"/"ltr" on a wrapper <div> inside app/app/layout.tsx, not
 * on <html>/<body>, so a portal straight to document.body escapes it and
 * falls back to the document's default LTR direction (same fix already
 * applied to every other dialog this app portals this way). Centering it
 * as a fixed overlay - rather than the old page-top banner - is also what
 * keeps the page from needing to scroll anywhere to show it: reported as
 * "the save banner scrolls me to the top of the page," which a
 * fixed-centered overlay can't do by construction.
 */
export function DailyReportSuccessToast({ locale, message }: { locale: AppLocale; message: string | null }) {
  if (!message) return null;

  return createPortal(
    <div dir={directionForLocale(locale)} className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="pointer-events-auto rounded-2xl bg-slate-900/90 px-5 py-3 text-center text-sm font-medium text-white shadow-2xl">
        {message}
      </div>
    </div>,
    document.body,
  );
}
