import { redirect } from "next/navigation";

import { AiUsageView } from "@/components/ai-usage-view";
import { israelDate, loadAiUsage, parsePeriod } from "@/lib/ai-usage-report";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

// Wrapped so the clock is read in one place (the render must not call Date.now directly).
const now = () => new Date();

/** AI cost per person and per page (lib/ai-usage-report.ts), for a day, week, month or year. Admins only. */
export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ gran?: string; date?: string; admins?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");
  if (!(await isCurrentUserAdmin(supabase, user.id))) redirect("/app/tickets");
  const locale: AppLocale = normalizeLocale((await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language);
  const params = await searchParams;
  const today = israelDate(now());
  const period = parsePeriod(params.gran, params.date, today);
  const includeAdmins = params.admins !== "0";
  const data = await loadAiUsage(supabase, period, includeAdmins, today);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{tr(locale, "AI usage and cost", "שימוש ועלות AI")}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {tr(
            locale,
            "Every AI action in Daffy, per person and per page. Admins are included and marked; the ticket automation is not part of these numbers.",
            "כל פעולת AI בדפי, לפי משתמש ולפי עמוד. מנהלים כלולים ומסומנים; האוטומציה של הפניות לא נכללת במספרים האלה.",
          )}
        </p>
      </header>
      <AiUsageView locale={locale} data={data} />
    </main>
  );
}
