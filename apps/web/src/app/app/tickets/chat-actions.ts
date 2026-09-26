"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import { ticketAreaOptions, ticketPriorityOptions, ticketTypeOptions } from "@/lib/tickets";

const ticketDraftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  ticket_type: z.enum(ticketTypeOptions),
  area: z.enum(ticketAreaOptions),
  priority: z.enum(ticketPriorityOptions),
  description: z.string().trim().min(1).max(5000),
  // Silent - not something the user drafted, just the app build they were
  // on when they filed this (see the caller in global-chat-widget.tsx),
  // for an admin investigating a report to know without having to ask.
  current_version: z.string().trim().min(1).nullish(),
});

export type SubmitTicketFromChatResult = { error?: string; success?: boolean; ticketId?: string };

/**
 * Writes a ticket the help domain's own negotiate step (lib/ai/help-chat.ts)
 * already drafted and the user already reviewed (Submit tap in the chat
 * widget) - same insert shape as createTicketAction (tickets/actions.ts),
 * just without the attachments path, which chat can't produce. Kept as its
 * own small action rather than reusing createTicketAction directly since
 * that one is FormData-and-redirect shaped for the ticket form, not a
 * plain object the chat widget can call.
 */
export async function submitTicketFromChatAction(rawDraft: Record<string, unknown>): Promise<SubmitTicketFromChatResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profileRow } = await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle();
  const locale = normalizeLocale(profileRow?.preferred_language);
  const genericFailureMessage = tr(locale, "Could not submit your ticket. Please try again.", "לא ניתן היה לשלוח את הפנייה. יש לנסות שוב.");

  const parsed = ticketDraftSchema.safeParse(rawDraft);
  if (!parsed.success) {
    return { error: genericFailureMessage };
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
      current_version: parsed.data.current_version ?? null,
    })
    .select("id")
    .single();

  if (insertError || !insertedTicket) {
    logServerError("tickets.submitFromChat", "insert_failed", { userId: user.id, error: insertError?.message });
    return { error: genericFailureMessage };
  }

  revalidatePath("/app/tickets");
  return { success: true, ticketId: insertedTicket.id as string };
}
