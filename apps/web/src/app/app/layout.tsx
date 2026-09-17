import type { ReactNode } from "react";

import { AppBottomNav } from "@/components/app-bottom-nav";
import { AppNav } from "@/components/app-nav";
import { UnsavedPreviewProvider } from "@/components/unsaved-preview-context";
import { directionForLocale, normalizeLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export default async function ProtectedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  // Falls back to a query without avatar_color when that column doesn't
  // exist yet (migration 033 not applied) - this runs on every single page,
  // so a missing-column error here can't be allowed to also take down
  // locale detection (preferred_language, a column that's existed for a
  // long time and has nothing to do with avatars) for every user on every
  // page just because one new, unrelated column isn't there yet. Same
  // "detect a missing-column error and retry without it" shape used
  // elsewhere in this app (e.g. isMissingReportedWeightColumn in
  // daily-report/page.tsx) - just resolved here instead of surfaced as a
  // user-facing error, since nothing about layout.tsx has an error banner
  // to show it in.
  let profileRow: { preferred_language: string | null; first_name: string | null; avatar_color?: string | null } | null = null;
  if (user) {
    const fullSelect = await supabase
      .from("user_profile")
      .select("preferred_language, first_name, avatar_color")
      .eq("user_id", user.id)
      .maybeSingle();
    if (fullSelect.error?.message.includes("avatar_color")) {
      profileRow = (
        await supabase
          .from("user_profile")
          .select("preferred_language, first_name")
          .eq("user_id", user.id)
          .maybeSingle()
      ).data;
    } else {
      profileRow = fullSelect.data;
    }
  }

  const locale = normalizeLocale(profileRow?.preferred_language);

  return (
    <div lang={locale} dir={directionForLocale(locale)}>
      <UnsavedPreviewProvider locale={locale}>
        {user ? <AppNav locale={locale} avatarColor={profileRow?.avatar_color} name={profileRow?.first_name ?? null} /> : null}
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
