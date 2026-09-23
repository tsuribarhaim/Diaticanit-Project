"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES, sanitizeFileName } from "@/lib/documents";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import {
  isCancellableTicketStatus,
  isCurrentUserAdmin,
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

function buildTicketSchema(locale: AppLocale) {
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
    description: z
      .string()
      .trim()
      .min(1, tr(locale, "Enter a description.", "יש להזין תיאור."))
      .max(5000, tr(locale, "Description is too long.", "התיאור ארוך מדי.")),
  });
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

  // Optional - a ticket can be submitted with no attachment at all.
  let attachment: {
    storage_path: string;
    file_name: string;
    mime_type: string;
    file_size_bytes: number;
  } | null = null;

  const fileValue = formData.get("attachment");
  if (fileValue instanceof File && fileValue.size > 0) {
    if (fileValue.size > MAX_DOCUMENT_SIZE_BYTES) {
      return { error: tr(locale, "Attachment exceeds 10 MB limit.", "הקובץ המצורף חורג מהמגבלה של 10MB.") };
    }
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(fileValue.type as never)) {
      return {
        error: tr(
          locale,
          "Unsupported attachment type. Allowed: PDF, PNG, JPG, WEBP, and text files.",
          "סוג קובץ מצורף לא נתמך. מותר: PDF, PNG, JPG, WEBP וקבצי טקסט.",
        ),
      };
    }

    const safeName = sanitizeFileName(fileValue.name || "attachment");
    const storagePath = `${user.id}/${Date.now()}-${safeName}`;

    const { error: storageError } = await supabase.storage
      .from("ticket-attachments")
      .upload(storagePath, fileValue, { contentType: fileValue.type, upsert: false });

    if (storageError) {
      logServerError("tickets.create", "attachment_upload_failed", { userId: user.id, error: storageError.message });
      return { error: genericFailureMessage };
    }

    attachment = {
      storage_path: storagePath,
      file_name: fileValue.name,
      mime_type: fileValue.type,
      file_size_bytes: fileValue.size,
    };
  }

  const { error: insertError } = await supabase.from("tickets").insert({
    created_by: user.id,
    subject: parsed.data.subject,
    ticket_type: parsed.data.ticket_type,
    area: parsed.data.area,
    priority: parsed.data.priority,
    description: parsed.data.description,
    attachment_storage_path: attachment?.storage_path ?? null,
    attachment_file_name: attachment?.file_name ?? null,
    attachment_mime_type: attachment?.mime_type ?? null,
    attachment_file_size_bytes: attachment?.file_size_bytes ?? null,
  });

  if (insertError) {
    logServerError("tickets.create", "insert_failed", { userId: user.id, error: insertError.message });

    if (attachment) {
      const { error: rollbackError } = await supabase.storage.from("ticket-attachments").remove([attachment.storage_path]);
      if (rollbackError) {
        logServerError("tickets.create", "attachment_rollback_failed", { userId: user.id, error: rollbackError.message });
      }
    }

    return { error: genericFailureMessage };
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
 * Same pattern as openOriginalDocumentAction in documents/actions.ts: a
 * short-lived (60s) signed URL generated fresh on click, rather than baked
 * into the server-rendered ticket detail page and left sitting around.
 */
export async function openTicketAttachmentAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const ticketId = formData.get("ticket_id")?.toString();
  if (!ticketId) return;

  // Admins can open any ticket's attachment, same as they can view any
  // ticket - RLS's own tickets_select_admin policy already allows the
  // read underneath this, the explicit created_by filter below is just
  // for a plain user's own case (RLS would block a cross-user read
  // anyway, but the query shape should match what's actually intended).
  const isAdmin = await isCurrentUserAdmin(supabase, user.id);
  let attachmentQuery = supabase.from("tickets").select("attachment_storage_path").eq("id", ticketId);
  if (!isAdmin) {
    attachmentQuery = attachmentQuery.eq("created_by", user.id);
  }
  const { data: row, error: rowError } = await attachmentQuery.maybeSingle();

  if (rowError || !row?.attachment_storage_path) {
    logServerError("tickets.openAttachment", "ticket_not_found_or_no_attachment", {
      userId: user.id,
      ticketId,
      error: rowError?.message,
    });
    return;
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from("ticket-attachments")
    .createSignedUrl(row.attachment_storage_path, 60);

  if (signedError || !signedData?.signedUrl) {
    logServerError("tickets.openAttachment", "signed_url_failed", {
      userId: user.id,
      ticketId,
      error: signedError?.message,
    });
    return;
  }

  redirect(signedData.signedUrl);
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
