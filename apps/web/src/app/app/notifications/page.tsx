import Link from "next/link";
import { redirect } from "next/navigation";

import { listNotifications } from "@/lib/notifications";
import { formatDateTimeForLocale, normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The landing spot for the Targets save-flow redesign's background-check
 * notifications (see docs/design/targets-save-performance-redesign.md) - a
 * plain reverse-chronological list, resolved and unresolved together, since
 * there's no real volume yet to justify tabs/filters. Each unresolved
 * concern links back into the Targets chat with itself seeded as the
 * opening context (see targets/page.tsx's own ?concern= handling), so it's
 * worked through with the AI rather than dead-ending here.
 */
export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const profileRow = (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data;
  const locale = normalizeLocale(profileRow?.preferred_language);

  const notifications = await listNotifications({ supabase, userId: user.id });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Notifications", "התראות")}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {tr(
          locale,
          "Concerns your AI coach flagged after a closer look at your targets - most from a background review that runs after you make a change.",
          "חששות שמאמן ה-AI שלך סימן לאחר בדיקה מעמיקה יותר של היעדים שלך - רובם מבדיקת רקע שרצה לאחר שאתם מבצעים שינוי.",
        )}
      </p>

      <div className="mt-6 space-y-3">
        {notifications.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {tr(locale, "Nothing here yet.", "אין כאן עדיין דבר.")}
          </p>
        ) : (
          notifications.map((notification) => {
            const isResolved = Boolean(notification.resolved_at);
            const isConcern = notification.severity === "concern";
            return (
              <div
                key={notification.id}
                className={`rounded-xl border p-4 ${
                  isResolved
                    ? "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40"
                    : isConcern
                      ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                      : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      isResolved
                        ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        : isConcern
                          ? "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-300"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {isResolved
                      ? tr(locale, "Resolved", "טופל")
                      : isConcern
                        ? tr(locale, "⚠ Needs attention", "⚠ דורש תשומת לב")
                        : tr(locale, "Info", "מידע")}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{formatDateTimeForLocale(notification.created_at, locale)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-800 dark:text-slate-200">{notification.message}</p>
                {!isResolved ? (
                  <Link
                    href={`/app/targets?concern=${notification.id}`}
                    className="mt-3 inline-flex items-center rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                  >
                    {tr(locale, "Discuss with AI coach", "לדון עם מאמן ה-AI")}
                  </Link>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
