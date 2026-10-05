"use strict";

/**
 * Auto Ticket Handling bridge (see docs/design/auto-ticket-handling.md).
 * Listens locally for n8n's daily trigger, pulls whatever tickets an admin
 * has opted in (auto_handle = 'Y') from the live Daffy API, investigates
 * each one with Claude Code running headlessly - read-only tools only, no
 * file edits, no shell access, a hard per-ticket cost cap - in a fresh,
 * disposable git worktree, and reports the result back to Daffy. Phase 1
 * only: produces a plan/classification, never touches a real file. No
 * dependencies - plain Node (18+) built-ins only, so there's nothing to
 * `npm install` before running this.
 *
 * Run with: node server.js
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

function loadEnvLocal(filePath) {
  const env = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

// Accepts an optional override path as the first CLI arg (used for safe
// dev-pointed test runs without touching the real .env.local that n8n's
// production runs use) - defaults to the real config.
const envFilePath = process.argv[2] || path.join(__dirname, ".env.local");
const env = loadEnvLocal(envFilePath);

const PORT = Number(env.BRIDGE_PORT || 7891);
const LOCAL_SECRET = env.BRIDGE_LOCAL_SECRET;
const DAFFY_BASE_URL = env.DAFFY_BASE_URL;
const TICKET_SECRET = env.N8N_TICKET_AUTOMATION_SECRET;
const REPO_PATH = env.REPO_PATH;
const WORKTREE_BASE = env.WORKTREE_BASE;
const MAX_BUDGET_USD = env.MAX_BUDGET_USD_PER_TICKET || "1.00";
const CLAUDE_TIMEOUT_MS = Number(env.CLAUDE_TIMEOUT_MS || 300000);
// The global `claude` command is a Windows .cmd shim - child_process.execFile
// with shell:false (required - the prompt embeds a ticket's own
// user-submitted description, which must never pass through a real shell)
// can't resolve that shim's extension on its own. Invoking this script
// directly through node's own executable (process.execPath) sidesteps the
// shim entirely: a real binary + a real argv array, no shell involved.
const CLAUDE_CLI_PATH = env.CLAUDE_CLI_PATH;

for (const [key, value] of Object.entries({ LOCAL_SECRET, DAFFY_BASE_URL, TICKET_SECRET, REPO_PATH, WORKTREE_BASE, CLAUDE_CLI_PATH })) {
  if (!value) {
    console.error(`Missing required config: ${key} (check .env.local)`);
    process.exit(1);
  }
}

const RESULT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    classification: { type: "string", enum: ["safe_code_fix", "needs_judgment", "unclear"] },
    diagnosis: { type: "string" },
    proposedFix: { type: ["string", "null"] },
    filesLikelyInvolved: { type: "array", items: { type: "string" } },
  },
  required: ["classification", "diagnosis", "proposedFix", "filesLikelyInvolved"],
  additionalProperties: false,
});

function buildPrompt(ticket) {
  return [
    "You are doing a READ-ONLY investigation of a support ticket for the Daffy app (this repository).",
    "You only have read-only tools available (Read, Grep, Glob) - there is no way for you to edit anything, so don't attempt to.",
    "",
    `Ticket TCK-${ticket.ticket_seq}: "${ticket.subject}"`,
    `Type: ${ticket.ticket_type} | Area: ${ticket.area} | Priority: ${ticket.priority}`,
    `Description: ${ticket.description}`,
    "",
    "Investigate the real code (grep/read the relevant files; check recent git log/blame if it helps) and determine whether " +
      "this is a safe, narrowly-scoped pure code fix with no functionality or UI/UX decision involved, or whether it " +
      "needs a human's judgment call (a product/UX decision, ambiguous requirements, something already fixed, or anything " +
      "you're genuinely not confident about). Be conservative: when in doubt, classify as needs_judgment rather than " +
      "guessing. Output your findings per the provided JSON schema.",
  ].join("\n");
}

async function fetchQueue() {
  const res = await fetch(`${DAFFY_BASE_URL}/api/admin/tickets/auto-handle-queue`, {
    headers: { "x-ticket-automation-secret": TICKET_SECRET },
  });
  if (!res.ok) throw new Error(`Queue fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.tickets || [];
}

async function reportResult(ticketId, autoHandle, notes, status) {
  const res = await fetch(`${DAFFY_BASE_URL}/api/admin/tickets/auto-handle-result`, {
    method: "POST",
    headers: { "x-ticket-automation-secret": TICKET_SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId, autoHandle, notes, status }),
  });
  if (!res.ok) throw new Error(`Result report failed: HTTP ${res.status} - ${await res.text()}`);
}

function runClaudeHeadless(cwd, prompt) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        CLAUDE_CLI_PATH,
        "-p",
        prompt,
        "--restricted",
        "--tools",
        "Read,Grep,Glob",
        "--permission-prompts",
        "none",
        "--output-format",
        "json",
        "--json-schema",
        RESULT_SCHEMA,
        "--max-budget-usd",
        MAX_BUDGET_USD,
      ],
      { cwd, timeout: CLAUDE_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 50, shell: false },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`claude invocation failed: ${err.message} | stderr: ${stderr.slice(0, 500)}`));
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch (parseErr) {
          return reject(new Error(`Failed to parse claude output as JSON: ${parseErr.message}`));
        }
        if (parsed.is_error) return reject(new Error(`claude returned an error result: ${parsed.result || JSON.stringify(parsed)}`));
        if (!parsed.structured_output) return reject(new Error("No structured_output in claude result"));
        resolve(parsed.structured_output);
      },
    );
  });
}

function gitWorktreeAdd(dir) {
  return new Promise((resolve, reject) => {
    execFile("git", ["worktree", "add", "--detach", dir, "main"], { cwd: REPO_PATH }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`git worktree add failed: ${err.message} | ${stderr}`));
      resolve();
    });
  });
}

function gitWorktreeRemove(dir) {
  return new Promise((resolve) => {
    execFile("git", ["worktree", "remove", "--force", dir], { cwd: REPO_PATH }, () => resolve());
  });
}

function formatNotes(output) {
  const lines = [
    `[Auto-handle Phase 1 - ${new Date().toISOString()}]`,
    `Classification: ${output.classification}`,
    "",
    "Diagnosis:",
    output.diagnosis,
  ];
  if (output.proposedFix) lines.push("", "Proposed fix:", output.proposedFix);
  if (output.filesLikelyInvolved && output.filesLikelyInvolved.length) {
    lines.push("", "Files likely involved: " + output.filesLikelyInvolved.join(", "));
  }
  return lines.join("\n");
}

async function processTicket(ticket) {
  const worktreeDir = path.join(WORKTREE_BASE, `ticket-${ticket.ticket_seq}-${Date.now()}`);
  try {
    await gitWorktreeAdd(worktreeDir);
    const output = await runClaudeHeadless(worktreeDir, buildPrompt(ticket));
    const notes = formatNotes(output);
    await reportResult(ticket.id, "P", notes, "in_progress");
    return {
      ticketId: ticket.id,
      ticketSeq: ticket.ticket_seq,
      subject: ticket.subject,
      outcome: "processed",
      classification: output.classification,
    };
  } catch (err) {
    // Deliberately does NOT call reportResult here - auto_handle stays at
    // 'Y' untouched, so this ticket is retried on the next attempt instead
    // of silently advancing past a genuine failure (see the design doc's
    // own note on why Y is the "retry me" state, not an error state).
    return { ticketId: ticket.id, ticketSeq: ticket.ticket_seq, subject: ticket.subject, outcome: "failed", error: err.message };
  } finally {
    await gitWorktreeRemove(worktreeDir);
  }
}

async function runAll() {
  const tickets = await fetchQueue();
  const results = [];
  for (const ticket of tickets) {
    // Sequential, not parallel - keeps cost/load predictable and avoids N
    // concurrent worktrees/Claude sessions competing for the same repo.
    results.push(await processTicket(ticket));
  }
  return {
    processedAt: new Date().toISOString(),
    totalEligible: tickets.length,
    succeeded: results.filter((r) => r.outcome === "processed"),
    failed: results.filter((r) => r.outcome === "failed"),
  };
}

fs.mkdirSync(WORKTREE_BASE, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/run") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. POST /run to trigger a batch." }));
    return;
  }
  if (req.headers["x-bridge-secret"] !== LOCAL_SECRET) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized." }));
    return;
  }
  runAll()
    .then((summary) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
    })
    .catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Auto Ticket Handling bridge listening on http://127.0.0.1:${PORT} (POST /run to trigger)`);
});
