"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { tr, type AppLocale } from "@/lib/locale";
import type { ProfileDiffRow } from "@/lib/targets";

/**
 * Shown right after a save that changed something feeding target
 * generation (weight, activity level, medical conditions, etc.) - reuses
 * the same computeProfileDiff data the Targets page's own "your profile
 * changed" banner already shows, just surfaced immediately instead of only
 * if/when the user happens to visit Targets on their own. Used from both
 * Profile Edit (a direct field change) and the Daily Report form (a
 * logged weight syncing back to the profile). Styled like the "Notice"
 * modal already used for the navigate-away guard, for visual consistency.
 *
 * Stays open until the user explicitly dismisses it, never automatically -
 * see the note on the Profile Edit page's use of onDismiss for a bug this
 * caused previously when dismissal was tied to a URL change instead.
 */
export function TargetsStaleModal({
  locale,
  changes,
  dismissHref,
}: {
  locale: AppLocale;
  changes: ProfileDiffRow[];
  /** When set, dismissing via "Got it" also replaces the URL with this
   * path (client-side, no full navigation) - Profile Edit passes its own
   * pathname to strip the query param that triggers this modal in the
   * first place (see profile/page.tsx), since a plain string is what can
   * cross the server/client boundary from that Server Component (a
   * function prop can't). Daily Report omits this entirely: it has no
   * such param, and visibility there is already driven by the save
   * action's own result, not the URL - an earlier version of this
   * component stripped /app/profile unconditionally on dismiss, which
   * would have navigated Daily Report users away just for closing the
   * modal. */
  dismissHref?: string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const router = useRouter();

  function dismiss() {
    setIsOpen(false);
    if (dismissHref) {
      router.replace(dismissHref, { scroll: false });
    }
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
              "The following just changed, which may affect your daily targets:",
              "הפרטים הבאים עודכנו כעת, מה שעשוי להשפיע על היעדים היומיים שלך:",
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
