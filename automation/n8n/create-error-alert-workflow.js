// Creates (or updates) the n8n workflow "Daffy - Error Alert" and, with `attach`, names it as the error workflow of every other
// "Daffy - ..." workflow. When any of them fails, this one tells the app (an in-app notification for every admin, shown by the
// bell and in red on the Ticket Automation dashboard) and tries to send an e-mail as well. The e-mail alone would not be enough:
// when the failure IS the e-mail sending, it fails too, which is why the in-app notification comes first.
//
//   node create-error-alert-workflow.js <dev|prod> [attach]
//
// dev  = alerts go to the dev app (localhost:3000); never attaches (it would change the real workflows)
// prod = alerts go to https://daffy-pilot.vercel.app; `attach` also sets the error workflow on the other Daffy workflows
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
const attach = process.argv[3] === "attach";
if (mode !== "dev" && mode !== "prod") {
  console.error("usage: node create-error-alert-workflow.js <dev|prod> [attach]");
  process.exit(1);
}
if (mode === "dev" && attach) {
  console.error("attach is only for prod: in dev it would change the real workflows.");
  process.exit(1);
}
const n8nEnv = loadEnv(path.join(__dirname, ".env.local"));
const bridgeEnv = loadEnv(path.join(__dirname, "bridge", mode === "dev" ? ".env.local.devtest" : ".env.local"));
const ROOT = n8nEnv.N8N_BASE_URL || "http://localhost:5678";
const BASE = `${ROOT}/api/v1`;
const H = { "X-N8N-API-KEY": n8nEnv.N8N_API_KEY, "Content-Type": "application/json" };
const appUrl = mode === "dev" ? "http://host.docker.internal:3000" : bridgeEnv.DAFFY_BASE_URL;
const appSecret = bridgeEnv.N8N_TICKET_AUTOMATION_SECRET;
const NAME = mode === "dev" ? "Daffy - Error Alert (dev)" : "Daffy - Error Alert";
const SMTP = { id: "RQAeQwoyPyJfEvaX", name: "Daffy SMTP" };
const uuid = () => crypto.randomUUID();

async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const buildJs = `// What failed, in one line, from the Error Trigger.
const ex = $json.execution || {};
const wf = $json.workflow || {};
const err = ex.error || {};
const workflow = String(wf.name || 'a workflow');
const node = String(ex.lastNodeExecuted || (err.node && err.node.name) || '');
const message = String(err.message || 'no details').replace(/\\s+/g, ' ').slice(0, 280);
return [{ json: { workflow, node, message, executionId: ex.id || '' } }];
`;

const notifyJs = `// 1) the app: an in-app notification for every admin (no repeat of the same alert within 6 hours).
const a = $input.first().json;
let notified = 'not reached';
try {
  const r = await this.helpers.httpRequest({ method: 'POST', url: '${appUrl}/api/admin/automation-alerts', headers: { 'x-ticket-automation-secret': '${appSecret}' }, body: { workflow: a.workflow, node: a.node, message: a.message }, json: true, timeout: 30000 });
  notified = 'alerted ' + r.alerted + ', repeats skipped ' + r.skipped;
} catch (e) {
  notified = 'the app could not be reached: ' + String((e && e.message) || e).slice(0, 120);
}
const key = a.node ? a.workflow + ' / ' + a.node : a.workflow;
return [{ json: { ...a, notified, emailSubject: 'Daffy automation failed: ' + key, emailBody: 'The automation reported a failure.\\n\\nWorkflow: ' + a.workflow + '\\nStep: ' + (a.node || '(unknown)') + '\\nWhat n8n said: ' + a.message + '\\n\\nExecution ' + a.executionId + ' (n8n: http://localhost:5678/executions)\\nIn the app: ${bridgeEnv.DAFFY_BASE_URL || ""}/app/tickets/automation' } }];
`;

async function main() {
  const trigger = { id: uuid(), name: "Error Trigger", type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [0, 0], parameters: {} };
  const build = { id: uuid(), name: "What failed", type: "n8n-nodes-base.code", typeVersion: 2, position: [240, 0], parameters: { jsCode: buildJs } };
  const notify = { id: uuid(), name: "Tell the app", type: "n8n-nodes-base.code", typeVersion: 2, position: [480, 0], parameters: { jsCode: notifyJs } };
  const mail = {
    id: uuid(), name: "Send alert email", type: "n8n-nodes-base.emailSend", typeVersion: 2.1, position: [720, 0], continueOnFail: true, credentials: { smtp: { ...SMTP } },
    parameters: { fromEmail: "Daffy <daffy.healthcompanion@gmail.com>", toEmail: "tsuri.barhaim@gmail.com", subject: "=⚠ {{ $json.emailSubject }}", emailFormat: "text", text: "={{ $json.emailBody }}", options: { appendAttribution: false } },
  };
  const nodes = [trigger, build, notify, mail];
  const connections = {
    [trigger.name]: { main: [[{ node: build.name, type: "main", index: 0 }]] },
    [build.name]: { main: [[{ node: notify.name, type: "main", index: 0 }]] },
    [notify.name]: { main: [[{ node: mail.name, type: "main", index: 0 }]] },
  };
  const existing = (await api("GET", "/workflows?limit=100")).data.find((w) => w.name === NAME);
  const body = { name: NAME, nodes, connections, settings: { executionOrder: "v1" } };
  const saved = existing ? await api("PUT", `/workflows/${existing.id}`, body) : await api("POST", "/workflows", body);
  console.log(`${existing ? "updated" : "created"}: ${NAME} (${saved.id})`);
  // An error workflow does not have to be active; try anyway and carry on if n8n says it cannot.
  await api("POST", `/workflows/${saved.id}/activate`, {}).then(() => console.log("activated")).catch((e) => console.log("not activated (fine for an error workflow):", e.message.slice(0, 120)));

  if (attach) {
    const others = (await api("GET", "/workflows?limit=100")).data.filter((w) => w.name.startsWith("Daffy - ") && w.id !== saved.id);
    for (const w of others) {
      const full = await api("GET", `/workflows/${w.id}`);
      if (full.settings?.errorWorkflow === saved.id) { console.log("already attached:", full.name); continue; }
      await api("PUT", `/workflows/${w.id}`, { name: full.name, nodes: full.nodes, connections: full.connections, settings: { ...(full.settings || { executionOrder: "v1" }), errorWorkflow: saved.id } });
      console.log("attached to:", full.name);
    }
  }
  return saved.id;
}

main().then((id) => console.log("done", id)).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
