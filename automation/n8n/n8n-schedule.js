// Reads/changes the schedule trigger of the "Daffy - Auto Ticket Handling" n8n workflow.
//   node n8n-schedule.js status
//   node n8n-schedule.js enable | disable
//   node n8n-schedule.js set HH:MM        (24h, Israel time - n8n runs in Asia/Jerusalem)
// The node is renamed to "Nightly Schedule HH:MM" (or "Evening Schedule HH:MM" with JOB=analyst) so its name always matches its time.
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, ".env.local"), "utf8");
const KEY = env.split(/\r?\n/).find((l) => l.startsWith("N8N_API_KEY="))?.slice("N8N_API_KEY=".length).replace(/^"|"$/g, "");
const BASE = "http://localhost:5678/api/v1";
// JOB=analyst targets the evening spec analyst workflow instead of the nightly run.
const JOB = process.env.JOB === "analyst" ? "analyst" : "night";
const ID = JOB === "analyst" ? "pKppGftX2H6ZtLr0" : "laS2Rbh58PsmS3DB";
const NODE_LABEL = JOB === "analyst" ? "Evening Schedule" : "Nightly Schedule";
const H = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };

const pad = (n) => String(n).padStart(2, "0");
const describe = (node) => {
  const i = node.parameters.rule.interval[0];
  return `${pad(i.triggerAtHour)}:${pad(i.triggerAtMinute ?? 0)} | ${node.disabled ? "DISABLED" : "enabled"} | node name: "${node.name}"`;
};

async function save(wf) {
  const put = await fetch(`${BASE}/workflows/${ID}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  if (!put.ok) throw new Error(`PUT ${put.status}: ${await put.text()}`);
  const pub = await fetch(`${BASE}/workflows/${ID}/publish`, { method: "POST", headers: H, body: "{}" });
  if (!pub.ok) throw new Error(`publish ${pub.status}: ${await pub.text()}`);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  const wf = await (await fetch(`${BASE}/workflows/${ID}`, { headers: H })).json();
  const node = wf.nodes.find((n) => n.type === "n8n-nodes-base.scheduleTrigger");
  if (!node) throw new Error("schedule trigger node not found");

  if (cmd === "status" || !cmd) return console.log("n8n schedule:", describe(node));

  if (cmd === "enable" || cmd === "disable") {
    node.disabled = cmd === "disable";
  } else if (cmd === "set") {
    const m = /^(\d{1,2}):(\d{2})$/.exec(arg || "");
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('usage: set HH:MM (24h), e.g. "set 02:15"');
    node.parameters = { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: +m[1], triggerAtMinute: +m[2] }] } };
    const newName = `${NODE_LABEL} ${pad(+m[1])}:${m[2]}`;
    if (node.name !== newName) {
      const old = node.name;
      node.name = newName;
      if (wf.connections[old]) {
        wf.connections[newName] = wf.connections[old];
        delete wf.connections[old];
      }
    }
  } else {
    throw new Error("unknown command: " + cmd);
  }
  await save(wf);
  const after = await (await fetch(`${BASE}/workflows/${ID}`, { headers: H })).json();
  const n = after.nodes.find((x) => x.type === "n8n-nodes-base.scheduleTrigger");
  console.log("n8n schedule:", describe(n), "| workflow active:", after.active, "| version==active:", after.versionId === after.activeVersionId);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
