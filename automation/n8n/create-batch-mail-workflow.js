// Creates (or updates) the n8n workflow that mails the daily batch's "ready to promote" and "done" emails:
//   "Daffy - Batch Mail"   webhook POST { subject, html } (called by the bridge's syncBatchAndMail after a run or a promotion)
//                          -> e-mail to the admin
//
//   node create-batch-mail-workflow.js [activate|deactivate]
//
// The e-mail node is cloned from "Daffy - Daily Admin Digest" (the "Daffy SMTP" credential, not written here). The webhook
// only listens on n8n's local port; the app renders the email, the bridge relays it, n8n only sends it.
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
const NAME = "Daffy - Batch Mail";
const HOOK_PATH = "daffy-batch-mail";
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
  if (!digest) throw new Error('"Daffy - Daily Admin Digest" must exist: its e-mail node is reused.');
  const digestWf = await api("GET", `/workflows/${digest.id}`);
  const hook = {
    id: uuid(), name: "Batch Mail Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: uuid(),
    parameters: { httpMethod: "POST", path: HOOK_PATH, responseMode: "lastNode", options: {} },
  };
  const send = { ...JSON.parse(JSON.stringify(digestWf.nodes.find((node) => node.name === "Send Digest Email"))), id: uuid(), name: "Send Batch Email", position: [260, 0] };
  send.parameters = { ...send.parameters, toEmail: RECIPIENTS.join(","), subject: "={{ $json.body.subject }}", emailFormat: "html", html: "={{ $json.body.html }}" };
  const payload = {
    name: NAME,
    nodes: [hook, send],
    connections: { [hook.name]: { main: [[{ node: send.name, type: "main", index: 0 }]] } },
    settings: { ...(digestWf.settings || {}), timezone: "Asia/Jerusalem" },
  };
  const existing = (all.data || []).find((w) => w.name === NAME);
  let id;
  if (existing) {
    const current = await api("GET", `/workflows/${existing.id}`);
    const oldHook = current.nodes.find((node) => node.name === hook.name);
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
    console.log(`activated: POST http://localhost:5678/webhook/${HOOK_PATH}`);
  }
  if (action === "deactivate") {
    await api("POST", `/workflows/${id}/deactivate`, {});
    console.log("deactivated");
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
