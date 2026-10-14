import { loadActiveBatch, MAX_BATCH_TICKETS, type BatchTicket } from "@/lib/daily-batch";
import { tr, type AppLocale } from "@/lib/locale";
import type { createClient } from "@/lib/supabase/server";
import { logAutomationEvent } from "@/lib/ticket-review";

type Client = Awaited<ReturnType<typeof createClient>>;
type Result = { error?: string; success?: string };

/**
 * "Approve" on the batch page: the ticked tickets go to the analyst ('S'), the rest are marked unticked (the triage leaves
 * them out for a week), and the batch becomes approved - from now until it closes, nothing is started by hand.
 * A ticket that left 'open'/'reopened' or got an automation flag since the scan is skipped and said so.
 */
export async function approveBatch(supabase: Client, adminId: string, locale: AppLocale, batchId: string, ticketIds: string[]): Promise<Result> {
  const batch = await loadActiveBatch(supabase);
  if (!batch || batch.id !== batchId || batch.status !== "proposed") return { error: tr(locale, "This batch is no longer waiting for approval. Refresh the page.", "החבילה כבר לא ממתינה לאישור. יש לרענן את הדף.") };
  const chosen = new Set(ticketIds.filter((id) => batch.tickets.some((t) => t.ticketId === id)).slice(0, MAX_BATCH_TICKETS));
  if (chosen.size === 0) return { error: tr(locale, "Tick at least one ticket, or reject the batch.", "יש לסמן לפחות פנייה אחת, או לדחות את החבילה.") };

  const { data: rows } = await supabase.from("tickets").select("id, status, auto_handle").in("id", [...chosen]);
  const ready = new Set(((rows ?? []) as { id: string; status: string; auto_handle: string | null }[]).filter((t) => ["open", "reopened"].includes(t.status) && !t.auto_handle).map((t) => t.id));
  const tickets: BatchTicket[] = batch.tickets.map((t) =>
    !chosen.has(t.ticketId)
      ? { ...t, state: "unselected" }
      : ready.has(t.ticketId)
        ? { ...t, state: "queued" }
        : { ...t, state: "out", note: tr(locale, "Changed since the scan (status or automation), so it was left out.", "השתנתה מאז הסריקה (סטטוס או אוטומציה), ולכן לא נכללה.") },
  );
  if (ready.size === 0) return { error: tr(locale, "None of the ticked tickets can still go in (they changed since the scan).", "אף אחת מהפניות שסומנו כבר לא יכולה להיכנס (הן השתנו מאז הסריקה).") };

  for (const ticketId of ready) {
    await supabase.from("tickets").update({ auto_handle: "S" }).eq("id", ticketId).is("auto_handle", null);
    await logAutomationEvent(supabase, adminId, ticketId, "marked", { batchId });
  }
  const { error } = await supabase.from("automation_batches").update({ status: "approved", tickets, approved_at: new Date().toISOString(), approved_by: adminId }).eq("id", batchId).eq("status", "proposed");
  if (error) return { error: tr(locale, "Could not save. Try again.", "לא ניתן היה לשמור. יש לנסות שוב.") };
  return {
    success: tr(
      locale,
      `${ready.size} ticket${ready.size === 1 ? "" : "s"} approved. The analyst takes them at 18:00 and the night run at 02:15; you get an email when it is ready to promote.`,
      `${ready.size === 1 ? "פנייה אחת אושרה" : `${ready.size} פניות אושרו`}. האנליסט ייקח אותן ב-18:00 וריצת הלילה ב-02:15; יישלח אליך מייל כשהחבילה תהיה מוכנה להעלאה.`,
    ),
  };
}

/** "Reject the batch": nothing runs, the tickets stay as they are (tomorrow's scan may suggest them again). */
export async function rejectBatch(supabase: Client, locale: AppLocale, batchId: string): Promise<Result> {
  const { data, error } = await supabase.from("automation_batches").update({ status: "rejected", closed_at: new Date().toISOString() }).eq("id", batchId).eq("status", "proposed").select("id");
  if (error || (data ?? []).length === 0) return { error: tr(locale, "This batch is no longer waiting for approval. Refresh the page.", "החבילה כבר לא ממתינה לאישור. יש לרענן את הדף.") };
  return { success: tr(locale, "Batch rejected. Nothing will run for it.", "החבילה נדחתה. שום דבר לא ירוץ עבורה.") };
}
