import type { ReactNode } from "react";

import { AppBottomNav } from "@/components/app-bottom-nav";
import { AppNav } from "@/components/app-nav";
import { AppUpdateBanner } from "@/components/app-update-banner";
import { InstallAppPrompt } from "@/components/install-app-prompt";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { UnsavedPreviewProvider } from "@/components/unsaved-preview-context";
import { directionForLocale, normalizeLocale } from "@/lib/locale";
import { getNavChrome, type NavChromeData } from "@/lib/nav-chrome";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { normalizeTheme } from "@/lib/theme";

export default async function ProtectedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const {
    data: { user },
  } = await getAuthenticatedUser();

  // This layout re-runs on every single page navigation (every child page
  // is force-dynamic), so name/avatar/theme/notification-count used to be
  // fetched fresh on every single tap - see getNavChrome's own comment for
  // why that read is now cached for a few seconds instead. Falls back to a
  // query without avatar_color when that column doesn't exist yet
  // (migration 033 not applied), same "detect a missing-column error and
  // retry without it" shape used elsewhere in this app (e.g.
  // isMissingReportedWeightColumn in daily-report/page.tsx).
  const navChrome: NavChromeData | null = user ? await getNavChrome(user.id) : null;
  const profileRow = navChrome?.profile ?? null;
  // Unresolved count for the nav badge (see AppNav) - resolved status, not
  // read status, since the whole point of that distinction (see the
  // Targets save-flow redesign's notification system) is that opening a
  // notification doesn't mean the underlying concern is actually settled.
  const unresolvedNotificationCount = navChrome?.unresolvedNotificationCount ?? 0;

  const locale = normalizeLocale(profileRow?.preferred_language);
  const theme = normalizeTheme(profileRow?.theme_preference);

  return (
    // data-theme drives every dark: utility class within /app/* (see
    // globals.css's own comment on the custom variant) - the same wrapper
    // that already carries lang/dir for locale, so a user's theme choice
    // applies everywhere inside the authenticated app the same way their
    // language choice already does, and stops at the same boundary (the
    // sign-in page, the marketing page, and this file's own root-layout
    // chrome stay on the light palette, matching locale/RTL precedent).
    <div lang={locale} dir={directionForLocale(locale)} data-theme={theme} className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <ServiceWorkerRegister />
      <AppUpdateBanner locale={locale} />
      <InstallAppPrompt locale={locale} />
      <UnsavedPreviewProvider locale={locale}>
        {user ? (
          <AppNav
            locale={locale}
            avatarColor={profileRow?.avatar_color}
            name={profileRow?.first_name ?? null}
            notificationCount={unresolvedNotificationCount}
          />
        ) : null}
        {/* Reserves space for AppBottomNav's fixed height below `sm`, where
            it replaces AppNav - zeroed out above that breakpoint, where
            AppNav (not fixed-positioned) needs no such reservation. Adds
            env(safe-area-inset-bottom) on top of the nav's own ~52px base
            height (icon + label + padding) rather than a flat guess, since
            AppBottomNav grows taller by that same inset on notched phones -
            a fixed px value would undershoot there and the nav would cover
            the page's last few pixels of content. */}
        <div className="pb-[calc(3.25rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</div>
        {user ? <AppBottomNav locale={locale} avatarColor={profileRow?.avatar_color} name={profileRow?.first_name ?? null} /> : null}
      </UnsavedPreviewProvider>
    </div>
  );
}
