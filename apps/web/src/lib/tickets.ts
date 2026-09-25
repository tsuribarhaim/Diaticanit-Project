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
  "deferred",
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

/** Statuses a user can still edit (subject/type/area/priority/description,
 * attachments) from - mirrors the tickets_edit_own RLS policy's own
 * `status in (...)` check (db/migrations/057_phase22_ticket_edit_reopen.sql),
 * same "UI can't drift from what the database allows" reasoning as
 * isCancellableTicketStatus above. Deliberately does NOT include
 * 'resolved' - reopening (see isReopenableTicketStatus) is the gateway
 * back into edit mode for a resolved ticket, not a side door around it. */
export const EDITABLE_TICKET_STATUSES: readonly TicketStatus[] = ["open", "in_progress", "reopened"];

export function isEditableTicketStatus(status: string): boolean {
  return (EDITABLE_TICKET_STATUSES as readonly string[]).includes(status);
}

/** Statuses a user can self-service reopen FROM - mirrors the
 * tickets_reopen_own RLS policy. Deliberately resolved-only: a closed
 * ticket is only reopenable by a tester/admin (via the existing admin
 * status control), matching the same "only testers/admin can close" rule
 * this app already applies to closing in the other direction. */
export const REOPENABLE_TICKET_STATUSES: readonly TicketStatus[] = ["resolved"];

export function isReopenableTicketStatus(status: string): boolean {
  return (REOPENABLE_TICKET_STATUSES as readonly string[]).includes(status);
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
  if (status === "deferred")
    return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400";
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

/**
 * The `description` column doubles as an append-only, dated history log
 * once a ticket has been edited/reopened at least once - the ORIGINAL
 * submission text is never touched again after that first save, and every
 * later save (a plain edit, or a reopen) adds one more entry underneath
 * it rather than overwriting anything. Each entry marker line is
 * `=== <ISO timestamp> ===`, optionally followed by a `CHANGES: ` line
 * summarizing which attributes/attachments changed that save (the "for
 * history" line the user asked for), then a blank line and the user's own
 * free-text note (present for every reopen - required there - and
 * optional for a plain edit). A brand-new ticket's description has no
 * markers at all yet - `parseTicketDescriptionLog` treats that (or
 * whatever precedes the first marker on an already-edited ticket) as the
 * original entry, dated at the ticket's own `created_at` rather than
 * needing every existing ticket backfilled with a marker of its own.
 */
export type TicketDescriptionEntry = {
  /** ISO timestamp - the ticket's created_at for the original entry, or
   * this entry's own marker timestamp otherwise. */
  date: string;
  /** The `CHANGES: ...` line's content, e.g. "Priority: Medium → High ·
   * Attachment added: photo.jpg" - null when this save was a note-only
   * edit with no attribute/attachment change. */
  changeSummary: string | null;
  /** "status" for a reopen entry (styled distinctly - see
   * ticketStatusBadgeClass's own amber-for-reopened convention) vs
   * "other" for every other kind of change line. */
  changeKind: "status" | "other" | null;
  /** The user's own free text for this entry - null when a plain edit
   * changed only attributes/attachments with no added note. */
  note: string | null;
  /** True only for the very first entry (the original submission) - shown
   * with a distinct "original" tag in the UI. */
  isOriginal: boolean;
  /** True when this entry was written by an admin editing someone else's
   * ticket (see updateTicketAction's own admin branch), not the ticket's
   * own creator - shown with a "Support" tag so a ticket with entries from
   * both sides stays unambiguous about who said what. */
  authoredBySupport: boolean;
};

const TICKET_DESCRIPTION_ENTRY_MARKER_RE = /^=== (.+?) ===\r?\n/gm;
const TICKET_DESCRIPTION_CHANGES_PREFIX = "CHANGES: ";
/** Appended inside the marker's timestamp segment (not its own line) so
 * the marker regex above needs no change to accommodate it - see
 * appendTicketDescriptionEntry and the parsing below, which both just
 * treat it as a suffix on the captured group's raw text. */
const TICKET_DESCRIPTION_SUPPORT_SUFFIX = " · support";

export function parseTicketDescriptionLog(raw: string, createdAtIso: string): TicketDescriptionEntry[] {
  const text = raw ?? "";
  const matches = [...text.matchAll(TICKET_DESCRIPTION_ENTRY_MARKER_RE)];

  function toEntry(block: string, rawMarker: string, isOriginal: boolean): TicketDescriptionEntry | null {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) return null;

    const authoredBySupport = rawMarker.endsWith(TICKET_DESCRIPTION_SUPPORT_SUFFIX);
    const date = authoredBySupport ? rawMarker.slice(0, -TICKET_DESCRIPTION_SUPPORT_SUFFIX.length) : rawMarker;

    let changeSummary: string | null = null;
    let note = trimmedBlock;
    if (trimmedBlock.startsWith(TICKET_DESCRIPTION_CHANGES_PREFIX)) {
      const newlineIndex = trimmedBlock.indexOf("\n");
      if (newlineIndex === -1) {
        changeSummary = trimmedBlock.slice(TICKET_DESCRIPTION_CHANGES_PREFIX.length).trim();
        note = "";
      } else {
        changeSummary = trimmedBlock.slice(TICKET_DESCRIPTION_CHANGES_PREFIX.length, newlineIndex).trim();
        note = trimmedBlock.slice(newlineIndex + 1).trim();
      }
    }

    return {
      date,
      changeSummary,
      changeKind: changeSummary ? (changeSummary.startsWith("Status:") ? "status" : "other") : null,
      note: note || null,
      isOriginal,
      authoredBySupport,
    };
  }

  const entries: TicketDescriptionEntry[] = [];
  const preambleEnd = matches.length > 0 ? matches[0].index : text.length;
  const preambleEntry = toEntry(text.slice(0, preambleEnd), createdAtIso, true);
  if (preambleEntry) entries.push(preambleEntry);

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const entry = toEntry(text.slice(start, end), match[1], false);
    if (entry) entries.push(entry);
  }

  // Chronological (oldest first) while building above, since that's the
  // order they actually appear in the stored text - reversed once here so
  // every caller gets newest-first, matching how it's always displayed.
  return entries.reverse();
}

/**
 * Appends one new dated entry to a ticket's description log - never
 * mutates anything before it. Returns the full new `description` value to
 * store; the caller (updateTicketAction / reopenTicketAction) never needs
 * to touch the raw marker format itself.
 */
export function appendTicketDescriptionEntry({
  currentDescription,
  changeLines,
  note,
  authoredBySupport = false,
  timestamp = new Date().toISOString(),
}: {
  currentDescription: string;
  /** e.g. ["Priority: Medium → High", "Attachment added: photo.jpg"] -
   * joined with " · " into one CHANGES line. Empty when nothing
   * structural changed this save (a note-only edit). */
  changeLines: string[];
  /** The user's own free text for this entry, already trimmed - empty
   * string (not present) when a plain edit added no note. */
  note: string;
  /** True when an admin is editing a ticket they didn't create - see
   * TicketDescriptionEntry's own comment on why this is tracked. */
  authoredBySupport?: boolean;
  timestamp?: string;
}): string {
  const marker = `${timestamp}${authoredBySupport ? TICKET_DESCRIPTION_SUPPORT_SUFFIX : ""}`;
  const lines: string[] = [`=== ${marker} ===`];
  if (changeLines.length > 0) {
    lines.push(`${TICKET_DESCRIPTION_CHANGES_PREFIX}${changeLines.join(" · ")}`);
  }
  if (note) {
    if (changeLines.length > 0) lines.push("");
    lines.push(note);
  }
  const entryBlock = lines.join("\n");
  const trimmedCurrent = currentDescription.replace(/\s+$/, "");
  return `${trimmedCurrent}\n\n${entryBlock}`;
}

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
