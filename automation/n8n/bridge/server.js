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
const envFilePath = path.resolve(process.argv[2] || path.join(__dirname, ".env.local"));
// tools/shot.js (run by the agent and by this bridge) reads the same config file.
process.env.BRIDGE_ENV_FILE = envFilePath;
const env = loadEnvLocal(envFilePath);

const { runPromote } = require("./promote");
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
// When true, a committed fix is merged into main on the dev repo right away - but only after the gates
// in autoMergeToDev pass. Off by default: the fix then just waits on its branch for "Merge to dev".
const AUTO_MERGE_TO_DEV = env.AUTO_MERGE_TO_DEV === "true";
// "Promote to production" (see promote.js): only runs when this is explicitly true, and only for the
// real bridge - the dev test bridge leaves it off.
const PROMOTE_ENABLED = env.PROMOTE_ENABLED === "true";
const STAGING_PATH = env.STAGING_PATH;
const PUBLIC_APP_URL = env.PUBLIC_APP_URL || "https://daffy-pilot.vercel.app";
const PHASE2_MAX_BUDGET_USD = env.PHASE2_MAX_BUDGET_USD_PER_TICKET || "5.00";
const PHASE2_TIMEOUT_MS = Number(env.PHASE2_TIMEOUT_MS || 1200000);
const DAILY_BUDGET_USD_CAP = Number(env.DAILY_BUDGET_USD_CAP || 20);
const DEV_SERVER_PORT = Number(env.DEV_SERVER_PORT || 3100);
const DEV_SERVER_BOOT_TIMEOUT_MS = Number(env.DEV_SERVER_BOOT_TIMEOUT_MS || 60000);
const AUTOFIX_BOT_EMAIL = env.AUTOFIX_BOT_EMAIL;
const AUTOFIX_BOT_PASSWORD = env.AUTOFIX_BOT_PASSWORD;
const WEB_APP_SUBDIR = env.WEB_APP_SUBDIR || "apps/web";
const ANALYST_MAX_BUDGET_USD = env.ANALYST_MAX_BUDGET_USD_PER_TICKET || "3.00";
const ANALYST_TIMEOUT_MS = Number(env.ANALYST_TIMEOUT_MS || 900000);
const SHOT_TOOL = path.join(__dirname, "tools", "shot.js");
// Outside every worktree on purpose: the bridge commits with `git add -A`, and screenshots must never end up in a fix.
const SHOTS_BASE = path.join(__dirname, "shots");
const MAX_SHOTS = 4;

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

const QUESTION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    q: { type: "string" },
    options: {
      type: "array",
      items: { type: "object", properties: { label: { type: "string" }, rec: { type: "boolean" } }, required: ["label", "rec"], additionalProperties: false },
    },
    why: { type: "string" },
  },
  required: ["q", "options", "why"],
  additionalProperties: false,
};

const PHASE1_RESULT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    classification: { type: "string", enum: ["safe_code_fix", "needs_judgment", "unclear"] },
    diagnosis: { type: "string" },
    proposedFix: { type: ["string", "null"] },
    filesLikelyInvolved: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: QUESTION_ITEM_SCHEMA },
  },
  required: ["classification", "diagnosis", "proposedFix", "filesLikelyInvolved", "questions"],
  additionalProperties: false,
});

/** True when the ticket's own log already holds decisions the admin made: an approved spec
 * (written by the review screen), a "Product decision (admin)" note, or answers to questions
 * an earlier run asked. */
function hasAdminDecisions(ticket) {
  return /Approved spec \(|Product decision \(admin\)|Product decisions \(admin\)|Admin answers to the questions/.test(ticket.description || "");
}

function buildPhase1Prompt(ticket) {
  const lines = [
    "You are doing a READ-ONLY investigation of a support ticket for the Daffy app (this repository).",
    "You only have read-only tools available (Read, Grep, Glob) - there is no way for you to edit anything, so don't attempt to.",
    "",
    `Ticket TCK-${ticket.ticket_seq}: "${ticket.subject}"`,
    `Type: ${ticket.ticket_type} | Area: ${ticket.area} | Priority: ${ticket.priority}`,
    `Description: ${ticket.description}`,
    "",
  ];
  if (hasAdminDecisions(ticket)) {
    lines.push(
      "The Description above contains decisions the admin has ALREADY MADE (an approved spec, product decisions, or answers to " +
        "questions an earlier run asked). Treat every product, UX and wording decision in them as SETTLED: do not reopen them, and " +
        "do not classify as needs_judgment merely because the change is a new feature, touches several files, or changes how " +
        "something behaves. Your job here is to check the spec against the REAL code. Classify safe_code_fix when it can be " +
        "implemented as written. Use needs_judgment only for something the admin could not have known: (a) the spec contradicts the " +
        "real code or itself, (b) something it relies on does not exist or lives somewhere else, (c) a risk it did not address that " +
        "could hurt users' data or other screens and needs a decision. Name exactly what is missing.",
      "",
    );
  }
  lines.push(
    "Investigate the real code (grep/read the relevant files; check recent git log/blame if it helps) and determine whether " +
      "this is a safe, narrowly-scoped pure code fix with no functionality or UI/UX decision involved, or whether it " +
      "needs a human's judgment call (a product/UX decision, ambiguous requirements, something already fixed, or anything " +
      "you're genuinely not confident about). Be conservative: when in doubt, classify as needs_judgment rather than " +
      "guessing.",
    "",
    "In `questions`: when the classification is needs_judgment or unclear, list 1 to 5 concrete questions the admin must answer " +
      "before this can be built, each with 2 or 3 concrete options, EXACTLY ONE of them marked rec:true (your recommendation), and a " +
      "one-sentence why. For safe_code_fix return an empty array. Output your findings per the provided JSON schema.",
  );
  return lines.join("\n");
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
    testSteps: { type: "array", items: { type: "string" } },
    screenshotPages: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, label: { type: "string" }, mobile: { type: "boolean" }, full: { type: "boolean" }, actions: { type: "array", items: { type: "string" } } },
        required: ["path", "label", "mobile", "full", "actions"],
        additionalProperties: false,
      },
    },
  },
  required: ["reproduced", "nature", "classification", "reproductionSummary", "diagnosis", "fixSummary", "testSummary", "filesChanged", "testSteps", "screenshotPages"],
  additionalProperties: false,
});

function buildPhase2Prompt(ticket, phase1Output, port, shotsDir) {
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
      "account for exactly this purpose, not a real user, so it's safe to sign in with. Prefer read-only checks (fetching pages, " +
      "reading state). Do NOT create tickets, drafts, or any other records unless the bug cannot be reproduced without one: " +
      "leftover test rows show up in the admin's real screens and have crashed pages before (a draft ticket with a null " +
      "type/area did). If you must create a record, delete it again before you finish, and if you cannot, list it " +
      "(table + id/ticket number) in reproductionSummary so a human can remove it. Try to actually trigger the behavior " +
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
    "LOOKING AT YOUR CHANGE: you can take a real screenshot of any page of the running dev server and then read it. Run " +
      `\`node "${SHOT_TOOL.replace(/\\/g, "/")}" <page> "${shotsDir.replace(/\\/g, "/")}/<name>.jpg"\` where <page> is the app path WITHOUT a leading slash ` +
      "(for example app/profile - a leading slash gets rewritten by the shell), add --mobile for a phone-sized view, --full for the " +
      "whole page, --locale he for Hebrew on pages that allow it; then Read the .jpg file to look at it. The browser is signed in as " +
      "the non-admin test account with no data, so pages that need an admin or real data show less than a real user would see - say so " +
      "honestly. Save every image ONLY inside that folder: your shell cannot write anywhere else, git ignores the folder, and the bridge " +
      "cleans it up, so do not delete it or its files. Look at the result after your fix; if what you see is wrong, fix it. In " +
      "`screenshotPages` list up to " +
      `${MAX_SHOTS} pages that best show the change (path without a leading slash, a short label, mobile true or false, full true when the part that shows your change is below the first screen, and actions: the same --do steps you used, or [] for none) - the bridge ` +
      "captures them itself after you finish. Use an empty array if no page shows the change.",
    "",
    "CLICKING AND TYPING: the screenshot tool can also operate the page before it takes the picture, so you can look at things that only " +
      "appear after an interaction (an opened chat, a pressed Save button, a typed value, an open menu). Add one or more `--do` steps: " +
      "`--do \"click:Save\"` (the text or aria-label of a button, link or tab; a CSS selector also works), `--do \"fill:Weight=72\"` (a field's label, " +
      "placeholder or selector, then = and the text), `--do \"press:Enter\"`, `--do \"wait:800\"`. Steps run in order on a freshly loaded page every time, so " +
      "repeat the earlier steps when you want a later state. If a step cannot be done the tool prints ACTION FAILED and still saves the picture. The test " +
      "account is non-admin and has copied sample data (profile, targets and recent daily reports), so Targets, Daily Report and the chat show real-looking " +
      "content. Everything you click happens on the test account only.",
    "",
    "TEST STEPS: in `testSteps` write 2 to 5 short, plain steps a person can follow on the dev app (localhost:3000) to see " +
      "that your change works, for example 'Open Profile, switch the app to Hebrew, check the arrows point the other way'. Name the " +
      "page, say what to click and what they should see. Use an empty array if you did not change anything.",
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

/** Hand the admin something to decide on or review (see the proposal-result route). With
 * strict:false a failure is only logged: a bridge pointed at an app that does not have the route
 * yet must keep working exactly as before. */
async function reportProposal(ticketId, kind, payload, { strict = false, status } = {}) {
  try {
    const res = await fetch(`${DAFFY_BASE_URL}/api/admin/tickets/proposal-result`, {
      method: "POST",
      headers: { "x-ticket-automation-secret": TICKET_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId, kind, payload, status }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} - ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    if (strict) throw new Error(`Proposal report failed: ${err.message}`);
    console.warn(`reportProposal(${kind}) skipped: ${err.message}`);
  }
}

function shotsDirFor(ticket, label) {
  return path.join(SHOTS_BASE, `tck-${ticket.ticket_seq}-${label}`);
}

/** The agent's shell can only write inside its own worktree, so its screenshots go to this folder
 * there. It is added to the worktree's private git exclude list first, so `git add -A` never commits
 * it, and the whole worktree (folder included) is removed afterwards. */
const AGENT_SHOTS_DIRNAME = ".agent-shots";
async function excludeAgentShots(worktreeDir) {
  const excludeFile = path.resolve(worktreeDir, await runGit(["rev-parse", "--git-path", "info/exclude"], worktreeDir));
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  // info/exclude is shared by every worktree of the repo (it lives in the common .git folder), so add the line only once.
  const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
  if (!existing.split("\n").map((line) => line.trim()).includes(`${AGENT_SHOTS_DIRNAME}/`)) {
    fs.appendFileSync(excludeFile, `\n${AGENT_SHOTS_DIRNAME}/\n`);
  }
}

/** The bridge's own screenshots of the pages the agent named, taken while the dev server for the
 * worktree is still up. Failures are skipped: a missing screenshot never blocks a fix. */
async function captureShots(ticket, pages) {
  const dir = shotsDirFor(ticket, "final");
  fs.mkdirSync(dir, { recursive: true });
  const shots = [];
  for (const [i, page] of (pages || []).slice(0, MAX_SHOTS).entries()) {
    const cleanPath = String(page.path || "").replace(/^\/+/, "");
    if (!cleanPath || /[\s"'`$&|;<>]/.test(cleanPath)) continue;
    const file = path.join(dir, `${i + 1}.jpg`);
    const args = [SHOT_TOOL, cleanPath, file];
    if (page.mobile) args.push("--mobile");
    if (page.full) args.push("--full");
    for (const action of (Array.isArray(page.actions) ? page.actions : []).slice(0, 12)) {
      if (typeof action === "string" && action.length <= 200 && !/[\u0000-\u001f]/.test(action)) args.push("--do", action);
    }
    const ok = await new Promise((resolve) => execFile(process.execPath, args, { timeout: 120000, shell: false }, (err) => resolve(!err)));
    if (!ok || !fs.existsSync(file)) continue;
    shots.push({ label: String(page.label || cleanPath).slice(0, 120), dataUrl: "data:image/jpeg;base64," + fs.readFileSync(file).toString("base64") });
  }
  return shots;
}

function removeShotDirs(ticket) {
  fs.rmSync(shotsDirFor(ticket, "final"), { recursive: true, force: true });
}

/** "Merge to dev": the fix lives on a local branch on this laptop, so the laptop merges it. Only
 * ever into main of the dev repo, never pushed, and a failed merge is aborted so nothing is left half-done. */
async function mergeBranch(ticketSeq) {
  const branch = `auto-fix/tck-${Number(ticketSeq)}`;
  if (!Number.isInteger(Number(ticketSeq))) return { ok: false, result: "Invalid ticket number." };
  try {
    const current = await runGit(["branch", "--show-current"], REPO_PATH);
    if (current !== "main") return { ok: false, result: `The dev repo is on "${current}", not main - nothing was merged.` };
    const exists = await runGit(["rev-parse", "--verify", "--quiet", branch], REPO_PATH).catch(() => "");
    if (!exists) return { ok: false, result: `Branch ${branch} does not exist on this laptop.` };
    const already = await runGit(["merge-base", "--is-ancestor", branch, "main"], REPO_PATH).then(() => true).catch(() => false);
    if (already) return { ok: true, result: `${branch} is already merged into main on dev.` };
    await runGit(["merge", "--no-ff", "-m", `Merge ${branch}`, branch], REPO_PATH);
    return { ok: true, result: `Merged ${branch} into main on dev (not pushed).` };
  } catch (err) {
    await runGit(["merge", "--abort"], REPO_PATH).catch(() => {});
    return { ok: false, result: "Merge failed and was undone - nothing was changed. The branch most likely conflicts with newer changes on main, or with uncommitted changes in your dev copy. Merge it by hand: git merge " + branch };
  }
}

/** "Send back": undo a fix's merge on dev. The merge commit is reverted (a new commit, history is
 * kept and nothing is pushed) and the old branch is renamed out of the way, so the next night run can
 * create a fresh auto-fix/tck-<n>. A revert that conflicts is aborted so nothing is left half-done. */
async function revertMerge(ticketSeq) {
  if (!Number.isInteger(Number(ticketSeq))) return { ok: false, result: "Invalid ticket number." };
  const branch = `auto-fix/tck-${Number(ticketSeq)}`;
  try {
    const current = await runGit(["branch", "--show-current"], REPO_PATH);
    if (current !== "main") return { ok: false, result: `The dev repo is on "${current}", not main - nothing was reverted.` };
    const sha = (await runGit(["log", "main", "--first-parent", "--merges", "--format=%H", "-n", "1", `--grep=^Merge ${branch}$`], REPO_PATH)).trim();
    if (!sha) return { ok: false, result: `Could not find the merge of ${branch} on main - nothing was reverted. Undo it by hand if needed.` };
    await runGit(["revert", "-m", "1", "--no-edit", sha], REPO_PATH);
    const exists = await runGit(["rev-parse", "--verify", "--quiet", branch], REPO_PATH).catch(() => "");
    if (exists) await runGit(["branch", "-m", branch, `${branch}-reverted-${Date.now()}`], REPO_PATH);
    return { ok: true, result: `Reverted the merge of ${branch} on dev (not pushed). The ticket goes back to the night run.` };
  } catch (err) {
    await runGit(["revert", "--abort"], REPO_PATH).catch(() => {});
    return { ok: false, result: "Revert failed and was undone - nothing was changed. Later commits on main probably touch the same code, or your dev copy has uncommitted changes. Undo it by hand: git revert -m 1 <merge commit>" };
  }
}

/** The gates a fix must pass before the night run merges it into main on dev by itself. Anything
 * that is not a plain code change (migrations, dependencies, env files, middleware) stays on its
 * branch for a human, and so does anything that breaks the type check or lint once merged. The
 * check runs in a throwaway copy of main, so the dev copy is not touched until everything passed.
 * Returns { merged, reason } - reason is shown to the admin when the fix was NOT merged. */
async function autoMergeToDev(ticketSeq, files, { force = false } = {}) {
  if (!AUTO_MERGE_TO_DEV && !force) return { merged: false, reason: null };
  const branch = `auto-fix/tck-${Number(ticketSeq)}`;
  const touches = (re) => files.find((file) => re.test(file.replace(/\\/g, "/")));
  const blocked =
    (touches(/(^|\/)(db|supabase)\/migrations\//) && "it includes a database migration") ||
    (touches(/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/) && "it changes dependencies") ||
    (touches(/(^|\/)\.env/) && "it touches an env file") ||
    (touches(/(^|\/)middleware\.ts$/) && "it touches the middleware");
  if (blocked) return { merged: false, reason: `Not merged automatically: ${blocked}. Merge it by hand once you have looked.` };
  try {
    const current = await runGit(["branch", "--show-current"], REPO_PATH);
    if (current !== "main") return { merged: false, reason: `Not merged automatically: the dev repo is on "${current}", not main.` };
    const dirty = await runGit(["status", "--porcelain", "--untracked-files=no"], REPO_PATH);
    if (dirty) return { merged: false, reason: "Not merged automatically: your dev copy has uncommitted changes." };
  } catch (err) {
    return { merged: false, reason: `Not merged automatically: could not read the dev repo (${err.message}).` };
  }

  const checkDir = path.join(WORKTREE_BASE, `merge-check-${Number(ticketSeq)}-${Date.now()}`);
  const junctions = [];
  let failure = null;
  try {
    await gitWorktreeAdd(checkDir);
    try {
      await runGit(["merge", "--no-ff", "-m", `Merge ${branch}`, branch], checkDir);
    } catch {
      failure = "it conflicts with newer changes on main";
    }
    if (!failure) {
      // Reuse the dev repo's installed packages instead of a fresh npm install per ticket.
      for (const sub of ["", WEB_APP_SUBDIR]) {
        const source = path.join(REPO_PATH, sub, "node_modules");
        const target = path.join(checkDir, sub, "node_modules");
        if (fs.existsSync(source) && !fs.existsSync(target)) {
          fs.symlinkSync(source, target, "junction");
          junctions.push(target);
        }
      }
      const webDir = path.join(checkDir, WEB_APP_SUBDIR);
      await runNpx(["next", "typegen"], webDir, 180000);
      const tsc = await runNpx(["tsc", "--noEmit"], webDir, 300000);
      const eslint = await runNpx(["eslint", "."], webDir, 300000);
      if (!tsc.ok || !eslint.ok) failure = `the merged result fails the checks (type check ok=${tsc.ok}, lint ok=${eslint.ok})`;
    }
  } catch (err) {
    failure = `the check could not run (${err.message})`;
  } finally {
    // rmdir (not rm -r) so removing a junction never touches the packages it points at.
    for (const target of junctions) {
      try {
        fs.rmdirSync(target);
      } catch {
        /* the worktree removal below will report anything left over */
      }
    }
    await gitWorktreeRemove(checkDir);
  }
  if (failure) return { merged: false, reason: `Not merged automatically: ${failure}. The fix stays on its branch.` };
  const merge = await mergeBranch(ticketSeq);
  return merge.ok ? { merged: true, reason: null } : { merged: false, reason: `Not merged automatically: ${merge.result}` };
}

// ------------------------------------------------------- dashboard hooks ----
// The Ticket Automation dashboard (docs/design/ticket-automation-dashboard.md) needs three things from here: a health answer
// the poller reports to the app, a Pause switch the admin sets in the app, and a record of every run that ends.

/** The admin's Pause switch. Asked before the analyst or the night run starts; if the app cannot be reached the run goes ahead
 * (the queue could not be fetched without the app anyway). */
async function automationPaused() {
  try {
    const res = await fetch(`${DAFFY_BASE_URL}/api/admin/automation-status`, { headers: { "x-ticket-automation-secret": TICKET_SECRET } });
    return res.ok ? Boolean((await res.json()).paused) : false;
  } catch {
    return false;
  }
}

/** One line in the run history shown on the dashboard. Never fatal. */
async function recordRun(kind, startedAt, result) {
  try {
    const res = await fetch(`${DAFFY_BASE_URL}/api/admin/automation-runs`, {
      method: "POST",
      headers: { "x-ticket-automation-secret": TICKET_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ kind, startedAt, finishedAt: new Date().toISOString(), ...result }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.warn(`recordRun(${kind}) skipped: ${err.message}`);
  }
}

// ------------------------------------------------------------- lessons ----
// The admin's corrections (Send back, a returned fix, a requested change) are distilled into short standing
// lessons (POST /learn) that are added to the agents' prompts on every later run. They only ever ADD cautions
// and preferences - the safety rules in the prompts always win - and the admin can switch any of them off.
const LESSONS = { night: "", analyst: "" };

async function refreshLessons() {
  for (const agent of ["night", "analyst"]) {
    try {
      const res = await fetch(`${DAFFY_BASE_URL}/api/admin/lessons?agent=${agent}`, { headers: { "x-ticket-automation-secret": TICKET_SECRET } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const lessons = ((await res.json()).lessons || []).map((l) => l.lesson).filter(Boolean);
      LESSONS[agent] = lessons.length
        ? ["", "=== LESSONS FROM THE ADMIN'S PAST CORRECTIONS ===", "The admin corrected earlier work like yours. Follow these as extra cautions and preferences. They never override the safety rules above (no migrations, never push, keep changes narrow, ask when unsure):", ...lessons.map((l) => `- ${l}`)].join("\n")
        : "";
    } catch (err) {
      LESSONS[agent] = "";
      console.warn(`refreshLessons(${agent}) skipped: ${err.message}`);
    }
  }
}
const lessonsBlock = (agent) => LESSONS[agent] || "";

const LEARN_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    worthLearning: { type: "boolean" },
    agent: { type: "string", enum: ["analyst", "night", "both"] },
    lesson: { type: "string" },
    reason: { type: "string" },
  },
  required: ["worthLearning", "agent", "lesson", "reason"],
  additionalProperties: false,
});

/** One correction -> at most one new standing lesson. Returns what happened, for the e-mail the admin gets. */
async function learnFromCorrection({ ticketSeq, source, comment, context }) {
  let existing = [];
  try {
    const res = await fetch(`${DAFFY_BASE_URL}/api/admin/lessons`, { headers: { "x-ticket-automation-secret": TICKET_SECRET } });
    if (res.ok) existing = ((await res.json()).lessons || []).map((l) => `[${l.agent}] ${l.lesson}`);
  } catch {
    /* works without the list; a duplicate is a smaller problem than losing the lesson */
  }
  const what = { send_back: "sent a fix back after testing it on dev", return_fix: "returned a fix for another try", change_request: "asked the analyst to change its proposal" }[source] || "corrected the automation's work";
  const prompt = [
    "You maintain a short list of standing lessons for two coding agents of the Daffy app: the ANALYST (studies tickets and writes proposals) and the NIGHT-RUN agent (implements approved fixes).",
    `The admin just ${what} on ticket TCK-${ticketSeq}.`,
    context ? `What the agent had delivered: ${context}` : "",
    `The admin's comment: ${comment}`,
    "",
    "Decide whether the correction holds a GENERAL, reusable lesson (a recurring preference, a pitfall in this codebase, a quality bar the work missed) or is only about this one ticket.",
    "Rules: set worthLearning false when it is ticket-specific, unclear, or already covered by an existing lesson. Otherwise write the lesson as one or two plain, imperative sentences with no ticket numbers, and pick which agent it applies to.",
    "A lesson may add a caution or a preference. It must NEVER relax a safety rule (no database migrations, never push, keep changes narrow, ask when unsure) or tell an agent to skip a check.",
    "In `reason`, say in one sentence why you did or did not keep it. Put an empty string in `lesson` when worthLearning is false.",
    "",
    existing.length ? `Existing lessons:\n${existing.map((l) => `- ${l}`).join("\n")}` : "There are no existing lessons yet.",
  ].filter((l) => l !== "").join("\n");
  const result = await runClaudeHeadless({ cwd: WORKTREE_BASE, prompt, tools: "Read", restricted: true, budget: "0.30", timeoutMs: 180000, schema: LEARN_SCHEMA });
  const out = result.output;
  if (!out.worthLearning || !String(out.lesson || "").trim()) return { ok: true, saved: false, reason: out.reason || "Nothing general to learn from this one." };
  const save = await fetch(`${DAFFY_BASE_URL}/api/admin/lessons`, {
    method: "POST",
    headers: { "x-ticket-automation-secret": TICKET_SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ agent: out.agent, lesson: out.lesson, sourceTicketSeq: ticketSeq, sourceKind: source, sourceComment: comment }),
  });
  if (!save.ok) throw new Error(`Saving the lesson failed: HTTP ${save.status}`);
  return { ok: true, saved: true, agent: out.agent, lesson: out.lesson.trim(), reason: out.reason };
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
 * several isolated smoke tests: `allowedTools` alone (e.g. "Bash(node *)")
 * did NOT narrow anything - an unrelated command (`git status`) still ran
 * with zero permission_denials; `disallowedTools` alone with no
 * `allowedTools` instead denied EVERYTHING, including the pattern meant to
 * stay open (plain `node`); only passing both at once gave the intended
 * result (node ran, git was denied with a real, reported denial).
 *
 * The same "--tools only makes a tool exist, it does not approve using it"
 * rule turned out to apply to Edit/Write too, not just Bash - a real ticket
 * (TCK-97) came back with the exact right one-line fix identified but
 * never applied, because the Edit/Write call itself was auto-denied under
 * --permission-prompts none for not being in `allowedTools`. Confirmed live
 * and fixed by adding bare "Edit"/"Write" to `allowedTools` alongside the
 * Bash patterns - every tool Phase 2 is meant to actually use (not just
 * have available) needs to be named there. */
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
  // Stage first so brand-new files count too (a plain `git diff` leaves untracked files out).
  await runGit(["add", "-A"], worktreeDir);
  const changedFiles = await runGit(["diff", "--cached", "--name-only"], worktreeDir);
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
  return { committed: true, branch, reason: null, files: changedFiles.split("\n").filter(Boolean) };
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
      prompt: buildPhase1Prompt(ticket) + lessonsBlock("night"),
      tools: "Read,Grep,Glob",
      restricted: true,
      budget: MAX_BUDGET_USD,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      schema: PHASE1_RESULT_SCHEMA,
    });
    budgetTracker.spentUsd += phase1.costUsd;
    await reportResult(ticket.id, "P", formatPhase1Notes(phase1.output), "in_progress");
    if (phase1.output.classification !== "safe_code_fix") {
      // What the admin sees on the review screen: why the run stopped and what it needs answered.
      await reportProposal(ticket.id, "questions", {
        why: [phase1.output.diagnosis, phase1.output.proposedFix ? `Proposed fix if approved:\n${phase1.output.proposedFix}` : ""].filter(Boolean).join("\n\n"),
        questions: phase1.output.questions || [],
      });
    }

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
    await excludeAgentShots(worktreeDir);
    await npmInstall(worktreeDir);
    devServerProc = await startDevServer(worktreeDir, DEV_SERVER_PORT);

    const phase2 = await runClaudeHeadless({
      cwd: worktreeDir,
      prompt: buildPhase2Prompt(ticket, phase1.output, DEV_SERVER_PORT, path.join(worktreeDir, AGENT_SHOTS_DIRNAME)) + lessonsBlock("night"),
      tools: "Read,Grep,Glob,Edit,Write,Bash",
      allowedTools: "Edit Write Bash(npx tsc*) Bash(npx eslint*) Bash(node *)",
      disallowedTools: "Bash(git *) Bash(npm *) Bash(yarn *) Bash(pnpm *) Bash(rm *) Bash(rmdir *) Bash(del *) Bash(taskkill*) Bash(npx next*)",
      restricted: true,
      budget: PHASE2_MAX_BUDGET_USD,
      timeoutMs: PHASE2_TIMEOUT_MS,
      schema: PHASE2_RESULT_SCHEMA,
    });
    budgetTracker.spentUsd += phase2.costUsd;

    // Screenshots need the dev server, so they are taken before it is stopped.
    const shots = phase2.output.classification === "reproduced_and_fixed" ? await captureShots(ticket, phase2.output.screenshotPages) : [];

    await stopDevServer(devServerProc);
    devServerProc = null;

    const commitResult = await verifyAndCommitFix(worktreeDir, ticket, phase2.output);
    // Night-run auto-merge: gated, and a no-op while AUTO_MERGE_TO_DEV is off.
    const mergeResult = commitResult.committed ? await autoMergeToDev(ticket.ticket_seq, commitResult.files || []) : { merged: false, reason: null };
    const finalAutoHandle = commitResult.committed ? (mergeResult.merged ? "M" : "D") : "P";
    const finalStatus = commitResult.committed ? "fixed" : "in_progress";
    await reportResult(ticket.id, finalAutoHandle, formatPhase2Notes(phase2.output, commitResult), finalStatus);
    if (commitResult.committed) {
      await reportProposal(ticket.id, "fix", {
        summary: phase2.output.fixSummary || phase2.output.diagnosis,
        branch: commitResult.branch,
        files: commitResult.files || [],
        checks: [
          { ok: true, text: "Type check passes (run by the bridge, not taken from the agent)" },
          { ok: true, text: "Lint passes with 0 errors (run by the bridge)" },
          ...(mergeResult.merged ? [{ ok: true, text: "Merged into dev after type check and lint passed on the merged result" }] : []),
          ...(mergeResult.reason ? [{ ok: false, text: mergeResult.reason }] : []),
        ],
        verification: phase2.output.testSummary || "",
        testSteps: phase2.output.testSteps || [],
        shots,
      }, { status: mergeResult.merged ? "merged" : undefined });
    } else {
      await reportProposal(ticket.id, "questions", {
        why: [phase2.output.diagnosis, commitResult.reason ? `Not committed: ${commitResult.reason}` : ""].filter(Boolean).join("\n\n"),
        questions: [],
      });
    }

    return {
      ...baseResult,
      outcome: "processed",
      nature: phase2.output.nature,
      phase2Classification: phase2.output.classification,
      committed: commitResult.committed,
      branch: commitResult.branch,
      mergedToDev: mergeResult.merged,
      mergeNote: mergeResult.reason,
    };
  } catch (err) {
    // Deliberately does NOT call reportResult here - auto_handle stays at
    // 'Y' untouched, so this ticket is retried on the next attempt instead
    // of silently advancing past a genuine failure.
    return { ticketId: ticket.id, ticketSeq: ticket.ticket_seq, subject: ticket.subject, outcome: "failed", error: err.message };
  } finally {
    if (devServerProc) await stopDevServer(devServerProc);
    removeShotDirs(ticket);
    // Safe to always remove the worktree directory itself, win or lose - a
    // real commit (if any) lives in git's object store tied to its branch,
    // not the ephemeral worktree checkout, so deleting the checkout never
    // loses a successful fix.
    await gitWorktreeRemove(worktreeDir);
  }
}

// ---------------------------------------------------------------- analyst ----
// Turns a ticket flagged 'S' into a proposal the admin can approve in one click, so the night run
// does not have to stop and ask. Read-only, like Phase 1. See docs/design/auto-ticket-handling.md.
const ANALYST_RESULT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    summary: { type: "string" },
    nature: { type: "string", enum: ["bug", "logic", "ui_ux"] },
    findings: { type: "array", items: { type: "string" } },
    blastRadius: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: QUESTION_ITEM_SCHEMA },
    mockups: {
      type: "array",
      items: { type: "object", properties: { title: { type: "string" }, html: { type: "string" } }, required: ["title", "html"], additionalProperties: false },
    },
    brief: { type: "string" },
    outOfScope: { type: "array", items: { type: "string" } },
    needsPairing: { type: "boolean" },
    pairingReason: { type: "string" },
  },
  required: ["summary", "nature", "findings", "blastRadius", "decisions", "mockups", "brief", "outOfScope", "needsPairing", "pairingReason"],
  additionalProperties: false,
});

function buildAnalystPrompt(ticket) {
  const lines = [
    "You are the ANALYST for the Daffy app (this repository). Turn the ticket below into a PROPOSAL an admin can approve in one click, so that a night-time coding agent can then implement it without needing to ask anything.",
    "You only have read-only tools (Read, Grep, Glob). You cannot run the app. Be conservative: CHECK, never assume.",
    "",
    `Ticket TCK-${ticket.ticket_seq}: "${ticket.subject}"`,
    `Type: ${ticket.ticket_type} | Area: ${ticket.area} | Priority: ${ticket.priority}`,
    `Description (including any admin notes and decisions already made): ${ticket.description}`,
    "",
  ];
  const prev = ticket.previousProposal;
  if (prev && prev.payload) {
    lines.push(
      `This is a REVISION. The admin read version ${prev.version} of your proposal and asked for a change.`,
      `Admin comment: ${prev.admin_comment || "(none)"}`,
      "Previous proposal (JSON):",
      JSON.stringify(prev.payload).slice(0, 12000),
      "Answer the admin's comment directly: change what they asked, keep what they did not.",
      "",
    );
  }
  lines.push(
    "Rules:",
    "1. GROUND EVERY CLAIM: every file path, function name, route and line number you mention must be one you actually opened or grepped in this session. Never cite from memory.",
    "2. BLAST RADIUS: for each component, function or style you propose to change, grep for everywhere it is used or rendered (other pages, shared components, the global chat widget, the Targets/overview screens, custom targets, admin vs regular users). List those places in blastRadius. A change that would alter another screen must be scoped out or called out as a decision.",
    "3. DECISIONS: list the real product/UX decisions (not technical trivia), each with 2 or 3 concrete options, EXACTLY ONE marked rec:true, and a one-sentence why. If the description or an admin note already settles a point, treat it as decided and do not ask again. Prefer the option consistent with how the app already behaves.",
    '4. MOCKUPS: only when nature is ui_ux, otherwise []. 1 to 3 mockups, each ONE self-contained HTML document (inline CSS only, no scripts, no external resources or image URLs, under 12 KB) showing the proposed result with realistic content from the app (Hebrew text with dir="rtl" where the screen is Hebrew-facing). Draw it on a light app surface (white card, dark slate text): it is shown in an isolated frame.',
    "5. BRIEF: the exact instructions the night coding agent will receive, as imperative numbered steps: which files and functions, exact behavior, every user-facing string in English AND Hebrew, what is OUT OF SCOPE, and how to verify (tsc and eslint, plus what to check). The agent can take screenshots with a headless browser but only as a non-admin test account with no data: say what cannot be verified. The brief must follow your recommended option for every decision. Never tell it to create records on any account.",
    "6. PAIRING: set needsPairing true, and say why in pairingReason, when doing this unattended is risky: it changes core behavior across several screens, writes user data automatically, needs a visual check on a phone to be judged, depends on another unmerged ticket, or needs a database migration. Still write the best brief you can. Otherwise needsPairing false and pairingReason an empty string.",
    "7. Keep the scope as small as the ticket allows. Do not propose changes to unrelated code.",
    "",
    "Output per the provided JSON schema.",
  );
  return lines.join("\n");
}

async function fetchAnalyzeQueue() {
  const res = await fetch(`${DAFFY_BASE_URL}/api/admin/tickets/analyze-queue`, { headers: { "x-ticket-automation-secret": TICKET_SECRET } });
  if (!res.ok) throw new Error(`Analyze queue fetch failed: HTTP ${res.status}`);
  return (await res.json()).tickets || [];
}

async function analyzeTicket(ticket, budgetTracker) {
  if (budgetTracker.spentUsd >= DAILY_BUDGET_USD_CAP) {
    return { ticketSeq: ticket.ticket_seq, subject: ticket.subject, outcome: "skipped_budget" };
  }
  const worktreeDir = path.join(WORKTREE_BASE, `analyst-${ticket.ticket_seq}-${Date.now()}`);
  try {
    await gitWorktreeAdd(worktreeDir);
    const run = await runClaudeHeadless({
      cwd: worktreeDir,
      prompt: buildAnalystPrompt(ticket) + lessonsBlock("analyst"),
      tools: "Read,Grep,Glob",
      restricted: true,
      budget: ANALYST_MAX_BUDGET_USD,
      timeoutMs: ANALYST_TIMEOUT_MS,
      schema: ANALYST_RESULT_SCHEMA,
    });
    budgetTracker.spentUsd += run.costUsd;
    const payload = { ...run.output, pairingReason: run.output.pairingReason || undefined };
    await reportProposal(ticket.id, "proposal", payload, { strict: true });
    return { ticketSeq: ticket.ticket_seq, subject: ticket.subject, outcome: "analyzed", needsPairing: Boolean(run.output.needsPairing), decisions: run.output.decisions.length, mockups: run.output.mockups.length };
  } catch (err) {
    // The ticket stays 'S', so the next analysis run tries again.
    return { ticketSeq: ticket.ticket_seq, subject: ticket.subject, outcome: "failed", error: err.message };
  } finally {
    await gitWorktreeRemove(worktreeDir);
  }
}

async function runAnalysis() {
  const tickets = await fetchAnalyzeQueue();
  if (tickets.length > 0) await refreshLessons();
  const budgetTracker = { spentUsd: 0 };
  const results = [];
  for (const ticket of tickets) results.push(await analyzeTicket(ticket, budgetTracker));
  return {
    processedAt: new Date().toISOString(),
    totalRequested: tickets.length,
    totalSpentUsd: Math.round(budgetTracker.spentUsd * 100) / 100,
    analyzed: results.filter((r) => r.outcome === "analyzed"),
    failed: results.filter((r) => r.outcome === "failed"),
    skipped: results.filter((r) => r.outcome === "skipped_budget"),
  };
}


async function runAll() {
  const tickets = await fetchQueue();
  if (tickets.length > 0) await refreshLessons();
  if (tickets.length > 0 && env.SEED_SOURCE_EMAIL) {
    // Fresh sample data for the test account, so the agent's screenshots show real-looking pages. Never fatal.
    await new Promise((resolve) =>
      execFile(process.execPath, [path.join(__dirname, "tools", "seed-bot-data.js")], { timeout: 120000, env: { ...process.env, BRIDGE_ENV_FILE: envFilePath } }, (err, stdout, stderr) => {
        console.log(err ? `seed-bot-data failed: ${(stderr || err.message).slice(0, 200)}` : String(stdout).trim());
        resolve();
      }),
    );
  }
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

let runInProgress = false;

/** While a long run is going, ask Windows not to sleep (SetThreadExecutionState - the call video players use).
 * Overnight nobody touches the laptop, and a sleep in the middle of a run would freeze everything. A hidden
 * PowerShell child holds the request and is killed when the run ends; if it cannot start, the run just goes
 * ahead without it. Returns the function that releases it. */
function keepAwake() {
  if (process.platform !== "win32") return () => {};
  try {
    const script =
      "Add-Type -Namespace W -Name P -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'; " +
      "[W.P]::SetThreadExecutionState([uint32]2147483649) | Out-Null; while ($true) { Start-Sleep -Seconds 30 }";
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], { stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    return () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
    };
  } catch {
    return () => {};
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

let analysisInProgress = false;
let promoteInProgress = false;

const server = http.createServer(async (req, res) => {
  const known = ["/run", "/analyze", "/merge", "/revert", "/promote", "/learn", "/health"];
  if (req.method !== "POST" || !known.includes(req.url)) {
    return sendJson(res, 404, { error: "Not found. POST /run, /analyze, /merge, /revert, /promote, /learn or /health." });
  }
  if (req.headers["x-bridge-secret"] !== LOCAL_SECRET) {
    return sendJson(res, 401, { error: "Unauthorized." });
  }

  if (req.url === "/merge") {
    const body = await readJsonBody(req);
    if (!body || !Number.isInteger(Number(body.ticketSeq))) return sendJson(res, 400, { error: "ticketSeq is required." });
    // gated:true runs the night run's checks first (used to test them without a real run).
    if (body.gated === true) {
      const gated = await autoMergeToDev(body.ticketSeq, Array.isArray(body.files) ? body.files : [], { force: true });
      return sendJson(res, 200, { ok: gated.merged, result: gated.merged ? "Merged after the gates passed." : gated.reason });
    }
    return sendJson(res, 200, await mergeBranch(body.ticketSeq));
  }

  if (req.url === "/health") {
    return sendJson(res, 200, { ok: true, runInProgress, analysisInProgress, promoteInProgress, autoMerge: AUTO_MERGE_TO_DEV, promoteEnabled: PROMOTE_ENABLED, reportedAt: new Date().toISOString() });
  }

  if (req.url === "/learn") {
    const body = await readJsonBody(req);
    if (!body || !Number.isInteger(Number(body.ticketSeq)) || typeof body.comment !== "string") return sendJson(res, 400, { error: "ticketSeq and comment are required." });
    try {
      return sendJson(res, 200, await learnFromCorrection({ ticketSeq: Number(body.ticketSeq), source: String(body.source || ""), comment: body.comment.slice(0, 2000), context: String(body.context || "").slice(0, 1500) }));
    } catch (err) {
      return sendJson(res, 200, { ok: false, saved: false, error: err.message });
    }
  }

  if (req.url === "/promote") {
    const body = await readJsonBody(req);
    const dryRun = Boolean(body && body.dryRun === true);
    if (!PROMOTE_ENABLED && !dryRun) return sendJson(res, 200, { ok: false, report: null, result: "Promote is switched off on this bridge (PROMOTE_ENABLED)." });
    if (!STAGING_PATH) return sendJson(res, 200, { ok: false, report: null, result: "STAGING_PATH is not configured on this bridge." });
    if (!body || !Array.isArray(body.tickets) || body.tickets.length === 0) return sendJson(res, 400, { error: "tickets is required." });
    if (promoteInProgress) return sendJson(res, 200, { ok: false, report: null, result: "A promotion is already running." });
    promoteInProgress = true;
    const releaseAwake = keepAwake();
    try {
      // A night run or an analysis may still be going: wait for it (up to 30 minutes) instead of racing it.
      for (let waited = 0; (runInProgress || analysisInProgress) && waited < 30 * 60 * 1000; waited += 10000) await new Promise((r) => setTimeout(r, 10000));
      if (runInProgress || analysisInProgress) return sendJson(res, 200, { ok: false, report: null, result: "A night run or analysis was still running after 30 minutes, so nothing was promoted. Request it again." });
      const report = await runPromote({
        tickets: body.tickets,
        dryRun,
        cfg: { stagingPath: STAGING_PATH, webSubdir: WEB_APP_SUBDIR, publicUrl: PUBLIC_APP_URL, dbPushScript: path.join(STAGING_PATH, "scripts", "supabase-db-push.ps1") },
        appCall: async (apiPath, payload) => {
          const r = await fetch(`${DAFFY_BASE_URL}${apiPath}`, { method: "POST", headers: { "x-ticket-automation-secret": TICKET_SECRET, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!r.ok) throw new Error(`HTTP ${r.status} - ${(await r.text()).slice(0, 200)}`);
          return r.json();
        },
      });
      const picked = report.tickets.filter((t) => t.status !== "skipped").length;
      return sendJson(res, 200, {
        ok: report.ok,
        report,
        result: report.ok ? `Version ${report.version}: ${picked} fix(es) promoted.` : `Promotion stopped: ${(report.steps[report.steps.length - 1] || {}).detail || "see the report"}`,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    } finally {
      releaseAwake();
      promoteInProgress = false;
    }
  }

  if (req.url === "/revert") {
    const body = await readJsonBody(req);
    if (!body || !Number.isInteger(Number(body.ticketSeq))) return sendJson(res, 400, { error: "ticketSeq is required." });
    return sendJson(res, 200, await revertMerge(body.ticketSeq));
  }

  if (req.url === "/analyze") {
    if (analysisInProgress || promoteInProgress) return sendJson(res, 200, { skipped: true, reason: "An analysis or a promotion is already running." });
    if (await automationPaused()) return sendJson(res, 200, { skipped: true, reason: "Automation is paused." });
    analysisInProgress = true;
    const releaseAwake = keepAwake();
    const startedAt = new Date().toISOString();
    try {
      const outcome = await runAnalysis();
      const done = (outcome.analyzed || []).length;
      const failed = (outcome.failed || []).length;
      if (outcome.totalRequested > 0) {
        await recordRun("analyst", startedAt, { ticketsCount: outcome.totalRequested, costUsd: outcome.totalSpentUsd, result: `${done} proposal(s) ready${failed ? `, ${failed} failed` : ""}` });
      }
      return sendJson(res, 200, outcome);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    } finally {
      releaseAwake();
      analysisInProgress = false;
    }
  }

  // Two triggers (Windows task + n8n schedule) can overlap; a second batch would
  // re-pick still-queued tickets and fight over the dev-server port.
  if (runInProgress || promoteInProgress) {
    return sendJson(res, 200, { skipped: true, reason: "A batch or a promotion is already running." });
  }
  if (await automationPaused()) return sendJson(res, 200, { skipped: true, reason: "Automation is paused." });
  runInProgress = true;
  const releaseAwake = keepAwake();
  const startedAt = new Date().toISOString();
  try {
    const outcome = await runAll();
    if (outcome.totalEligible > 0) {
      const fixed = (outcome.succeeded || []).filter((r) => r.committed).length;
      await recordRun("night", startedAt, { ticketsCount: outcome.totalEligible, costUsd: outcome.totalSpentUsd, result: `${fixed} fixed, ${(outcome.failed || []).length} failed`, details: { merged: (outcome.succeeded || []).filter((r) => r.mergedToDev).length } });
    }
    return sendJson(res, 200, outcome);
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  } finally {
    releaseAwake();
    runInProgress = false;
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Auto Ticket Handling bridge listening on http://127.0.0.1:${PORT} (POST /run, /analyze, /merge)`);
  console.log(`Phase 2: ${PHASE2_ENABLED ? "enabled" : "disabled"}`);
});
