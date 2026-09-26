"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES, sanitizeFileName } from "@/lib/documents";
import { formatTicketArea, formatTicketPriority, formatTicketType, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import {
  appendTicketDescriptionEntry,
  isCancellableTicketStatus,
  isCurrentUserAdmin,
  isEditableTicketStatus,
  isReopenableTicketStatus,
  MAX_TICKET_ATTACHMENTS,
  ticketAreaOptions,
  ticketPriorityOptions,
  ticketStatusOptions,
  ticketTypeOptions,
  type TicketStatus,
} from "@/lib/tickets";

export type TicketFormState = {
  error?: string;
  success?: string;
};

async function resolveUserLocale(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<AppLocale> {
  const { data } = await supabase.from("user_profile").select("preferred_language").eq("user_id", userId).maybeSingle();
  return normalizeLocale(data?.preferred_language);
}

function buildTicketFieldsSchema(locale: AppLocale) {
  return z.object({
    subject: z
      .string()
      .trim()
      .min(1, tr(locale, "Enter a subject.", "יש להזין נושא."))
      .max(200, tr(locale, "Subject is too long.", "הנושא ארוך מדי.")),
    ticket_type: z.enum(ticketTypeOptions, {
      message: tr(locale, "Choose a ticket type.", "יש לבחור סוג פנייה."),
    }),
    area: z.enum(ticketAreaOptions, {
      message: tr(locale, "Choose which area this is about.", "יש לבחור לאיזה אזור זה קשור."),
    }),
    priority: z.enum(ticketPriorityOptions, {
      message: tr(locale, "Choose a priority.", "יש לבחור עדיפות."),
    }),
  });
}

function buildTicketSchema(locale: AppLocale) {
  return buildTicketFieldsSchema(locale).extend({
    description: z
      .string()
      .trim()
      .min(1, tr(locale, "Enter a description.", "יש להזין תיאור."))
      .max(5000, tr(locale, "Description is too long.", "התיאור ארוך מדי.")),
  });
}

/** Shared by createTicketAction and updateTicketAction so file-validation
 * rules (and their exact messages) can't drift between the two - the only
 * difference between callers is what they do with an accepted file
 * afterward (upload immediately vs. stage for upload alongside a field
 * diff), not what makes a file acceptable in the first place. */
function validateAttachmentFile(file: File, locale: AppLocale): string | null {
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return tr(locale, `"${file.name}" exceeds the 10 MB limit.`, `"${file.name}" חורג מהמגבלה של 10MB.`);
  }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as never)) {
    return tr(
      locale,
      `"${file.name}" isn't a supported file type. Allowed: PDF, PNG, JPG, WEBP, and text files.`,
      `"${file.name}" אינו סוג קובץ נתמך. מותר: PDF, PNG, JPG, WEBP וקבצי טקסט.`,
    );
  }
  return null;
}

/**
 * Creates a support ticket (see docs/design/user-support-tickets-design.md).
 * A plain user can only ever insert with status defaulting to 'open' (see
 * the tickets_insert_own RLS policy) - everything past this point (status
 * transitions beyond the user's own Cancel, fix_description, root cause,
 * duplicate linking) is support-team-only, set directly in Supabase, not
 * through any action in this file.
 */
export async function createTicketAction(_prevState: TicketFormState, formData: FormData): Promise<TicketFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveUserLocale(supabase, user.id);
  const genericFailureMessage = tr(locale, "Could not submit your ticket. Please try again.", "לא ניתן היה לשלוח את הפנייה. יש לנסות שוב.");

  const parsed = buildTicketSchema(locale).safeParse({
    subject: formData.get("subject"),
    ticket_type: formData.get("ticket_type"),
    area: formData.get("area"),
    priority: formData.get("priority"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? genericFailureMessage };
  }

  // Optional - a ticket can be submitted with no attachment at all. Every
  // file under this field name (browse, drag-drop, and a pasted image all
  // funnel into the same hidden multi-file input client-side - see
  // TicketAttachmentsField) is validated and uploaded the same way.
  const fileValues = formData.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);

  if (fileValues.length > MAX_TICKET_ATTACHMENTS) {
    return {
      error: tr(
        locale,
        `Only ${MAX_TICKET_ATTACHMENTS} attachments allowed per ticket.`,
        `מותר עד ${MAX_TICKET_ATTACHMENTS} קבצים מצורפים לפנייה אחת.`,
      ),
    };
  }

  for (const fileValue of fileValues) {
    const fileError = validateAttachmentFile(fileValue, locale);
    if (fileError) {
      return { error: fileError };
    }
  }

  const uploaded: { storage_path: string; file_name: string; mime_type: string; file_size_bytes: number }[] = [];
  // Captured once, outside the closure below - TS doesn't carry the `user`
  // null-check's narrowing into a nested function declaration.
  const userId = user.id;

  async function rollbackUploads() {
    if (uploaded.length === 0) return;
    const { error: rollbackError } = await supabase.storage
      .from("ticket-attachments")
      .remove(uploaded.map((item) => item.storage_path));
    if (rollbackError) {
      logServerError("tickets.create", "attachment_rollback_failed", { userId, error: rollbackError.message });
    }
  }

  for (const [index, fileValue] of fileValues.entries()) {
    const safeName = sanitizeFileName(fileValue.name || "attachment");
    const storagePath = `${user.id}/${Date.now()}-${index}-${safeName}`;

    const { error: storageError } = await supabase.storage
      .from("ticket-attachments")
      .upload(storagePath, fileValue, { contentType: fileValue.type, upsert: false });

    if (storageError) {
      logServerError("tickets.create", "attachment_upload_failed", { userId: user.id, error: storageError.message });
      await rollbackUploads();
      return { error: genericFailureMessage };
    }

    uploaded.push({
      storage_path: storagePath,
      file_name: fileValue.name,
      mime_type: fileValue.type,
      file_size_bytes: fileValue.size,
    });
  }

  // Silent - not user-entered, just the app build they were on when they
  // filed this (see new-ticket-form.tsx's hidden field), for an admin
  // investigating a report to know without having to ask.
  const currentVersionRaw = formData.get("current_version");
  const currentVersion = typeof currentVersionRaw === "string" && currentVersionRaw.trim() ? currentVersionRaw.trim() : null;

  const { data: insertedTicket, error: insertError } = await supabase
    .from("tickets")
    .insert({
      created_by: user.id,
      subject: parsed.data.subject,
      ticket_type: parsed.data.ticket_type,
      area: parsed.data.area,
      priority: parsed.data.priority,
      description: parsed.data.description,
      current_version: currentVersion,
    })
    .select("id")
    .single();

  if (insertError || !insertedTicket) {
    logServerError("tickets.create", "insert_failed", { userId: user.id, error: insertError?.message });
    await rollbackUploads();
    return { error: genericFailureMessage };
  }

  if (uploaded.length > 0) {
    const { error: attachmentsInsertError } = await supabase.from("ticket_attachments").insert(
      uploaded.map((item) => ({
        ticket_id: insertedTicket.id,
        storage_path: item.storage_path,
        file_name: item.file_name,
        mime_type: item.mime_type,
        file_size_bytes: item.file_size_bytes,
      })),
    );

    if (attachmentsInsertError) {
      logServerError("tickets.create", "attachments_insert_failed", { userId: user.id, error: attachmentsInsertError.message });
      await rollbackUploads();
      await supabase.from("tickets").delete().eq("id", insertedTicket.id);
      return { error: genericFailureMessage };
    }
  }

  revalidatePath("/app/tickets");
  redirect("/app/tickets?notice=1");
}

/**
 * The only self-service write a user ever makes to a ticket after creating
 * it - mirrors the tickets_cancel_own RLS policy exactly (only while
 * open/in_progress, only into 'cancelled' with a reason). Soft-cancel, not
 * a delete - keeps history/audit intact, same reasoning as the original
 * design doc.
 */
export async function cancelTicketAction(_prevState: TicketFormState, formData: FormData): Promise<TicketFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveUserLocale(supabase, user.id);
  const ticketId = formData.get("ticket_id")?.toString();
  const reasonRaw = formData.get("reason")?.toString().trim();
  const reason = reasonRaw || tr(locale, "User request", "בקשת המשתמש");

  if (!ticketId) {
    return { error: tr(locale, "Missing ticket.", "הפנייה חסרה.") };
  }

  const { data: existingTicket } = await supabase
    .from("tickets")
    .select("status")
    .eq("id", ticketId)
    .eq("created_by", user.id)
    .maybeSingle();

  if (!existingTicket || !isCancellableTicketStatus(existingTicket.status)) {
    return {
      error: tr(
        locale,
        "This ticket can no longer be cancelled.",
        "לא ניתן עוד לבטל את הפנייה הזו.",
      ),
    };
  }

  const { error: updateError } = await supabase
    .from("tickets")
    .update({ status: "cancelled", cancelled_reason: reason, cancelled_at: new Date().toISOString() })
    .eq("id", ticketId)
    .eq("created_by", user.id);

  if (updateError) {
    logServerError("tickets.cancel", "update_failed", { userId: user.id, ticketId, error: updateError.message });
    return { error: tr(locale, "Could not cancel this ticket. Please try again.", "לא ניתן היה לבטל את הפנייה. יש לנסות שוב.") };
  }

  revalidatePath("/app/tickets");
  revalidatePath(`/app/tickets/${ticketId}`);
  return { success: tr(locale, "Ticket cancelled.", "הפנייה בוטלה.") };
}

/**
 * Edits a ticket - subject/type/area/priority are overwritten in place
 * (the current value is always just the latest one), while `description`
 * is never overwritten: whatever changed, plus the editor's own optional
 * note, becomes one new dated entry appended to it (see
 * appendTicketDescriptionEntry). Attachments can be added (same upload
 * path as createTicketAction) and/or removed (storage + row delete) in
 * the same save - both also get logged as change lines, same as a plain
 * field change would.
 *
 * Two distinct callers share this one action:
 * - The ticket's own creator, gated to open/in_progress/reopened (mirrors
 *   tickets_edit_own) - a resolved ticket has to be reopened first (see
 *   reopenTicketAction), and a cancelled/closed/duplicate one can't be
 *   self-edited at all.
 * - An admin, who can edit ANY ticket in ANY status (mirrors
 *   tickets_update_admin, which already grants this at the RLS layer with
 *   no status restriction - the admin status dropdown already lets them
 *   move a ticket to any status freely, so gating content edits more
 *   tightly than that would be inconsistent, not safer). Entries an admin
 *   adds to someone else's ticket are tagged authoredBySupport so the
 *   history stays unambiguous about who wrote what.
 */
export async function updateTicketAction(_prevState: TicketFormState, formData: FormData): Promise<TicketFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveUserLocale(supabase, user.id);
  const genericFailureMessage = tr(locale, "Could not save your changes. Please try again.", "לא ניתן היה לשמור את השינויים. יש לנסות שוב.");
  const ticketId = formData.get("ticket_id")?.toString();
  if (!ticketId) {
    return { error: tr(locale, "Missing ticket.", "הפנייה חסרה.") };
  }

  const isAdmin = await isCurrentUserAdmin(supabase, user.id);

  let ticketQuery = supabase.from("tickets").select("subject, ticket_type, area, priority, description, status, created_by").eq("id", ticketId);
  if (!isAdmin) {
    ticketQuery = ticketQuery.eq("created_by", user.id);
  }
  const { data: existingTicket } = await ticketQuery.maybeSingle();

  if (!existingTicket || (!isAdmin && !isEditableTicketStatus(existingTicket.status))) {
    return {
      error: tr(locale, "This ticket can no longer be edited.", "לא ניתן עוד לערוך את הפנייה הזו."),
    };
  }

  const authoredBySupport = isAdmin && existingTicket.created_by !== user.id;

  const parsed = buildTicketFieldsSchema(locale).safeParse({
    subject: formData.get("subject"),
    ticket_type: formData.get("ticket_type"),
    area: formData.get("area"),
    priority: formData.get("priority"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? genericFailureMessage };
  }

  const note = (formData.get("note")?.toString() ?? "").trim();
  if (note.length > 2000) {
    return { error: tr(locale, "Note is too long.", "ההערה ארוכה מדי.") };
  }

  const userId = user.id;
  const changeLines: string[] = [];

  // English regardless of the viewer's own locale, same convention
  // technical_response already uses - this text is stored once and read
  // back by whoever opens the ticket later (the submitter, support, an
  // admin), who may not share the locale it was written in.
  if (parsed.data.subject !== existingTicket.subject) {
    changeLines.push("Subject updated");
  }
  if (parsed.data.ticket_type !== existingTicket.ticket_type) {
    changeLines.push(`Type: ${formatTicketType(existingTicket.ticket_type, "en")} → ${formatTicketType(parsed.data.ticket_type, "en")}`);
  }
  if (parsed.data.area !== existingTicket.area) {
    changeLines.push(`Area: ${formatTicketArea(existingTicket.area, "en")} → ${formatTicketArea(parsed.data.area, "en")}`);
  }
  if (parsed.data.priority !== existingTicket.priority) {
    changeLines.push(`Priority: ${formatTicketPriority(existingTicket.priority, "en")} → ${formatTicketPriority(parsed.data.priority, "en")}`);
  }

  // Attachment removals - verified against this ticket specifically (not
  // just "some attachment the caller happens to know the id of") before
  // anything is deleted.
  const removeAttachmentIds = formData.getAll("remove_attachment_ids").map((value) => value.toString()).filter(Boolean);
  let removedAttachments: { id: string; storage_path: string; file_name: string }[] = [];
  if (removeAttachmentIds.length > 0) {
    const { data: toRemove } = await supabase
      .from("ticket_attachments")
      .select("id, storage_path, file_name")
      .eq("ticket_id", ticketId)
      .in("id", removeAttachmentIds);
    removedAttachments = toRemove ?? [];
  }

  // New attachments - same validation as createTicketAction, but the cap
  // now has to account for whatever's staying on the ticket too, not just
  // what's newly added.
  const newFiles = formData.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
  const { count: existingAttachmentCount } = await supabase
    .from("ticket_attachments")
    .select("id", { count: "exact", head: true })
    .eq("ticket_id", ticketId);
  const remainingAfterRemoval = (existingAttachmentCount ?? 0) - removedAttachments.length;

  if (remainingAfterRemoval + newFiles.length > MAX_TICKET_ATTACHMENTS) {
    return {
      error: tr(
        locale,
        `Only ${MAX_TICKET_ATTACHMENTS} attachments allowed per ticket.`,
        `מותר עד ${MAX_TICKET_ATTACHMENTS} קבצים מצורפים לפנייה אחת.`,
      ),
    };
  }
  for (const fileValue of newFiles) {
    const fileError = validateAttachmentFile(fileValue, locale);
    if (fileError) {
      return { error: fileError };
    }
  }

  if (changeLines.length === 0 && removedAttachments.length === 0 && newFiles.length === 0 && !note) {
    return { error: tr(locale, "Nothing to save.", "אין מה לשמור.") };
  }

  // Removals first - if a re-attach of the same filename is part of the
  // same save (unusual, but not prevented), the remove-then-add order
  // keeps storage_path collisions from ever being possible.
  for (const attachment of removedAttachments) {
    const { error: storageError } = await supabase.storage.from("ticket-attachments").remove([attachment.storage_path]);
    if (storageError) {
      logServerError("tickets.update", "attachment_remove_storage_failed", { userId, ticketId, error: storageError.message });
      return { error: genericFailureMessage };
    }
    const { error: rowError } = await supabase.from("ticket_attachments").delete().eq("id", attachment.id);
    if (rowError) {
      logServerError("tickets.update", "attachment_remove_row_failed", { userId, ticketId, error: rowError.message });
      return { error: genericFailureMessage };
    }
    changeLines.push(`Attachment removed: ${attachment.file_name}`);
  }

  const uploaded: { storage_path: string; file_name: string; mime_type: string; file_size_bytes: number }[] = [];
  async function rollbackNewUploads() {
    if (uploaded.length === 0) return;
    const { error: rollbackError } = await supabase.storage.from("ticket-attachments").remove(uploaded.map((item) => item.storage_path));
    if (rollbackError) {
      logServerError("tickets.update", "attachment_rollback_failed", { userId, ticketId, error: rollbackError.message });
    }
  }

  for (const [index, fileValue] of newFiles.entries()) {
    const safeName = sanitizeFileName(fileValue.name || "attachment");
    const storagePath = `${userId}/${Date.now()}-${index}-${safeName}`;
    const { error: storageError } = await supabase.storage
      .from("ticket-attachments")
      .upload(storagePath, fileValue, { contentType: fileValue.type, upsert: false });
    if (storageError) {
      logServerError("tickets.update", "attachment_upload_failed", { userId, ticketId, error: storageError.message });
      await rollbackNewUploads();
      return { error: genericFailureMessage };
    }
    uploaded.push({ storage_path: storagePath, file_name: fileValue.name, mime_type: fileValue.type, file_size_bytes: fileValue.size });
  }

  if (uploaded.length > 0) {
    const { error: attachmentsInsertError } = await supabase.from("ticket_attachments").insert(
      uploaded.map((item) => ({
        ticket_id: ticketId,
        storage_path: item.storage_path,
        file_name: item.file_name,
        mime_type: item.mime_type,
        file_size_bytes: item.file_size_bytes,
      })),
    );
    if (attachmentsInsertError) {
      logServerError("tickets.update", "attachments_insert_failed", { userId, ticketId, error: attachmentsInsertError.message });
      await rollbackNewUploads();
      return { error: genericFailureMessage };
    }
    for (const item of uploaded) {
      changeLines.push(`Attachment added: ${item.file_name}`);
    }
  }

  const description = appendTicketDescriptionEntry({ currentDescription: existingTicket.description, changeLines, note, authoredBySupport });

  let updateQuery = supabase
    .from("tickets")
    .update({
      subject: parsed.data.subject,
      ticket_type: parsed.data.ticket_type,
      area: parsed.data.area,
      priority: parsed.data.priority,
      description,
    })
    .eq("id", ticketId);
  if (!isAdmin) {
    updateQuery = updateQuery.eq("created_by", userId);
  }
  const { error: updateError } = await updateQuery;

  if (updateError) {
    logServerError("tickets.update", "update_failed", { userId, ticketId, error: updateError.message });
    await rollbackNewUploads();
    return { error: genericFailureMessage };
  }

  revalidatePath("/app/tickets");
  revalidatePath(`/app/tickets/${ticketId}`);
  return { success: tr(locale, "Ticket updated.", "הפנייה עודכנה.") };
}

/**
 * Self-service reopen - resolved only (mirrors tickets_reopen_own; a
 * closed ticket stays tester/admin-only to reopen, same as closing it in
 * the first place already is). The note is required here (unlike a plain
 * edit's optional one) since reopening without saying what's still wrong
 * would leave support with nothing to act on.
 */
export async function reopenTicketAction(_prevState: TicketFormState, formData: FormData): Promise<TicketFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveUserLocale(supabase, user.id);
  const ticketId = formData.get("ticket_id")?.toString();
  const note = (formData.get("note")?.toString() ?? "").trim();

  if (!ticketId) {
    return { error: tr(locale, "Missing ticket.", "הפנייה חסרה.") };
  }
  if (!note) {
    return { error: tr(locale, "Please describe what's still wrong before reopening.", "נא לתאר מה עדיין לא תקין לפני פתיחה מחדש.") };
  }
  if (note.length > 2000) {
    return { error: tr(locale, "Note is too long.", "ההערה ארוכה מדי.") };
  }

  const { data: existingTicket } = await supabase
    .from("tickets")
    .select("description, status")
    .eq("id", ticketId)
    .eq("created_by", user.id)
    .maybeSingle();

  if (!existingTicket || !isReopenableTicketStatus(existingTicket.status)) {
    return { error: tr(locale, "This ticket can no longer be reopened.", "לא ניתן עוד לפתוח מחדש את הפנייה הזו.") };
  }

  const description = appendTicketDescriptionEntry({
    currentDescription: existingTicket.description,
    changeLines: ["Status: Resolved → Reopened"],
    note,
  });

  const { error: updateError } = await supabase
    .from("tickets")
    .update({ status: "reopened", description })
    .eq("id", ticketId)
    .eq("created_by", user.id);

  if (updateError) {
    logServerError("tickets.reopen", "update_failed", { userId: user.id, ticketId, error: updateError.message });
    return { error: tr(locale, "Could not reopen this ticket. Please try again.", "לא ניתן היה לפתוח מחדש את הפנייה. יש לנסות שוב.") };
  }

  revalidatePath("/app/tickets");
  revalidatePath(`/app/tickets/${ticketId}`);
  return { success: tr(locale, "Ticket reopened.", "הפנייה נפתחה מחדש.") };
}

/**
 * Same pattern as openOriginalDocumentAction in documents/actions.ts: a
 * short-lived (60s) signed URL generated fresh on click, rather than baked
 * into the server-rendered ticket detail page and left sitting around.
 * One ticket can now have several attachments, so this targets a single
 * attachment row by id rather than "the" ticket's one attachment -
 * ticket_attachments_select's own RLS policy already enforces the same
 * own-ticket-or-admin visibility this used to check by hand here.
 *
 * Returns the signed URL instead of redirecting to it - confirmed live
 * that a server-side redirect() here took over the current tab/window
 * entirely, actually leaving the app's origin/PWA shell to show the raw
 * file, with no in-app "Close" affordance and the browser back button
 * sometimes exiting the app instead of returning to the ticket. The
 * caller (TicketAttachmentViewer) opens this URL inside an in-app modal
 * instead, so the user never actually navigates away.
 */
export type OpenTicketAttachmentResult = { signedUrl: string; mimeType: string; fileName: string } | { error: string };

export async function openTicketAttachmentAction(attachmentId: string): Promise<OpenTicketAttachmentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: row, error: rowError } = await supabase
    .from("ticket_attachments")
    .select("storage_path, mime_type, file_name")
    .eq("id", attachmentId)
    .maybeSingle();

  if (rowError || !row) {
    logServerError("tickets.openAttachment", "attachment_not_found", {
      userId: user.id,
      attachmentId,
      error: rowError?.message,
    });
    return { error: tr(await resolveUserLocale(supabase, user.id), "Attachment not found.", "הקובץ המצורף לא נמצא.") };
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from("ticket-attachments")
    .createSignedUrl(row.storage_path, 60);

  if (signedError || !signedData?.signedUrl) {
    logServerError("tickets.openAttachment", "signed_url_failed", {
      userId: user.id,
      attachmentId,
      error: signedError?.message,
    });
    return {
      error: tr(await resolveUserLocale(supabase, user.id), "Could not open this attachment. Please try again.", "לא ניתן היה לפתוח את הקובץ. יש לנסות שוב."),
    };
  }

  return { signedUrl: signedData.signedUrl, mimeType: row.mime_type, fileName: row.file_name };
}

export type AdminStatusUpdateResult = { error?: string };

/**
 * The one write an admin makes through this UI (see
 * docs/design/user-support-tickets-design.md and its own is_admin follow-
 * up migration) - any ticket, to any status, freely. Called directly from
 * a client component's onChange (not through useActionState/a <form>,
 * since there's no form here - just a select), so it returns a plain
 * result object instead of the {error,success} shape the form actions
 * above use. is_admin is checked here too, not just relied on via RLS -
 * RLS is still what actually stops a non-admin from writing, this is only
 * so a non-admin never even gets a real error to reverse-engineer
 * anything from.
 */
export async function updateTicketStatusAdminAction(ticketId: string, status: TicketStatus): Promise<AdminStatusUpdateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveUserLocale(supabase, user.id);

  if (!ticketStatusOptions.includes(status)) {
    return { error: tr(locale, "Unknown status.", "סטטוס לא מוכר.") };
  }

  const isAdmin = await isCurrentUserAdmin(supabase, user.id);
  if (!isAdmin) {
    return { error: tr(locale, "Not authorized.", "אין הרשאה.") };
  }

  const { error: updateError } = await supabase.from("tickets").update({ status }).eq("id", ticketId);

  if (updateError) {
    logServerError("tickets.adminUpdateStatus", "update_failed", { userId: user.id, ticketId, status, error: updateError.message });
    return { error: tr(locale, "Could not update status. Please try again.", "לא ניתן היה לעדכן את הסטטוס. יש לנסות שוב.") };
  }

  revalidatePath("/app/tickets");
  revalidatePath(`/app/tickets/${ticketId}`);
  return {};
}
