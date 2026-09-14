"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { tr, type AppLocale } from "@/lib/locale";
import type { ProfileDiffRow } from "@/lib/targets";

/**
 * Shown right after a Profile save that changed something feeding target
 * generation (weight, activity level, medical conditions, etc.) - reuses
 * the same computeProfileDiff data the Targets page's own "your profile
 * changed" banner already shows, just surfaced immediately instead of only
 * if/when the user happens to visit Targets on their own. Styled like the
 * "Notice" modal already used for the navigate-away guard, for visual
 * consistency.
 *
 * Stays open until the user explicitly dismisses it - the query param that
 * makes the server component render this in the first place (see
 * profile/page.tsx) is stripped only from the dismiss handlers below, never
 * automatically on mount. Stripping it on mount was the earlier bug here:
 * that re-ran the server page with the param gone, which stopped rendering
 * this component's parent branch entirely - unmounting the modal within a
 * second or two regardless of its own "stay open" state, since a child's
 * local state doesn't survive its parent choosing not to render it anymore.
 */
export function TargetsStaleModal({ locale, changes }: { locale: AppLocale; changes: ProfileDiffRow[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const router = useRouter();

  function dismiss() {
    setIsOpen(false);
    router.replace("/app/profile", { scroll: false });
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 bg-teal-50 px-5 py-4">
          <span className="text-lg">🎯</span>
          <h2 className="text-sm font-semibold text-teal-900">
            {tr(locale, "Your targets may need an update", "ייתכן שהיעדים שלך זקוקים לעדכון")}
          </h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-700">
            {tr(
              locale,
              "You just changed the following in your profile, which may affect your daily targets:",
              "עדכנת כרגע את הפרטים הבאים בפרופיל שלך, מה שעשוי להשפיע על היעדים היומיים שלך:",
            )}
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-slate-700">
            {changes.map((row) => (
              <li key={row.labelEn}>
                <span className="font-medium">{tr(locale, row.labelEn, row.labelHe)}:</span> {row.before} → {row.after}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {tr(locale, "Got it", "הבנתי")}
          </button>
          <Link
            href="/app/targets"
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
          >
            {tr(locale, "Go to Targets", "מעבר ליעדים")}
          </Link>
        </div>
      </div>
    </div>
  );
}
