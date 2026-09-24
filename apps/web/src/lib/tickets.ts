import type { createClient } from "@/lib/supabase/server";

/** Support ticket types/constants shared between the server actions and
 * client forms (see docs/design/user-support-tickets-design.md). Mirrors
 * the tickets table's own check constraints (db/migrations/
 * 044_phase22_user_tickets.sql) - keep both in sync if either changes. */

export const ticketTypeOptions = ["bug", "feature_request"] as const;
export type TicketType = (typeof ticketTypeOptions)[number];

/** Which part of the app a ticket is about - seeded with today's sections,
 * open to grow as new areas ship (adding one here also needs a matching
 * migration updating the `area` check constraint). */
export const ticketAreaOptions = [
  "home",
  "daily_report",
  "targets",
  "profile",
  "documents",
  "health_labs",
  "notifications",
  "settings",
  "account_auth",
  "other",
] as const;
export type TicketArea = (typeof ticketAreaOptions)[number];

export const ticketPriorityOptions = ["low", "medium", "high", "urgent"] as const;
export type TicketPriority = (typeof ticketPriorityOptions)[number];

/** Reopened is currently support-team-only (set directly in Supabase,
 * same as every status transition beyond a user's own Cancel) - no
 * user-facing action produces it yet. See the design doc's own open
 * item on this. */
export const ticketStatusOptions = [
  "open",
  "in_progress",
  "resolved",
  "closed",
  "cancelled",
  "duplicate",
  "reopened",
] as const;
export type TicketStatus = (typeof ticketStatusOptions)[number];

/** Statuses a user can still Cancel from - mirrors the tickets_cancel_own
 * RLS policy's own `status in ('open', 'in_progress')` check, kept here so
 * the UI's "show Cancel" logic can't drift from what the database will
 * actually allow. */
export const CANCELLABLE_TICKET_STATUSES: readonly TicketStatus[] = ["open", "in_progress"];

export function isCancellableTicketStatus(status: string): boolean {
  return (CANCELLABLE_TICKET_STATUSES as readonly string[]).includes(status);
}

/** Shared between the plain ticket list's static badge and the admin
 * status dropdown's own pill styling (see components/admin-status-
 * dropdown.tsx) - one status-to-color mapping, not two copies that could
 * drift apart. */
export function ticketStatusBadgeClass(status: TicketStatus): string {
  if (status === "open") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400";
  if (status === "in_progress" || status === "reopened")
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400";
  if (status === "resolved")
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400";
  if (status === "cancelled")
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400";
  return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

/** A ticket can have any number of these up to MAX_TICKET_ATTACHMENTS - a
 * soft UX cap enforced in the client form and re-checked server-side in
 * createTicketAction, not a database constraint (see db/migrations/
 * 052_phase22_ticket_multi_attachments.sql's own comment on why). */
export const MAX_TICKET_ATTACHMENTS = 5;

export type TicketAttachment = {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
};

export type TicketListRow = {
  id: string;
  ticket_seq: number;
  subject: string;
  status: TicketStatus;
  created_at: string;
};

export type TicketDetail = TicketListRow & {
  ticket_type: TicketType;
  area: TicketArea;
  priority: TicketPriority;
  description: string;
  cancelled_reason: string | null;
  cancelled_at: string | null;
  fix_description: string | null;
  resolved_at: string | null;
};

/** Mirrors the is_admin() SQL function used in the tickets_select_admin/
 * tickets_update_admin RLS policies (db/migrations/
 * 048_phase22_ticket_admin.sql) - this is only ever used to decide what
 * the UI shows (an extra column, filters, a free status dropdown); RLS is
 * still the real enforcement boundary underneath every query and update
 * this flag gates in the UI. */
export async function isCurrentUserAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase.from("user_profile").select("is_admin").eq("user_id", userId).maybeSingle();
  return Boolean(data?.is_admin);
}
