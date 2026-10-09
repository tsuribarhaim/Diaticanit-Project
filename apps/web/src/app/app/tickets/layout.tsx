import { Suspense, type ReactNode } from "react";

import { TicketsAreaNav } from "@/components/tickets-area-nav";
import { getAutomationOverview } from "@/lib/automation-overview";
import { normalizeLocale, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** Admins get one navigation bar on every ticket screen (Tickets, Automation, Review & approvals).
 * Members see the pages as before. */
export default async function TicketsLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user || !(await isCurrentUserAdmin(supabase, user.id))) return <>{children}</>;

  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );
  let waiting = 0;
  try {
    waiting = (await getAutomationOverview(supabase)).needsYou;
  } catch {
    // The bar still works without the count.
  }
  return (
    <>
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto w-full max-w-6xl px-6 pt-2">
          <Suspense fallback={null}>
            <TicketsAreaNav locale={locale} waiting={waiting} />
          </Suspense>
        </div>
      </div>
      {children}
    </>
  );
}
