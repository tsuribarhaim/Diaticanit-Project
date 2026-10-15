import { busyAgent, busyAgentLabel, type BridgeHealth, type BusyAgent } from "@/lib/agent-lock";
import { loadActiveBatch, type Batch } from "@/lib/daily-batch";
import { tr, type AppLocale } from "@/lib/locale";
import type { createClient } from "@/lib/supabase/server";
import type { DeferReason, WorkOrder } from "@/lib/work-order";

/**
 * The control room (agreed 2026-10-15, mockup https://claude.ai/artifact/Dz82SQcXFcAQTKTWJYkJky): the whole automation in one
 * place - what runs now and what is locked, what waits in each queue, a 16:00 -> 16:00 timeline of who ran what, tonight's
 * work order, an activity log, and any ticket's journey. Read-only, admin-only, built from the tables the automation already
 * writes (runs, events, requests, proposals, batches, work orders).
 */

type Client = Awaited<ReturnType<typeof createClient>>;

export type Actor = "ai" | "auto" | "you" | "user";
export type Trigger = "schedule" | "manual" | "batch" | "auto";
export type Source = "batch" | "you" | "reopen" | "scan";
export type Tone = "ai" | "you" | "auto" | "amber" | "rose" | "green" | "batch" | "plain";

export type QueueItem = { ticketId: string; seq: number; subject: string; source: Source; chip?: { tone: Tone; text: string } };
export type Lane = { key: string; title: string; who: { actor: Actor; text: string }; sub: string; items: QueueItem[]; more?: string; empty: string; requests?: { what: string; seq: number | null; state: { tone: Tone; text: string } }[] };
export type TimelineBlock = { row: string; startH: number; lengthH: number; trigger: Trigger | "skip" | "wait"; label: string; title: string; who: string; result: string; cost: string };
export type LogEntry = { at: string; actor: Actor; who: string; text: string; ticketId?: string; seq?: number; subject?: string; cost?: string; tags: Trigger[] };
export type TonightJob = { position: number; seqs: number[]; ticketIds: string[]; subjects: string[]; bundleLetter: string | null; inBatch: boolean; files: string[]; migrationNumber: number | null; estimateUsd: number; risk: number; pulled: boolean; state: { tone: Tone; text: string } | null };
export type TonightDeferred = { ticketId: string; seq: number; subject: string; why: string };
export type ControlRoom = {
  now: {
    running: { label: string; detail: string | null; progress: number | null } | null;
    locks: { tone: Tone; text: string }[];
    next: { what: string; when: string; why: string; tone: Tone }[];
    waiting: { text: string; count: number }[];
  };
  lanes: Lane[];
  timeline: { from: string; to: string; nowH: number | null; rows: { key: string; title: string; kind: string }[]; blocks: TimelineBlock[] };
  tonight: { id: string; status: WorkOrder["status"]; nightDate: string; createdAt: string; plannedBy: WorkOrder["planned_by"]; baseRef: string | null; budgetUsd: number | null; estimateUsd: number | null; successEstimate: number | null; jobs: TonightJob[]; deferred: TonightDeferred[]; successRate: number | null } | null;
  history: { nightDate: string; rate: number }[];
  log: LogEntry[];
};

const IL = "Asia/Jerusalem";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: IL, hour: "2-digit", minute: "2-digit", hour12: false });
const ddmm = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: IL, day: "2-digit", month: "2-digit" });
const money = (usd: number | null | undefined) => (usd === null || usd === undefined ? "" : `$${Number(usd).toFixed(2)}`);
const ilParts = (d: Date) => {
  const s = d.toLocaleString("en-CA", { timeZone: IL, hour12: false });
  const [date, time] = s.split(", ");
  return { date, hour: Number(time.slice(0, 2)) % 24, minute: Number(time.slice(3, 5)) };
};

/** The automation day: 16:00 (the scan) to 16:00 the next day, in Israel time. dayOffset 1 = the one before. */
function automationDay(dayOffset: number): { from: Date; to: Date } {
  const now = new Date();
  const p = ilParts(now);
  const offsetMin = Math.round((Date.parse(`${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:00Z`) - now.getTime()) / 60000);
  const sixteenToday = new Date(Date.parse(`${p.date}T16:00:00Z`) - offsetMin * 60000);
  const from = new Date(sixteenToday.getTime() - (p.hour >= 16 ? 0 : 24 * 3600000) - dayOffset * 24 * 3600000);
  return { from, to: new Date(from.getTime() + 24 * 3600000) };
}

const KIND_ROW: Record<string, string> = { triage: "triage", analyst: "analyst", planner: "planner", night: "night" };

export async function getControlRoom(supabase: Client, locale: AppLocale, dayOffset = 0): Promise<ControlRoom> {
  const L = (en: string, he: string) => tr(locale, en, he);
  const day = automationDay(dayOffset);
  const since3d = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
  const [settingsR, ticketsR, runsR, eventsR, requestsR, proposalsR, batch, ordersR, historyR, batchesR] = await Promise.all([
    supabase.from("automation_settings").select("paused, bridge_seen_at, bridge_status").eq("id", true).maybeSingle(),
    supabase.from("tickets").select("id, ticket_seq, subject, status, auto_handle, bundle_id, created_at").or("auto_handle.not.is.null,status.in.(open,reopened)").order("ticket_seq"),
    supabase.from("automation_runs").select("kind, trigger, started_at, finished_at, tickets_count, cost_usd, result").gte("started_at", new Date(Math.min(day.from.getTime(), Date.parse(since3d))).toISOString()).order("started_at"),
    supabase.from("automation_events").select("ticket_id, kind, actor, detail, created_at").gte("created_at", since3d).order("created_at"),
    supabase.from("automation_requests").select("id, kind, ticket_id, requested_at, picked_at, completed_at, result, details").gte("requested_at", since3d).order("requested_at"),
    supabase.from("ticket_proposals").select("ticket_id, kind, status, created_at").gte("created_at", since3d).order("created_at"),
    loadActiveBatch(supabase),
    supabase.from("automation_work_orders").select("*").neq("status", "superseded").order("created_at", { ascending: false }).limit(1),
    supabase.from("automation_work_orders").select("night_date, success_rate").eq("status", "done").not("success_rate", "is", null).order("night_date", { ascending: false }).limit(10),
    supabase.from("automation_batches").select("batch_date, status, created_at, approved_at, ready_at, closed_at, tickets, triage_cost_usd").gte("created_at", since3d),
  ]);

  type T = { id: string; ticket_seq: number; subject: string; status: string; auto_handle: string | null; bundle_id: string | null; created_at: string };
  const tickets = (ticketsR.data ?? []) as T[];
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const events = (eventsR.data ?? []) as { ticket_id: string; kind: string; actor: string | null; detail: Record<string, unknown> | null; created_at: string }[];
  const requests = (requestsR.data ?? []) as { id: string; kind: string; ticket_id: string | null; requested_at: string; picked_at: string | null; completed_at: string | null; result: string | null; details: Record<string, unknown> | null }[];
  const proposals = (proposalsR.data ?? []) as { ticket_id: string; kind: string; status: string; created_at: string }[];
  const runs = (runsR.data ?? []) as { kind: string; trigger: Trigger | null; started_at: string; finished_at: string | null; tickets_count: number; cost_usd: number | null; result: string | null }[];
  const order = ((ordersR.data ?? [])[0] as WorkOrder | undefined) ?? null;

  // Missing tickets referenced by events/proposals (resolved meanwhile) are loaded for their names.
  const missing = [...new Set([...events.map((e) => e.ticket_id), ...proposals.map((p) => p.ticket_id)].filter((id) => id && !byId.has(id)))];
  if (missing.length) {
    const { data } = await supabase.from("tickets").select("id, ticket_seq, subject, status, auto_handle, bundle_id, created_at").in("id", missing);
    for (const t of (data ?? []) as T[]) byId.set(t.id, t);
  }

  const settings = settingsR.data as { paused: boolean; bridge_seen_at: string | null; bridge_status: BridgeHealth | null } | null;
  const fresh = Boolean(settings?.bridge_seen_at && Date.now() - Date.parse(settings.bridge_seen_at) < 3 * 60 * 1000);
  const busy: BusyAgent | null = busyAgent(settings?.bridge_status ?? null, fresh);
  const batchLive = new Set(batch && ["approved", "building", "ready", "promoting"].includes(batch.status) ? batch.tickets.filter((t) => !["unselected", "out"].includes(t.state)).map((t) => t.ticketId) : []);
  const reopenedAfterFix = new Set(events.filter((e) => e.kind === "reopened_after_fix").map((e) => e.ticket_id));
  const sourceOf = (t: T): Source => (batchLive.has(t.id) ? "batch" : t.status === "reopened" || reopenedAfterFix.has(t.id) ? "reopen" : t.auto_handle ? "you" : "scan");
  const item = (t: T, chip?: QueueItem["chip"]): QueueItem => ({ ticketId: t.id, seq: t.ticket_seq, subject: t.subject, source: sourceOf(t), chip });
  const live = tickets.filter((t) => ["open", "reopened"].includes(t.status) || ["D", "M", "R"].includes(t.auto_handle ?? ""));
  const flagged = (flag: string) => live.filter((t) => t.auto_handle === flag);
  const pendingQuestions = new Set(proposals.filter((p) => p.kind === "questions" && p.status === "pending").map((p) => p.ticket_id));

  // ---- now
  const jobStateOf = (ids: string[]): TonightJob["state"] => {
    const flags = ids.map((id) => byId.get(id)?.auto_handle ?? null);
    if (flags.every((f) => f === "M" || f === "R")) return { tone: "green", text: L("Merged to dev", "מוזג לפיתוח") };
    if (flags.some((f) => f === "D")) return { tone: "amber", text: L("Built, not merged", "נבנה, לא מוזג") };
    if (flags.some((f) => f === "P")) return busy === "night" && !ids.some((id) => pendingQuestions.has(id)) ? { tone: "ai", text: L("Being built now", "נבנית עכשיו") } : { tone: "amber", text: L("Stopped with a question", "נעצרה עם שאלה") };
    if (flags.some((f) => f === "S" || f === "A")) return { tone: "rose", text: L("Back to the analyst", "חזרה לאנליסט") };
    return { tone: "plain", text: L("Queued", "בתור") };
  };
  let running: ControlRoom["now"]["running"] = null;
  if (busy) {
    const label = busyAgentLabel(busy, locale);
    let detail: string | null = null;
    let progress: number | null = null;
    if (busy === "night" && order && order.status === "running") {
      const planned = order.jobs.filter((j) => !j.pulled);
      const done = planned.filter((j) => ["green", "amber"].includes(jobStateOf(j.ticketIds)?.tone ?? "")).length;
      const now = planned.find((j) => jobStateOf(j.ticketIds)?.tone === "ai");
      detail = L(`Job ${Math.min(done + 1, planned.length)} of ${planned.length}`, `משימה ${Math.min(done + 1, planned.length)} מתוך ${planned.length}`) + (now ? ` · TCK-${now.seqs.join("+")}` : "");
      progress = planned.length ? done / planned.length : null;
    }
    running = { label: label.charAt(0).toUpperCase() + label.slice(1), detail, progress };
  }
  const locks: ControlRoom["now"]["locks"] = [];
  if (batch && ["approved", "building", "ready", "promoting"].includes(batch.status)) locks.push({ tone: "batch", text: L(`Batch ${ddmm(batch.batch_date)} in progress - manual runs locked`, `חבילה ${ddmm(batch.batch_date)} בתהליך - הפעלה ידנית נעולה`) });
  locks.push(fresh ? { tone: "green", text: L("Bridge online", "הגשר מחובר") } : { tone: "rose", text: L("Bridge offline", "הגשר כבוי") });
  locks.push(settings?.paused ? { tone: "rose", text: L("Paused", "מושהית") } : { tone: "plain", text: L("Pause: off", "השהיה: כבויה") });
  const next: ControlRoom["now"]["next"] = [
    { what: L("Daily digest", "סיכום יומי"), when: "07:00", why: L("schedule", "לוח זמנים"), tone: "auto" },
    { what: L("Batch scan", "סריקת חבילה"), when: "16:00", why: batch && ["approved", "building", "ready", "promoting"].includes(batch.status) ? L("skips: batch in progress", "תדלג: חבילה בתהליך") : L("schedule", "לוח זמנים"), tone: "ai" },
    { what: L("Analyst", "אנליסט"), when: "18:00", why: L("schedule", "לוח זמנים"), tone: "ai" },
    { what: L("Night planner", "מתכנן הלילה"), when: L("after the analyst", "אחרי האנליסט"), why: L("automatic, no AI", "אוטומטי, בלי AI"), tone: "auto" },
    { what: L("Night run", "ריצת לילה"), when: "02:15", why: L("by tonight's plan", "לפי תוכנית הלילה"), tone: "ai" },
  ];
  const waiting = [
    { text: L("Proposals to approve", "הצעות לאישור"), count: flagged("A").length },
    { text: L("Questions from the night run", "שאלות מריצת הלילה"), count: flagged("P").filter((t) => pendingQuestions.has(t.id)).length },
    { text: L("Fixes to test on dev", "תיקונים לבדיקה בפיתוח"), count: flagged("M").filter((t) => !batchLive.has(t.id)).length + flagged("D").length },
    { text: L("Ready to promote", "מוכן להעלאה"), count: flagged("R").length + (batch?.status === "ready" ? 1 : 0) },
  ];

  // ---- lanes
  const scanCandidates = live.filter((t) => !t.auto_handle && ["open", "reopened"].includes(t.status));
  const orderPlace = new Map<string, number>();
  for (const j of order && order.status !== "done" ? order.jobs : []) for (const id of j.ticketIds) orderPlace.set(id, j.position);
  const deferredWhy = new Map((order && order.status !== "done" ? order.deferred : []).map((d) => [d.ticketId, d]));
  const lanes: Lane[] = [
    {
      key: "triage",
      title: L("Batch scan", "סריקת חבילה"),
      who: { actor: "ai", text: L("AI agent · 16:00", "סוכן AI · 16:00") },
      sub: L("Open tickets the scan will consider (it leaves out ones you handled yourself lately).", "פניות פתוחות שהסריקה תשקול (בלי אלה שטיפלת בהן בעצמך לאחרונה)."),
      items: scanCandidates.slice(0, 4).map((t) => item(t)),
      more: scanCandidates.length > 4 ? L(`and ${scanCandidates.length - 4} more`, `ועוד ${scanCandidates.length - 4}`) : undefined,
      empty: L("No open tickets outside the automation.", "אין פניות פתוחות מחוץ לאוטומציה."),
    },
    {
      key: "analyst",
      title: L("Analyst", "אנליסט"),
      who: { actor: "ai", text: L("AI agent · 18:00", "סוכן AI · 18:00") },
      sub: L("Waiting for analysis. Proposals for the daily batch are approved automatically.", "ממתינות לניתוח. הצעות של החבילה מאושרות אוטומטית."),
      items: flagged("S").map((t) => item(t, events.some((e) => e.ticket_id === t.id && e.kind === "requeued" && (e.detail as { reason?: string } | null)?.reason === "stale") ? { tone: "amber", text: L("Code changed - analysed again", "הקוד השתנה - ניתוח חוזר") } : undefined)),
      empty: L("Nothing waits for the analyst.", "אין כלום שממתין לאנליסט."),
    },
    {
      key: "night",
      title: L("Night run", "ריצת לילה"),
      who: { actor: "ai", text: L("AI agent · 02:15", "סוכן AI · 02:15") },
      sub: L("By tonight's plan.", "לפי תוכנית הלילה."),
      items: [
        ...flagged("Y")
          .concat(flagged("P").filter((t) => !pendingQuestions.has(t.id)))
          .sort((a, b) => (orderPlace.get(a.id) ?? 99) - (orderPlace.get(b.id) ?? 99) || a.ticket_seq - b.ticket_seq)
          .map((t) => {
            const place = orderPlace.get(t.id);
            const d = deferredWhy.get(t.id);
            if (t.auto_handle === "P") return item(t, { tone: "ai", text: L("Being built now", "נבנית עכשיו") });
            if (place) return item(t, { tone: "plain", text: L(`Job ${place}`, `משימה ${place}`) });
            if (d) return item(t, { tone: d.reason === "budget" || d.reason === "pulled" ? "amber" : "rose", text: deferText(d.reason, d.waitsFor, locale) });
            return item(t, { tone: "plain", text: L("Waits for tonight's plan", "ממתינה לתוכנית הלילה") });
          }),
      ],
      empty: L("Nothing is queued for the night run.", "אין כלום בתור לריצת הלילה."),
    },
    {
      key: "you",
      title: L("Waiting for you", "ממתין לך"),
      who: { actor: "you", text: L("You", "את/ה") },
      sub: L("Only you can move these on.", "רק את/ה יכול/ה להעביר אותן הלאה."),
      items: [
        ...flagged("A").map((t) => item(t, { tone: "you", text: L("Proposal to approve", "הצעה לאישור") })),
        ...flagged("P").filter((t) => pendingQuestions.has(t.id)).map((t) => item(t, { tone: "amber", text: L("Question from the night run", "שאלה מריצת הלילה") })),
        ...flagged("D").map((t) => item(t, { tone: "amber", text: L("Built, merge it to dev", "נבנה, למזג לפיתוח") })),
        ...flagged("M").filter((t) => !batchLive.has(t.id)).map((t) => item(t, { tone: "you", text: L("Test on dev", "לבדוק בפיתוח") })),
      ],
      empty: L("Nothing waits for you.", "שום דבר לא ממתין לך."),
    },
    {
      key: "promote",
      title: L("Promotion", "העלאה לייצור"),
      who: { actor: "auto", text: L("Automation · when you approve", "אוטומציה · כשתאשר/י") },
      sub: L("Fixes approved for production. During a daily batch they go out with it.", "תיקונים שאושרו לייצור. בזמן חבילה הם עולים איתה."),
      items: [...flagged("R"), ...(batch?.status === "ready" ? flagged("M").filter((t) => batchLive.has(t.id)) : [])].map((t) => item(t, batchLive.has(t.id) ? { tone: "batch", text: L("In the ready batch", "בחבילה המוכנה") } : { tone: "green", text: L("Approved", "אושר") })),
      empty: L("Nothing is waiting to be promoted.", "אין כרגע שום דבר שממתין להעלאה."),
    },
    {
      key: "requests",
      title: L("Requests to the laptop", "בקשות למחשב הנייד"),
      who: { actor: "auto", text: L("The bridge", "הגשר") },
      sub: L("What you asked in the app, done on the laptop (last 24 hours).", "מה שביקשת באפליקציה ובוצע במחשב (24 השעות האחרונות)."),
      items: [],
      requests: requests
        .filter((r) => Date.parse(r.requested_at) > Date.now() - 24 * 3600000 && r.kind !== "digest")
        .slice(-6)
        .reverse()
        .map((r) => ({
          what: requestLabel(r.kind, r.details, locale),
          seq: r.ticket_id ? byId.get(r.ticket_id)?.ticket_seq ?? null : null,
          state: r.completed_at ? { tone: "green" as Tone, text: L(`Done ${hm(r.completed_at)}`, `בוצע ${hm(r.completed_at)}`) } : r.picked_at ? { tone: "ai" as Tone, text: L("Running", "מתבצע") } : { tone: "amber" as Tone, text: L("Waiting for the laptop", "ממתין למחשב") },
        })),
      empty: L("No requests in the last 24 hours.", "אין בקשות ב-24 השעות האחרונות."),
    },
  ];

  // ---- timeline (hours from the day's 16:00)
  const H = (iso: string) => (Date.parse(iso) - day.from.getTime()) / 3600000;
  const inDay = (iso: string) => Date.parse(iso) >= day.from.getTime() && Date.parse(iso) < day.to.getTime();
  const runName: Record<string, [string, string]> = { triage: ["Batch scan", "סריקת חבילה"], analyst: ["Analyst", "אנליסט"], planner: ["Night planner", "מתכנן הלילה"], night: ["Night run", "ריצת לילה"] };
  const trigText = (t: Trigger | null, at: string) =>
    t === "manual" ? L(`You started it ${hm(at)}`, `הפעלת ידנית ${hm(at)}`) : t === "batch" ? L("For the daily batch", "עבור החבילה היומית") : t === "auto" ? L("Automatically", "אוטומטית") : L(`Schedule ${hm(at)}`, `לוח זמנים ${hm(at)}`);
  const blocks: TimelineBlock[] = [];
  for (const r of runs.filter((r) => inDay(r.started_at) && KIND_ROW[r.kind])) {
    const end = r.finished_at ?? r.started_at;
    const skipped = /^Skipped/i.test(r.result ?? "");
    const waited = /waited \d+ min/i.test(r.result ?? "");
    blocks.push({
      row: KIND_ROW[r.kind],
      startH: H(r.started_at),
      lengthH: Math.max(0.05, (Date.parse(end) - Date.parse(r.started_at)) / 3600000),
      trigger: skipped ? "skip" : waited ? "wait" : (r.trigger ?? "schedule"),
      label: skipped ? L("skipped", "דילג") : r.tickets_count ? String(r.tickets_count) : "",
      title: L(runName[r.kind][0], runName[r.kind][1]),
      who: trigText(r.trigger, r.started_at),
      result: r.result ?? "",
      cost: money(r.cost_usd) || "—",
    });
  }
  for (const r of requests.filter((r) => r.kind === "promote" && r.picked_at && inDay(r.picked_at))) {
    const report = (r.details as { report?: { version?: string; ok?: boolean } } | null)?.report;
    blocks.push({ row: "promote", startH: H(r.picked_at!), lengthH: Math.max(0.1, (Date.parse(r.completed_at ?? new Date().toISOString()) - Date.parse(r.picked_at!)) / 3600000), trigger: "auto", label: report?.version ?? "", title: L("Promotion", "העלאה לייצור"), who: L(`You approved it ${hm(r.requested_at)}`, `אישרת ${hm(r.requested_at)}`), result: report ? (report.ok ? L(`Version ${report.version} is live`, `גרסה ${report.version} באוויר`) : L("Failed and rolled back", "נכשלה וחזרה לאחור")) : L("In progress", "בתהליך"), cost: "—" });
  }
  for (const e of events.filter((e) => inDay(e.created_at) && actorOf(e) === "you")) {
    const t = byId.get(e.ticket_id);
    blocks.push({ row: "you", startH: H(e.created_at), lengthH: 0.08, trigger: "manual", label: "", title: eventText(e.kind, locale) + (t ? ` TCK-${t.ticket_seq}` : ""), who: L(`You, ${hm(e.created_at)}`, `את/ה, ${hm(e.created_at)}`), result: t?.subject ?? "", cost: "—" });
  }
  for (const b of (batchesR.data ?? []) as Pick<Batch, "batch_date" | "approved_at">[]) {
    if (b.approved_at && inDay(b.approved_at)) blocks.push({ row: "you", startH: H(b.approved_at), lengthH: 0.08, trigger: "batch", label: "", title: L(`You approved batch ${ddmm(b.batch_date)}`, `אישרת את חבילה ${ddmm(b.batch_date)}`), who: L(`You, ${hm(b.approved_at)}`, `את/ה, ${hm(b.approved_at)}`), result: "", cost: "—" });
  }
  const nowH = dayOffset === 0 ? H(new Date().toISOString()) : null;
  const timeline = {
    from: day.from.toISOString(),
    to: day.to.toISOString(),
    nowH,
    rows: [
      { key: "triage", title: L("Batch scan", "סריקת חבילה"), kind: L("AI agent", "סוכן AI") },
      { key: "analyst", title: L("Analyst", "אנליסט"), kind: L("AI agent", "סוכן AI") },
      { key: "planner", title: L("Planner", "מתכנן"), kind: L("Automation", "אוטומציה") },
      { key: "night", title: L("Night run", "ריצת לילה"), kind: L("AI agent", "סוכן AI") },
      { key: "promote", title: L("Promotion", "העלאה"), kind: L("Automation", "אוטומציה") },
      { key: "you", title: L("You", "את/ה"), kind: "" },
    ],
    blocks,
  };

  // ---- tonight
  const tonight: ControlRoom["tonight"] = order
    ? {
        id: order.id,
        status: order.status,
        nightDate: order.night_date,
        createdAt: order.created_at,
        plannedBy: order.planned_by,
        baseRef: order.base_ref,
        budgetUsd: order.budget_usd === null ? null : Number(order.budget_usd),
        estimateUsd: order.estimate_usd === null ? null : Number(order.estimate_usd),
        successEstimate: order.success_estimate === null ? null : Number(order.success_estimate),
        successRate: order.success_rate === null ? null : Number(order.success_rate),
        jobs: order.jobs.map((j) => ({ ...j, pulled: Boolean(j.pulled), state: j.pulled ? null : order.status === "planned" ? null : jobStateOf(j.ticketIds) })),
        deferred: order.deferred.map((d) => ({ ticketId: d.ticketId, seq: d.seq, subject: d.subject, why: deferText(d.reason, d.waitsFor, locale, d.detail) })),
      }
    : null;
  const history = ((historyR.data ?? []) as { night_date: string; success_rate: number }[]).map((h) => ({ nightDate: h.night_date, rate: Number(h.success_rate) })).reverse();

  // ---- log (last 3 days)
  const log: LogEntry[] = [];
  const tk = (id: string | null | undefined) => {
    const t = id ? byId.get(id) : undefined;
    return t ? { ticketId: t.id, seq: t.ticket_seq, subject: t.subject } : {};
  };
  for (const r of runs.filter((r) => r.started_at >= since3d)) {
    const name = runName[r.kind] ?? [r.kind, r.kind];
    log.push({ at: r.finished_at ?? r.started_at, actor: r.kind === "planner" ? "auto" : "ai", who: L(name[0], name[1]), text: r.result ?? "", cost: r.cost_usd ? money(r.cost_usd) : undefined, tags: [r.trigger ?? "schedule"] });
  }
  for (const p of proposals) {
    const text = p.kind === "proposal" ? L("wrote a proposal for", "כתב הצעה ל-") : p.kind === "fix" ? L("built a fix for", "בנתה תיקון ל-") : p.kind === "questions" ? L("stopped with questions on", "נעצרה עם שאלות על") : "";
    if (!text) continue;
    log.push({ at: p.created_at, actor: "ai", who: p.kind === "proposal" ? L("Analyst", "אנליסט") : L("Night run", "ריצת לילה"), text, ...tk(p.ticket_id), tags: batchLive.has(p.ticket_id) ? ["batch"] : [] });
  }
  for (const e of events) {
    const actor = actorOf(e);
    log.push({ at: e.created_at, actor, who: actor === "auto" ? L("Planner", "מתכנן") : actor === "user" ? L("Reporter", "מדווח/ת") : L("You", "את/ה"), text: eventText(e.kind, locale, e.detail), ...tk(e.ticket_id), tags: (e.detail as { batchId?: string } | null)?.batchId ? ["batch"] : actor === "you" ? ["manual"] : [] });
  }
  for (const b of (batchesR.data ?? []) as (Pick<Batch, "batch_date" | "status" | "created_at" | "approved_at" | "ready_at" | "closed_at" | "tickets"> & { triage_cost_usd: number | null })[]) {
    const date = ddmm(b.batch_date);
    log.push({ at: b.created_at, actor: "ai", who: L("Batch scan", "סריקת חבילה"), text: L(`suggested ${b.tickets.length} tickets for batch ${date} and emailed you`, `הציעה ${b.tickets.length} פניות לחבילה ${date} ושלחה לך מייל`), cost: b.triage_cost_usd ? money(b.triage_cost_usd) : undefined, tags: ["batch"] });
    if (b.approved_at) log.push({ at: b.approved_at, actor: "you", who: L("You", "את/ה"), text: L(`approved batch ${date}`, `אישרת את חבילה ${date}`), tags: ["batch"] });
    if (b.ready_at) log.push({ at: b.ready_at, actor: "auto", who: L("Automation", "אוטומציה"), text: L(`batch ${date} is ready to promote (email sent)`, `חבילה ${date} מוכנה להעלאה (נשלח מייל)`), tags: ["batch"] });
    if (b.closed_at) log.push({ at: b.closed_at, actor: "auto", who: L("Automation", "אוטומציה"), text: L(`batch ${date} closed (${b.status})`, `חבילה ${date} נסגרה (${b.status})`), tags: ["batch"] });
  }
  for (const r of requests.filter((r) => r.kind === "promote" && r.completed_at)) {
    const report = (r.details as { report?: { version?: string; ok?: boolean; tickets?: unknown[] } } | null)?.report;
    log.push({ at: r.completed_at!, actor: "auto", who: L("Promotion", "העלאה לייצור"), text: report?.ok ? L(`version ${report.version} is live (${report.tickets?.length ?? 0} tickets, reporters told)`, `גרסה ${report.version} באוויר (${report.tickets?.length ?? 0} פניות, המדווחים קיבלו הודעה)`) : L("failed and was rolled back", "נכשלה וחזרה לאחור"), tags: [] });
  }
  for (const t of tickets.filter((t) => t.created_at >= since3d)) log.push({ at: t.created_at, actor: "user", who: L("Reporter", "מדווח/ת"), text: L("reported", "דיווח/ה על"), ticketId: t.id, seq: t.ticket_seq, subject: t.subject, tags: [] });
  log.sort((a, b) => b.at.localeCompare(a.at));

  return { now: { running, locks, next, waiting }, lanes, timeline, tonight, history, log: log.slice(0, 300) };
}

function actorOf(e: { kind: string; detail: Record<string, unknown> | null }): Actor {
  if ((e.detail as { by?: string } | null)?.by === "planner") return "auto";
  if (e.kind === "reopened_after_fix") return "user";
  return "you";
}

function eventText(kind: string, locale: AppLocale, detail?: Record<string, unknown> | null): string {
  const L = (en: string, he: string) => tr(locale, en, he);
  const d = (detail ?? {}) as { reason?: string; letter?: string; by?: string };
  switch (kind) {
    case "marked": return d && (detail as { batchId?: string } | null)?.batchId ? L("added to the daily batch", "הוספת לחבילה היומית") : L("marked for automation", "סימנת לאוטומציה");
    case "spec_approved": return L("approved the proposal of", "אישרת את ההצעה של");
    case "change_requested": return L("asked for changes to the proposal of", "ביקשת שינוי בהצעה של");
    case "rejected": return L("rejected the proposal of", "דחית את ההצעה של");
    case "answered": return L("answered the night run's question on", "ענית על שאלת ריצת הלילה על");
    case "sent_back": return L("sent back the fix of", "החזרת את התיקון של");
    case "returned": return L("returned the fix of", "החזרת את התיקון של");
    case "approved_for_production": return L("approved for production", "אישרת לייצור את");
    case "approval_withdrawn": return L("withdrew the production approval of", "ביטלת את האישור לייצור של");
    case "promote_requested": return L("requested a promotion with", "ביקשת העלאה עם");
    case "merge_requested": return L("asked to merge to dev", "ביקשת מיזוג לפיתוח של");
    case "taken_out": return L("took out of automation", "הוצאת מהאוטומציה את");
    case "handled_by_hand": return L("handled by hand", "טיפלת ידנית ב-");
    case "bundle_created": return d.by === "planner" ? L(`bundled (bundle ${d.letter ?? ""}, same files)`, `איחד לחבילה ${d.letter ?? ""} (אותם קבצים)`) : L(`bundled (bundle ${d.letter ?? ""})`, `איחדת לחבילה ${d.letter ?? ""}`);
    case "bundle_split": return L("split the bundle of", "פיצלת את החבילה של");
    case "requeued": return d.reason === "stale" ? L("sent back to the analyst (code changed since the analysis):", "החזיר לאנליסט (הקוד השתנה מאז הניתוח):") : L("put back in the queue", "החזרת לתור את");
    case "reopened_after_fix": return L("reopened after the fix:", "פתח/ה מחדש אחרי התיקון:");
    case "overlap_override": return L("said to build without waiting:", "ביקשת לבנות בלי להמתין:");
    default: return kind.replace(/_/g, " ");
  }
}

function requestLabel(kind: string, details: Record<string, unknown> | null, locale: AppLocale): string {
  const L = (en: string, he: string) => tr(locale, en, he);
  if (kind === "analyze") return (details as { batchId?: string } | null)?.batchId ? L("Analyst (for the batch)", "אנליסט (עבור החבילה)") : L("Analyst (by hand)", "אנליסט (ידני)");
  if (kind === "night") return L("Night run (by hand)", "ריצת לילה (ידני)");
  if (kind === "merge") return L("Merge to dev", "מיזוג לפיתוח");
  if (kind === "revert") return L("Undo a merge", "ביטול מיזוג");
  if (kind === "promote") return L("Promotion", "העלאה לייצור");
  if (kind === "learn") return L("Lesson for the agents", "לקח לסוכנים");
  if (kind === "invite") return L("Invitation email", "מייל הזמנה");
  return kind;
}

export function deferText(reason: DeferReason, waitsFor: number[], locale: AppLocale, detail = ""): string {
  const L = (en: string, he: string) => tr(locale, en, he);
  const list = waitsFor.map((seq) => `TCK-${seq}`).join(", ");
  switch (reason) {
    case "held_fix": return L(`Waits for ${list}: same files, its fix is not in production yet.`, `ממתינה ל-${list}: אותם קבצים, התיקון שלה עוד לא בייצור.`);
    case "held_queue": return L(`Waits for ${list}: same files, built first.`, `ממתינה ל-${list}: אותם קבצים, היא נבנית קודם.`);
    case "bundle_partner": return L(`Its bundle partner ${list} is not approved yet.`, `השותפה שלה לחבילה ${list} עוד לא אושרה.`);
    case "stale": return L(`Code changed since the analysis${detail ? ` (${detail})` : ""} - back to the analyst.`, `הקוד השתנה מאז הניתוח${detail ? ` (${detail})` : ""} - חזרה לאנליסט.`);
    case "budget": return L(`Over tonight's budget${detail ? ` (${detail})` : ""} - the next night.`, `מעבר לתקציב הלילה${detail ? ` (${detail})` : ""} - בלילה הבא.`);
    case "pulled": return L("You pulled it out of tonight.", "הוצאת אותה מהלילה.");
    default: return "";
  }
}

export type JourneyStep = { at: string; actor: Actor; who: string; text: string };

/** One ticket's whole way through the automation, oldest first: reported, picked, analysed, approved, planned, built, released. */
export async function getTicketJourney(supabase: Client, locale: AppLocale, ticketId: string): Promise<{ seq: number; subject: string; steps: JourneyStep[] } | null> {
  const L = (en: string, he: string) => tr(locale, en, he);
  const { data: t } = await supabase.from("tickets").select("id, ticket_seq, subject, created_at, status, resolved_at").eq("id", ticketId).maybeSingle();
  if (!t) return null;
  const [eventsR, proposalsR, batchesR, ordersR, promotesR] = await Promise.all([
    supabase.from("automation_events").select("kind, detail, created_at").eq("ticket_id", ticketId).order("created_at"),
    supabase.from("ticket_proposals").select("kind, status, created_at, decided_at").eq("ticket_id", ticketId).order("created_at"),
    supabase.from("automation_batches").select("batch_date, created_at, approved_at, tickets").contains("tickets", [{ ticketId }]),
    supabase.from("automation_work_orders").select("night_date, created_at, status, jobs, outcome").contains("jobs", [{ ticketIds: [ticketId] }]).neq("status", "superseded"),
    supabase.from("automation_requests").select("completed_at, details").eq("kind", "promote").not("completed_at", "is", null).contains("details", { tickets: [{ ticketId }] }),
  ]);
  const steps: JourneyStep[] = [{ at: t.created_at as string, actor: "user", who: L("Reporter", "מדווח/ת"), text: L("reported the ticket", "דיווח/ה על הפנייה") }];
  for (const b of (batchesR.data ?? []) as Pick<Batch, "batch_date" | "created_at" | "approved_at" | "tickets">[]) {
    const m = b.tickets.find((x) => x.ticketId === ticketId);
    steps.push({ at: b.created_at, actor: "ai", who: L("Batch scan", "סריקת חבילה"), text: L(`picked it for batch ${ddmm(b.batch_date)}`, `בחרה אותה לחבילה ${ddmm(b.batch_date)}`) + (m?.reason ? `: "${m.reason}"` : "") });
    if (b.approved_at && m && m.state !== "unselected") steps.push({ at: b.approved_at, actor: "you", who: L("You", "את/ה"), text: L("approved the batch", "אישרת את החבילה") });
  }
  for (const e of (eventsR.data ?? []) as { kind: string; detail: Record<string, unknown> | null; created_at: string }[]) {
    if (e.kind === "marked" && (e.detail as { batchId?: string } | null)?.batchId) continue;
    const actor = actorOf(e);
    steps.push({ at: e.created_at, actor, who: actor === "auto" ? L("Planner", "מתכנן") : actor === "user" ? L("Reporter", "מדווח/ת") : L("You", "את/ה"), text: eventText(e.kind, locale, e.detail).replace(/[:\s]+$/, "") });
  }
  for (const p of (proposalsR.data ?? []) as { kind: string; status: string; created_at: string; decided_at: string | null }[]) {
    if (p.kind === "proposal") steps.push({ at: p.created_at, actor: "ai", who: L("Analyst", "אנליסט"), text: L("wrote a proposal", "כתב הצעה") + (p.status === "approved" ? L(" (approved)", " (אושרה)") : "") });
    if (p.kind === "questions") steps.push({ at: p.created_at, actor: "ai", who: L("Night run", "ריצת לילה"), text: L("stopped with questions", "נעצרה עם שאלות") });
    if (p.kind === "fix") steps.push({ at: p.created_at, actor: "ai", who: L("Night run", "ריצת לילה"), text: L("built the fix", "בנתה את התיקון") + (["merged", "approved", "released"].includes(p.status) ? L(" and merged it to dev", " ומיזגה לפיתוח") : "") });
  }
  for (const o of (ordersR.data ?? []) as Pick<WorkOrder, "night_date" | "created_at" | "jobs">[]) {
    const job = o.jobs.find((j) => j.ticketIds.includes(ticketId));
    if (job) steps.push({ at: o.created_at, actor: "auto", who: L("Planner", "מתכנן"), text: L(`job ${job.position} for the night of ${ddmm(o.night_date)}`, `משימה ${job.position} ללילה של ${ddmm(o.night_date)}`) + (job.pulled ? L(" (you pulled it out)", " (הוצאת אותה)") : "") });
  }
  for (const r of (promotesR.data ?? []) as { completed_at: string; details: { report?: { version?: string; ok?: boolean } } | null }[]) {
    const report = r.details?.report;
    steps.push({ at: r.completed_at, actor: "auto", who: L("Promotion", "העלאה לייצור"), text: report?.ok ? L(`released in version ${report.version}`, `עלתה בגרסה ${report.version}`) : L("the promotion failed and was rolled back", "ההעלאה נכשלה וחזרה לאחור") });
  }
  steps.sort((a, b) => a.at.localeCompare(b.at));
  return { seq: t.ticket_seq as number, subject: t.subject as string, steps };
}
