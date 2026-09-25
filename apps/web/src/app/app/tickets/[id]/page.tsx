import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { openTicketAttachmentAction } from "@/app/app/tickets/actions";
import { AdminStatusDropdown } from "@/components/admin-status-dropdown";
import { CancelTicketDialog } from "@/components/cancel-ticket-dialog";
import { EditTicketDialog } from "@/components/edit-ticket-dialog";
import { LocalDateTime } from "@/components/local-time";
import { ReopenTicketDialog } from "@/components/reopen-ticket-dialog";
import { TicketHistoryLog } from "@/components/ticket-history-log";
import { formatFileSize } from "@/lib/documents";
import { markNotificationRead } from "@/lib/notifications";
import {
  formatTicketArea,
  formatTicketPriority,
  formatTicketStatus,
  formatTicketType,
  normalizeLocale,
  tr,
  type AppLocale,
} from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import {
  isCancellableTicketStatus,
  isCurrentUserAdmin,
  isEditableTicketStatus,
  isReopenableTicketStatus,
  parseTicketDescriptionLog,
  type TicketArea,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from "@/lib/tickets";

export const dynamic = "force-dynamic";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; reopen?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
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

  const isAdmin = await isCurrentUserAdmin(supabase, user.id);

  // Admins can open any ticket (RLS's own tickets_select_admin policy
  // already allows this); a plain user's query stays scoped to their own.
  // technical_response is fetched here same as cancelled_reason/
  // fix_description/deferred_reason - this whole route is a Server
  // Component with no client-component prop passing of the raw `ticket`
  // object, so gating its RENDER on isAdmin below is enough: a non-admin's
  // response HTML never contains it, same privacy guarantee as those
  // other admin/status-gated fields already get.
  let ticketQuery = supabase
    .from("tickets")
    .select(
      "id, ticket_seq, subject, ticket_type, area, priority, description, status, created_at, created_by, cancelled_reason, cancelled_at, fix_description, resolved_at, deferred_reason, technical_response",
    )
    .eq("id", id);
  if (!isAdmin) {
    ticketQuery = ticketQuery.eq("created_by", user.id);
  }
  const { data: ticket, error } = await ticketQuery.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!ticket) {
    notFound();
  }

  // ticket_attachments_select's own RLS policy already scopes this to the
  // same own-ticket-or-admin visibility the ticket query above just used -
  // no need to repeat the isAdmin/created_by check here.
  const { data: attachments } = await supabase
    .from("ticket_attachments")
    .select("id, file_name, mime_type, file_size_bytes")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });

  // Only fetched for admins viewing someone else's ticket - a plain user's
  // own tickets are all theirs, and an admin viewing their own doesn't
  // need to be told they submitted it.
  let submittedByName: string | null = null;
  if (isAdmin && ticket.created_by !== user.id) {
    const { data: creator } = await supabase
      .from("user_profile")
      .select("first_name, last_name")
      .eq("user_id", ticket.created_by)
      .maybeSingle();
    submittedByName = creator ? [creator.first_name, creator.last_name].filter(Boolean).join(" ") || null : null;
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
            <h1 className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100" dir="auto">{ticket.subject}</h1>
            {submittedByName ? (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {tr(locale, "Submitted by", "נשלח על ידי")} {submittedByName}
              </p>
            ) : null}
          </div>
          {isAdmin ? (
            <AdminStatusDropdown locale={locale} ticketId={ticket.id} status={status} size="md" />
          ) : (
            <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {formatTicketStatus(status, locale)}
            </span>
          )}
        </div>

        <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <DetailRow label={tr(locale, "Type", "סוג")} value={formatTicketType(ticket.ticket_type, locale)} />
          <DetailRow label={tr(locale, "Area", "אזור")} value={formatTicketArea(ticket.area, locale)} />
          <DetailRow label={tr(locale, "Priority", "עדיפות")} value={formatTicketPriority(ticket.priority, locale)} />
          <DetailRow label={tr(locale, "Submitted", "נשלח")} value={<LocalDateTime value={ticket.created_at} locale={locale} />} />
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Description", "תיאור")}</p>
          <div className="mt-2">
            <TicketHistoryLog locale={locale} entries={parseTicketDescriptionLog(ticket.description, ticket.created_at)} />
          </div>
        </div>

        {attachments && attachments.length > 0 ? (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Attachments", "קבצים מצורפים")}
            </p>
            <ul className="mt-1.5 space-y-1">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <form action={openTicketAttachmentAction}>
                    <input type="hidden" name="attachment_id" value={attachment.id} />
                    <button type="submit" className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400">
                      {attachment.file_name}
                      {attachment.file_size_bytes ? ` (${formatFileSize(attachment.file_size_bytes)})` : ""}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {status === "cancelled" && ticket.cancelled_reason ? (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/60">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Cancellation reason", "סיבת הביטול")}</p>
            <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">{ticket.cancelled_reason}</p>
          </div>
        ) : null}

        {status === "deferred" && ticket.deferred_reason ? (
          <div className="mt-5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-800 dark:bg-violet-950/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
              {tr(locale, "Deferred reason", "סיבת הדחייה")}
            </p>
            <p className="mt-1 text-sm text-violet-900 dark:text-violet-300">{ticket.deferred_reason}</p>
          </div>
        ) : null}

        {isAdmin && ticket.technical_response ? (
          <div className="mt-5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-950/30">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-400">
                {tr(locale, "Technical response", "מענה טכני")}
              </p>
              <span className="rounded-full border border-indigo-200 bg-indigo-100 px-1.5 py-0 text-[10px] font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
                {tr(locale, "Admin only", "מנהלים בלבד")}
              </span>
            </div>
            <p className="mt-1 text-sm text-indigo-900 dark:text-indigo-300">{ticket.technical_response}</p>
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
            status change. Reopen/Cancel are self-service-only (admins
            already have full status control via the dropdown above, so
            they don't get a second, narrower way to change status down
            here too) - but Edit is available to BOTH: a user on their own
            still-live ticket, or an admin on ANY ticket in any status
            (mirrors tickets_update_admin's own unrestricted RLS grant -
            the status dropdown already lets an admin move a ticket
            anywhere freely, so gating content edits more tightly than
            that would only be inconsistent, not actually safer). */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          {isAdmin || isEditableTicketStatus(status) || isReopenableTicketStatus(status) || isCancellableTicketStatus(status) ? (
            <div className="flex flex-wrap items-center gap-4">
              {isAdmin || isEditableTicketStatus(status) ? (
                <EditTicketDialog
                  locale={locale}
                  ticketId={ticket.id}
                  ticketSeq={ticket.ticket_seq}
                  currentSubject={ticket.subject}
                  currentType={ticket.ticket_type as TicketType}
                  currentArea={ticket.area as TicketArea}
                  currentPriority={ticket.priority as TicketPriority}
                  currentAttachments={(attachments ?? []).map((attachment) => ({
                    id: attachment.id,
                    fileName: attachment.file_name,
                    mimeType: attachment.mime_type,
                    fileSizeBytes: attachment.file_size_bytes,
                  }))}
                  autoOpen={resolvedSearchParams.edit === "1"}
                />
              ) : null}
              {!isAdmin && isReopenableTicketStatus(status) ? (
                <ReopenTicketDialog locale={locale} ticketId={ticket.id} ticketSeq={ticket.ticket_seq} autoOpen={resolvedSearchParams.reopen === "1"} />
              ) : null}
              {!isAdmin && isCancellableTicketStatus(status) ? <CancelTicketDialog locale={locale} ticketId={ticket.id} ticketSeq={ticket.ticket_seq} /> : null}
            </div>
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
