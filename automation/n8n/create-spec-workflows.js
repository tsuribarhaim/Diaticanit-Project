// Creates (or updates) the two n8n workflows behind the spec-first review flow:
//   "Daffy - Spec Analyst"            evening schedule + manual webhook -> bridge /analyze -> email
//   "Daffy - Review Requests Poller"  every minute -> picks up "Run analysis now" / "Merge to dev"
//                                     clicks made in the web app and has the bridge do them
//
//   node create-spec-workflows.js <dev|prod> [activate|deactivate]
//
// dev  = the dev bridge (port 7892, .env.local.devtest) and the dev app (localhost:3000)
// prod = the real bridge (port 7891, .env.local) and https://daffy-pilot.vercel.app
// New workflows are created INACTIVE. The URLs and secrets are written into the nodes (n8n keeps
// them in its own database, the same way the existing "Auto Ticket Handling" workflow does).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return env;
}

const mode = process.argv[2];
const action = process.argv[3];
if (mode !== "dev" && mode !== "prod") {
  console.error("usage: node create-spec-workflows.js <dev|prod> [activate|deactivate]");
  process.exit(1);
}
const n8nEnv = loadEnv(path.join(__dirname, ".env.local"));
const bridgeEnv = loadEnv(path.join(__dirname, "bridge", mode === "dev" ? ".env.local.devtest" : ".env.local"));
const BASE = `${n8nEnv.N8N_BASE_URL || "http://localhost:5678"}/api/v1`;
const H = { "X-N8N-API-KEY": n8nEnv.N8N_API_KEY, "Content-Type": "application/json" };
const cfg = {
  bridgeUrl: `http://host.docker.internal:${bridgeEnv.BRIDGE_PORT}`,
  bridgeSecret: bridgeEnv.BRIDGE_LOCAL_SECRET,
  appUrl: mode === "dev" ? "http://host.docker.internal:3000" : bridgeEnv.DAFFY_BASE_URL,
  appSecret: bridgeEnv.N8N_TICKET_AUTOMATION_SECRET,
  // Link shown to people, always the real address.
  publicUrl: "https://daffy-pilot.vercel.app",
};
const uuid = () => crypto.randomUUID();

const ANALYST_NAME = "Daffy - Spec Analyst";
const POLLER_NAME = "Daffy - Review Requests Poller";
const PROMOTE_NAME = "Daffy - Promote to Production";
const LESSON_NAME = "Daffy - Lesson Learned";

const promoteFinishJs = `// The bridge's answer (or its error), then close the request in the app and build the confirmation email.
const APP_URL = '${cfg.appUrl}';
const appHeaders = { 'x-ticket-automation-secret': '${cfg.appSecret}' };
const call = (opts) => this.helpers.httpRequest({ json: true, timeout: 60000, ...opts });
const started = $('Promote Webhook').first().json.body || {};
const res = $input.first().json || {};
const failedToReach = res.error !== undefined && res.report === undefined;
const report = res.report || null;
const ok = res.ok === true;
const result = res.result || (failedToReach ? 'The bridge could not be reached: ' + (typeof res.error === 'string' ? res.error : JSON.stringify(res.error)).slice(0, 300) : 'No answer from the bridge.');
await call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: started.requestId, action: 'complete', ok, result, report } });
const mail = await call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: started.requestId, action: 'email' } });
return [{ json: { ok, result, emailSubject: mail.subject, emailBody: mail.html, adminEmails: mail.adminEmails || [] } }];
`;

const lessonFinishJs = `// The bridge's answer (a saved lesson, or "nothing general to learn"): close the request and tell the admin what happened.
const APP_URL = '${cfg.appUrl}';
const appHeaders = { 'x-ticket-automation-secret': '${cfg.appSecret}' };
const PUBLIC_URL = '${cfg.publicUrl}';
const call = (opts) => this.helpers.httpRequest({ json: true, timeout: 60000, ...opts });
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const started = $('Lesson Webhook').first().json.body || {};
const res = $input.first().json || {};
const failed = res.error !== undefined && res.ok === undefined;
const result = failed ? 'The bridge could not be reached.' : res.ok === false ? 'Learning failed: ' + (res.error || 'unknown') : res.saved ? 'Saved a lesson.' : 'No lesson: ' + (res.reason || '');
await call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: started.requestId, action: 'complete', ok: !failed && res.ok !== false, result } });
const ticket = 'TCK-' + started.ticketSeq;
const when = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const kind = ({ send_back: 'You sent the fix back', return_fix: 'You returned the fix', change_request: 'You asked for a change to the proposal' })[started.source] || 'You corrected the work';
let subject, body;
if (failed || res.ok === false) {
  subject = 'Daffy could not learn from your correction on ' + ticket;
  body = '<p>' + esc(kind) + ' on ' + ticket + ' (' + esc(when) + '). The automation tried to turn your comment into a lesson but it failed: ' + esc(result) + '</p><p>Nothing was changed in the instructions of the agents.</p>';
} else if (res.saved) {
  subject = 'Daffy learned a new lesson from your correction on ' + ticket;
  body = '<h2 style="margin:0 0 6px">New lesson added</h2><p style="color:#5b6b78;margin:0 0 10px">' + esc(kind) + ' on ' + ticket + ' (' + esc(when) + ').</p>'
    + '<p><b>Your comment:</b> ' + esc(started.comment) + '</p><p><b>What the agents now follow</b> (' + esc(res.agent === 'both' ? 'both agents' : res.agent === 'night' ? 'night-run agent' : 'analyst') + '):</p>'
    + '<blockquote style="border-left:4px solid #0f766e;margin:6px 0;padding:4px 12px">' + esc(res.lesson) + '</blockquote>'
    + '<p style="color:#5b6b78">Why: ' + esc(res.reason) + '</p><p>It is added to the instructions from the next run on. Switch it off any time on the <a href="' + PUBLIC_URL + '/app/tickets/automation">Ticket Automation page</a>.</p>';
} else {
  subject = 'Daffy looked at your correction on ' + ticket + ' - no new lesson';
  body = '<p>' + esc(kind) + ' on ' + ticket + ' (' + esc(when) + '). The automation read your comment and decided there is nothing general to add to the instructions of the agents.</p><p><b>Your comment:</b> ' + esc(started.comment) + '</p><p style="color:#5b6b78">Why: ' + esc(res.reason) + '</p>';
}
const mail = await call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: started.requestId, action: 'recipients' } }).catch(() => ({ adminEmails: [] }));
return [{ json: { emailSubject: subject, emailBody: '<div style="font-family:Arial,sans-serif;max-width:640px;color:#1a2530">' + body + '</div>', adminEmails: mail.adminEmails || [] } }];
`;

const analystSummaryJs = `// The bridge answers {skipped:true} when an analysis is already running - send no email for that.
const data = $input.first().json;
if (data && data.skipped === true) { return []; }
const analyzed = Array.isArray(data.analyzed) ? data.analyzed : [];
const failed = Array.isArray(data.failed) ? data.failed : [];
// Nothing new (and nothing broken) means nothing to tell anyone.
if (analyzed.length === 0 && failed.length === 0) { return []; }
const lines = [];
if (analyzed.length) {
  lines.push('Waiting for your review (' + analyzed.length + '):');
  for (const t of analyzed) {
    lines.push('  TCK-' + t.ticketSeq + ' - ' + t.subject + (t.needsPairing ? '  [the analyst suggests building this one together with you]' : ''));
  }
  lines.push('', 'Open the review page: ${cfg.publicUrl}/app/tickets/review');
}
if (failed.length) {
  lines.push('', 'Could not be analysed (they stay requested and are retried next time) (' + failed.length + '):');
  for (const t of failed) { lines.push('  TCK-' + t.ticketSeq + ' - ' + t.subject + ' - ' + t.error); }
}
lines.push('', 'Spend this run: $' + (data.totalSpentUsd ?? 0));
const subject = analyzed.length
  ? 'Daffy - ' + analyzed.length + ' proposal' + (analyzed.length === 1 ? '' : 's') + ' waiting for your review'
  : 'Daffy - spec analysis had problems';
return [{ json: { emailSubject: subject, emailBody: lines.join('\\n') } }];
`;

const failureJs = `const errData = $input.first().json;
const errorDetail = (errData && (errData.error || errData.message)) || JSON.stringify(errData);
const emailBody = 'The spec analysis step itself failed - Daffy never got a response from the local bridge.\\n\\n' +
  'This usually means the local bridge service is not running, the laptop/Docker is off, or the bridge crashed outright.\\n\\n' +
  'Error detail:\\n' + errorDetail + '\\n\\nTime: ' + new Date().toISOString();
return [{ json: { emailSubject: 'Daffy Spec Analyst - bridge FAILED', emailBody } }];
`;

const pollerJs = `// Picks up what the admin clicked in the web app ("Run analysis now", "Merge to dev") and has the
// laptop's bridge do it. Claim first so two pollers can never do the same request twice.
const APP_URL = '${cfg.appUrl}';
const APP_SECRET = '${cfg.appSecret}';
const BRIDGE_URL = '${cfg.bridgeUrl}';
const BRIDGE_SECRET = '${cfg.bridgeSecret}';
const PROMOTE_WEBHOOK = 'http://localhost:5678/webhook/daffy-promote';
const LESSON_WEBHOOK = 'http://localhost:5678/webhook/daffy-lesson';
const ANALYST_WEBHOOK = 'http://localhost:5678/webhook/daffy-spec-analyst-manual';
const NIGHT_WEBHOOK = 'http://localhost:5678/webhook/daffy-auto-ticket-handling-manual';
const DIGEST_WEBHOOK = 'http://localhost:5678/webhook/daffy-daily-digest-manual';
// Those three workflows answer only when they finish (minutes). The poller just starts them: a timeout here means "it is running".
const fire = async (url) => {
  try {
    await this.helpers.httpRequest({ method: 'POST', url, body: {}, json: true, timeout: 8000 });
  } catch (e) {
    if (!/timeout|ETIMEDOUT|ECONNABORTED|ESOCKETTIMEDOUT/i.test(String(e && (e.code || e.message)))) throw e;
  }
};
const appHeaders = { 'x-ticket-automation-secret': APP_SECRET };
const call = (opts) => this.helpers.httpRequest({ json: true, timeout: 30000, ...opts });

// Heartbeat: tell the app the bridge is alive (and which run is in progress). If the bridge is down the app simply stops
// hearing from us, and the dashboard says "Bridge offline".
const beat = async () => {
  try {
    const health = await call({ method: 'POST', url: BRIDGE_URL + '/health', headers: { 'x-bridge-secret': BRIDGE_SECRET }, timeout: 8000 });
    await call({ method: 'POST', url: APP_URL + '/api/admin/automation-status', headers: appHeaders, body: { health } });
  } catch (e) { /* offline: nothing to report */ }
};
await beat();

let list;
try {
  list = await call({ method: 'GET', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders });
} catch (e) {
  // No network for a moment (DNS, connection refused, timeout): nothing to do until the next minute. The dashboard shows
  // "Bridge offline" when the heartbeat stops arriving, so an outage is not hidden - it just stops filling n8n with errors.
  // A real answer from the app that is an error (HTTP status) is not matched here and still fails loudly.
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|getaddrinfo|timeout/i.test(String((e && (e.code || e.message)) || ''))) return [];
  throw e;
}
const done = [];
for (const r of (list.requests || [])) {
  const claim = await call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: r.id, action: 'claim' } });
  if (!claim.claimed) continue;
  let ok = false;
  let result = '';
  try {
    if (r.kind === 'analyze') {
      await fire(ANALYST_WEBHOOK);
      ok = true;
      result = 'The analyst was started.';
    } else if (r.kind === 'night') {
      await fire(NIGHT_WEBHOOK);
      ok = true;
      result = 'The night run was started.';
    } else if (r.kind === 'digest') {
      await fire(DIGEST_WEBHOOK);
      ok = true;
      result = 'The daily digest was started.';
    } else if (r.kind === 'merge') {
      const res = await call({ method: 'POST', url: BRIDGE_URL + '/merge', headers: { 'x-bridge-secret': BRIDGE_SECRET }, body: { ticketSeq: r.ticketSeq } });
      ok = res.ok === true;
      result = res.result || '';
    } else if (r.kind === 'promote') {
      // Starts the "Daffy - Promote to Production" workflow and moves on: that workflow waits for the
      // bridge (minutes), completes this request itself and sends the confirmation email.
      await call({ method: 'POST', url: PROMOTE_WEBHOOK, body: { requestId: r.id, tickets: (r.details && r.details.tickets) || [] } });
      done.push({ id: r.id, kind: r.kind, ok: true, result: 'promotion started' });
      continue;
    } else if (r.kind === 'learn') {
      // Turning a correction into a lesson takes a few seconds and ends with an e-mail, which a code node
      // cannot send: hand it to the "Lesson Learned" workflow, which completes this request itself.
      await call({ method: 'POST', url: LESSON_WEBHOOK, body: { requestId: r.id, ticketSeq: (r.details && r.details.ticketSeq) || r.ticketSeq, source: r.details && r.details.source, comment: r.details && r.details.comment, context: r.details && r.details.context } });
      done.push({ id: r.id, kind: r.kind, ok: true, result: 'learning started' });
      continue;
    } else if (r.kind === 'revert') {
      const res = await call({ method: 'POST', url: BRIDGE_URL + '/revert', headers: { 'x-bridge-secret': BRIDGE_SECRET }, body: { ticketSeq: r.ticketSeq } });
      ok = res.ok === true;
      result = res.result || '';
    } else {
      result = 'Unknown request kind: ' + r.kind;
    }
  } catch (e) {
    result = 'The bridge could not be reached: ' + (e.message || e);
  }
  await call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: r.id, action: 'complete', ok, result } });
  done.push({ id: r.id, kind: r.kind, ok, result });
}
// A run was just started: tell the app again in a few seconds, so the dashboard shows it running without waiting for the next minute.
if (done.some((d) => ['analyze', 'night'].includes(d.kind))) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await beat();
}
return done.map((d) => ({ json: d }));
`;

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function upsert(name, nodes, connections, settings = { executionOrder: "v1" }) {
  const all = await api("GET", "/workflows?limit=100");
  const existing = (all.data || []).find((w) => w.name === name);
  const payload = { name, nodes, connections, settings };
  if (existing) {
    // Keep the webhook id of an existing workflow so its URL stays stable.
    const current = await api("GET", `/workflows/${existing.id}`);
    for (const node of nodes) {
      const old = current.nodes.find((n) => n.name === node.name);
      if (old && old.webhookId) node.webhookId = old.webhookId;
    }
    await api("PUT", `/workflows/${existing.id}`, payload);
    return existing.id;
  }
  return (await api("POST", "/workflows", payload)).id;
}

(async () => {
  // ---------- Spec Analyst: cloned from the Auto Ticket Handling workflow so the email, error handling and credentials match ----------
  const all = await api("GET", "/workflows?limit=100");
  const source = await api("GET", `/workflows/${(all.data || []).find((w) => w.name === "Daffy - Auto Ticket Handling").id}`);
  const find = (n) => JSON.parse(JSON.stringify(source.nodes.find((x) => x.name === n)));

  const schedule = find(source.nodes.find((n) => n.type === "n8n-nodes-base.scheduleTrigger").name);
  schedule.name = "Evening Schedule 18:00";
  schedule.parameters = { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 18, triggerAtMinute: 0 }] } };
  const manual = find("Manual Trigger (Webhook)");
  manual.name = "Manual Trigger (Webhook)";
  manual.parameters.path = "daffy-spec-analyst-manual";
  const run = find("Run Bridge");
  run.name = "Run Analyst";
  run.parameters.url = `${cfg.bridgeUrl}/analyze`;
  run.parameters.headerParameters = { parameters: [{ name: "x-bridge-secret", value: cfg.bridgeSecret }] };
  const summary = find("Build Summary");
  summary.name = "Build Summary";
  summary.parameters.jsCode = analystSummaryJs;
  const sendSummary = find("Send Summary Email");
  sendSummary.name = "Send Analysis Email";
  const failure = find("Build Failure Alert");
  failure.parameters.jsCode = failureJs;
  const sendFailure = find("Send Failure Email");
  const nodes = [schedule, manual, run, summary, sendSummary, failure, sendFailure];
  nodes.forEach((n, i) => {
    n.id = uuid();
    if (n.webhookId) n.webhookId = uuid();
    n.position = [i * 220 - 100, i % 2 === 0 ? -60 : 80];
  });
  const connections = {
    [schedule.name]: { main: [[{ node: run.name, type: "main", index: 0 }]] },
    [manual.name]: { main: [[{ node: run.name, type: "main", index: 0 }]] },
    [run.name]: { main: [[{ node: summary.name, type: "main", index: 0 }], [{ node: failure.name, type: "main", index: 0 }]] },
    [summary.name]: { main: [[{ node: sendSummary.name, type: "main", index: 0 }]] },
    [failure.name]: { main: [[{ node: sendFailure.name, type: "main", index: 0 }]] },
  };
  const analystId = await upsert(ANALYST_NAME, nodes, connections);

  // ---------- Poller ----------
  const pollSchedule = {
    id: uuid(), name: "Every minute", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0],
    parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } },
  };
  const pollCode = { id: uuid(), name: "Process requests", type: "n8n-nodes-base.code", typeVersion: 2, position: [240, 0], parameters: { jsCode: pollerJs } };
  const pollerId = await upsert(POLLER_NAME, [pollSchedule, pollCode], { [pollSchedule.name]: { main: [[{ node: pollCode.name, type: "main", index: 0 }]] } },
    // Runs every minute, so successful (usually empty) runs are not stored; failures still are.
    { executionOrder: "v1", saveDataSuccessExecution: "none" });

  // ---------- Promote to Production: webhook (from the poller) -> bridge /promote -> finish + email ----------
  const promoteHook = {
    id: uuid(), name: "Promote Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: uuid(),
    parameters: { httpMethod: "POST", path: "daffy-promote", responseMode: "onReceived", options: {} },
  };
  const promoteRun = JSON.parse(JSON.stringify(run));
  promoteRun.id = uuid();
  promoteRun.name = "Run Promote";
  promoteRun.position = [240, 0];
  delete promoteRun.webhookId;
  promoteRun.onError = "continueErrorOutput";
  promoteRun.parameters = {
    method: "POST", url: `${cfg.bridgeUrl}/promote`, sendHeaders: true,
    headerParameters: { parameters: [{ name: "x-bridge-secret", value: cfg.bridgeSecret }] },
    sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({ tickets: $json.body.tickets }) }}",
    options: { timeout: 3600000 },
  };
  const promoteFinish = {
    id: uuid(), name: "Finish and build email", type: "n8n-nodes-base.code", typeVersion: 2, position: [480, 0],
    parameters: { jsCode: promoteFinishJs },
  };
  const promoteMail = JSON.parse(JSON.stringify(sendSummary));
  promoteMail.id = uuid();
  promoteMail.name = "Send Promotion Email";
  promoteMail.position = [720, 0];
  promoteMail.parameters = {
    resource: "message", operation: "send",
    sendTo: '={{ [...new Set([...($json.adminEmails || []), "tsuri.barhaim@gmail.com", "shenhar.orit@gmail.com"])].join(",") }}',
    subject: "={{ $json.emailSubject }}", emailType: "html", message: "={{ $json.emailBody }}", options: { appendAttribution: false },
  };
  const promoteId = await upsert(PROMOTE_NAME, [promoteHook, promoteRun, promoteFinish, promoteMail], {
    [promoteHook.name]: { main: [[{ node: promoteRun.name, type: "main", index: 0 }]] },
    [promoteRun.name]: { main: [[{ node: promoteFinish.name, type: "main", index: 0 }], [{ node: promoteFinish.name, type: "main", index: 0 }]] },
    [promoteFinish.name]: { main: [[{ node: promoteMail.name, type: "main", index: 0 }]] },
  });

  // ---------- Lesson Learned: webhook (from the poller) -> bridge /learn -> finish + e-mail ----------
  const lessonHook = {
    id: uuid(), name: "Lesson Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: uuid(),
    parameters: { httpMethod: "POST", path: "daffy-lesson", responseMode: "onReceived", options: {} },
  };
  const lessonRun = JSON.parse(JSON.stringify(run));
  lessonRun.id = uuid();
  lessonRun.name = "Run Learn";
  lessonRun.position = [240, 0];
  delete lessonRun.webhookId;
  lessonRun.onError = "continueErrorOutput";
  lessonRun.parameters = {
    method: "POST", url: `${cfg.bridgeUrl}/learn`, sendHeaders: true,
    headerParameters: { parameters: [{ name: "x-bridge-secret", value: cfg.bridgeSecret }] },
    sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({ ticketSeq: $json.body.ticketSeq, source: $json.body.source, comment: $json.body.comment, context: $json.body.context }) }}",
    options: { timeout: 300000 },
  };
  const lessonFinish = { id: uuid(), name: "Finish and build email", type: "n8n-nodes-base.code", typeVersion: 2, position: [480, 0], parameters: { jsCode: lessonFinishJs } };
  const lessonMail = JSON.parse(JSON.stringify(sendSummary));
  lessonMail.id = uuid();
  lessonMail.name = "Send Lesson Email";
  lessonMail.position = [720, 0];
  lessonMail.parameters = {
    resource: "message", operation: "send",
    sendTo: '={{ [...new Set([...($json.adminEmails || []), "tsuri.barhaim@gmail.com"])].join(",") }}',
    subject: "={{ $json.emailSubject }}", emailType: "html", message: "={{ $json.emailBody }}", options: { appendAttribution: false },
  };
  const lessonId = await upsert(LESSON_NAME, [lessonHook, lessonRun, lessonFinish, lessonMail], {
    [lessonHook.name]: { main: [[{ node: lessonRun.name, type: "main", index: 0 }]] },
    [lessonRun.name]: { main: [[{ node: lessonFinish.name, type: "main", index: 0 }], [{ node: lessonFinish.name, type: "main", index: 0 }]] },
    [lessonFinish.name]: { main: [[{ node: lessonMail.name, type: "main", index: 0 }]] },
  });

  console.log(`mode=${mode}  analyst=${analystId}  poller=${pollerId}  promote=${promoteId}  lesson=${lessonId}`);
  for (const [id, name] of [[analystId, ANALYST_NAME], [pollerId, POLLER_NAME], [promoteId, PROMOTE_NAME], [lessonId, LESSON_NAME]]) {
    if (action === "activate") await api("POST", `/workflows/${id}/publish`, {});
    if (action === "deactivate") await api("POST", `/workflows/${id}/deactivate`, {}).catch((e) => console.log("deactivate:", e.message));
    const w = await api("GET", `/workflows/${id}`);
    console.log(`  ${name}: active=${w.active}`);
  }
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
