import type { ReactNode } from "react";

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
        {children}
      </UnsavedPreviewProvider>
    </div>
  );
}
