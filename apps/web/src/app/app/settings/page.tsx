import { redirect } from "next/navigation";

import { EnvironmentBadge } from "@/components/environment-badge";
import { LanguageToggle } from "@/components/language-toggle";
import { PasskeyManager } from "@/components/passkey-manager";
import { ThemeToggle } from "@/components/theme-toggle";
import { getEnvironmentBadgeLabel } from "@/lib/environment-badge";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { normalizeTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

/**
 * A simple, extensible list of setting rows - language, theme, and the
 * environment/version badge for now. More rows (measurement units, etc.)
 * are planned to land here later, so this stays a plain stacked list rather
 * than anything bespoke to today's settings.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const profileRow = (
    await supabase.from("user_profile").select("preferred_language, theme_preference").eq("user_id", user.id).maybeSingle()
  ).data;
  const locale = normalizeLocale(profileRow?.preferred_language);
  const theme = normalizeTheme(profileRow?.theme_preference);

  const environmentBadgeLabel = getEnvironmentBadgeLabel();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6">
          <div>
            <p className="font-medium text-slate-900 dark:text-slate-100">{tr(locale, "Language", "שפה")}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {tr(locale, "Choose the language used across the app.", "בחרו את השפה שתשמש בכל האפליקציה.")}
            </p>
          </div>
          <LanguageToggle locale={locale} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-6">
          <div>
            <p className="font-medium text-slate-900 dark:text-slate-100">{tr(locale, "Theme", "ערכת נושא")}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {tr(locale, "Choose a bright screen, or dark throughout.", "בחרו מסך בהיר, או כהה בכל מקום.")}
            </p>
          </div>
          <ThemeToggle locale={locale} theme={theme} />
        </div>

        <div className="flex flex-col gap-3 p-6">
          <div>
            <p className="font-medium text-slate-900 dark:text-slate-100">{tr(locale, "Passkeys", "מפתחות גישה")}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {tr(
                locale,
                "Sign in with Face ID, Touch ID, Windows Hello, or a security key instead of typing your password.",
                "התחברו עם זיהוי פנים, טביעת אצבע, Windows Hello, או מפתח אבטחה במקום הקלדת הסיסמה.",
              )}
            </p>
          </div>
          <PasskeyManager locale={locale} />
        </div>

        {environmentBadgeLabel ? (
          <div className="flex flex-wrap items-center justify-between gap-3 p-6">
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">{tr(locale, "Environment", "סביבה")}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
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
