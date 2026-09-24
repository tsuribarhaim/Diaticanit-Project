"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { flagTargetsReviewPendingAction } from "@/app/app/actions";
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
 * OK doesn't navigate anywhere (ticket #10) - an earlier version offered
 * "Go to Targets", which used to kick off an automatic background review
 * that no longer exists in the redesigned Targets page, making that button
 * a promise the app didn't keep. OK now just flags the change
 * (flagTargetsReviewPendingAction) so Daffy raises it herself the next
 * time the Targets chat opens (see plan-actions.ts) - a single
 * acknowledgement instead of an unkept "go check now."
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
  /** When set, dismissing also replaces the URL with this path (client-
   * side, no full navigation) - Profile Edit passes its own pathname to
   * strip the query param that triggers this modal in the first place
   * (see profile/page.tsx), since a plain string is what can cross the
   * server/client boundary from that Server Component (a function prop
   * can't). Daily Report omits this entirely: it has no such param, and
   * visibility there is already driven by the save action's own result,
   * not the URL - an earlier version of this component stripped
   * /app/profile unconditionally on dismiss, which would have navigated
   * Daily Report users away just for closing the modal. */
  dismissHref?: string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const router = useRouter();

  function acknowledge() {
    setIsOpen(false);
    void flagTargetsReviewPendingAction(changes);
    if (dismissHref) {
      router.replace(dismissHref, { scroll: false });
    }
  }

  if (!isOpen) return null;

  return (
    // z-[60]: above the daily-report page's floating chat bubble and save
    // icon (both z-50) - at equal z-index, later DOM order wins ties, and
    // depending on where in the tree this modal happens to render relative
    // to those buttons, an equal z-index risked this modal's backdrop and
    // dialog landing visually behind/beside them instead of clearly on top
    // of the whole page as a modal should.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 dark:bg-slate-950/60">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center gap-2 bg-teal-50 px-5 py-4 dark:bg-teal-950/30">
          <span className="text-lg">🎯</span>
          <h2 className="text-sm font-semibold text-teal-900 dark:text-teal-300">
            {tr(locale, "Your targets may need an update", "ייתכן שהיעדים שלך זקוקים לעדכון")}
          </h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {tr(
              locale,
              "The following changed, which might impact your targets:",
              "הפרטים הבאים השתנו, מה שעשוי להשפיע על היעדים שלך:",
            )}
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-slate-700 dark:text-slate-300">
            {changes.map((row) => (
              <li key={row.labelEn}>
                <span className="font-medium">{tr(locale, row.labelEn, row.labelHe)}:</span> {row.before} → {row.after}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            {tr(
              locale,
              "Next time you open chat with Daffy, she'll remind you to check and adjust anything that needs it.",
              "בפעם הבאה שתפתח/י צ'אט עם Daffy, היא תזכיר לך לבדוק ולהתאים את מה שצריך.",
            )}
          </p>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={acknowledge}
            className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            {tr(locale, "OK", "אישור")}
          </button>
        </div>
      </div>
    </div>
  );
}
