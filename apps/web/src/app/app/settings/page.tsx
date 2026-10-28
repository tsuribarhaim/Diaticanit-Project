import { redirect } from "next/navigation";

import { hasAiTargetsConsent } from "@/app/app/targets/actions";
import { LanguageToggle } from "@/components/language-toggle";
import { NavLink } from "@/components/nav-link";
import {
  AiConsentToggleRow,
  ComingSoonRow,
  DataPrivacyRow,
  PasskeysRow,
  PasswordRow,
} from "@/components/profile-app-settings-rows";
import { ProfileRow, ProfileRowGroup, ProfileSectionTitle } from "@/components/profile-quick-edit";
import { ThemeToggle } from "@/components/theme-toggle";
import { getEnvironmentBadgeLabel } from "@/lib/environment-badge";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { normalizeTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

/**
 * "Settings & Support" - every system setting that used to sit at the
 * bottom of the Profile page (TCK-166), grouped as in the mockup. Opened from
 * the gear on Profile's header card (or Settings in the desktop nav). Each row
 * opens the same sheet/page it did on Profile; only where it lives changed.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const [{ data: profileRow }, hasAiConsent] = await Promise.all([
    supabase.from("user_profile").select("preferred_language, theme_preference").eq("user_id", user.id).maybeSingle(),
    hasAiTargetsConsent({ supabase, userId: user.id }),
  ]);
  const locale = normalizeLocale(profileRow?.preferred_language);
  const theme = normalizeTheme(profileRow?.theme_preference);

  const environmentBadgeLabel = getEnvironmentBadgeLabel();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex items-center gap-2">
        <NavLink
          href="/app/profile"
          aria-label={tr(locale, "Back to profile", "חזרה לפרופיל")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <svg
            className="h-5 w-5 rtl:-scale-x-100"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </NavLink>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Settings & Support", "הגדרות ותמיכה")}</h1>
      </div>

      <div>
        <ProfileSectionTitle>{tr(locale, "Display", "תצוגה")}</ProfileSectionTitle>
        <ProfileRowGroup>
          <ProfileRow label={tr(locale, "Language", "שפה")} endSlot={<LanguageToggle locale={locale} />} />
          <ProfileRow label={tr(locale, "Theme", "ערכת נושא")} endSlot={<ThemeToggle locale={locale} theme={theme} />} />
          <ComingSoonRow locale={locale} label={tr(locale, "Measurement units", "יחידות מידה")} caption={tr(locale, "Metric (kg, cm)", "מטרי (ק\"ג, ס\"מ)")} />
        </ProfileRowGroup>
      </div>

      <div>
        <ProfileSectionTitle>{tr(locale, "Connections", "חיבורים")}</ProfileSectionTitle>
        <ProfileRowGroup>
          <ComingSoonRow locale={locale} label={tr(locale, "Connected apps & devices", "אפליקציות ומכשירים מחוברים")} />
          <PasskeysRow locale={locale} />
        </ProfileRowGroup>
      </div>

      <div>
        <ProfileSectionTitle>{tr(locale, "Privacy", "פרטיות")}</ProfileSectionTitle>
        <ProfileRowGroup>
          <DataPrivacyRow locale={locale} />
          <AiConsentToggleRow locale={locale} checked={hasAiConsent} />
        </ProfileRowGroup>
      </div>

      <div>
        <ProfileSectionTitle>{tr(locale, "Account & Support", "חשבון ותמיכה")}</ProfileSectionTitle>
        <ProfileRowGroup>
          <PasswordRow locale={locale} />
          <ProfileRow label={tr(locale, "Notifications", "התראות")} href="/app/notifications" />
          <ProfileRow label={tr(locale, "Support Tickets", "פניות תמיכה")} href="/app/tickets" />
        </ProfileRowGroup>
      </div>

      {environmentBadgeLabel ? (
        <div>
          <ProfileSectionTitle>{tr(locale, "About", "אודות")}</ProfileSectionTitle>
          <ProfileRowGroup>
            {/* Plain text, not the pill/badge treatment EnvironmentBadge
                renders elsewhere (sign-in) - a ticket (TCK-6) reported the
                highlighted frame looked out of place next to rows that all
                show their value as plain text via ProfileRow's `value`. */}
            <ProfileRow label={tr(locale, "Environment", "סביבה")} value={environmentBadgeLabel} />
          </ProfileRowGroup>
        </div>
      ) : null}
    </main>
  );
}
