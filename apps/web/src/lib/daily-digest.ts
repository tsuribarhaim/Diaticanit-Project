/** The admin daily digest email (see app/api/admin/daily-digest/route.ts, which reads the data and
 * calls this). Pure on purpose - no database, no imports - so it can be tested with fixtures. */

export type DigestTicket = {
  id: string;
  ticket_seq: number;
  status: string;
  priority: string;
  ticket_type: string | null;
  area: string | null;
  auto_handle: string | null;
  auto_handle_notes: string | null;
  created_at: string;
};
export type DigestProposal = { ticket_id: string; kind: string; status: string; created_at: string };
export type DigestUser = { name: string; isAdmin: boolean; createdAt: string };
/** What a digest remembers for the next day's "since yesterday" column. */
export type DigestSnapshot = { total: number; statuses: Record<string, number> };

type StatusGroup = { key: string; label: string; statuses: [string, string][] };
const STATUS_GROUPS: StatusGroup[] = [
  { key: "open", label: "Still open", statuses: [["open", "Open"], ["reopened", "Reopened"], ["in_progress", "In progress"], ["draft", "Draft"]] },
  { key: "done", label: "Done", statuses: [["resolved", "Resolved"], ["fixed", "Fixed (waiting for your OK)"]] },
  { key: "closed", label: "Closed without a fix", statuses: [["closed", "Closed"], ["duplicate", "Duplicate"], ["cancelled", "Cancelled by the user"]] },
  { key: "deferred", label: "Deferred", statuses: [["deferred", "Deferred"]] },
];
/** A ticket in one of these is finished - an old automation flag on it is history, not a to-do. */
const FINAL_STATUSES = ["resolved", "closed", "cancelled", "duplicate"];
const OPEN_STATUSES = ["open", "reopened", "in_progress", "draft"];

const AREA_LABELS: Record<string, string> = {
  home: "Home", daily_report: "Daily Report", targets: "Targets", profile: "Profile", documents: "Documents",
  health_labs: "Health / Labs", notifications: "Notifications", account_auth: "Account / Sign-in", other: "Other",
};
const PRIORITIES = [["urgent", "Urgent"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]] as const;

export type DigestStats = {
  total: number;
  statuses: Record<string, number>;
  groupTotals: Record<string, number>;
  other: number;
  openCount: number;
  doneCount: number;
  createdLastDay: number;
  createdLastWeek: number;
  openByPriority: Record<string, number>;
  openBugs: number;
  openFeatures: number;
  topAreas: [string, number][];
  oldestOpen: { seq: number; days: number; status: string } | null;
  needsYou: {
    proposalsWaiting: number;
    returnedWithQuestions: number;
    fixesToMerge: number;
    toPromote: { seq: number; mergedOnDev: boolean }[];
    queuedForAnalysis: number;
    queuedForNightRun: number;
  };
  automation: {
    workedOn: number;
    passedPrecheck: number;
    neededDecision: number;
    doneTotal: number;
    doneByAutomation: number;
    doneByHand: number;
    spec: { written: number; approved: number; changesRequested: number; rejected: number; waiting: number; since: string | null };
  };
  users: { total: number; admins: number; newThisWeek: number };
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function daysBetween(fromIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86_400_000));
}

function count<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

/** Each automation-touched ticket's latest pre-check result, read from the notes the bridge wrote:
 * a ticket that reached Phase 2 passed the pre-check; otherwise Phase 1's own classification decides. */
function precheckPassed(notes: string): boolean | null {
  if (!/\[Auto-handle Phase [12]/.test(notes)) return null;
  if (/\[Auto-handle Phase 2/.test(notes)) return true;
  const match = /\[Auto-handle Phase 1[^\]]*\][\s\S]*?Classification: (\w+)/.exec(notes);
  if (!match) return null;
  return match[1] === "safe_code_fix";
}

export function computeDigestStats(input: { tickets: DigestTicket[]; proposals: DigestProposal[]; users: DigestUser[]; now: Date }): DigestStats {
  const { tickets, proposals, users, now } = input;
  const statuses = count(tickets, (ticket) => ticket.status);
  const groupTotals: Record<string, number> = {};
  for (const group of STATUS_GROUPS) groupTotals[group.key] = group.statuses.reduce((sum, [status]) => sum + (statuses[status] ?? 0), 0);
  const known = Object.values(groupTotals).reduce((a, b) => a + b, 0);

  const open = tickets.filter((ticket) => OPEN_STATUSES.includes(ticket.status));
  const openReal = open.filter((ticket) => ticket.status !== "draft");
  const oldest = [...openReal].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const areaCounts = Object.entries(count(open, (ticket) => ticket.area ?? "other")).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const live = (ticketId: string) => {
    const ticket = ticketById.get(ticketId);
    return Boolean(ticket && !FINAL_STATUSES.includes(ticket.status));
  };
  const pendingFor = (kind: string, flag: string) => {
    const seen = new Set<string>();
    for (const row of proposals) {
      if (row.kind === kind && row.status === "pending" && live(row.ticket_id) && ticketById.get(row.ticket_id)?.auto_handle === flag) seen.add(row.ticket_id);
    }
    return seen.size;
  };
  const mergedFix = new Set(proposals.filter((row) => row.kind === "fix" && row.status === "merged").map((row) => row.ticket_id));
  const toPromote = tickets
    .filter((ticket) => ticket.status === "fixed")
    .sort((a, b) => a.ticket_seq - b.ticket_seq)
    .map((ticket) => ({ seq: ticket.ticket_seq, mergedOnDev: mergedFix.has(ticket.id) }));

  const touched = tickets.filter((ticket) => ticket.auto_handle_notes && precheckPassed(ticket.auto_handle_notes) !== null);
  const passed = touched.filter((ticket) => precheckPassed(ticket.auto_handle_notes!) === true).length;
  const done = tickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "fixed");
  const doneByAutomation = done.filter((ticket) => ticket.auto_handle === "D").length;

  const proposalRows = proposals.filter((row) => row.kind === "proposal");
  const waiting = pendingFor("proposal", "A");
  const earliest = proposalRows.map((row) => row.created_at).sort()[0] ?? null;

  return {
    total: tickets.length,
    statuses,
    groupTotals,
    other: tickets.length - known,
    openCount: groupTotals.open,
    doneCount: groupTotals.done,
    createdLastDay: tickets.filter((ticket) => now.getTime() - new Date(ticket.created_at).getTime() < 86_400_000).length,
    createdLastWeek: tickets.filter((ticket) => now.getTime() - new Date(ticket.created_at).getTime() < 7 * 86_400_000).length,
    openByPriority: count(open, (ticket) => ticket.priority),
    openBugs: open.filter((ticket) => ticket.ticket_type === "bug").length,
    openFeatures: open.filter((ticket) => ticket.ticket_type === "feature_request").length,
    topAreas: areaCounts.map(([area, n]) => [AREA_LABELS[area] ?? area, n]),
    oldestOpen: oldest ? { seq: oldest.ticket_seq, days: daysBetween(oldest.created_at, now), status: oldest.status } : null,
    needsYou: {
      proposalsWaiting: waiting,
      returnedWithQuestions: pendingFor("questions", "P"),
      fixesToMerge: pendingFor("fix", "D"),
      toPromote,
      queuedForAnalysis: tickets.filter((ticket) => ticket.auto_handle === "S" && !FINAL_STATUSES.includes(ticket.status)).length,
      queuedForNightRun: tickets.filter((ticket) => ticket.auto_handle === "Y" && ["open", "reopened"].includes(ticket.status)).length,
    },
    automation: {
      workedOn: touched.length,
      passedPrecheck: passed,
      neededDecision: touched.length - passed,
      doneTotal: done.length,
      doneByAutomation,
      doneByHand: done.length - doneByAutomation,
      spec: {
        written: proposalRows.length,
        approved: proposalRows.filter((row) => row.status === "approved").length,
        changesRequested: proposalRows.filter((row) => row.status === "changes_requested").length,
        rejected: proposalRows.filter((row) => row.status === "rejected").length,
        waiting,
        since: earliest,
      },
    },
    users: {
      total: users.length,
      admins: users.filter((user) => user.isAdmin).length,
      newThisWeek: users.filter((user) => now.getTime() - new Date(user.createdAt).getTime() < 7 * 86_400_000).length,
    },
  };
}

export function snapshotOf(stats: DigestStats): DigestSnapshot {
  return { total: stats.total, statuses: stats.statuses };
}

/** "+2", "-1", "0" - or an en dash when there is nothing to compare with yet. */
function deltaText(current: number, previous: number | undefined): string {
  if (previous === undefined) return "–";
  const diff = current - previous;
  return diff === 0 ? "0" : diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}

function groupPrevious(group: StatusGroup, previous: DigestSnapshot | null): number | undefined {
  if (!previous) return undefined;
  return group.statuses.reduce((sum, [status]) => sum + (previous.statuses[status] ?? 0), 0);
}

export type DigestEmail = { subject: string; html: string; text: string };

export function renderDigest(input: {
  stats: DigestStats;
  previous: DigestSnapshot | null;
  users: DigestUser[];
  adminFirstNames: string[];
  now: Date;
  publicUrl: string;
}): DigestEmail {
  const { stats, previous, users, adminFirstNames, now, publicUrl } = input;
  const reviewUrl = `${publicUrl}/app/tickets/review`;
  const dateLabel = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jerusalem" });
  const greeting = `Good morning ${adminFirstNames.length === 0 ? "there" : adminFirstNames.length === 1 ? adminFirstNames[0] : `${adminFirstNames.slice(0, -1).join(", ")} and ${adminFirstNames[adminFirstNames.length - 1]}`}`;
  const needs = stats.needsYou;
  const waitingOnYou = needs.proposalsWaiting + needs.returnedWithQuestions + needs.fixesToMerge;
  const subject = `Daffy Production - Daily Digest: ${stats.openCount} open, ${waitingOnYou} waiting on you`;
  const promoteText = needs.toPromote.map((item) => `TCK-${item.seq} (${item.mergedOnDev ? "merged on dev" : "branch not merged on dev yet"})`).join(" · ");

  // ---------------------------------------------------------------- plain text ----
  const text: string[] = [
    `${greeting},`,
    `Daffy Production - ${dateLabel}`,
    "",
    "NEEDS YOU TODAY",
    `  Proposals waiting for your approval: ${needs.proposalsWaiting}`,
    `  Tickets the night run sent back with questions: ${needs.returnedWithQuestions}`,
    `  Fixes ready to merge on dev: ${needs.fixesToMerge}`,
    `  Fixed, waiting for you to promote and resolve: ${needs.toPromote.length}${promoteText ? ` - ${promoteText}` : ""}`,
    `  Queued for tonight: ${needs.queuedForAnalysis} for analysis, ${needs.queuedForNightRun} for the night run`,
    `  Review page: ${reviewUrl}`,
    "",
    `TICKETS - ${stats.total} in total (${stats.createdLastDay} new in the last day, ${stats.createdLastWeek} in the last week)`,
  ];
  for (const group of STATUS_GROUPS) {
    text.push(`  ${group.label}: ${stats.groupTotals[group.key]} (${deltaText(stats.groupTotals[group.key], groupPrevious(group, previous))} since yesterday)`);
    for (const [status, label] of group.statuses) text.push(`      ${label}: ${stats.statuses[status] ?? 0}`);
  }
  if (stats.other > 0) text.push(`  Other statuses: ${stats.other}`);
  text.push("", "WHAT IS STILL OPEN");
  text.push(`  By priority: ${PRIORITIES.map(([key, label]) => `${label} ${stats.openByPriority[key] ?? 0}`).join(", ")}`);
  text.push(`  By type: Bugs ${stats.openBugs}, Feature requests ${stats.openFeatures}`);
  if (stats.oldestOpen) text.push(`  Oldest open ticket: TCK-${stats.oldestOpen.seq}, ${stats.oldestOpen.days} days (${stats.oldestOpen.status.replace("_", " ")})`);
  if (stats.topAreas.length) text.push(`  Most open tickets: ${stats.topAreas.map(([label, n]) => `${label} ${n}`).join(", ")}`);
  const a = stats.automation;
  text.push("", "AUTOMATION");
  text.push(`  Tickets the automation has worked on: ${a.workedOn}`);
  text.push(`  Passed the automatic pre-check: ${a.passedPrecheck} of ${a.workedOn} (${percent(a.passedPrecheck, a.workedOn)})`);
  text.push(`  Needed a human decision first: ${a.neededDecision}`);
  text.push(`  Of the ${a.doneTotal} done tickets: ${a.doneByAutomation} fixed by the automation (${percent(a.doneByAutomation, a.doneTotal)}), ${a.doneByHand} by hand`);
  text.push(`  Spec analysis${a.spec.since ? ` (since ${new Date(a.spec.since).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jerusalem" })})` : ""}: ${a.spec.written} written, ${a.spec.approved} approved, ${a.spec.changesRequested} sent back, ${a.spec.rejected} rejected, ${a.spec.waiting} waiting`);
  text.push("", `PEOPLE - ${stats.users.total} users (${stats.users.admins} admins), ${stats.users.newThisWeek} new this week`);
  for (const user of users) text.push(`  ${user.name}${user.isAdmin ? " (Admin)" : ""} - ${daysBetween(user.createdAt, now)} days`);
  text.push("", "I wish you a pleasant day!");

  // ---------------------------------------------------------------------- html ----
  const ink = "#16282b", muted = "#5d6f72", line = "#dbe4e6", soft = "#f3f7f8";
  const td = (content: string, extra = "") => `<td style="padding:7px 10px;border-top:1px solid ${line};font-size:14px;${extra}">${content}</td>`;
  const num = (content: string, extra = "") => td(content, `text-align:right;font-variant-numeric:tabular-nums;${extra}`);
  const th = (content: string, right = false) => `<th style="padding:7px 10px;background:${soft};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${muted};text-align:${right ? "right" : "left"};font-weight:700">${content}</th>`;
  const h2 = (content: string) => `<h2 style="font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:${muted};margin:26px 0 8px;font-weight:700">${content}</h2>`;
  const table = (rows: string, extra = "") => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;${extra}">${rows}</table>`;
  const tag = `<span style="display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:6px;background:#e8eafd;color:#4338ca;margin-left:6px">NEW</span>`;
  const tile = (big: string, label: string) => `<td width="25%" style="padding:0 5px 0 0"><div style="border:1px solid ${line};border-radius:12px;padding:12px 14px"><div style="font-size:26px;font-weight:800;line-height:1.1">${big}</div><div style="font-size:12px;color:${muted};margin-top:3px">${label}</div></div></td>`;

  const needRow = (label: string, value: string, hot = false, sub = "") =>
    `<tr style="${hot ? "background:#fdf0d8" : ""}">${td(`${label}${sub ? `<br><span style="font-size:12.5px;color:${muted}">${escapeHtml(sub)}</span>` : ""}`)}${num(`<strong style="${hot ? "color:#b45309" : ""}">${value}</strong>`, "white-space:nowrap")}</tr>`;
  const needsHtml = table(
    needRow("Proposals waiting for your approval", String(needs.proposalsWaiting), needs.proposalsWaiting > 0) +
      needRow("Tickets the night run sent back with questions", String(needs.returnedWithQuestions), needs.returnedWithQuestions > 0) +
      needRow("Fixes ready to merge on dev", String(needs.fixesToMerge), needs.fixesToMerge > 0) +
      needRow("Fixed, waiting for you to promote and resolve", String(needs.toPromote.length), needs.toPromote.length > 0, promoteText) +
      needRow("Queued for tonight: analysis this evening / fixes overnight", `${needs.queuedForAnalysis} / ${needs.queuedForNightRun}`),
    `border:1px solid ${line};border-radius:12px`,
  );

  const segments = STATUS_GROUPS.map((group, i) => ({ value: stats.groupTotals[group.key], color: ["#f59e0b", "#10b981", "#94a3b8", "#6366f1"][i] })).filter((s) => s.value > 0);
  const barHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px"><tr>${segments.map((s) => `<td width="${(s.value / Math.max(1, stats.total - stats.other)) * 100}%" style="background:${s.color};height:10px;font-size:0;line-height:0">&nbsp;</td>`).join("")}</tr></table><div style="font-size:12.5px;color:${muted};margin-top:5px">${STATUS_GROUPS.map((group, i) => `<span style="color:${["#b45309", "#047857", "#64748b", "#4338ca"][i]}">&#9632;</span> ${group.label.toLowerCase()} ${stats.groupTotals[group.key]}`).join(" &nbsp; ")}</div>`;

  let statusRows = `<tr>${th("Status")}${th("Now", true)}${th("Since yesterday", true)}</tr>`;
  for (const group of STATUS_GROUPS) {
    statusRows += `<tr style="background:${soft}">${td(`<strong>${group.label}</strong>`, "border-top:1px solid #c8d5d8")}${num(`<strong>${stats.groupTotals[group.key]}</strong>`, "border-top:1px solid #c8d5d8")}${num(deltaText(stats.groupTotals[group.key], groupPrevious(group, previous)), `color:${muted};border-top:1px solid #c8d5d8`)}</tr>`;
    for (const [status, label] of group.statuses) {
      const now0 = stats.statuses[status] ?? 0;
      statusRows += `<tr>${td(label, `padding-left:26px;${now0 === 0 ? "color:#9aabae" : "color:#3b4f53"}`)}${num(String(now0), now0 === 0 ? "color:#9aabae" : "")}${num(deltaText(now0, previous ? (previous.statuses[status] ?? 0) : undefined), `color:${muted}`)}</tr>`;
    }
  }
  if (stats.other > 0) statusRows += `<tr>${td("Other statuses")}${num(String(stats.other))}${num("–")}</tr>`;
  statusRows += `<tr>${td("<strong>Total</strong>", `border-top:2px solid ${ink}`)}${num(`<strong>${stats.total}</strong>`, `border-top:2px solid ${ink}`)}${num(deltaText(stats.total, previous?.total), `color:${muted};border-top:2px solid ${ink}`)}</tr>`;

  const openRows =
    `<tr>${th("By priority")}${th("Tickets", true)}${th("By type")}${th("Tickets", true)}</tr>` +
    `<tr>${td("Urgent")}${num(String(stats.openByPriority.urgent ?? 0))}${td("Bugs")}${num(String(stats.openBugs))}</tr>` +
    `<tr>${td("High")}${num(String(stats.openByPriority.high ?? 0))}${td("Feature requests")}${num(String(stats.openFeatures))}</tr>` +
    `<tr>${td("Medium")}${num(String(stats.openByPriority.medium ?? 0))}${td(stats.oldestOpen ? `Oldest open: TCK-${stats.oldestOpen.seq}, ${stats.oldestOpen.days} days (${stats.oldestOpen.status.replace("_", " ")})` : "", `font-size:12.5px;color:${muted}`).replace("<td", '<td colspan="2"')}</tr>` +
    `<tr>${td("Low")}${num(String(stats.openByPriority.low ?? 0))}${td(stats.topAreas.length ? `Most open: ${stats.topAreas.map(([label, n]) => `${escapeHtml(label)} ${n}`).join(", ")}` : "", `font-size:12.5px;color:${muted}`).replace("<td", '<td colspan="2"')}</tr>`;

  const autoRows =
    `<tr>${th("Fixing tickets")}${th("Count", true)}</tr>` +
    `<tr>${td("Tickets the automation has worked on")}${num(String(a.workedOn))}</tr>` +
    `<tr>${td("Passed the automatic pre-check (safe code fix)")}${num(`${a.passedPrecheck} of ${a.workedOn} &middot; ${percent(a.passedPrecheck, a.workedOn)}`)}</tr>` +
    `<tr>${td("Needed a human decision first")}${num(String(a.neededDecision))}</tr>` +
    `<tr style="background:${soft}">${td(`<strong>Of the ${a.doneTotal} done tickets, fixed by the automation</strong>`)}${num(`<strong>${a.doneByAutomation} &middot; ${percent(a.doneByAutomation, a.doneTotal)}</strong>`)}</tr>` +
    `<tr>${td("Fixed by hand")}${num(String(a.doneByHand))}</tr>`;
  const sinceLabel = a.spec.since ? ` (since ${new Date(a.spec.since).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jerusalem" })})` : "";
  const specRows =
    `<tr>${th(`Spec analysis${sinceLabel}`)}${th("Count", true)}</tr>` +
    `<tr>${td("Proposals written")}${num(String(a.spec.written))}</tr>` +
    `<tr>${td("Approved")}${num(String(a.spec.approved))}</tr>` +
    `<tr>${td("Sent back for changes / rejected")}${num(`${a.spec.changesRequested} / ${a.spec.rejected}`)}</tr>` +
    `<tr>${td("Waiting for your approval")}${num(String(a.spec.waiting))}</tr>`;

  const userRows =
    `<tr>${th("User")}${th("Days with Daffy", true)}</tr>` +
    users.map((user) => `<tr>${td(`${escapeHtml(user.name)}${user.isAdmin ? " (Admin)" : ""}${now.getTime() - new Date(user.createdAt).getTime() < 7 * 86_400_000 ? ` <span style="font-size:11px;font-weight:700;padding:1px 7px;border-radius:6px;background:#e8eafd;color:#4338ca">new</span>` : ""}`)}${num(String(daysBetween(user.createdAt, now)))}</tr>`).join("");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#e9eef0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e9eef0"><tr><td align="center" style="padding:18px 10px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:14px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};font-size:15px;line-height:1.5"><tr><td style="padding:22px 22px 8px">
<h1 style="font-size:20px;margin:0 0 2px">${escapeHtml(greeting)}</h1>
<p style="color:${muted};margin:0 0 18px;font-size:13.5px">Daffy Production &middot; ${escapeHtml(dateLabel)}</p>
${h2(`Needs you today${tag}`)}${needsHtml}
<p style="margin:10px 0 0"><a href="${reviewUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;padding:8px 16px;border-radius:9px;font-size:13.5px">Open review &amp; approvals</a></p>
${h2("Tickets")}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${tile(String(stats.total), "tickets in total")}${tile(String(stats.openCount), "still open")}${tile(String(stats.doneCount), "done (resolved or fixed)")}${tile(`${stats.createdLastDay} / ${stats.createdLastWeek}`, "new in the last day / week")}</tr></table>
${barHtml}
<div style="height:10px"></div>${table(statusRows)}
<p style="font-size:12.5px;color:${muted};margin:6px 0 0">Every status is always listed, even at 0, so the groups add up to the total. "Since yesterday" compares with the previous digest.</p>
${h2("What is still open")}${table(openRows)}
${h2(`Automation${tag}`)}${table(autoRows)}<div style="height:12px"></div>${table(specRows)}
<p style="font-size:12.5px;color:${muted};margin:6px 0 0">Pre-check numbers use each ticket's latest result.</p>
${h2("People")}${table(userRows)}
<p style="font-size:12.5px;color:${muted};margin:6px 0 0">${stats.users.total} users in total (${stats.users.admins} admins), ${stats.users.newThisWeek} new this week.</p>
</td></tr><tr><td style="padding:6px 22px 22px;font-size:13px;color:${muted}">I wish you a pleasant day!</td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text: text.join("\n") };
}
