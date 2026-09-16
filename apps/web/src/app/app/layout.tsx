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

  const locale = user
    ? normalizeLocale(
        (
          await supabase
            .from("user_profile")
            .select("preferred_language")
            .eq("user_id", user.id)
            .maybeSingle()
        ).data?.preferred_language,
      )
    : "en";

  return (
    <div lang={locale} dir={directionForLocale(locale)}>
      <UnsavedPreviewProvider locale={locale}>
        {user ? <AppNav locale={locale} /> : null}
        {/* Reserves space for AppBottomNav's fixed height below `sm`, where
            it replaces AppNav - zeroed out above that breakpoint, where
            AppNav (not fixed-positioned) needs no such reservation. Adds
            env(safe-area-inset-bottom) on top of the nav's own ~52px base
            height (icon + label + padding) rather than a flat guess, since
            AppBottomNav grows taller by that same inset on notched phones -
            a fixed px value would undershoot there and the nav would cover
            the page's last few pixels of content. */}
        <div className="pb-[calc(3.25rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</div>
        {user ? <AppBottomNav locale={locale} /> : null}
      </UnsavedPreviewProvider>
    </div>
  );
}
