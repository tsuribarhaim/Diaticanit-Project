import { NavLink as Link } from "@/components/nav-link";
import { redirect } from "next/navigation";

import { AutomationCycle, DigestCard } from "@/components/automation-cycle";
import { getAutomationOverview } from "@/lib/automation-overview";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** The Ticket Automation dashboard (admin only): every ticket marked for automation, where it stands in the cycle and what
 * is waiting for the admin. See docs/design/ticket-automation-dashboard.md. */
export default async function TicketAutomationPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");
  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );
  if (!(await isCurrentUserAdmin(supabase, user.id))) redirect("/app/tickets");

  const { notice } = await searchParams;
  const overview = await getAutomationOverview(supabase);

  const cards = [
    {
      href: "/app/tickets/review",
      title: tr(locale, "Review & approvals", "סקירה ואישורים"),
      note: tr(locale, "Proposals, fixes on dev and what is ready to promote - the detailed screens.", "הצעות, תיקונים בפיתוח ומה שמוכן להעלאה - המסכים המפורטים."),
      badge: overview.needsYou > 0 ? tr(locale, `${overview.needsYou} waiting`, `${overview.needsYou} ממתינות`) : null,
    },
    {
      href: "/app/tickets/automation/releases",
      title: tr(locale, "Release history", "היסטוריית שחרורים"),
      note: tr(locale, "Every promotion: tickets, steps and rollbacks.", "כל העלאה: פניות, שלבים וחזרות לאחור."),
      badge: null,
    },
    {
      href: "/app/tickets/automation/lessons",
      title: tr(locale, "What the agents learned", "מה שהסוכנים למדו"),
      note: tr(locale, "Standing lessons from your corrections - switch any off.", "לקחים קבועים מהתיקונים שלך - אפשר לכבות כל אחד."),
      badge: null,
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8">
      {notice ? (
        <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Ticket Automation", "אוטומציית פניות")}</h1>
      <p className="mb-2 mt-1 text-sm text-slate-600 dark:text-slate-400">
        {tr(locale, "Every ticket marked for automation, where it stands, and what is waiting for you.", "כל פנייה שסומנה לאוטומציה, איפה היא עומדת ומה ממתין לך.")}
      </p>
      <p className="mb-5 flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
          <path d="M9 12l2.2 2.2L15.5 10" />
        </svg>
        <span>
          <b>{tr(locale, "You sign off every step that matters.", "את/ה מאשר/ת כל שלב חשוב.")}</b>{" "}
          {tr(locale, "The AI proposes and builds; the shields mark where only you can move a ticket on.", "ה-AI מציע ובונה; המגנים מסמנים איפה רק את/ה יכול/ה להעביר פנייה הלאה.")}
        </span>
      </p>

      <AutomationCycle locale={locale} overview={overview} />

      {overview.recentReleases.length > 0 ? (
        <>
          <h2 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Recently released", "שוחרר לאחרונה")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.recentReleases.map((release, index) => (
              <Link key={`${release.at}-${index}`} href="/app/tickets/automation/releases" className="rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{release.version ? `v${release.version}` : tr(locale, "No version", "ללא גרסה")}</span>
                  <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                    {new Date(release.at).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jerusalem" })}
                  </span>
                </span>
                <span className={`mt-0.5 block text-xs ${release.ok ? "text-slate-500 dark:text-slate-400" : "font-semibold text-amber-700 dark:text-amber-400"}`}>
                  {release.ok
                    ? tr(locale, `${release.tickets} fix${release.tickets === 1 ? "" : "es"} released`, `${release.tickets} תיקונים שוחררו`)
                    : release.rolledBack
                      ? tr(locale, "Rolled back - nothing changed for users", "הוחזר לאחור - דבר לא השתנה למשתמשים")
                      : tr(locale, "Stopped - nothing changed in production", "נעצר - דבר לא השתנה בייצור")}
                </span>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <h2 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Everything about it", "הכל על זה")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{card.title}</span>
              {card.badge ? <span className="whitespace-nowrap text-xs font-bold text-teal-700 dark:text-teal-400">{card.badge}</span> : null}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{card.note}</span>
          </Link>
        ))}
        <DigestCard locale={locale} digestRequested={overview.status.requested.digest} />
      </div>
    </main>
  );
}
