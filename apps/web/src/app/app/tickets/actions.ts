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
    if (fileValue.size > MAX_DOCUMENT_SIZE_BYTES) {
      return {
        error: tr(locale, `"${fileValue.name}" exceeds the 10 MB limit.`, `"${fileValue.name}" חורג מהמגבלה של 10MB.`),
      };
    }
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(fileValue.type as never)) {
      return {
        error: tr(
          locale,
          `"${fileValue.name}" isn't a supported file type. Allowed: PDF, PNG, JPG, WEBP, and text files.`,
          `"${fileValue.name}" אינו סוג קובץ נתמך. מותר: PDF, PNG, JPG, WEBP וקבצי טקסט.`,
        ),
      };
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

  const { data: insertedTicket, error: insertError } = await supabase
    .from("tickets")
    .insert({
      created_by: user.id,
      subject: parsed.data.subject,
      ticket_type: parsed.data.ticket_type,
      area: parsed.data.area,
      priority: parsed.data.priority,
      description: parsed.data.description,
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
 * Same pattern as openOriginalDocumentAction in documents/actions.ts: a
 * short-lived (60s) signed URL generated fresh on click, rather than baked
 * into the server-rendered ticket detail page and left sitting around.
 * One ticket can now have several attachments, so this targets a single
 * attachment row by id rather than "the" ticket's one attachment -
 * ticket_attachments_select's own RLS policy already enforces the same
 * own-ticket-or-admin visibility this used to check by hand here.
 */
export async function openTicketAttachmentAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const attachmentId = formData.get("attachment_id")?.toString();
  if (!attachmentId) return;

  const { data: row, error: rowError } = await supabase
    .from("ticket_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();

  if (rowError || !row) {
    logServerError("tickets.openAttachment", "attachment_not_found", {
      userId: user.id,
      attachmentId,
      error: rowError?.message,
    });
    return;
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
