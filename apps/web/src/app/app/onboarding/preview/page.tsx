import { NavLink as Link } from "@/components/nav-link";
import { redirect } from "next/navigation";

import { OnboardingProfileForm } from "@/components/onboarding-profile-form";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** Admin-only test run of the sign-up wizard (TCK-168). Runs the real
 * wizard blank, like a brand-new user, but in previewMode nothing is
 * saved - see previewOnboardingProfileAction and the preview targets
 * actions. */
export default async function OnboardingPreviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  if (!(await isCurrentUserAdmin(supabase, user.id))) {
    redirect("/app/tickets");
  }

  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      {/* The nav, bottom nav and chat are hidden under /app/onboarding, so
         this banner carries the only way back out. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        <span>
          {tr(
            locale,
            "Test mode - nothing you enter here is saved. No user, profile or targets are created.",
            "מצב בדיקה - שום דבר שמוזן כאן לא נשמר. לא נוצרים משתמש, פרופיל או יעדים.",
          )}
        </span>
        <Link href="/app/tickets" className="font-semibold underline">
          {tr(locale, "Exit test", "יציאה מהבדיקה")}
        </Link>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <OnboardingProfileForm locale={locale} previewMode />
      </section>
    </main>
  );
}
