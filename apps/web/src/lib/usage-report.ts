/**
 * The weekly usage report e-mail (Hebrew, RTL): who used Daffy last week and how, from the heaviest user to the people who
 * did not open it at all, plus a few people worth a message. n8n's "Daffy - Weekly Usage Report" workflow calls
 * /api/admin/usage-report every Sunday morning and mails the result; that route only reads the rows, everything that
 * decides what the e-mail says lives here (pure functions, so it can be checked without a database).
 *
 * The week is the previous Sunday-to-Saturday in Israel time. Test and bot accounts are left out by the route.
 */

export type UsagePerson = { id: string; name: string; joinedAt: string; lastActiveAt: string | null };
export type UsageReport = { userId: string; at: string; food: boolean; weight: boolean; exercise: boolean };
export type UsageRow = { userId: string; at: string };

export type UsageInput = {
  now: Date;
  people: UsagePerson[];
  /** Daily reports from a little before the week until now (the window is cut here). */
  reports: UsageReport[];
  /** Each person's latest daily report ever (or within a long lookback), for "last reported on". */
  lastReportAt: Record<string, string>;
  targetPlans: (UsageRow & { ai: boolean })[];
  targetRequests: UsageRow[];
  savedListAdded: UsageRow[];
  savedListEdited: UsageRow[];
  notifications: (UsageRow & { read: boolean })[];
  ticketsOpened: UsageRow[];
  /** One row per dated update a ticket's creator added to their ticket. */
  ticketUpdates: UsageRow[];
};

export type Tier = "heavy" | "light" | "opened" | "inactive";

export type PersonWeek = {
  person: UsagePerson;
  tier: Tier;
  reports: number;
  perDay: number[];
  food: number;
  weight: number;
  exercise: number;
  targetPlans: number;
  targetPlansByAi: number;
  targetRequests: number;
  savedListAdded: number;
  savedListEdited: number;
  notifications: number;
  notificationsRead: number;
  ticketsOpened: number;
  ticketUpdates: number;
  joinedThisWeek: boolean;
};

export type UsageWeek = {
  days: string[];
  start: string;
  end: string;
  people: PersonWeek[];
  totals: { people: number; active: number; reports: number; weight: number; weightPeople: number; tickets: number; ticketPeople: number; joined: number };
  suggestions: string[];
};

const TZ = "Asia/Jerusalem";
/** Heavy: at least this many reports, on at least this many different days of the week. */
const HEAVY_REPORTS = 10;
const HEAVY_DAYS = 4;
/** "Has not reported for a while" and "away for a long time", in days. */
const QUIET_DAYS = 3;
const AWAY_DAYS = 10;

const israelDate = (value: string | Date) => new Date(value).toLocaleDateString("en-CA", { timeZone: TZ });
const shiftDate = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const daysBetweenDates = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
const ddmm = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
const timeOf = (value: string) => new Date(value).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const HEB_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const weekdayOf = (isoDate: string) => HEB_DAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];

export function computeUsageWeek(input: UsageInput): UsageWeek {
  const today = israelDate(input.now);
  // Last full week: the 7 days before today (sent on Sunday, that is Sunday to Saturday).
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(today, i - 7));
  const start = days[0];
  const end = days[6];
  const inWeek = (at: string) => {
    const d = israelDate(at);
    return d >= start && d <= end;
  };
  const countFor = (rows: UsageRow[], id: string) => rows.filter((row) => row.userId === id && inWeek(row.at)).length;

  const people: PersonWeek[] = input.people.map((person) => {
    const mine = input.reports.filter((r) => r.userId === person.id && inWeek(r.at));
    const perDay = days.map((d) => mine.filter((r) => israelDate(r.at) === d).length);
    const plans = input.targetPlans.filter((row) => row.userId === person.id && inWeek(row.at));
    const notes = input.notifications.filter((row) => row.userId === person.id && inWeek(row.at));
    const activeInWeek = Boolean(person.lastActiveAt && israelDate(person.lastActiveAt) >= start);
    const reportDays = perDay.filter((n) => n > 0).length;
    const tier: Tier = mine.length >= HEAVY_REPORTS && reportDays >= HEAVY_DAYS ? "heavy" : mine.length > 0 ? "light" : activeInWeek ? "opened" : "inactive";
    return {
      person,
      tier,
      reports: mine.length,
      perDay,
      food: mine.filter((r) => r.food).length,
      weight: mine.filter((r) => r.weight).length,
      exercise: mine.filter((r) => r.exercise).length,
      targetPlans: plans.length,
      targetPlansByAi: plans.filter((row) => row.ai).length,
      targetRequests: countFor(input.targetRequests, person.id),
      savedListAdded: countFor(input.savedListAdded, person.id),
      savedListEdited: countFor(input.savedListEdited, person.id),
      notifications: notes.length,
      notificationsRead: notes.filter((row) => row.read).length,
      ticketsOpened: countFor(input.ticketsOpened, person.id),
      ticketUpdates: countFor(input.ticketUpdates, person.id),
      joinedThisWeek: israelDate(person.joinedAt) >= start && israelDate(person.joinedAt) <= end,
    };
  });

  const order: Record<Tier, number> = { heavy: 0, light: 1, opened: 2, inactive: 3 };
  people.sort((a, b) => order[a.tier] - order[b.tier] || b.reports - a.reports || (b.person.lastActiveAt ?? "").localeCompare(a.person.lastActiveAt ?? ""));

  const suggestions: string[] = [];
  for (const week of people) {
    const name = week.person.name;
    const last = input.lastReportAt[week.person.id];
    if (week.joinedThisWeek && week.reports === 0) {
      suggestions.push(`${name}: הצטרפות ב-${ddmm(israelDate(week.person.joinedAt))}, ועדיין אין דיווח ראשון. כדאי לשלוח הסבר קצר איך מדווחים.`);
    } else if (week.reports > 0 && last && daysBetweenDates(israelDate(last), end) >= QUIET_DAYS) {
      suggestions.push(`${name}: הדיווח האחרון היה ב-${ddmm(israelDate(last))}, ומאז אין דיווחים. כדאי לבדוק אם משהו לא עובד.`);
    }
  }
  const away = people.filter((w) => w.tier === "inactive" && (!w.person.lastActiveAt || daysBetweenDates(israelDate(w.person.lastActiveAt), end) >= AWAY_DAYS));
  if (away.length > 0) suggestions.push(`${away.map((w) => w.person.name).join(", ")}: לא נכנסו לדפי ${AWAY_DAYS} ימים או יותר.`);

  const active = people.filter((w) => w.tier !== "inactive");
  return {
    days,
    start,
    end,
    people,
    totals: {
      people: people.length,
      active: active.length,
      reports: people.reduce((sum, w) => sum + w.reports, 0),
      weight: people.reduce((sum, w) => sum + w.weight, 0),
      weightPeople: people.filter((w) => w.weight > 0).length,
      tickets: people.reduce((sum, w) => sum + w.ticketsOpened, 0),
      ticketPeople: people.filter((w) => w.ticketsOpened > 0).length,
      joined: people.filter((w) => w.joinedThisWeek).length,
    },
    suggestions,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const times = (n: number) => (n === 1 ? "פעם אחת" : `${n} פעמים`);
/** "דיווח אחד" rather than "1 דיווחים" - a Hebrew count of one reads wrong with the plural. */
const counted = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** What one person did, as short Hebrew phrases (only the things they actually did). */
function activityParts(w: PersonWeek): string[] {
  const parts: string[] = [];
  if (w.food) parts.push(`${w.food} אוכל`);
  if (w.weight) parts.push(`${w.weight} שקילות`);
  if (w.exercise) parts.push(`${w.exercise} פעילות גופנית`);
  if (w.targetPlans) parts.push(`יעדים עודכנו ${times(w.targetPlans)}${w.targetPlansByAi ? ` (${w.targetPlansByAi} ב-AI)` : ""}`);
  if (w.targetRequests) parts.push(`${w.targetRequests === 1 ? "בקשה אחת" : `${w.targetRequests} בקשות`} לשינוי יעדים`);
  if (w.savedListAdded || w.savedListEdited) parts.push(`רשימה שמורה: ${[w.savedListAdded ? counted(w.savedListAdded, "פריט אחד נוסף", "נוספו") : "", w.savedListEdited ? counted(w.savedListEdited, "פריט אחד נערך", "נערכו") : ""].filter(Boolean).join(", ")}`);
  if (w.ticketsOpened || w.ticketUpdates) parts.push([w.ticketsOpened ? counted(w.ticketsOpened, "פנייה חדשה אחת", "פניות חדשות") : "", w.ticketUpdates ? counted(w.ticketUpdates, "עדכון אחד לפנייה", "עדכונים לפניות") : ""].filter(Boolean).join(", "));
  if (w.notifications) parts.push(`נקראו ${w.notificationsRead}/${w.notifications} התראות`);
  return parts;
}

function lastActiveText(w: PersonWeek, now: Date): string {
  const at = w.person.lastActiveAt;
  if (!at) return "עוד לא נכנסו";
  const day = israelDate(at);
  const today = israelDate(now);
  if (day === today) return `פעילות אחרונה: היום ${timeOf(at)}`;
  if (day === shiftDate(today, -1)) return `פעילות אחרונה: אתמול ${timeOf(at)}`;
  return `פעילות אחרונה: ${ddmm(day)} ${timeOf(at)}`;
}

const TIERS: Record<Tier, { label: string; title: string; hint: string; bg: string; fg: string }> = {
  heavy: { label: "פעילים מאוד", title: "דיווחו רוב ימי השבוע", hint: `${HEAVY_REPORTS} דיווחים או יותר, ב-${HEAVY_DAYS} ימים לפחות.`, bg: "#ccebe6", fg: "#0f766e" },
  light: { label: "פעילים", title: "השתמשו, אבל לא כל יום", hint: "לפחות דיווח אחד השבוע.", bg: "#eef1f0", fg: "#4b5b58" },
  opened: { label: "נכנסו בלבד", title: "נכנסו לאפליקציה, בלי דיווח", hint: "נכנסו השבוע אבל לא דיווחו כלום.", bg: "#fdecc8", fg: "#b45309" },
  inactive: { label: "לא פעילים", title: "לא נכנסו לדפי השבוע", hint: "לפי הכניסה האחרונה.", bg: "#fde2e7", fg: "#be123c" },
};

export type UsageEmail = { subject: string; html: string; text: string };

export function renderUsageReport(week: UsageWeek, now: Date, appUrl: string): UsageEmail {
  const t = week.totals;
  const range = `${ddmm(week.start)}–${ddmm(week.end)}`;
  const rangeHtml = `<span dir="ltr">${range}</span>`;
  const subject = `דפי – שימוש שבועי ${range}: ${t.active} מתוך ${t.people} פעילים, ${t.reports} דיווחים`;

  const byReports = week.people.filter((w) => w.reports > 0);
  const [first, second] = byReports;
  const joinName = (a: string, b: string) => `${a} ו${/^[֐-׿]/.test(b) ? "" : "-"}${b}`;
  let headline = `${t.reports} דיווחים מ-${byReports.length} אנשים השבוע`;
  if (first && second && (first.reports + second.reports) / Math.max(1, t.reports) >= 0.7) {
    headline = `${joinName(first.person.name, second.person.name)} כתבו ${first.reports + second.reports} מתוך ${t.reports} הדיווחים`;
  } else if (first && first.reports / Math.max(1, t.reports) >= 0.6) {
    headline = `${first.person.name} כתב/ה ${first.reports} מתוך ${t.reports} הדיווחים`;
  }
  if (t.reports === 0) headline = "לא היו דיווחים השבוע";
  const inactiveCount = week.people.filter((w) => w.tier === "inactive").length;
  const lede = [
    t.joined ? `${t.joined === 1 ? "הצטרף/ה אדם חדש אחד" : `הצטרפו ${t.joined} אנשים חדשים`}.` : "",
    inactiveCount ? `${inactiveCount} אנשים לא נכנסו לדפי השבוע.` : "כולם נכנסו לדפי השבוע.",
  ].filter(Boolean).join(" ");

  const font = "font-family:Arial,'Segoe UI',sans-serif;";
  const card = "background:#ffffff;border:1px solid #e2e8e6;border-radius:12px;padding:18px 20px;margin:0 0 14px;";
  const muted = "#61716e";
  const kpi = (value: string, label: string, note: string) =>
    `<td style="width:25%;padding:4px;"><div style="border:1px solid #e2e8e6;border-radius:10px;padding:10px 12px;"><div style="font-size:22px;font-weight:bold;color:#17302c;">${value}</div><div style="font-size:12px;color:${muted};">${label}</div><div style="font-size:11.5px;color:#0f766e;">${note}</div></div></td>`;
  const bars = (perDay: number[]) => {
    const max = Math.max(1, ...perDay);
    const cells = perDay
      .map((n, i) => {
        const h = n ? Math.max(4, Math.round((n / max) * 22)) : 3;
        return `<td style="vertical-align:bottom;padding:0 1px;" title="${weekdayOf(week.days[i])} ${n}"><div style="width:8px;height:${h}px;background:${n ? "#0f766e" : "#e2e8e6"};border-radius:2px 2px 0 0;"></div></td>`;
      })
      .join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:4px;display:inline-table;"><tr style="height:24px;">${cells}</tr></table>`;
  };
  const tierHead = (tier: Tier) => {
    const s = TIERS[tier];
    return `<div style="font-size:15px;font-weight:bold;color:#17302c;margin-bottom:2px;"><span style="background:${s.bg};color:${s.fg};border-radius:999px;padding:2px 9px;font-size:11.5px;">${s.label}</span>&nbsp; ${s.title}</div><div style="font-size:12.5px;color:${muted};margin-bottom:10px;">${s.hint}</div>`;
  };

  const sections: string[] = [];
  for (const tier of ["heavy", "light", "opened"] as Tier[]) {
    const rows = week.people.filter((w) => w.tier === tier);
    if (rows.length === 0) continue;
    const body = rows
      .map((w, i) => {
        const what = tier === "opened" ? (w.joinedThisWeek ? `הצטרפות ב-${ddmm(israelDate(w.person.joinedAt))}${w.targetPlans ? ", קיבלו תכנית יעדים ראשונה" : ""}. עדיין אין דיווח.` : "נכנסו לאפליקציה ולא דיווחו.") : activityParts(w).join(" · ");
        const border = i === 0 ? "" : "border-top:1px solid #e2e8e6;";
        return `<tr><td style="${border}padding:9px 0;vertical-align:top;width:30%;"><div style="font-weight:bold;color:#17302c;" dir="rtl"><span dir="auto">${escapeHtml(w.person.name)}</span></div><div style="font-size:12px;color:${muted};">${lastActiveText(w, now)}</div></td><td style="${border}padding:9px 10px;vertical-align:top;font-size:12.5px;color:${muted};">${escapeHtml(what)}</td><td style="${border}padding:9px 0;vertical-align:top;text-align:left;white-space:nowrap;"><div style="font-size:18px;font-weight:bold;color:#17302c;">${w.reports}</div><div style="font-size:11.5px;color:${muted};">דיווחים</div>${tier === "opened" ? "" : bars(w.perDay)}</td></tr>`;
      })
      .join("");
    sections.push(`<div style="${card}">${tierHead(tier)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></div>`);
  }
  const idle = week.people.filter((w) => w.tier === "inactive");
  if (idle.length > 0) {
    const cells = idle
      .map((w) => `<tr><td style="border-top:1px solid #e2e8e6;padding:6px 0;font-size:13px;color:#17302c;text-align:right;" dir="rtl"><span dir="auto">${escapeHtml(w.person.name)}</span></td><td style="border-top:1px solid #e2e8e6;padding:6px 0;font-size:12px;color:${muted};text-align:left;">${w.person.lastActiveAt ? ddmm(israelDate(w.person.lastActiveAt)) : "אף פעם"}</td></tr>`)
      .join("");
    sections.push(`<div style="${card}">${tierHead("inactive")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells}</table></div>`);
  }
  if (week.suggestions.length > 0) {
    const items = week.suggestions.map((s) => `<li style="margin:0 0 8px;" dir="rtl">${escapeHtml(s)}</li>`).join("");
    sections.push(`<div style="${card}"><div style="font-size:15px;font-weight:bold;color:#17302c;margin-bottom:8px;">כדאי לשלוח הודעה</div><ul style="margin:0;padding-right:18px;font-size:13.5px;color:#17302c;">${items}</ul><a href="${appUrl}/app" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:bold;font-size:13px;margin-top:8px;">פתיחת דפי</a></div>`);
  }

  const shareColors = ["#0f766e", "#5eb8ad", "#a7d8d1", "#d3e6e3"];
  const shareRows = byReports.slice(0, 3);
  const rest = byReports.slice(3);
  const segments = [...shareRows.map((w) => ({ name: w.person.name, n: w.reports })), ...(rest.length ? [{ name: rest.length === 1 ? rest[0].person.name : `עוד ${rest.length}`, n: rest.reduce((s, w) => s + w.reports, 0) }] : [])];
  const shareBar = t.reports
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-radius:6px;overflow:hidden;"><tr>${segments.map((s, i) => `<td style="height:12px;background:${shareColors[i]};width:${((s.n / t.reports) * 100).toFixed(1)}%;"></td>`).join("")}</tr></table><div style="font-size:12px;color:${muted};margin-top:6px;">${segments.map((s, i) => `<span style="white-space:nowrap;margin-left:12px;"><span style="display:inline-block;width:9px;height:9px;background:${shareColors[i]};border-radius:2px;"></span> <span dir="auto">${escapeHtml(s.name)}</span> ${s.n}</span>`).join("")}</div>`
    : "";

  const html = `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f6f8f7;"><div dir="rtl" style="${font}max-width:640px;margin:0 auto;padding:20px 12px;color:#17302c;font-size:14px;line-height:1.5;">
<div style="padding:4px 4px 14px;"><span style="font-weight:bold;font-size:16px;">דוח שימוש בדפי</span><span style="float:left;color:${muted};font-size:12.5px;">${rangeHtml}</span></div>
<div style="${card}"><div style="font-size:21px;font-weight:bold;line-height:1.3;margin-bottom:6px;" dir="auto">${escapeHtml(headline)}</div><div style="color:${muted};">${escapeHtml(lede)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>${kpi(`${t.active}<span style="font-size:14px;color:${muted};">/${t.people}</span>`, "אנשים פעילים", t.joined ? `${t.joined} חדשים השבוע` : "ללא חדשים")}${kpi(String(t.reports), "דיווחים יומיים", `${Math.round(t.reports / 7)} ביום בממוצע`)}${kpi(String(t.weight), "שקילות", `מ-${t.weightPeople} אנשים`)}${kpi(String(t.tickets), "פניות חדשות", t.ticketPeople ? `מ-${t.ticketPeople} אנשים` : "אין")}</tr></table>${shareBar}</div>
${sections.join("\n")}
<div style="color:${muted};font-size:12px;text-align:center;padding:8px 4px 0;">נשלח בכל יום ראשון בבוקר. הנתונים מהמערכת עצמה, משבוע ${rangeHtml} (שעון ישראל). חשבונות בדיקה ובוט אינם נכללים.</div>
</div></body></html>`;

  const lines = [`דוח שימוש בדפי, ${range}`, "", headline, lede, "", `${t.active}/${t.people} פעילים · ${t.reports} דיווחים · ${t.weight} שקילות · ${t.tickets} פניות חדשות`, ""];
  for (const tier of ["heavy", "light", "opened", "inactive"] as Tier[]) {
    const rows = week.people.filter((w) => w.tier === tier);
    if (rows.length === 0) continue;
    lines.push(`${TIERS[tier].label}:`);
    for (const w of rows) {
      if (tier === "inactive") lines.push(`- ${w.person.name} (${w.person.lastActiveAt ? ddmm(israelDate(w.person.lastActiveAt)) : "אף פעם"})`);
      else lines.push(`- ${w.person.name}: ${counted(w.reports, "דיווח אחד", "דיווחים")}${activityParts(w).length ? ` (${activityParts(w).join(", ")})` : ""}`);
    }
    lines.push("");
  }
  if (week.suggestions.length > 0) lines.push("כדאי לשלוח הודעה:", ...week.suggestions.map((s) => `- ${s}`));
  return { subject, html, text: lines.join("\n") };
}
