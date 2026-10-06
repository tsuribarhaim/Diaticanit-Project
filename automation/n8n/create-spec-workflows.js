// Creates (or updates) the two n8n workflows behind the spec-first review flow:
//   "Daffy - Spec Analyst"            evening schedule + manual webhook -> bridge /analyze -> email
//   "Daffy - Review Requests Poller"  every 5 minutes -> picks up "Run analysis now" / "Merge to dev"
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
const appHeaders = { 'x-ticket-automation-secret': APP_SECRET };
const call = (opts) => this.helpers.httpRequest({ json: true, timeout: 30000, ...opts });

const list = await call({ method: 'GET', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders });
const done = [];
for (const r of (list.requests || [])) {
  const claim = await call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: r.id, action: 'claim' } });
  if (!claim.claimed) continue;
  let ok = false;
  let result = '';
  try {
    if (r.kind === 'analyze') {
      const res = await call({ method: 'POST', url: BRIDGE_URL + '/analyze', headers: { 'x-bridge-secret': BRIDGE_SECRET }, timeout: 25 * 60 * 1000 });
      ok = !res.error;
      result = res.skipped === true ? 'An analysis was already running.' : (res.analyzed ? res.analyzed.length + ' proposal(s) ready' + (res.failed && res.failed.length ? ', ' + res.failed.length + ' failed' : '') : (res.error || 'done'));
    } else if (r.kind === 'merge') {
      const res = await call({ method: 'POST', url: BRIDGE_URL + '/merge', headers: { 'x-bridge-secret': BRIDGE_SECRET }, body: { ticketSeq: r.ticketSeq } });
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
return done.map((d) => ({ json: d }));
`;

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function upsert(name, nodes, connections) {
  const all = await api("GET", "/workflows?limit=100");
  const existing = (all.data || []).find((w) => w.name === name);
  const payload = { name, nodes, connections, settings: { executionOrder: "v1" } };
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
    id: uuid(), name: "Every 5 minutes", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0],
    parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } },
  };
  const pollCode = { id: uuid(), name: "Process requests", type: "n8n-nodes-base.code", typeVersion: 2, position: [240, 0], parameters: { jsCode: pollerJs } };
  const pollerId = await upsert(POLLER_NAME, [pollSchedule, pollCode], { [pollSchedule.name]: { main: [[{ node: pollCode.name, type: "main", index: 0 }]] } });

  console.log(`mode=${mode}  analyst=${analystId}  poller=${pollerId}`);
  for (const [id, name] of [[analystId, ANALYST_NAME], [pollerId, POLLER_NAME]]) {
    if (action === "activate") await api("POST", `/workflows/${id}/publish`, {});
    if (action === "deactivate") await api("POST", `/workflows/${id}/deactivate`, {}).catch((e) => console.log("deactivate:", e.message));
    const w = await api("GET", `/workflows/${id}`);
    console.log(`  ${name}: active=${w.active}`);
  }
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
