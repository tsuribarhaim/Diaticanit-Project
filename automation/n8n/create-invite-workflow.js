// Creates (or updates) the n8n workflow that sends the welcome email when an admin adds a new user with "Send a welcome email" ticked:
//   "Daffy - Welcome Invite"   webhook (called by the Review Requests Poller for an 'invite' request)
//                              -> asks the app for the email (subject + html + recipient) -> sends it over SMTP -> closes the request
//
//   node create-invite-workflow.js <test|prod> [activate|deactivate]
//
// test = a throwaway copy ("Daffy - Welcome Invite (TEST)", webhook daffy-welcome-invite-test) that talks to the DEV app (localhost:3000):
//        for trying the email out without touching the live automation. Delete it afterwards with:  node create-invite-workflow.js test delete
// prod = the real workflow, talking to https://daffy-pilot.vercel.app. Also adds the 'invite' branch to the live poller (once; the same branch
//        is in create-spec-workflows.js, so a full run of that script keeps it).
// The e-mail node is cloned from "Daffy - Promote to Production", so it uses the same "Daffy SMTP" credential. A failure closes the request as
// failed and then fails the workflow on purpose, so "Daffy - Error Alert" (attached to it with create-error-alert-workflow.js) tells the admins.
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
if (mode !== "test" && mode !== "prod") {
  console.error("usage: node create-invite-workflow.js <test|prod> [activate|deactivate|delete]");
  process.exit(1);
}
const n8nEnv = loadEnv(path.join(__dirname, ".env.local"));
const bridgeEnv = loadEnv(path.join(__dirname, "bridge", mode === "test" ? ".env.local.devtest" : ".env.local"));
const BASE = `${n8nEnv.N8N_BASE_URL || "http://localhost:5678"}/api/v1`;
const H = { "X-N8N-API-KEY": n8nEnv.N8N_API_KEY, "Content-Type": "application/json" };
const appUrl = mode === "test" ? "http://host.docker.internal:3000" : bridgeEnv.DAFFY_BASE_URL;
const appSecret = bridgeEnv.N8N_TICKET_AUTOMATION_SECRET;
const NAME = mode === "test" ? "Daffy - Welcome Invite (TEST)" : "Daffy - Welcome Invite";
const HOOK_PATH = mode === "test" ? "daffy-welcome-invite-test" : "daffy-welcome-invite";
const uuid = () => crypto.randomUUID();

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const prelude = `const APP_URL = '${appUrl}';
const appHeaders = { 'x-ticket-automation-secret': '${appSecret}' };
const call = (opts) => this.helpers.httpRequest({ json: true, timeout: 30000, ...opts });
const requestId = ($('Welcome Webhook').first().json.body || {}).requestId;
const complete = (ok, result) => call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: requestId, action: 'complete', ok, result } });
`;

// Step 1: the email, rendered by the app (one source of truth for the wording and the languages).
const getEmailJs = `${prelude}
try {
  const mail = await call({ method: 'POST', url: APP_URL + '/api/admin/automation-requests', headers: appHeaders, body: { id: requestId, action: 'invite_email' } });
  return [{ json: { to: mail.to, subject: mail.subject, html: mail.html } }];
} catch (e) {
  const why = String((e && (e.message || e)) || 'unknown error').slice(0, 300);
  try { await complete(false, 'Could not prepare the welcome email: ' + why); } catch (e2) { /* the original failure is the one to report */ }
  throw new Error('Welcome email: could not prepare it (' + why + ')');
}
`;

const doneJs = `${prelude}
const mail = $('Get email').first().json;
await complete(true, 'Welcome email sent to ' + mail.to);
return [{ json: { ok: true, to: mail.to } }];
`;

const failedJs = `${prelude}
const mail = $('Get email').first().json;
const err = $input.first().json || {};
const why = String((err.error && (err.error.message || err.error)) || err.message || 'unknown error').slice(0, 300);
await complete(false, 'The welcome email to ' + mail.to + ' could not be sent: ' + why);
// Fail on purpose: "Daffy - Error Alert" then tells the admins that a welcome email did not go out.
throw new Error('Welcome email to ' + mail.to + ' could not be sent: ' + why);
`;

// The 'invite' branch added to the poller (also written in create-spec-workflows.js).
const POLLER_MARK = "} else if (r.kind === 'revert') {";
const pollerBranch = `} else if (r.kind === 'invite') {
      // The welcome email for a new user: handed to the "Welcome Invite" workflow, which sends it and completes this request itself.
      await call({ method: 'POST', url: 'http://localhost:5678/webhook/daffy-welcome-invite', body: { requestId: r.id } });
      done.push({ id: r.id, kind: r.kind, ok: true, result: 'welcome email started' });
      continue;
    `;

(async () => {
  const all = await api("GET", "/workflows?limit=100");
  const existing = (all.data || []).find((w) => w.name === NAME);
  if (action === "delete") {
    if (!existing) return console.log("nothing to delete");
    await api("POST", `/workflows/${existing.id}/deactivate`, {}).catch(() => {});
    await api("DELETE", `/workflows/${existing.id}`);
    return console.log(`deleted ${NAME}`);
  }

  const promote = (all.data || []).find((w) => w.name === "Daffy - Promote to Production");
  const source = await api("GET", `/workflows/${promote.id}`);
  const mailNode = JSON.parse(JSON.stringify(source.nodes.find((n) => n.name === "Send Promotion Email")));
  mailNode.id = uuid();
  mailNode.name = "Send Welcome Email";
  mailNode.position = [720, 0];
  mailNode.onError = "continueErrorOutput";
  mailNode.parameters = {
    fromEmail: "Daffy <daffy.healthcompanion@gmail.com>",
    toEmail: "={{ $json.to }}",
    subject: "={{ $json.subject }}",
    emailFormat: "html",
    html: "={{ $json.html }}",
    options: { appendAttribution: false },
  };
  const hook = {
    id: uuid(), name: "Welcome Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: uuid(),
    parameters: { httpMethod: "POST", path: HOOK_PATH, responseMode: "onReceived", options: {} },
  };
  const getEmail = { id: uuid(), name: "Get email", type: "n8n-nodes-base.code", typeVersion: 2, position: [240, 0], parameters: { jsCode: getEmailJs } };
  const done = { id: uuid(), name: "Complete OK", type: "n8n-nodes-base.code", typeVersion: 2, position: [960, -60], parameters: { jsCode: doneJs } };
  const failed = { id: uuid(), name: "Complete failed", type: "n8n-nodes-base.code", typeVersion: 2, position: [960, 100], parameters: { jsCode: failedJs } };
  const nodes = [hook, getEmail, mailNode, done, failed];
  const connections = {
    [hook.name]: { main: [[{ node: getEmail.name, type: "main", index: 0 }]] },
    [getEmail.name]: { main: [[{ node: mailNode.name, type: "main", index: 0 }]] },
    [mailNode.name]: { main: [[{ node: done.name, type: "main", index: 0 }], [{ node: failed.name, type: "main", index: 0 }]] },
  };
  const payload = { name: NAME, nodes, connections, settings: { executionOrder: "v1" } };
  let id;
  if (existing) {
    const current = await api("GET", `/workflows/${existing.id}`);
    const oldHook = current.nodes.find((n) => n.name === hook.name);
    if (oldHook && oldHook.webhookId) hook.webhookId = oldHook.webhookId;
    await api("PUT", `/workflows/${existing.id}`, payload);
    id = existing.id;
  } else {
    id = (await api("POST", "/workflows", payload)).id;
  }
  if (action === "activate") await api("POST", `/workflows/${id}/publish`, {});
  if (action === "deactivate") await api("POST", `/workflows/${id}/deactivate`, {});
  console.log(`${NAME}: id=${id} active=${(await api("GET", `/workflows/${id}`)).active}  webhook=/webhook/${HOOK_PATH}`);

  if (mode === "prod") {
    const poller = (all.data || []).find((w) => w.name === "Daffy - Review Requests Poller");
    const live = await api("GET", `/workflows/${poller.id}`);
    const codeNode = live.nodes.find((n) => n.name === "Process requests");
    if (codeNode.parameters.jsCode.includes("r.kind === 'invite'")) return console.log("poller already has the invite branch");
    if (!codeNode.parameters.jsCode.includes(POLLER_MARK)) throw new Error("poller code changed: cannot find the place for the invite branch");
    codeNode.parameters.jsCode = codeNode.parameters.jsCode.replace(POLLER_MARK, pollerBranch + POLLER_MARK);
    await api("PUT", `/workflows/${poller.id}`, { name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings });
    if (live.active) await api("POST", `/workflows/${poller.id}/publish`, {});
    console.log("poller updated with the invite branch");
  }
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
