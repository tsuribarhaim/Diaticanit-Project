// Creates (or updates) the n8n workflow of the daily batch's first step (memory "daily-batch-process"; app lib/daily-batch.ts):
//   "Daffy - Daily Batch"   every day at 16:00 (Israel time), or POST to the manual webhook
//                           -> bridge POST /triage (picks up to 8 clear, small tickets; the app records the proposed batch
//                              and renders the approval email) -> e-mail to the admin, only when a batch was created
//
//   node create-daily-batch-workflow.js [activate|deactivate]
//
// The bridge call is cloned from "Daffy - Auto Ticket Handling" (same x-bridge-secret) and the e-mail node from
// "Daffy - Daily Admin Digest" (same "Daffy SMTP" credential); neither secret is written here. Manual run:
//   curl -X POST http://localhost:5678/webhook/daffy-daily-batch-manual
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

const action = process.argv[2];
const n8nEnv = loadEnv(path.join(__dirname, ".env.local"));
const BASE = `${n8nEnv.N8N_BASE_URL || "http://localhost:5678"}/api/v1`;
const H = { "X-N8N-API-KEY": n8nEnv.N8N_API_KEY, "Content-Type": "application/json" };
const NAME = "Daffy - Daily Batch";
const HOOK_PATH = "daffy-daily-batch-manual";
const RECIPIENTS = ["tsuri.barhaim@gmail.com"];
const uuid = () => crypto.randomUUID();

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  const all = await api("GET", "/workflows?limit=100");
  const byName = (name) => (all.data || []).find((w) => w.name === name);
  const night = byName("Daffy - Auto Ticket Handling");
  const digest = byName("Daffy - Daily Admin Digest");
  if (!night || !digest) throw new Error('"Daffy - Auto Ticket Handling" and "Daffy - Daily Admin Digest" must exist: their bridge call and e-mail node are reused.');
  const nightWf = await api("GET", `/workflows/${night.id}`);
  const digestWf = await api("GET", `/workflows/${digest.id}`);
  const clone = (wf, name) => JSON.parse(JSON.stringify(wf.nodes.find((n) => n.name === name)));

  const schedule = {
    id: uuid(), name: "Every Day 16:00", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0],
    parameters: { rule: { interval: [{ field: "days", triggerAtHour: 16, triggerAtMinute: 0 }] } },
  };
  const hook = {
    id: uuid(), name: "Manual Trigger (Webhook)", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 200], webhookId: uuid(),
    parameters: { httpMethod: "POST", path: HOOK_PATH, responseMode: "lastNode", options: {} },
  };
  const triage = { ...clone(nightWf, "Run Bridge"), id: uuid(), name: "Run Triage", position: [260, 100] };
  triage.parameters = { ...triage.parameters, url: String(triage.parameters.url).replace(/\/run$/, "/triage"), options: { ...(triage.parameters.options || {}), timeout: 3600000 } };
  const gate = {
    id: uuid(), name: "Only When A Batch Was Made", type: "n8n-nodes-base.code", typeVersion: 2, position: [520, 100],
    parameters: { jsCode: "// No email on a day with nothing clear and small (or when the triage was skipped: another agent, Pause).\nconst r = $input.first().json || {};\nreturn r.batchId && r.emailBody ? [{ json: r }] : [];" },
  };
  const send = { ...clone(digestWf, "Send Digest Email"), id: uuid(), name: "Send Approval Email", position: [780, 100] };
  send.parameters = { ...send.parameters, toEmail: RECIPIENTS.join(","), subject: "={{ $json.emailSubject }}", emailFormat: "html", html: "={{ $json.emailBody }}" };

  const payload = {
    name: NAME,
    nodes: [schedule, hook, triage, gate, send],
    connections: {
      [schedule.name]: { main: [[{ node: triage.name, type: "main", index: 0 }]] },
      [hook.name]: { main: [[{ node: triage.name, type: "main", index: 0 }]] },
      [triage.name]: { main: [[{ node: gate.name, type: "main", index: 0 }]] },
      [gate.name]: { main: [[{ node: send.name, type: "main", index: 0 }]] },
    },
    settings: { ...(digestWf.settings || {}), timezone: "Asia/Jerusalem" },
  };

  const existing = byName(NAME);
  let id;
  if (existing) {
    const current = await api("GET", `/workflows/${existing.id}`);
    const oldHook = current.nodes.find((n) => n.name === hook.name);
    if (oldHook && oldHook.webhookId) hook.webhookId = oldHook.webhookId;
    await api("PUT", `/workflows/${existing.id}`, payload);
    id = existing.id;
    console.log(`updated "${NAME}" (${id})`);
  } else {
    id = (await api("POST", "/workflows", payload)).id;
    console.log(`created "${NAME}" (${id})`);
  }
  if (action === "activate") {
    await api("POST", `/workflows/${id}/publish`, {});
    console.log("activated: runs every day at 16:00 Israel time");
  }
  if (action === "deactivate") {
    await api("POST", `/workflows/${id}/deactivate`, {});
    console.log("deactivated");
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
