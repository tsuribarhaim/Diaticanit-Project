"use strict";

/**
 * Auto Ticket Handling bridge (see docs/design/auto-ticket-handling.md).
 * Listens locally for n8n's daily trigger, pulls whatever tickets an admin
 * has opted in (auto_handle = 'Y') from the live Daffy API, and processes
 * each one in two stages:
 *
 * Phase 1 (cheap pre-filter): a READ-ONLY investigation - Read/Grep/Glob
 * only, no file edits, no shell access, --restricted mode. Classifies the
 * ticket and writes a plan back to Daffy. Always runs.
 *
 * Phase 2 (escalation, only when Phase 1 said safe_code_fix): a second,
 * higher-trust pass in the SAME worktree - signs into a dedicated
 * "Auto-Fix Bot" dev account (never a real user's), starts an isolated dev
 * server the bridge itself manages, and gives Claude a narrow, explicit
 * toolset (Read/Grep/Glob/Edit/Write + a small Bash allowlist for
 * tsc/eslint/node, with git/npm/yarn/pnpm/rm/del/taskkill/another-dev-server
 * hard-blocked on top - see runClaudeHeadless for why both an allow- and a
 * deny-list are needed together) to try to reproduce the issue and, only
 * if it's genuinely a narrow code fix with no
 * functionality/UX impact, implement and verify it. ALL git operations
 * (branch creation, staging, commit) are done by the bridge's own
 * deterministic code afterward, never by the agent - same for the final
 * tsc/eslint/build gate, which the bridge re-runs itself rather than
 * trusting the agent's self-report. A successful fix lands as a commit on
 * its own local branch (auto-fix/tck-<n>) - never main, never pushed.
 *
 * No dependencies - plain Node (18+) built-ins only, so there's nothing to
 * `npm install` before running this (Phase 2 symlinks node_modules from the
 * main repo into each worktree instead of a real install).
 *
 * Run with: node server.js
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const { execFile, spawn } = require("child_process");

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

// Phase 2 config.
const PHASE2_ENABLED = env.PHASE2_ENABLED !== "false";
const PHASE2_MAX_BUDGET_USD = env.PHASE2_MAX_BUDGET_USD_PER_TICKET || "5.00";
const PHASE2_TIMEOUT_MS = Number(env.PHASE2_TIMEOUT_MS || 1200000);
const DAILY_BUDGET_USD_CAP = Number(env.DAILY_BUDGET_USD_CAP || 20);
const DEV_SERVER_PORT = Number(env.DEV_SERVER_PORT || 3100);
const DEV_SERVER_BOOT_TIMEOUT_MS = Number(env.DEV_SERVER_BOOT_TIMEOUT_MS || 60000);
const AUTOFIX_BOT_EMAIL = env.AUTOFIX_BOT_EMAIL;
const AUTOFIX_BOT_PASSWORD = env.AUTOFIX_BOT_PASSWORD;
const WEB_APP_SUBDIR = env.WEB_APP_SUBDIR || "apps/web";

for (const [key, value] of Object.entries({ LOCAL_SECRET, DAFFY_BASE_URL, TICKET_SECRET, REPO_PATH, WORKTREE_BASE, CLAUDE_CLI_PATH })) {
  if (!value) {
    console.error(`Missing required config: ${key} (check .env.local)`);
    process.exit(1);
  }
}
if (PHASE2_ENABLED) {
  for (const [key, value] of Object.entries({ AUTOFIX_BOT_EMAIL, AUTOFIX_BOT_PASSWORD })) {
    if (!value) {
      console.error(`Missing required Phase 2 config: ${key} (check .env.local, or set PHASE2_ENABLED=false)`);
      process.exit(1);
    }
  }
}

const PHASE1_RESULT_SCHEMA = JSON.stringify({
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

function buildPhase1Prompt(ticket) {
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

// TCK-nature classification (bug/logic/ui_ux) is separate from the Y/P/D
// auto_handle state machine - it's what the daily email groups by, per
// Tsuri's own request. reproduced/classification together decide whether a
// fix was actually attempted; nature is just a label on top of that for
// the human reading the summary.
const PHASE2_RESULT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    reproduced: { type: "boolean" },
    nature: { type: "string", enum: ["bug", "logic", "ui_ux"] },
    classification: {
      type: "string",
      enum: ["reproduced_and_fixed", "reproduced_needs_judgment", "could_not_reproduce", "incomplete"],
    },
    reproductionSummary: { type: "string" },
    diagnosis: { type: "string" },
    fixSummary: { type: ["string", "null"] },
    testSummary: { type: ["string", "null"] },
    filesChanged: { type: "array", items: { type: "string" } },
  },
  required: ["reproduced", "nature", "classification", "reproductionSummary", "diagnosis", "fixSummary", "testSummary", "filesChanged"],
  additionalProperties: false,
});

function buildPhase2Prompt(ticket, phase1Output, port) {
  return [
    "This ticket passed a first, read-only pre-filter as a likely safe, narrow code bug (see the earlier diagnosis below).",
    "You now have broader tools to actually confirm it and, if it really is safe, fix it. Read this whole prompt before doing anything.",
    "",
    `Ticket TCK-${ticket.ticket_seq}: "${ticket.subject}"`,
    `Type: ${ticket.ticket_type} | Area: ${ticket.area} | Priority: ${ticket.priority}`,
    `Description: ${ticket.description}`,
    "",
    "Earlier read-only diagnosis (re-verify this yourself, don't just trust it):",
    phase1Output.diagnosis,
    "",
    "=== Your task, in order ===",
    "",
    "1. REPRODUCE: a Daffy dev server for THIS exact worktree is already running at " +
      `http://localhost:${port} - do not start, stop, or restart any server yourself (you have no tool to do that anyway). ` +
      `Sign in with email "${AUTOFIX_BOT_EMAIL}" and password "${AUTOFIX_BOT_PASSWORD}" - this is a dedicated internal test ` +
      "account for exactly this purpose, not a real user, so it's safe to use freely. Try to actually trigger the behavior " +
      "the ticket describes - calling the relevant server action/API route directly, inspecting the resulting state, or " +
      "writing a small node script (you can use fetch) against that running server are all fine. You do NOT have a browser " +
      "automation tool - if the bug is purely visual/CSS and genuinely can't be confirmed without seeing a rendered page, " +
      "say so honestly in reproductionSummary rather than guessing.",
    "",
    "2. CLASSIFY, conservatively:",
    "   - reproduced: did you actually confirm the behavior described, one way or another (true even if you confirmed it's " +
      "NOT happening / already fixed)?",
    "   - If you could not reproduce it at all (couldn't tell either way): classification = could_not_reproduce. Stop here, do not edit anything.",
    "   - If you reproduced it and fixing it would require ANY product/UX/business-logic decision, or touches a database " +
      "migration, or would need an unusually large/invasive change: classification = reproduced_needs_judgment. Describe " +
      "what you found and what a fix would involve, but do NOT edit any files.",
    "   - Only if you reproduced it AND it's a genuinely narrow, mechanical code fix with no judgment call involved: " +
      "classification = reproduced_and_fixed, and proceed to step 3.",
    "   - nature: tag it bug (a real defect), logic (business-rule/behavior gap), or ui_ux (presentation/interaction) - " +
      "whichever best describes it, regardless of which classification you picked.",
    "",
    "3. FIX (only for reproduced_and_fixed): make the narrowest change that fixes it. Then verify: run `npx tsc --noEmit` " +
      "and `npx eslint .` yourself (both must pass with zero errors) and re-run whatever you used in step 1 to confirm the " +
      "behavior actually changed. If anything doesn't come out clean, downgrade classification to incomplete rather than " +
      "claiming success - do not leave half-working changes reported as fixed.",
    "",
    "You do NOT have git access (no commits, no branches) and no access to npm install or any dev-server control - the " +
      "bridge handles all of that separately after you finish. Just edit files and verify. Output your findings per the " +
      "provided JSON schema.",
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

/** Shared invocation helper - cwd/prompt/tools/budget/timeout/schema all
 * vary between Phase 1 and Phase 2, everything else (the Windows .cmd-shim
 * workaround, JSON parsing, error shape) is identical. Returns both the
 * structured output AND the real dollar cost (total_cost_usd) so callers
 * can track a running daily total.
 *
 * `tools` (--tools) only takes bare built-in tool names (e.g. "Bash,Edit") -
 * under --restricted, Bash/PowerShell/REPL/WebFetch are removed entirely
 * unless "Bash" is named here. Getting Bash scoped down safely needs BOTH
 * `allowedTools` and `disallowedTools` together - confirmed live across
 * three isolated smoke tests: `allowedTools` alone (e.g. "Bash(node *)")
 * did NOT narrow anything - an unrelated command (`git status`) still ran
 * with zero permission_denials; `disallowedTools` alone with no
 * `allowedTools` instead denied EVERYTHING, including the pattern meant to
 * stay open (plain `node`); only passing both at once gave the intended
 * result (node ran, git was denied with a real, reported denial). */
function runClaudeHeadless({ cwd, prompt, tools, allowedTools, disallowedTools, restricted, permissionPrompts, budget, timeoutMs, schema }) {
  return new Promise((resolve, reject) => {
    const args = [CLAUDE_CLI_PATH, "-p", prompt];
    if (restricted) args.push("--restricted");
    args.push("--tools", tools);
    if (allowedTools) args.push("--allowedTools", allowedTools);
    if (disallowedTools) args.push("--disallowedTools", disallowedTools);
    args.push("--permission-prompts", permissionPrompts || "none", "--output-format", "json", "--json-schema", schema, "--max-budget-usd", budget);
    execFile(
      process.execPath,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 50, shell: false },
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
        resolve({ output: parsed.structured_output, costUsd: Number(parsed.total_cost_usd || 0) });
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

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`git ${args.join(" ")} failed: ${err.message} | ${stderr}`));
      resolve(stdout.trim());
    });
  });
}

function runNpx(args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    // shell:true is safe here specifically because args is always a fixed,
    // bridge-controlled array (["tsc", "--noEmit"] etc.) - never ticket
    // text or anything else untrusted. npx's own .cmd shim on Windows
    // can't be resolved by execFile without a real shell underneath it,
    // the same issue the Claude CLI invocation (which does embed
    // untrusted ticket text, and so must stay shell:false) hit earlier.
    execFile("npx", args, { cwd, timeout: timeoutMs || 180000, maxBuffer: 1024 * 1024 * 50, shell: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || "") + (stderr || "") });
    });
  });
}

/** A real `npm install` in the worktree, not a symlink - Turbopack (this
 * project's dev server) explicitly refuses a node_modules symlink that
 * points outside its own project root ("Symlink is invalid, it points out
 * of the filesystem root"), confirmed live. --prefer-offline leans on the
 * main repo's already-warm local npm cache to keep this reasonably fast
 * despite being a real install. Only called when escalating to Phase 2
 * (Phase 1 is read-only and never runs anything that needs node_modules). */
function npmInstall(worktreeDir) {
  return new Promise((resolve, reject) => {
    const cwd = path.join(worktreeDir, WEB_APP_SUBDIR);
    execFile(
      "npm",
      ["install", "--prefer-offline", "--no-audit", "--no-fund"],
      { cwd, timeout: 300000, maxBuffer: 1024 * 1024 * 50, shell: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`npm install failed: ${err.message} | ${stderr.slice(0, 1000)}`));
        resolve();
      },
    );
  });
}

/** apps/web/.env.local is gitignored, so a fresh worktree checkout never
 * has it - confirmed live: without this, the dev server booted fine but
 * every Supabase-backed route (e.g. sign-in) 500'd. Copying it from the
 * main repo (REPO_PATH, not the worktree) is safe: it already points at
 * the dev Supabase project, never production. */
function copyEnvLocal(worktreeDir) {
  const src = path.join(REPO_PATH, WEB_APP_SUBDIR, ".env.local");
  const dest = path.join(worktreeDir, WEB_APP_SUBDIR, ".env.local");
  fs.copyFileSync(src, dest);
}

/** spawn's own shell:true (needed for the same .cmd-shim reason as runNpx -
 * next dev's own args are always bridge-controlled, never ticket text) on
 * Windows wraps the real process inside a cmd.exe shell - proc.kill() only
 * kills that shell, not next dev itself, leaving an orphaned server
 * holding the port for the next ticket. taskkill /T kills the whole
 * process tree instead. */
function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], () => {});
  } else {
    proc.kill();
  }
}

/** The bridge - not the agent - owns the dev server's entire lifecycle:
 * starts it in the worktree on a fixed local port, waits for it to
 * actually respond before handing control to Claude, and kills it
 * afterward no matter how Phase 2 turns out. The agent is never given a
 * way to start/stop/restart a server itself. */
function startDevServer(worktreeDir, port) {
  return new Promise((resolve, reject) => {
    const cwd = path.join(worktreeDir, WEB_APP_SUBDIR);
    const proc = spawn("npx", ["next", "dev", "-p", String(port)], {
      cwd,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let settled = false;
    const deadline = Date.now() + DEV_SERVER_BOOT_TIMEOUT_MS;
    const poll = setInterval(async () => {
      if (settled) return;
      if (Date.now() > deadline) {
        settled = true;
        clearInterval(poll);
        killProcessTree(proc);
        reject(new Error("Dev server did not become healthy in time"));
        return;
      }
      try {
        const res = await fetch(`http://localhost:${port}/api/version`);
        if (res.ok) {
          settled = true;
          clearInterval(poll);
          resolve(proc);
        }
      } catch {
        // Not up yet - keep polling.
      }
    }, 1500);
    proc.once("exit", (code) => {
      if (!settled) {
        settled = true;
        clearInterval(poll);
        reject(new Error(`Dev server exited early (code ${code})`));
      }
    });
  });
}

function stopDevServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve();
    proc.once("exit", () => resolve());
    killProcessTree(proc);
    // Fallback in case the process doesn't exit cleanly within a few seconds.
    setTimeout(resolve, 5000);
  });
}

/** The bridge's own, authoritative verification and commit step - never
 * trusts the agent's self-reported "tests passed" or file list. Re-runs
 * tsc/eslint/build itself and only commits if BOTH genuinely pass AND the
 * agent's own classification was reproduced_and_fixed. Commits to a new
 * local branch (auto-fix/tck-<n>) - never main, never pushed - so the
 * result is a real, reviewable git branch rather than an orphaned diff in
 * a worktree that's about to be deleted. */
async function verifyAndCommitFix(worktreeDir, ticket, phase2Output) {
  const webDir = path.join(worktreeDir, WEB_APP_SUBDIR);
  const changedFiles = await runGit(["diff", "--name-only"], worktreeDir);
  if (!changedFiles) {
    return { committed: false, branch: null, reason: "Agent reported a fix but no files actually changed." };
  }
  if (phase2Output.classification !== "reproduced_and_fixed") {
    // The agent itself didn't claim success - whatever it touched (if
    // anything) is discarded, not partially applied.
    return { committed: false, branch: null, reason: null };
  }

  const tsc = await runNpx(["tsc", "--noEmit"], webDir, 180000);
  const eslint = await runNpx(["eslint", "."], webDir, 180000);
  if (!tsc.ok || !eslint.ok) {
    return {
      committed: false,
      branch: null,
      reason: `Bridge-run verification failed (not the agent's own claim) - tsc ok=${tsc.ok}, eslint ok=${eslint.ok}.`,
    };
  }

  const branch = `auto-fix/tck-${ticket.ticket_seq}`;
  await runGit(["checkout", "-b", branch], worktreeDir);
  await runGit(["add", "-A"], worktreeDir);
  await runGit(
    [
      "commit",
      "-m",
      `fix: TCK-${ticket.ticket_seq} - ${ticket.subject}\n\nAuto-fixed by the Auto Ticket Handling bridge (Phase 2).\nNever pushed; review before merging.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`,
    ],
    worktreeDir,
  );
  return { committed: true, branch, reason: null };
}

function formatPhase1Notes(output) {
  const lines = [`[Auto-handle Phase 1 - ${new Date().toISOString()}]`, `Classification: ${output.classification}`, "", "Diagnosis:", output.diagnosis];
  if (output.proposedFix) lines.push("", "Proposed fix:", output.proposedFix);
  if (output.filesLikelyInvolved && output.filesLikelyInvolved.length) {
    lines.push("", "Files likely involved: " + output.filesLikelyInvolved.join(", "));
  }
  return lines.join("\n");
}

function formatPhase2Notes(output, commitResult) {
  const lines = [
    `[Auto-handle Phase 2 - ${new Date().toISOString()}]`,
    `Nature: ${output.nature} | Classification: ${output.classification}`,
    "",
    "Reproduction:",
    output.reproductionSummary,
    "",
    "Diagnosis:",
    output.diagnosis,
  ];
  if (output.fixSummary) lines.push("", "Fix:", output.fixSummary);
  if (output.testSummary) lines.push("", "Verification:", output.testSummary);
  if (commitResult.committed) {
    lines.push("", `Committed to local branch "${commitResult.branch}" (not pushed, not merged) - review and ask to promote when ready.`);
  } else if (commitResult.reason) {
    lines.push("", `Not committed: ${commitResult.reason}`);
  }
  return lines.join("\n");
}

/** budgetTracker is a single mutable object shared across the whole run so
 * every ticket's cost (Phase 1 and, if it escalates, Phase 2) adds to one
 * running total - once the daily cap is hit, remaining tickets are skipped
 * entirely rather than silently continuing to spend. */
async function processTicket(ticket, budgetTracker) {
  if (budgetTracker.spentUsd >= DAILY_BUDGET_USD_CAP) {
    return {
      ticketId: ticket.id,
      ticketSeq: ticket.ticket_seq,
      subject: ticket.subject,
      outcome: "skipped_budget",
      error: `Daily budget cap ($${DAILY_BUDGET_USD_CAP}) reached - skipped without spending anything.`,
    };
  }

  const worktreeDir = path.join(WORKTREE_BASE, `ticket-${ticket.ticket_seq}-${Date.now()}`);
  let devServerProc = null;
  try {
    await gitWorktreeAdd(worktreeDir);

    const phase1 = await runClaudeHeadless({
      cwd: worktreeDir,
      prompt: buildPhase1Prompt(ticket),
      tools: "Read,Grep,Glob",
      restricted: true,
      budget: MAX_BUDGET_USD,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      schema: PHASE1_RESULT_SCHEMA,
    });
    budgetTracker.spentUsd += phase1.costUsd;
    await reportResult(ticket.id, "P", formatPhase1Notes(phase1.output), "in_progress");

    const baseResult = {
      ticketId: ticket.id,
      ticketSeq: ticket.ticket_seq,
      subject: ticket.subject,
      phase1Classification: phase1.output.classification,
    };

    if (!PHASE2_ENABLED || phase1.output.classification !== "safe_code_fix") {
      return { ...baseResult, outcome: "processed_phase1_only", nature: null, phase2Classification: null };
    }
    if (budgetTracker.spentUsd >= DAILY_BUDGET_USD_CAP) {
      return { ...baseResult, outcome: "processed_phase1_only", nature: null, phase2Classification: null, note: "Daily budget cap reached before Phase 2 could start." };
    }

    copyEnvLocal(worktreeDir);
    await npmInstall(worktreeDir);
    devServerProc = await startDevServer(worktreeDir, DEV_SERVER_PORT);

    const phase2 = await runClaudeHeadless({
      cwd: worktreeDir,
      prompt: buildPhase2Prompt(ticket, phase1.output, DEV_SERVER_PORT),
      tools: "Read,Grep,Glob,Edit,Write,Bash",
      allowedTools: "Bash(npx tsc*) Bash(npx eslint*) Bash(node *)",
      disallowedTools: "Bash(git *) Bash(npm *) Bash(yarn *) Bash(pnpm *) Bash(rm *) Bash(rmdir *) Bash(del *) Bash(taskkill*) Bash(npx next*)",
      restricted: true,
      budget: PHASE2_MAX_BUDGET_USD,
      timeoutMs: PHASE2_TIMEOUT_MS,
      schema: PHASE2_RESULT_SCHEMA,
    });
    budgetTracker.spentUsd += phase2.costUsd;

    await stopDevServer(devServerProc);
    devServerProc = null;

    const commitResult = await verifyAndCommitFix(worktreeDir, ticket, phase2.output);
    const finalAutoHandle = commitResult.committed ? "D" : "P";
    const finalStatus = commitResult.committed ? "fixed" : "in_progress";
    await reportResult(ticket.id, finalAutoHandle, formatPhase2Notes(phase2.output, commitResult), finalStatus);

    return {
      ...baseResult,
      outcome: "processed",
      nature: phase2.output.nature,
      phase2Classification: phase2.output.classification,
      committed: commitResult.committed,
      branch: commitResult.branch,
    };
  } catch (err) {
    // Deliberately does NOT call reportResult here - auto_handle stays at
    // 'Y' untouched, so this ticket is retried on the next attempt instead
    // of silently advancing past a genuine failure.
    return { ticketId: ticket.id, ticketSeq: ticket.ticket_seq, subject: ticket.subject, outcome: "failed", error: err.message };
  } finally {
    if (devServerProc) await stopDevServer(devServerProc);
    // Safe to always remove the worktree directory itself, win or lose - a
    // real commit (if any) lives in git's object store tied to its branch,
    // not the ephemeral worktree checkout, so deleting the checkout never
    // loses a successful fix.
    await gitWorktreeRemove(worktreeDir);
  }
}

async function runAll() {
  const tickets = await fetchQueue();
  const budgetTracker = { spentUsd: 0 };
  const results = [];
  for (const ticket of tickets) {
    // Sequential, not parallel - keeps cost/load predictable and avoids N
    // concurrent worktrees/dev servers/Claude sessions competing for the
    // same repo and the same fixed dev-server port.
    results.push(await processTicket(ticket, budgetTracker));
  }
  return {
    processedAt: new Date().toISOString(),
    totalEligible: tickets.length,
    totalSpentUsd: Math.round(budgetTracker.spentUsd * 100) / 100,
    succeeded: results.filter((r) => r.outcome === "processed" || r.outcome === "processed_phase1_only"),
    failed: results.filter((r) => r.outcome === "failed"),
    skipped: results.filter((r) => r.outcome === "skipped_budget"),
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
  console.log(`Phase 2: ${PHASE2_ENABLED ? "enabled" : "disabled"}`);
});
