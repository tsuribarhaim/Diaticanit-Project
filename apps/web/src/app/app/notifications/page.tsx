import Link from "next/link";
import { redirect } from "next/navigation";

import { LocalDateTime } from "@/components/local-time";
import { MarkNotificationReadButton } from "@/components/mark-notification-read-button";
import { listNotifications } from "@/lib/notifications";
import { normalizeLocale, tr } from "@/lib/locale";
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
          "Concerns your AI coach flagged on your targets, and updates on tickets you've submitted to support.",
          "חששות שמאמן ה-AI שלך סימן ביעדים שלך, ועדכונים על פניות ששלחתם לתמיכה.",
        )}
      </p>

      <div className="mt-6 space-y-3">
        {notifications.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {tr(locale, "Nothing here yet.", "אין כאן עדיין דבר.")}
          </p>
        ) : (
          notifications.map((notification) => {
            const isConcern = notification.severity === "concern";
            // "Done" means different things per severity - see
            // nav-chrome.ts's own comment: a concern is only ever done once
            // a later background check confirms it's actually resolved
            // (reading it doesn't count, on purpose), while a plain info
            // notification has no such second check to wait on, so being
            // read IS being done.
            const isDone = isConcern ? Boolean(notification.resolved_at) : Boolean(notification.read_at);
            // A ticket-status-change notification (see tickets table's own
            // notify_ticket_status_change trigger) carries a
            // "ticket_<uuid>" field key instead of a RingMetric id -
            // routes to that ticket instead of assuming every notification
            // is a Targets concern, which was true when this page was
            // first built but no longer is.
            const ticketFieldKey = notification.field_keys.find((key) => key.startsWith("ticket_"));
            const ticketId = ticketFieldKey?.slice("ticket_".length);
            return (
              <div
                key={notification.id}
                className={`rounded-xl border p-4 ${
                  isDone
                    ? "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40"
                    : isConcern
                      ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                      : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      isDone
                        ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        : isConcern
                          ? "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-300"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {isConcern
                      ? isDone
                        ? tr(locale, "Resolved", "טופל")
                        : tr(locale, "⚠ Needs attention", "⚠ דורש תשומת לב")
                      : isDone
                        ? tr(locale, "Read", "נקרא")
                        : tr(locale, "Info", "מידע")}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    <LocalDateTime value={notification.created_at} locale={locale} />
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-800 dark:text-slate-200">{notification.message}</p>
                {isConcern ? (
                  !isDone ? (
                    <Link
                      href={`/app/targets?concern=${notification.id}`}
                      className="mt-3 inline-flex items-center rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                    >
                      {tr(locale, "Discuss with AI coach", "לדון עם מאמן ה-AI")}
                    </Link>
                  ) : null
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {ticketId ? (
                      <Link
                        href={`/app/tickets/${ticketId}`}
                        className="inline-flex items-center rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                      >
                        {tr(locale, "View ticket", "צפייה בפנייה")}
                      </Link>
                    ) : (
                      // Everything else info-severity is a Targets
                      // background-check outcome (see
                      // runBackgroundTargetsCheck) - a "ready to review"
                      // notification routes back to the pending-draft
                      // review card on Targets (targets/page.tsx reads it
                      // straight from user_target_profile_drafts), and a
                      // plain "still accurate" one has nothing further to
                      // do beyond marking it read.
                      <Link
                        href={`/app/targets?viewed=${notification.id}`}
                        className="inline-flex items-center rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                      >
                        {tr(locale, "Go to Targets", "מעבר ליעדים")}
                      </Link>
                    )}
                    {!isDone ? <MarkNotificationReadButton locale={locale} notificationId={notification.id} /> : null}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
