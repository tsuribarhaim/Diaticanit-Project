import type { ReactNode } from "react";

import { directionForLocale, normalizeLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export default async function ProtectedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
      {children}
    </div>
  );
}
