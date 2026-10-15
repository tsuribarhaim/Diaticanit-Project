import { loadBusyFiles } from "@/lib/automation-overlap";
import { createBundle } from "@/lib/bundles";
import { loadActiveBatch, MAX_BATCH_TICKETS, type BatchTicket } from "@/lib/daily-batch";
import { tr, type AppLocale } from "@/lib/locale";
import { sharedFiles, suggestBundles } from "@/lib/overlap";
import type { createClient } from "@/lib/supabase/server";
import { logAutomationEvent } from "@/lib/ticket-review";

type Client = Awaited<ReturnType<typeof createClient>>;
type Result = { error?: string; success?: string };

/** The Israel hour now (the analyst runs at 18:00, the night run at 02:15). */
function israelHour(): number {
  return Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false })) % 24;
}

/**
 * "Approve" on the batch page: the ticked tickets go to the analyst ('S'), the rest are marked unticked (the triage leaves
 * them out for a week), and the batch becomes approved - from now until it closes, nothing is started by hand.
 * A ticket that left 'open'/'reopened' or got an automation flag since the scan is skipped and said so. So is one whose
 * files a fix not promoted yet, or a ticket already queued, is changing ("waits for TCK-x"): the night run would only hold it.
 * Ticked tickets that change the same files are bundled, so the night run builds them as one job instead of holding one.
 * Approved outside 16:00-18:00 (the 18:00 analyst already ran, or is hours away), the analyst is requested right away.
 */
export async function approveBatch(supabase: Client, adminId: string, locale: AppLocale, batchId: string, ticketIds: string[]): Promise<Result> {
  const batch = await loadActiveBatch(supabase);
  if (!batch || batch.id !== batchId || batch.status !== "proposed") return { error: tr(locale, "This batch is no longer waiting for approval. Refresh the page.", "החבילה כבר לא ממתינה לאישור. יש לרענן את הדף.") };
  const chosen = new Set(ticketIds.filter((id) => batch.tickets.some((t) => t.ticketId === id)).slice(0, MAX_BATCH_TICKETS));
  if (chosen.size === 0) return { error: tr(locale, "Tick at least one ticket, or reject the batch.", "יש לסמן לפחות פנייה אחת, או לדחות את החבילה.") };

  const { data: rows } = await supabase.from("tickets").select("id, status, auto_handle, bundle_id").in("id", [...chosen]);
  const ticketRows = (rows ?? []) as { id: string; status: string; auto_handle: string | null; bundle_id: string | null }[];
  const ready = new Set(ticketRows.filter((t) => ["open", "reopened"].includes(t.status) && !t.auto_handle).map((t) => t.id));
  // What else is about to change the same files, checked now (things may have moved since the 16:00 scan).
  const busy = await loadBusyFiles(supabase);
  const waitsFor = new Map<string, number[]>();
  for (const t of batch.tickets) {
    if (!ready.has(t.ticketId)) continue;
    const seqs = [...new Set(busy.filter((b) => b.seq !== t.seq && sharedFiles(t.files ?? [], b.files).length > 0).map((b) => b.seq))];
    if (seqs.length > 0) {
      waitsFor.set(t.ticketId, seqs);
      ready.delete(t.ticketId);
    }
  }
  const tickets: BatchTicket[] = batch.tickets.map((t) => {
    if (!chosen.has(t.ticketId)) return { ...t, state: "unselected" };
    if (ready.has(t.ticketId)) return { ...t, state: "queued" };
    const seqs = waitsFor.get(t.ticketId);
    if (seqs) {
      const list = seqs.map((seq) => `TCK-${seq}`).join(", ");
      return { ...t, state: "out", note: tr(locale, `Waits for ${list} (same files, not in production yet) - a later batch.`, `ממתינה ל-${list} (אותם קבצים, עוד לא בייצור) - תיכנס לחבילה מאוחרת יותר.`) };
    }
    return { ...t, state: "out", note: tr(locale, "Changed since the scan (status or automation), so it was left out.", "השתנתה מאז הסריקה (סטטוס או אוטומציה), ולכן לא נכללה.") };
  });
  if (ready.size === 0) return { error: tr(locale, "None of the ticked tickets can still go in (they changed since the scan, or wait for other fixes).", "אף אחת מהפניות שסומנו כבר לא יכולה להיכנס (הן השתנו מאז הסריקה, או ממתינות לתיקונים אחרים).") };

  for (const ticketId of ready) {
    await supabase.from("tickets").update({ auto_handle: "S" }).eq("id", ticketId).is("auto_handle", null);
    await logAutomationEvent(supabase, adminId, ticketId, "marked", { batchId });
  }
  // Batch tickets that change the same files become one bundle (built together tonight). One already in a bundle stays as it is.
  const free = new Set(ticketRows.filter((t) => !t.bundle_id).map((t) => t.id));
  const bySeq = new Map(tickets.filter((t) => ready.has(t.ticketId) && free.has(t.ticketId)).map((t) => [t.seq, t]));
  for (const group of suggestBundles([...bySeq.values()].map((t) => ({ seq: t.seq, files: t.files ?? [] })))) {
    const members = group.map((seq) => bySeq.get(seq)!);
    const made = await createBundle(supabase, adminId, members.map((t) => t.ticketId));
    if ("bundle" in made) {
      const others = (t: BatchTicket) => members.filter((m) => m !== t).map((m) => `TCK-${m.seq}`).join(", ");
      for (const t of members) t.note = tr(locale, `Bundle ${made.bundle.letter} with ${others(t)} (same files, built together).`, `חבילה ${made.bundle.letter} עם ${others(t)} (אותם קבצים, ייבנו יחד).`);
    }
  }

  const { error } = await supabase.from("automation_batches").update({ status: "approved", tickets, approved_at: new Date().toISOString(), approved_by: adminId }).eq("id", batchId).eq("status", "proposed");
  if (error) return { error: tr(locale, "Could not save. Try again.", "לא ניתן היה לשמור. יש לנסות שוב.") };

  // The batch owns the analyst from here, so this request is not a manual run (requestAgentRun would refuse it under the lock).
  const hour = israelHour();
  let analystNow = false;
  if (hour < 16 || hour >= 18) {
    const { data: open } = await supabase.from("automation_requests").select("id").eq("kind", "analyze").is("completed_at", null).limit(1);
    if ((open ?? []).length > 0) analystNow = true;
    else analystNow = !(await supabase.from("automation_requests").insert({ kind: "analyze", requested_by: adminId, details: { batchId } })).error;
  }
  const count = tr(locale, `${ready.size} ticket${ready.size === 1 ? "" : "s"} approved.`, ready.size === 1 ? "פנייה אחת אושרה." : `${ready.size} פניות אושרו.`);
  return {
    success: analystNow
      ? tr(locale, `${count} The analyst starts within a minute and the night run takes them at 02:15; you get an email when it is ready to promote.`, `${count} האנליסט יתחיל תוך כדקה וריצת הלילה תיקח אותן ב-02:15; יישלח אליך מייל כשהחבילה תהיה מוכנה להעלאה.`)
      : tr(locale, `${count} The analyst takes them at 18:00 and the night run at 02:15; you get an email when it is ready to promote.`, `${count} האנליסט ייקח אותן ב-18:00 וריצת הלילה ב-02:15; יישלח אליך מייל כשהחבילה תהיה מוכנה להעלאה.`),
  };
}

/** "Reject the batch": nothing runs, the tickets stay as they are (tomorrow's scan may suggest them again). */
export async function rejectBatch(supabase: Client, locale: AppLocale, batchId: string): Promise<Result> {
  const { data, error } = await supabase.from("automation_batches").update({ status: "rejected", closed_at: new Date().toISOString() }).eq("id", batchId).eq("status", "proposed").select("id");
  if (error || (data ?? []).length === 0) return { error: tr(locale, "This batch is no longer waiting for approval. Refresh the page.", "החבילה כבר לא ממתינה לאישור. יש לרענן את הדף.") };
  return { success: tr(locale, "Batch rejected. Nothing will run for it.", "החבילה נדחתה. שום דבר לא ירוץ עבורה.") };
}
