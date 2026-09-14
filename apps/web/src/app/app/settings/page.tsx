import { redirect } from "next/navigation";

import { EnvironmentBadge } from "@/components/environment-badge";
import { LanguageToggle } from "@/components/language-toggle";
import { getEnvironmentBadgeLabel } from "@/lib/environment-badge";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * A simple, extensible list of setting rows - just language and the
 * environment/version badge for now. More rows (measurement units, etc.)
 * are planned to land here later, so this stays a plain stacked list rather
 * than anything bespoke to today's two settings.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = normalizeLocale(
    (
      await supabase
        .from("user_profile")
        .select("preferred_language")
        .eq("user_id", user.id)
        .maybeSingle()
    ).data?.preferred_language,
  );

  const environmentBadgeLabel = getEnvironmentBadgeLabel();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Settings", "הגדרות")}</h1>

      <section className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6">
          <div>
            <p className="font-medium text-slate-900">{tr(locale, "Language", "שפה")}</p>
            <p className="mt-1 text-sm text-slate-600">
              {tr(locale, "Choose the language used across the app.", "בחרו את השפה שתשמש בכל האפליקציה.")}
            </p>
          </div>
          <LanguageToggle locale={locale} />
        </div>

        {environmentBadgeLabel ? (
          <div className="flex flex-wrap items-center justify-between gap-3 p-6">
            <div>
              <p className="font-medium text-slate-900">{tr(locale, "Environment", "סביבה")}</p>
              <p className="mt-1 text-sm text-slate-600">
                {tr(locale, "Which environment and app version you're currently using.", "באיזו סביבה וגרסת אפליקציה אתם משתמשים כעת.")}
              </p>
            </div>
            <EnvironmentBadge label={environmentBadgeLabel} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
