/** The confirmation email sent when a "Promote to production" request ends (see
 * automation/n8n/bridge/promote.js for where the report comes from, and the n8n poller that sends it).
 * Pure, so it can be rendered for any report without a database. English only, like the other ops emails. */

export type PromoteReportStep = { name: string; ok: boolean; detail: string };
export type PromoteReportTicket = { seq: number; subject: string; commit: string | null; status: string; reason: string; bundleLetter?: string | null; alsoSeqs?: number[] };

/** "TCK-203" for a ticket, "TCK-203, TCK-204 (Bundle A)" for a bundle. */
function ticketLabel(t: PromoteReportTicket): string {
  const all = [t.seq, ...(t.alsoSeqs ?? [])].map((seq) => `TCK-${seq}`).join(", ");
  return t.bundleLetter ? `${all} (Bundle ${t.bundleLetter})` : all;
}
export type PromoteReport = {
  version: string | null;
  previousVersion: string | null;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  rolledBack: boolean;
  dryRun: boolean;
  steps: PromoteReportStep[];
  tickets: PromoteReportTicket[];
  migrations: string[];
};

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clock(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

function minutes(from: string, to: string | null): string {
  if (!to) return "-";
  const total = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  return `${total} min`;
}

export function renderPromotionEmail({
  report,
  requestedAt,
  resultText,
  publicUrl,
}: {
  report: PromoteReport | null;
  requestedAt: string;
  resultText: string | null;
  publicUrl: string;
}): { subject: string; html: string } {
  if (!report) {
    return {
      subject: "Daffy promotion could not run - nothing changed in production",
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;color:#1a2530"><h2 style="margin:0 0 8px">The promotion could not run</h2><p>Requested ${esc(clock(requestedAt))}.</p><p>${esc(resultText ?? "The laptop's bridge did not answer.")}</p><p>Nothing changed in production and your tickets are still approved - press Promote to production again once the bridge is reachable.</p></div>`,
    };
  }
  const released = report.tickets.filter((t) => t.status === "released" || t.status === "deployed");
  const skipped = report.tickets.filter((t) => t.status === "skipped");
  const failedStep = report.steps.find((s) => !s.ok);
  const state = report.ok ? (failedStep ? "live, with a follow-up needed" : "live") : report.rolledBack ? "rolled back" : "stopped before it reached production";
  const subject = report.ok
    ? `Daffy v${report.version} is ${failedStep ? "live (see the follow-up)" : "live"} - ${released.length} fix${released.length === 1 ? "" : "es"} released${released.some((t) => (t.alsoSeqs ?? []).length > 0) ? ` (${released.reduce((n, t) => n + 1 + (t.alsoSeqs ?? []).length, 0)} tickets)` : ""}`
    : `Daffy promotion did not complete - ${report.rolledBack ? "rolled back to the previous version" : "nothing changed in production"}`;
  const color = report.ok && !failedStep ? "#0b8f7f" : report.ok ? "#a86400" : "#b3261e";
  const th = "text-align:left;padding:6px 8px;border-bottom:1px solid #d3dde4;font-size:12px;color:#5b6b78";
  const td = "padding:6px 8px;border-bottom:1px solid #e3e9ed;font-size:13px;vertical-align:top";
  const ticketRows = report.tickets
    .map((t) => {
      const ok = t.status === "released" || t.status === "deployed";
      const note = ok ? (t.status === "released" ? "Resolved" : "Deployed - ticket not marked resolved, do it by hand") : `Not shipped: ${t.reason}`;
      return `<tr><td style="${td}">${esc(ticketLabel(t))}</td><td style="${td}">${esc(t.subject)}</td><td style="${td};font-family:Consolas,monospace">${esc(t.commit ?? "-")}</td><td style="${td};color:${ok ? "#0b8f7f" : "#b3261e"}">${esc(note)}</td></tr>`;
    })
    .join("");
  const stepRows = report.steps
    .map((s) => `<tr><td style="${td}">${esc(s.name)}</td><td style="${td};color:${s.ok ? "#0b8f7f" : "#b3261e"}"><b>${s.ok ? "OK" : "Failed"}</b>${s.detail ? ` - ${esc(s.detail)}` : ""}</td></tr>`)
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;color:#1a2530">
<h2 style="margin:0 0 4px;color:${color}">${report.version ? `Daffy v${esc(report.version)}` : "Daffy"} is ${esc(state)}</h2>
<p style="margin:0 0 12px;color:#5b6b78;font-size:13px">Requested ${esc(clock(requestedAt))} &middot; finished ${esc(clock(report.finishedAt))} (${esc(minutes(report.startedAt, report.finishedAt))})${report.previousVersion ? ` &middot; previous version ${esc(report.previousVersion)}` : ""}${report.dryRun ? " &middot; DRY RUN, nothing left the laptop" : ""}</p>
<table style="border-collapse:collapse;width:100%;margin:8px 0"><tr><th style="${th}">Ticket</th><th style="${th}">Fix</th><th style="${th}">Commit</th><th style="${th}">Result</th></tr>${ticketRows}</table>
<table style="border-collapse:collapse;width:100%;margin:8px 0"><tr><th style="${th}">Step</th><th style="${th}">Result</th></tr>${stepRows}</table>
<p style="font-size:13px;margin:8px 0">Migrations applied to production: ${report.migrations.length ? esc(report.migrations.join(", ")) : "none"}.${report.rolledBack ? " <b>The site was rolled back to the previous deployment.</b>" : ""}</p>
${skipped.length && report.ok ? `<p style="font-size:13px;color:#a86400;margin:8px 0">${skipped.length} approved fix${skipped.length === 1 ? " was" : "es were"} not shipped and stay${skipped.length === 1 ? "s" : ""} approved - see above.</p>` : ""}
${report.ok ? "" : `<p style="font-size:13px;margin:8px 0">The approved tickets are still approved for production, so nothing is lost. Fix the cause above and press Promote to production again.</p>`}
<p style="font-size:12px;color:#5b6b78;margin-top:14px"><a href="${esc(publicUrl)}/app/tickets/review">Open the review page</a></p>
</div>`;
  return { subject, html };
}
