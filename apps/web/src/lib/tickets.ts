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

export type TicketAttachment = {
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
  attachment_storage_path: string | null;
  attachment_file_name: string | null;
  cancelled_reason: string | null;
  cancelled_at: string | null;
  fix_description: string | null;
  resolved_at: string | null;
};
