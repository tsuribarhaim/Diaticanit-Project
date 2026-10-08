import { NavLink as Link } from "@/components/nav-link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AdminStatusDropdown } from "@/components/admin-status-dropdown";
import { AutomationCheckbox } from "@/components/quick-automation-mark";
import { ReviewCallout } from "@/components/review-banner";
import { CancelTicketDialog } from "@/components/cancel-ticket-dialog";
import { EditTicketDialog } from "@/components/edit-ticket-dialog";
import { LocalDateTime } from "@/components/local-time";
import { ReopenTicketDialog } from "@/components/reopen-ticket-dialog";
import { SubmitTicketDraftButton } from "@/components/submit-ticket-draft-button";
import { TicketAttachmentViewer } from "@/components/ticket-attachment-viewer";
import { TicketHistoryLog } from "@/components/ticket-history-log";
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
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import {
  isCancellableTicketStatus,
  isCurrentUserAdmin,
  isEditableTicketStatus,
  isReopenableTicketStatus,
  isSubmittableTicketStatus,
  parseTicketDescriptionLog,
  type TicketArea,
  type TicketAutoHandle,
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
  searchParams: Promise<{ edit?: string; reopen?: string; from?: string }>;
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
      "id, ticket_seq, subject, ticket_type, area, priority, description, status, created_at, created_by, cancelled_reason, cancelled_at, fix_description, resolved_at, deferred_reason, technical_response, current_version, auto_handle, auto_handle_notes",
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

  // Only fetched for admins - a plain user's own tickets are all theirs.
  // Shown on every ticket an admin opens, their own included (TCK-113).
  // Falls back to the auth email when the profile has no first/last name,
  // same as tickets/page.tsx's TCK-83 follow-up (email lives on the auth
  // user, so it needs the service-role admin client).
  let submittedByName: string | null = null;
  if (isAdmin) {
    const { data: creator } = await supabase
      .from("user_profile")
      .select("first_name, last_name")
      .eq("user_id", ticket.created_by)
      .maybeSingle();
    submittedByName = creator ? [creator.first_name, creator.last_name].filter(Boolean).join(" ") || null : null;
    if (!submittedByName) {
      const { data } = await createAdminClient().auth.admin.getUserById(ticket.created_by);
      submittedByName = data.user?.email ?? ticket.created_by;
    }
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
  const notSetLabel = tr(locale, "Not set yet", "טרם נבחר");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <div className="mb-4">
        <Link href="/app/tickets" className="text-sm font-semibold text-teal-700 dark:text-teal-400">
          {tr(locale, "← My Tickets", "← הפניות שלי")}
        </Link>
      </div>

      <section className="relative rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        {/* Close just navigates back to the ticket list - not a status
            change. An icon in the top end corner (top-left in Hebrew)
            rather than a footer button, so it can't be mistaken for
            closing the ticket itself (TCK-6). Positioned via a wrapper
            since NavLink always puts `relative` on the link itself. */}
        <div className="absolute end-3 top-3">
          <Link
            href={resolvedSearchParams.from === "automation" ? "/app/tickets/automation" : "/app/tickets"}
            aria-label={tr(locale, "Close", "סגירה")}
            title={tr(locale, "Close", "סגירה")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="block">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 pe-10">
          <div>
            <p className="font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{ticket.ticket_seq}</p>
            <h1 className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100" dir="auto">{ticket.subject}</h1>
          </div>
          {isAdmin ? (
            <AdminStatusDropdown locale={locale} ticketId={ticket.id} status={status} size="md" />
          ) : (
            <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {formatTicketStatus(status, locale)}
            </span>
          )}
        </div>

        {isAdmin ? <ReviewCallout locale={locale} ticketId={ticket.id} autoHandle={ticket.auto_handle as TicketAutoHandle | null} /> : null}

        <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <DetailRow label={tr(locale, "Type", "סוג")} value={ticket.ticket_type ? formatTicketType(ticket.ticket_type, locale) : notSetLabel} />
          <DetailRow label={tr(locale, "Area", "אזור")} value={ticket.area ? formatTicketArea(ticket.area, locale) : notSetLabel} />
          <DetailRow label={tr(locale, "Priority", "עדיפות")} value={formatTicketPriority(ticket.priority, locale)} />
          <DetailRow label={tr(locale, "Submitted", "נשלח")} value={<LocalDateTime value={ticket.created_at} locale={locale} />} />
          {isAdmin && submittedByName ? <DetailRow label={tr(locale, "Submitted by", "נשלח על ידי")} value={submittedByName} /> : null}
          {isAdmin ? (
            <DetailRow
              label={tr(locale, "Automation", "אוטומציה")}
              value={<AutomationCheckbox locale={locale} ticketId={ticket.id} autoHandle={ticket.auto_handle} settled={["resolved", "closed", "cancelled", "duplicate"].includes(status)} status={status} withText />}
            />
          ) : null}
        </div>

        {status !== "draft" || ticket.description ? (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{tr(locale, "Description", "תיאור")}</p>
            <div className="mt-2">
              <TicketHistoryLog locale={locale} entries={parseTicketDescriptionLog(ticket.description ?? "", ticket.created_at)} />
            </div>
          </div>
        ) : null}

        {status === "draft" ? (
          <div className="mt-5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 px-3 py-2 dark:border-indigo-700 dark:bg-indigo-950/30">
            <p className="text-sm text-indigo-800 dark:text-indigo-300">
              {tr(
                locale,
                "This is a draft - keep editing to add detail, then submit it when ready. We won't look at it until then.",
                "זו טיוטה - אפשר להמשיך לערוך ולהוסיף פרטים, ולשלוח אותה כשתהיה מוכנה. לא נתייחס אליה עד אז.",
              )}
            </p>
          </div>
        ) : null}

        {attachments && attachments.length > 0 ? (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Attachments", "קבצים מצורפים")}
            </p>
            <TicketAttachmentViewer locale={locale} attachments={attachments} />
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

        {isAdmin && ticket.current_version ? (
          <div className="mt-5 flex items-center gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(locale, "Reported on app version", "דווח בגרסת אפליקציה")} {ticket.current_version}
            </p>
            <span className="rounded-full border border-indigo-200 bg-indigo-100 px-1.5 py-0 text-[10px] font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
              {tr(locale, "Admin only", "מנהלים בלבד")}
            </span>
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

        {isAdmin && ticket.auto_handle_notes ? (
          <div className="mt-5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 dark:border-cyan-800 dark:bg-cyan-950/30">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-400">
                {tr(locale, "Auto-handle notes", "הערות טיפול אוטומטי")}
              </p>
              <span className="rounded-full border border-indigo-200 bg-indigo-100 px-1.5 py-0 text-[10px] font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
                {tr(locale, "Admin only", "מנהלים בלבד")}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-cyan-900 dark:text-cyan-300">{ticket.auto_handle_notes}</p>
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

        {/* Reopen/Cancel are self-service-only (admins already have full
            status control via the dropdown above, so they don't get a
            second, narrower way to change status down here too) - but
            Edit is available to BOTH: a user on their own still-live
            ticket, or an admin on ANY ticket in any status (mirrors
            tickets_update_admin's own unrestricted RLS grant - the status
            dropdown already lets an admin move a ticket anywhere freely,
            so gating content edits more tightly than that would only be
            inconsistent, not actually safer). No footer at all when no
            action applies (Submit only shows for drafts, which are
            editable, so this condition covers it too). */}
        {isAdmin || isEditableTicketStatus(status) || isReopenableTicketStatus(status) || isCancellableTicketStatus(status) ? (
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-4">
              {isAdmin || isEditableTicketStatus(status) ? (
                <EditTicketDialog
                  locale={locale}
                  ticketId={ticket.id}
                  ticketSeq={ticket.ticket_seq}
                  currentSubject={ticket.subject}
                  currentType={ticket.ticket_type as TicketType | null}
                  currentArea={ticket.area as TicketArea | null}
                  currentPriority={ticket.priority as TicketPriority}
                  currentAttachments={(attachments ?? []).map((attachment) => ({
                    id: attachment.id,
                    fileName: attachment.file_name,
                    mimeType: attachment.mime_type,
                    fileSizeBytes: attachment.file_size_bytes,
                  }))}
                  isDraft={status === "draft"}
                  currentDescription={ticket.description}
                  canSubmitDraft={!isAdmin && isSubmittableTicketStatus(status)}
                  autoOpen={resolvedSearchParams.edit === "1"}
                />
              ) : null}
              {!isAdmin && isSubmittableTicketStatus(status) ? <SubmitTicketDraftButton locale={locale} ticketId={ticket.id} /> : null}
              {!isAdmin && isReopenableTicketStatus(status) ? (
                <ReopenTicketDialog locale={locale} ticketId={ticket.id} ticketSeq={ticket.ticket_seq} autoOpen={resolvedSearchParams.reopen === "1"} />
              ) : null}
              {!isAdmin && isCancellableTicketStatus(status) ? <CancelTicketDialog locale={locale} ticketId={ticket.id} ticketSeq={ticket.ticket_seq} /> : null}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
