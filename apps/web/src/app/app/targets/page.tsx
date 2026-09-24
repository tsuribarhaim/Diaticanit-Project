import { redirect } from "next/navigation";

import { TargetsPageClient } from "@/components/targets-page-client";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { mapTargetProfileRowToPayload, TARGET_PROFILE_COLUMNS } from "@/lib/targets";

export const dynamic = "force-dynamic";

/**
 * The standalone Targets page - full replacement of the old tabbed
 * workspace (TargetsWorkspace/TargetsChatWorkspace/targets-section-tabs),
 * reusing the exact same read-only plan view the onboarding Targets step
 * already established (see targets-plan-view.tsx). This page assumes an
 * active target profile already exists - if the profile is incomplete or
 * no plan has ever been locked in, onboarding is where that gets fixed
 * (its own page.tsx now routes straight to its Targets step in that
 * case - see its startAtTargetsStep computation), so there's no
 * "generate a baseline here" fallback to maintain in two places anymore.
 *
 * No chat here anymore - GlobalChatWidget (app/app/layout.tsx) covers
 * this page too now, as part of the app-wide unified-chat redesign. This
 * page's own job is just the editable plan itself (TargetsPlanEditor,
 * via TargetsPageClient).
 */
export default async function TargetsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const [{ data: profileRow }, { data: activeRow, error: activeError }] = await Promise.all([
    supabase.from("user_profile").select("first_name, preferred_language").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_target_profiles").select(TARGET_PROFILE_COLUMNS).eq("user_id", user.id).eq("is_active", true).maybeSingle(),
  ]);

  if (activeError) {
    throw new Error(activeError.message);
  }

  if (!profileRow || !activeRow) {
    redirect("/app/onboarding");
  }

  const locale = normalizeLocale(profileRow.preferred_language);
  const payload = mapTargetProfileRowToPayload(activeRow);
  const source: "ai" | "heuristic" = activeRow.analysis_source === "ai" ? "ai" : "heuristic";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <TargetsPageClient initialPayload={payload} locale={locale} firstName={profileRow.first_name} source={source} />

        <p className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800">
          {tr(
            locale,
            "Informational support only. Check with a qualified healthcare professional for medical decisions.",
            "למטרות מידע בלבד. להחלטות רפואיות יש להתייעץ עם איש מקצוע מוסמך.",
          )}
        </p>
      </section>
    </main>
  );
}
