import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

/**
 * The daily batch (agreed with the admin, 2026-10-14): at 16:00 a triage agent (automation/n8n/bridge, POST /triage) reads
 * the open and reopened tickets and picks up to MAX_BATCH_TICKETS that are clear and small. The admin approves them on
 * /app/tickets/batch; the analyst (18:00) and the night run (02:15) fix them, the batch's analyst choices approved
 * automatically; the admin approves the promotion; the tickets are resolved and the batch closes.
 *
 * While a batch is active, nothing is started by hand (requestAgentRun refuses), so fixes and files never overlap.
 */

export const MAX_BATCH_TICKETS = 8;
/** States of a ticket inside a batch. */
export type BatchTicketState = "proposed" | "unselected" | "queued" | "analysing" | "building" | "built" | "out" | "released";
/** retried: the fix stopped once and was requeued (a second stop takes it out); summary: what the fix changed (for the emails);
 * files: the source files the triage expects it to change (the overlap checks at creation and approval). */
export type BatchTicket = { ticketId: string; seq: number; subject: string; reason: string; needsMigration: boolean; state: BatchTicketState; note?: string | null; retried?: boolean; summary?: string | null; files?: string[] };
export type BatchStatus = "proposed" | "approved" | "building" | "ready" | "promoting" | "done" | "rejected" | "expired" | "failed";
export type Batch = {
  id: string;
  batch_date: string;
  status: BatchStatus;
  tickets: BatchTicket[];
  scanned_count: number;
  triage_cost_usd: number | null;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  ready_at: string | null;
  promoted_at: string | null;
  version: string | null;
  dev_tested: boolean;
  closed_at: string | null;
  note: string | null;
};

export const ACTIVE_BATCH_STATUSES: BatchStatus[] = ["proposed", "approved", "building", "ready", "promoting"];
/** A batch the admin approved and that is not finished: the lock against manual agent runs is on. */
export const LOCKING_BATCH_STATUSES: BatchStatus[] = ["approved", "building", "ready", "promoting"];

type AnyClient = ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createClient>>;

export async function loadActiveBatch(supabase: AnyClient): Promise<Batch | null> {
  const { data } = await supabase.from("automation_batches").select("*").in("status", ACTIVE_BATCH_STATUSES).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as Batch | null) ?? null;
}

/** The newest batch whatever its status (the batch page shows the last one once it is closed). */
export async function loadLatestBatch(supabase: AnyClient): Promise<Batch | null> {
  const { data } = await supabase.from("automation_batches").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as Batch | null) ?? null;
}

export async function batchLockActive(supabase: AnyClient): Promise<boolean> {
  const { data } = await supabase.from("automation_batches").select("id").in("status", LOCKING_BATCH_STATUSES).limit(1);
  return (data ?? []).length > 0;
}

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ddmm = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

/** The 16:00 email: what the triage picked and why, with a link to approve on the batch page (never by the email itself). */
export function renderBatchProposalEmail(batch: Pick<Batch, "batch_date" | "tickets" | "scanned_count">, appUrl: string): { subject: string; html: string; text: string } {
  const picks = batch.tickets;
  const date = ddmm(batch.batch_date);
  const subject = `דפי – ${picks.length === 1 ? "פנייה פשוטה אחת מוכנה" : `${picks.length} פניות פשוטות מוכנות`} לאישור (חבילה ${date})`;
  const card = "background:#ffffff;border:1px solid #e2e8e6;border-radius:12px;padding:16px 18px;margin:0 0 12px;";
  const rows = picks
    .map(
      (t, i) =>
        `<tr><td style="${i ? "border-top:1px solid #eef1f0;" : ""}padding:9px 0;vertical-align:top;width:72px;"><span dir="ltr" style="font-family:Consolas,monospace;font-size:12px;background:#eef1f0;border-radius:6px;padding:1px 6px;">TCK-${t.seq}</span></td>` +
        `<td style="${i ? "border-top:1px solid #eef1f0;" : ""}padding:9px 0;"><div style="font-weight:bold;" dir="auto">${esc(t.subject)}</div><div style="color:#61716e;font-size:13px;">${esc(t.reason)}</div>` +
        `${t.needsMigration ? `<div style="margin-top:3px;"><span style="font-size:11px;border-radius:999px;padding:1px 8px;background:#e0f2fe;color:#0369a1;">שינוי במסד הנתונים</span></div>` : ""}</td></tr>`,
    )
    .join("");
  const notPicked = Math.max(0, batch.scanned_count - picks.length);
  const html = `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f6f8f7;"><div dir="rtl" style="font-family:Arial,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:18px 12px;color:#17302c;font-size:14px;line-height:1.55;">
<div style="${card}"><div style="font-size:19px;font-weight:bold;margin-bottom:6px;">${picks.length === 1 ? "פנייה אחת שאפשר לתקן הלילה" : `${picks.length} פניות שאפשר לתקן הלילה`}</div><div style="color:#61716e;">בדקתי ${batch.scanned_count} פניות פתוחות. אלה ברורות וקטנות, לכל אחת סיבה קצרה. אשרו בדף החבילה, ואני אעביר אותן לאנליסט בשש ולריצת הלילה.</div></div>
<div style="${card}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></div>
<div style="${card}"><a href="${appUrl}/app/tickets/batch" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:10px;padding:10px 18px;">פתיחת דף החבילה</a>${notPicked ? `<div style="color:#61716e;font-size:12px;margin-top:10px;">לא נבחרו: ${notPicked} פניות שצריכות החלטה, עיצוב או בדיקה. הן מחכות לך כרגיל.</div>` : ""}</div>
<div style="color:#61716e;font-size:12px;text-align:center;">האישור נעשה רק בדף החבילה באפליקציה. חבילה שלא אושרה עד הסריקה הבאה מתבטלת.</div>
</div></body></html>`;
  const text = [`${picks.length} פניות פשוטות לאישור (חבילה ${date})`, "", ...picks.map((t) => `TCK-${t.seq}: ${t.subject} - ${t.reason}${t.needsMigration ? " [שינוי במסד הנתונים]" : ""}`), "", `לאישור: ${appUrl}/app/tickets/batch`].join("\n");
  return { subject, html, text };
}

function batchEmailShell(title: string, lede: string, sections: string[], button: { href: string; label: string } | null): string {
  const card = "background:#ffffff;border:1px solid #e2e8e6;border-radius:12px;padding:16px 18px;margin:0 0 12px;";
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f6f8f7;"><div dir="rtl" style="font-family:Arial,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:18px 12px;color:#17302c;font-size:14px;line-height:1.55;">
<div style="${card}"><div style="font-size:19px;font-weight:bold;margin-bottom:6px;">${esc(title)}</div><div style="color:#61716e;">${esc(lede)}</div></div>
${sections.map((html) => `<div style="${card}">${html}</div>`).join("\n")}
${button ? `<div style="${card}"><a href="${button.href}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:10px;padding:10px 18px;">${esc(button.label)}</a></div>` : ""}
</div></body></html>`;
}

function ticketRows(tickets: BatchTicket[], detail: (t: BatchTicket) => string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tickets
    .map(
      (t, i) =>
        `<tr><td style="${i ? "border-top:1px solid #eef1f0;" : ""}padding:8px 0;vertical-align:top;width:72px;"><span dir="ltr" style="font-family:Consolas,monospace;font-size:12px;background:#eef1f0;border-radius:6px;padding:1px 6px;">TCK-${t.seq}</span></td>` +
        `<td style="${i ? "border-top:1px solid #eef1f0;" : ""}padding:8px 0;"><div style="font-weight:bold;" dir="auto">${esc(t.subject)}</div>${detail(t) ? `<div style="color:#61716e;font-size:13px;" dir="auto">${esc(detail(t))}</div>` : ""}</td></tr>`,
    )
    .join("")}</table>`;
}

/** After the night run: every ticket of the batch is fixed on dev or out - approve the promotion on the batch page. */
export function renderBatchReadyEmail(batch: Pick<Batch, "batch_date" | "tickets">, appUrl: string): { subject: string; html: string; text: string } {
  const built = batch.tickets.filter((t) => t.state === "built");
  const out = batch.tickets.filter((t) => t.state === "out");
  const date = ddmm(batch.batch_date);
  const subject = `דפי – החבילה מוכנה להעלאה: ${built.length === 1 ? "תיקון אחד" : `${built.length} תיקונים`} (חבילה ${date})`;
  const sections = [ticketRows(built, (t) => t.summary ?? t.reason)];
  if (out.length) sections.push(`<div style="font-weight:bold;margin-bottom:4px;">יצאו מהחבילה</div>${ticketRows(out, (t) => t.note ?? "")}`);
  const html = batchEmailShell(
    `${built.length === 1 ? "תיקון אחד מוכן" : `${built.length} תיקונים מוכנים`} ובדוקים`,
    `כולם נבנו על גרסת הייצור, עברו בדיקת קוד ומוזגו לסביבת הפיתוח.${out.length ? ` ${out.length === 1 ? "פנייה אחת יצאה" : `${out.length} פניות יצאו`} מהחבילה.` : ""} אפשר לבדוק קודם בפיתוח.`,
    sections,
    { href: `${appUrl}/app/tickets/batch`, label: "אישור העלאה בדף החבילה" },
  );
  const text = [subject, "", ...built.map((t) => `TCK-${t.seq}: ${t.subject}`), ...(out.length ? ["", "יצאו מהחבילה:", ...out.map((t) => `TCK-${t.seq}: ${t.note ?? ""}`)] : []), "", `${appUrl}/app/tickets/batch`].join("\n");
  return { subject, html, text };
}

/** After Promote resolved the batch's tickets: the batch is closed. */
export function renderBatchDoneEmail(batch: Pick<Batch, "batch_date" | "tickets" | "version">, appUrl: string): { subject: string; html: string; text: string } {
  const released = batch.tickets.filter((t) => t.state === "released");
  const out = batch.tickets.filter((t) => t.state === "out");
  // The version is isolated left-to-right (U+2066..U+2069) so "1.1.88" never reads backwards inside the Hebrew text.
  const version = batch.version ? `⁦${batch.version}⁩` : null;
  const subject = `דפי – החבילה הועלתה${version ? `: גרסה ${version}` : ""}, ${released.length === 1 ? "פנייה אחת טופלה" : `${released.length} פניות טופלו`}`;
  const sections = [ticketRows(released, () => "טופלה, ונשלחה הודעה על כך")];
  if (out.length) sections.push(`<div style="font-weight:bold;margin-bottom:4px;">ממתינות לך</div>${ticketRows(out, (t) => t.note ?? "")}`);
  const html = batchEmailShell(
    version ? `גרסה ${version} באוויר` : "החבילה הועלתה",
    `${released.length === 1 ? "פנייה אחת סומנה כפתורה" : `${released.length} פניות סומנו כפתורות`}. החבילה של ${ddmm(batch.batch_date)} נסגרה, והחבילה הבאה תוצע ב-16:00.`,
    sections,
    { href: `${appUrl}/app/tickets/batch`, label: "פתיחת דף החבילה" },
  );
  const text = [subject, "", ...released.map((t) => `TCK-${t.seq}: ${t.subject}`)].join("\n");
  return { subject, html, text };
}
