import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { openTicketAttachmentAction } from "@/app/app/tickets/actions";
import { CancelTicketDialog } from "@/components/cancel-ticket-dialog";
import { formatFileSize } from "@/lib/documents";
import { markNotificationRead } from "@/lib/notifications";
import {
  formatDateTimeForLocale,
  formatTicketArea,
  formatTicketPriority,
  formatTicketStatus,
  formatTicketType,
  normalizeLocale,
  tr,
  type AppLocale,
} from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCancellableTicketStatus, type TicketStatus } from "@/lib/tickets";

export const dynamic = "force-dynamic";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );

  const { data: ticket, error } = await supabase
    .from("tickets")
    .select(
      "id, ticket_seq, subject, ticket_type, area, priority, description, status, created_at, attachment_storage_path, attachment_file_name, attachment_file_size_bytes, cancelled_reason, cancelled_at, fix_description, resolved_at",
    )
    .eq("id", id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!ticket) {
    notFound();
  }

  // Landing on a ticket this way (typically via a "View ticket" click from
  // Notifications - see notifications/page.tsx's own ticket_<uuid> field
  // key handling) means the status-change concern it was about has now
  // been seen - mirrors how visiting Targets with ?concern= already marks
  // that notification read. Filtered in JS, not via a `.contains()` query
  // on field_keys - confirmed empirically that PostgREST's jsonb-contains
  // operator throws on a value containing hyphens (a UUID's own format),
  // so it can't be used against this column at all here. The unread list
  // is small (scoped to read_at is null for one user), so this is cheap.
  const { data: unreadNotifications } = await supabase
    .from("user_notifications")
    .select("id, field_keys")
    .eq("user_id", user.id)
    .is("read_at", null);
  const relatedNotifications = (unreadNotifications ?? []).filter((notification) =>
    (notification.field_keys as string[]).includes(`ticket_${ticket.id}`),
  );
  for (const notification of relatedNotifications) {
    await markNotificationRead({ supabase, userId: user.id, notificationId: notification.id });
  }

  const status = ticket.status as TicketStatus;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <div className="mb-4">
        <Link href="/app/tickets" className="text-sm font-semibold text-teal-700 dark:text-teal-400">
          {tr(locale, "← My Tickets", "← הפניות שלי")}
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{ticket.ticket_seq}</p>
            <h1 className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100">{ticket.subject}</h1>
          </div>
          <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {formatTicketStatus(status, locale)}
          </span>
        </div>

        <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <DetailRow label={tr(locale, "Type", "סוג")} value={formatTicketType(ticket.ticket_type, locale)} />
          <DetailRow label={tr(locale, "Area", "אזור")} value={formatTicketArea(ticket.area, locale)} />
          <DetailRow label={tr(locale, "Priority", "עדיפות")} value={formatTicketPriority(ticket.priority, locale)} />
          <DetailRow label={tr(locale, "Submitted", "נשלח")} value={formatDateTimeForLocale(ticket.created_at, locale)} />
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Description", "תיאור")}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{ticket.description}</p>
        </div>

        {ticket.attachment_storage_path ? (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Attachment", "קובץ מצורף")}</p>
            <form action={openTicketAttachmentAction} className="mt-1">
              <input type="hidden" name="ticket_id" value={ticket.id} />
              <button type="submit" className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400">
                {ticket.attachment_file_name ?? tr(locale, "Download", "הורדה")}
                {ticket.attachment_file_size_bytes ? ` (${formatFileSize(ticket.attachment_file_size_bytes)})` : ""}
              </button>
            </form>
          </div>
        ) : null}

        {status === "cancelled" && ticket.cancelled_reason ? (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/60">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Cancellation reason", "סיבת הביטול")}</p>
            <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">{ticket.cancelled_reason}</p>
          </div>
        ) : null}

        {ticket.fix_description ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              {tr(locale, "Resolution", "פתרון")}
            </p>
            <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-300">{ticket.fix_description}</p>
          </div>
        ) : null}

        {/* Close here just navigates back to the ticket list - not a
            status change. Cancel Ticket (the only status change a user
            can make themselves) sits opposite it, shown only while still
            cancellable. */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          {isCancellableTicketStatus(status) ? (
            <CancelTicketDialog locale={locale} ticketId={ticket.id} ticketSeq={ticket.ticket_seq} />
          ) : (
            <span />
          )}
          <Link
            href="/app/tickets"
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {tr(locale, "Close", "סגירה")}
          </Link>
        </div>
      </section>
    </main>
  );
}
