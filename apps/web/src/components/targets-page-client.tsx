"use client";

import { useState } from "react";

import { TargetsPlanEditor } from "@/components/targets-plan-editor";
import { tr, type AppLocale } from "@/lib/locale";
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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {firstName ? tr(locale, `${firstName}'s targets`, `היעדים של ${firstName}`) : tr(locale, "Your targets", "היעדים שלך")}
        </h2>
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
            "These are locked in and in effect. Ask Daffy for a change from the chat bubble to preview it before it's applied.",
            "אלה נעולים ובתוקף. בקשו שינוי מ-Daffy דרך בועת הצ'אט כדי לצפות בו לפני שהוא מוחל.",
          )}
        </p>
      </div>

      <TargetsPlanEditor payload={payload} locale={locale} onPayloadUpdated={setPayload} onDaffyMessage={() => {}} />
    </div>
  );
}
