import { NavLink as Link } from "@/components/nav-link";
import { redirect } from "next/navigation";

import { LocalDateTime } from "@/components/local-time";
import { MarkAllNotificationsReadButton } from "@/components/mark-all-notifications-read-button";
import { MarkNotificationReadButton } from "@/components/mark-notification-read-button";
import { NotificationsCloseButton } from "@/components/notifications-close-button";
import { listNotifications } from "@/lib/notifications";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The landing spot for the Targets save-flow redesign's background-check
 * notifications (see docs/design/targets-save-performance-redesign.md) - a
 * plain reverse-chronological list, resolved and unresolved together, since
 * there's no real volume yet to justify tabs/filters. Each unresolved
 * concern links back into the Targets page with itself marked read on
 * arrival (see targets/page.tsx's own ?concern=/?viewed= handling).
 *
 * Ticket #77: added a round close (x) in the title row that closes back to
 * the previous screen (Daily Report if there's no history), and a "mark
 * all as read" bulk action, and reworded
 * the intro below - this list already carries more than AI-flagged
 * concerns (ticket status updates too), and is expected to carry periodic
 * report insights soon, so "concerns your AI coach flagged" undersold what
 * actually shows up here.
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
  const hasUnread = notifications.some((notification) => !notification.read_at);

  // TCK-77 reverses TCK-96's mark-on-open - otherwise the "Mark all as read"
  // button never has anything to act on. Reading is now explicit: "Mark all
  // as read", a per-row mark, or opening the item (Targets ?concern=/?viewed=,
  // ticket page), which already mark it read on arrival.

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Notifications", "התראות")}</h1>
        <div className="flex items-center gap-2">
          {hasUnread ? <MarkAllNotificationsReadButton locale={locale} /> : null}
          <NotificationsCloseButton locale={locale} />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {tr(
          locale,
          "Daffy wants to share insights, recommendations, and updates from your tracking - plus updates on tickets you've submitted.",
          "דפי רוצה לשתף איתך תובנות, המלצות ועדכונים מהמעקב שלך - ועדכונים על פניות שהגשת.",
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
            // TCK-96: isRead now drives "done" for both severities (matches
            // the nav badge - see nav-chrome.ts). isResolved stays separate
            // and still real for a concern: Daffy's own later background
            // check, not something reading it changes - shown as its own
            // "Resolved" label and still what gates the "Discuss with AI
            // coach" button below, so a reviewed-but-not-actually-fixed
            // concern doesn't look like there's nothing left to do.
            const isRead = Boolean(notification.read_at);
            const isResolved = Boolean(notification.resolved_at);
            const isDone = isRead;
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
                      ? isResolved
                        ? tr(locale, "Resolved", "טופל")
                        : isRead
                          ? tr(locale, "Reviewed", "נסקר")
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
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* Gated on isResolved, not isRead/isDone - reviewing
                        doesn't mean it's actually fixed, so the way to
                        actually address it stays available either way. */}
                    {!isResolved ? (
                      <Link
                        href={`/app/targets?concern=${notification.id}`}
                        className="inline-flex items-center rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                      >
                        {tr(locale, "Discuss with AI coach", "לדון עם מאמן ה-AI")}
                      </Link>
                    ) : null}
                    {!isRead ? <MarkNotificationReadButton locale={locale} notificationId={notification.id} /> : null}
                  </div>
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
