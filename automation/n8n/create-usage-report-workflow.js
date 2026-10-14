// Creates (or updates) the n8n workflow that mails the weekly usage report:
//   "Daffy - Weekly Usage Report"   every Sunday at 08:00 (Israel time), or POST to the manual webhook
//                                   -> GET https://daffy-pilot.vercel.app/api/admin/usage-report -> e-mail to the admin
//
//   node create-usage-report-workflow.js [activate|deactivate]
//
// The request and e-mail nodes are cloned from "Daffy - Daily Admin Digest", so they carry the same x-digest-secret and the
// same "Daffy SMTP" credential (neither is written into this file). Recipients: the admin only, for now (RECIPIENTS below).
// Manual test send:  curl -X POST http://localhost:5678/webhook/daffy-weekly-usage-manual
// Failures go to "Daffy - Error Alert", like the digest.
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
const NAME = "Daffy - Weekly Usage Report";
const HOOK_PATH = "daffy-weekly-usage-manual";
const REPORT_URL = "https://daffy-pilot.vercel.app/api/admin/usage-report";
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
  const digest = (all.data || []).find((w) => w.name === "Daffy - Daily Admin Digest");
  if (!digest) throw new Error('"Daffy - Daily Admin Digest" not found - it holds the secret and the SMTP credential this workflow reuses.');
  const source = await api("GET", `/workflows/${digest.id}`);
  const clone = (name) => JSON.parse(JSON.stringify(source.nodes.find((n) => n.name === name)));

  const schedule = {
    id: uuid(),
    name: "Every Sunday 8am",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: [0, 0],
    parameters: { rule: { interval: [{ field: "weeks", weeksInterval: 1, triggerAtDay: [0], triggerAtHour: 8, triggerAtMinute: 0 }] } },
  };
  const hook = {
    id: uuid(),
    name: "Manual Trigger (Webhook)",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 200],
    webhookId: uuid(),
    parameters: { httpMethod: "POST", path: HOOK_PATH, responseMode: "lastNode", options: {} },
  };
  const get = { ...clone("Get Daffy Digest"), id: uuid(), name: "Get Usage Report", position: [260, 100] };
  get.parameters = { ...get.parameters, url: REPORT_URL };
  const send = { ...clone("Send Digest Email"), id: uuid(), name: "Send Usage Report", position: [520, 100] };
  send.parameters = { ...send.parameters, toEmail: RECIPIENTS.join(","), subject: "={{ $json.emailSubject }}", html: "={{ $json.emailBody }}" };

  const payload = {
    name: NAME,
    nodes: [schedule, hook, get, send],
    connections: {
      [schedule.name]: { main: [[{ node: get.name, type: "main", index: 0 }]] },
      [hook.name]: { main: [[{ node: get.name, type: "main", index: 0 }]] },
      [get.name]: { main: [[{ node: send.name, type: "main", index: 0 }]] },
    },
    settings: { ...(source.settings || {}), timezone: "Asia/Jerusalem" },
  };

  const existing = (all.data || []).find((w) => w.name === NAME);
  let id;
  if (existing) {
    // Keep the manual webhook's id, so its URL stays registered the same way.
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
    console.log("activated: it runs every Sunday at 08:00 Israel time");
  }
  if (action === "deactivate") {
    await api("POST", `/workflows/${id}/deactivate`, {});
    console.log("deactivated");
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
