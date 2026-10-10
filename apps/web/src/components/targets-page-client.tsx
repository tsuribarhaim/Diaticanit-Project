"use client";

import { useState } from "react";

import { TargetsPlanEditor } from "@/components/targets-plan-editor";
import { formatDateTimeForLocale, tr, type AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";

/**
 * The standalone /app/targets page's client half - TargetsPlanEditor (the
 * editable, tap-to-edit counterpart to the read-only TargetsPlanView
 * onboarding uses). The chat that used to live on this page (negotiate a
 * change, review/apply a diff, ticket #10's stale-targets reminder) has
 * moved to GlobalChatWidget (mounted once in app/app/layout.tsx) as part
 * of the app-wide unified-chat redesign - it's available from any screen
 * now, not just this one, and routes a targets-domain message through
 * the exact same negotiateActiveTargetsAction this page's own chat used
 * to call directly. This component now only owns what's genuinely
 * specific to this screen: the editable plan itself.
 */
export function TargetsPageClient({
  initialPayload,
  locale,
  firstName,
  source,
}: {
  initialPayload: TargetGenerationPayload;
  locale: AppLocale;
  firstName?: string | null;
  source: "ai" | "heuristic";
}) {
  const [payload, setPayload] = useState(initialPayload);

  // useState(initialPayload) only reads the prop on first mount - a chat-
  // driven change (GlobalChatWidget, a separate component with no direct
  // reference to this one's state) has no way to update it other than
  // router.refresh(), which re-fetches this page's server data but does
  // NOT by itself reset an already-mounted client component's own state.
  // Confirmed live as a real gap while adding the version/updated-at
  // header below: the DB and a full page reload were always correct, but
  // the on-page header silently kept showing the pre-edit version until
  // the user manually reloaded - exactly the "hard to tell if it updated"
  // problem this feature exists to fix. Pure state sync during render
  // (not a useEffect - see react-hooks/set-state-in-effect), same
  // prev-value-tracking pattern already used elsewhere in this app. Safe
  // against racing an optimistic local update: every quick-apply write
  // already finishes before its caller calls router.refresh(), so by the
  // time Next.js re-renders with a new initialPayload, it's already
  // fresher than or equal to whatever's currently in state.
  const [prevInitialPayload, setPrevInitialPayload] = useState(initialPayload);
  if (initialPayload !== prevInitialPayload) {
    setPrevInitialPayload(initialPayload);
    setPayload(initialPayload);
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {firstName ? tr(locale, `${firstName}'s targets`, `היעדים של ${firstName}`) : tr(locale, "Your targets", "היעדים שלך")}
          </h2>
          {payload.version !== undefined ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {tr(locale, `Version ${payload.version}`, `גרסה ${payload.version}`)}
              {payload.updatedAt ? ` · ${tr(locale, "Updated", "עודכן")} ${formatDateTimeForLocale(payload.updatedAt, locale)}` : ""}
            </span>
          ) : null}
        </div>
        {source === "heuristic" ? (
          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            {tr(
              locale,
              "Baseline estimate - AI review wasn't available when this was generated.",
              "הערכה בסיסית - סקירת AI לא הייתה זמינה בעת יצירת התכנית.",
            )}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {tr(
            locale,
            "A small change within the allowed range updates right away. A bigger change needs a fresh review of your profile: Daffy will check it in the background and get back to you with an answer.",
            "שינוי קטן בתוך הטווח המותר מתעדכן מיד. שינוי גדול יותר מצריך בדיקה מחודשת של הפרופיל שלכם: דפי תבדוק ברקע ותעדכן אתכם בתשובה.",
          )}
        </p>
      </div>

      <TargetsPlanEditor payload={payload} locale={locale} onPayloadUpdated={setPayload} onDaffyMessage={() => {}} />
    </div>
  );
}
