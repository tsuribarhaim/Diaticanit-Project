"use strict";
/**
 * "Promote to production": ship exactly the fixes the admin approved, nothing else.
 *
 * Runs in the staging worktree (release/1.0). For every approved ticket it cherry-picks that
 * ticket's single fix commit (NOT a merge of the branch: a branch is cut from main, so merging it
 * would drag along every other unreleased commit on main, approved or not). Then, in this order:
 * migrations check -> type check + lint -> apply migrations to production -> deploy -> smoke test
 * -> tag + push -> mark the tickets resolved in the app. A failure before the deploy resets the
 * release branch to where it was; a failure after it rolls Vercel back to the previous deployment.
 * Nothing reaches GitHub until the live site passed its smoke test.
 *
 * With dryRun the git, check and report steps run for real but nothing leaves the laptop: no
 * database push, no Vercel call, no push, no ticket update. That is what the scratch-clone test uses.
 */
const { execFile } = require("child_process");
const path = require("path");

function exec(cmd, args, { cwd, timeout = 600000, shell = false } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 1024 * 1024 * 50, shell }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout || ""}${stderr || ""}`.trim() });
    });
  });
}
const git = async (args, cwd) => {
  const r = await exec("git", args, { cwd });
  if (!r.ok) throw new Error(`git ${args.join(" ")} failed: ${r.output.slice(0, 400)}`);
  return r.output;
};
const npx = (args, cwd, timeout) => exec("npx", args, { cwd, timeout, shell: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Only plain additions are allowed to reach production unattended. */
function nonAdditive(sql) {
  const text = sql.replace(/--.*$/gm, "").toLowerCase();
  const bad = [/\bdrop\s+(table|column|schema|policy|index|function|trigger|type|constraint)\b/, /\btruncate\b/, /\bdelete\s+from\b/, /\balter\s+table[^;]*\balter\s+column[^;]*\btype\b/, /\brename\b/];
  const hit = bad.find((re) => re.test(text));
  return hit ? (text.match(hit) || [hit.source])[0].trim() : null;
}

async function runPromote({ tickets, dryRun = false, cfg, appCall }) {
  const sp = cfg.stagingPath;
  const web = path.join(sp, cfg.webSubdir);
  const report = {
    version: null,
    previousVersion: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: false,
    rolledBack: false,
    dryRun,
    steps: [],
    tickets: [],
    migrations: [],
  };
  const step = (name, ok, detail = "") => report.steps.push({ name, ok, detail: String(detail).slice(0, 600) });
  let preSha = null;
  let tag = null;
  let envChanged = false;
  let previousDeployment = null;
  let deployed = false;

  async function rollback(reason) {
    if (deployed && !dryRun) {
      const rb = previousDeployment ? await exec("npx", ["vercel", "rollback", previousDeployment, "--yes"], { cwd: web, timeout: 600000, shell: true }) : { ok: false, output: "no previous deployment recorded" };
      report.rolledBack = rb.ok;
      step("Roll back to the previous deployment", rb.ok, rb.ok ? previousDeployment : rb.output.slice(0, 300));
    }
    if (envChanged && !dryRun && report.previousVersion) {
      await exec("npx", ["vercel", "env", "rm", "NEXT_PUBLIC_APP_VERSION", "production", "--yes"], { cwd: web, shell: true });
      await exec("npx", ["vercel", "env", "add", "NEXT_PUBLIC_APP_VERSION", "production", "--value", report.previousVersion, "--yes"], { cwd: web, shell: true });
    }
    if (preSha) {
      await git(["reset", "--hard", preSha], sp).catch(() => {});
      step("Reset the release branch to where it was", true, preSha.slice(0, 8));
    }
    step("Stopped", false, reason);
  }

  try {
    // ---- preflight
    const branch = await git(["branch", "--show-current"], sp);
    if (branch !== "release/1.0") throw new Error(`The staging copy is on "${branch}", not release/1.0.`);
    if (await git(["status", "--porcelain", "--untracked-files=no"], sp)) throw new Error("The staging copy has uncommitted changes.");
    preSha = await git(["rev-parse", "HEAD"], sp);
    if (!dryRun) {
      const live = await fetch(`${cfg.publicUrl}/api/version`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      report.previousVersion = live && live.version ? String(live.version) : null;
      const inspect = await exec("npx", ["vercel", "inspect", cfg.publicUrl.replace(/^https?:\/\//, "")], { cwd: web, timeout: 120000, shell: true });
      previousDeployment = (inspect.output.match(/dpl_[A-Za-z0-9]+/) || [])[0] || null;
      if (!previousDeployment) throw new Error("Could not find the current production deployment, so a rollback would not be possible. Nothing was changed.");
    }
    const tags = (await git(["tag", "-l", "v1.1.*"], sp)).split(/\r?\n/).map((t) => Number((t.match(/^v1\.1\.(\d+)$/) || [])[1])).filter(Number.isFinite);
    const next = Math.max(0, ...tags) + 1;
    report.version = `1.1.${next}`;
    tag = `v${report.version}`;
    step("Preflight", true, `release/1.0 at ${preSha.slice(0, 8)}, next version ${report.version}`);

    // ---- cherry-pick every approved ticket's fix commit
    for (const t of tickets) {
      const entry = { seq: t.ticketSeq, subject: t.subject, ticketId: t.ticketId, proposalId: t.proposalId, commit: null, status: "skipped", reason: "" };
      report.tickets.push(entry);
      const ref = `auto-fix/tck-${t.ticketSeq}`;
      const tip = await git(["rev-parse", "--verify", "--quiet", ref], sp).catch(() => "");
      if (!tip) { entry.reason = `branch ${ref} no longer exists on this laptop`; continue; }
      const subject = await git(["log", "-1", "--format=%s", tip], sp);
      const parents = (await git(["rev-list", "--parents", "-n", "1", tip], sp)).split(" ").length - 1;
      if (!subject.startsWith(`fix: TCK-${t.ticketSeq}`) || parents !== 1) { entry.reason = "the branch tip is not a single fix commit"; continue; }
      const pick = await exec("git", ["cherry-pick", tip], { cwd: sp });
      if (!pick.ok) {
        await exec("git", ["cherry-pick", "--abort"], { cwd: sp });
        entry.reason = /empty|nothing to commit/i.test(pick.output) ? "its change is already in release/1.0" : "it does not apply cleanly to release/1.0 (it depends on changes that are not released yet)";
        continue;
      }
      entry.commit = (await git(["rev-parse", "--short", "HEAD"], sp)).trim();
      entry.status = "picked";
    }
    const picked = report.tickets.filter((t) => t.status === "picked");
    step("Pick the approved fixes", picked.length > 0, report.tickets.map((t) => `TCK-${t.seq}: ${t.status === "picked" ? "ok" : `skipped - ${t.reason}`}`).join("; "));
    if (picked.length === 0) throw new Error("None of the approved fixes could be applied to release/1.0.");

    // ---- migrations
    const changed = (await git(["diff", "--name-only", preSha, "HEAD"], sp)).split(/\r?\n/).filter(Boolean);
    const migrations = changed.filter((f) => /^(db|supabase)\/migrations\/.+\.sql$/.test(f));
    for (const file of migrations) {
      const sql = await git(["show", `HEAD:${file}`], sp);
      const bad = nonAdditive(sql);
      if (bad) throw new Error(`Migration ${file} is not purely additive (${bad}), so it is not applied unattended.`);
      report.migrations.push(file);
    }
    step("Migrations are additive", true, migrations.length ? migrations.join(", ") : "none");

    // ---- checks
    await npx(["next", "typegen"], web, 180000);
    const tsc = await npx(["tsc", "--noEmit"], web, 600000);
    const lint = await npx(["eslint", "."], web, 600000);
    step("Type check and lint on the release branch", tsc.ok && lint.ok, `type check ok=${tsc.ok}, lint ok=${lint.ok}`);
    if (!tsc.ok || !lint.ok) throw new Error("The release branch fails the type check or lint, so nothing was deployed.");

    if (dryRun) {
      step("Dry run: database, deploy, push and ticket update skipped", true, "nothing left this laptop");
      report.ok = true;
      await git(["reset", "--hard", preSha], sp);
      return report;
    }

    // ---- production database
    if (migrations.length > 0) {
      const push = await exec("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", cfg.dbPushScript, "-Environment", "staging"], { cwd: sp, timeout: 600000 });
      step("Apply migrations to production", push.ok, push.output.slice(-300));
      if (!push.ok) throw new Error("Applying the migrations failed, so nothing was deployed.");
    }

    // ---- deploy
    await exec("npx", ["vercel", "env", "rm", "NEXT_PUBLIC_APP_VERSION", "production", "--yes"], { cwd: web, shell: true });
    const add = await exec("npx", ["vercel", "env", "add", "NEXT_PUBLIC_APP_VERSION", "production", "--value", report.version, "--yes"], { cwd: web, shell: true });
    envChanged = true;
    if (!add.ok) throw new Error(`Could not set the version on Vercel: ${add.output.slice(0, 300)}`);
    const deploy = await exec("npx", ["vercel", "deploy", "--prod", "--yes"], { cwd: web, timeout: 1200000, shell: true });
    step("Deploy to production", deploy.ok, deploy.output.slice(-300));
    if (!deploy.ok) throw new Error("The Vercel deployment failed.");
    deployed = true;

    // ---- smoke test
    let live = null;
    for (let i = 0; i < 12 && live !== report.version; i++) {
      live = await fetch(`${cfg.publicUrl}/api/version`, { cache: "no-store" }).then((r) => r.json()).then((j) => j.version).catch(() => null);
      if (live !== report.version) await sleep(10000);
    }
    const signIn = await fetch(`${cfg.publicUrl}/auth/sign-in`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
    const smokeOk = live === report.version && signIn === 200;
    step("Smoke test on the live site", smokeOk, `version=${live}, sign-in page=${signIn}`);
    if (!smokeOk) throw new Error("The live site failed its smoke test.");

    // ---- publish to GitHub, then tell the app
    await git(["tag", tag], sp);
    const push = await exec("git", ["push", "origin", "release/1.0", tag], { cwd: sp, timeout: 300000 });
    step("Push release/1.0 and the tag to GitHub", push.ok, push.ok ? tag : push.output.slice(-300));
    const released = await appCall("/api/admin/tickets/mark-released", { version: report.version, tickets: picked.map((t) => ({ ticketId: t.ticketId, proposalId: t.proposalId })) }).catch((err) => ({ error: err.message }));
    step("Mark the tickets resolved", !released.error, released.error || `${released.resolved ?? picked.length} resolved`);
    for (const t of picked) t.status = released.error ? "deployed" : "released";
    report.ok = true;
    return report;
  } catch (err) {
    await rollback(err.message);
    return report;
  } finally {
    report.finishedAt = new Date().toISOString();
  }
}

module.exports = { runPromote, nonAdditive };
