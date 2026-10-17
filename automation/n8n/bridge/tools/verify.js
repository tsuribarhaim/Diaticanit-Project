// The night agent's one verify command: type check, lint and the diff of its change, in a single call.
//
//   node <bridge>/tools/verify.js            (run from the worktree root, which is where the agent starts)
//
// Why it exists: the agent may not run git, and `npx tsc` / `npx eslint` only work from inside apps/web (run from
// the root, npx fetches an unrelated "tsc" package). Agents kept guessing command shapes, some were denied, and
// TCK-154 ended "incomplete" with a correct fix that was then thrown away. `node *` is always allowed for the agent,
// so this script runs the same checks the bridge runs before it commits (tsc --noEmit and eslint . in apps/web) and
// shows the change with read-only git. Exit code 0 only when both checks pass.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const web = path.join(root, "apps", "web");
if (!fs.existsSync(path.join(web, "package.json"))) {
  console.log(`VERIFY CANNOT RUN: ${web} has no package.json. Run this from the worktree root (the folder you started in).`);
  process.exit(2);
}

// Fixed, bridge-written argument lists only (never ticket text), so shell:true for the Windows npx shim is safe.
function run(cmd, args, cwd, timeout = 240000) {
  const r = spawnSync(cmd, args, { cwd, shell: true, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 * 50 });
  return { ok: r.status === 0, timedOut: Boolean(r.error && r.error.code === "ETIMEDOUT"), output: `${r.stdout || ""}${r.stderr || ""}`.replace(/\s+$/, "") };
}
const tail = (text, lines) => text.split(/\r?\n/).slice(-lines).join("\n");

const tsc = run("npx", ["tsc", "--noEmit"], web);
console.log(`=== TYPE CHECK (tsc --noEmit in apps/web): ${tsc.ok ? "PASS" : tsc.timedOut ? "TIMED OUT" : "FAIL"}`);
if (!tsc.ok) console.log(tail(tsc.output, 40));

const eslint = run("npx", ["eslint", "."], web);
console.log(`=== LINT (eslint . in apps/web): ${eslint.ok ? "PASS" : eslint.timedOut ? "TIMED OUT" : "FAIL"}`);
if (!eslint.ok) console.log(tail(eslint.output, 40));

// What the bridge will commit: tracked changes plus new files (git diff alone leaves untracked files out).
const status = run("git", ["status", "--short", "--untracked-files=all"], root, 60000);
console.log("=== CHANGED FILES (git status --short)");
console.log(status.output || "(no changes)");
const diff = run("git", ["diff", "--no-color"], root, 60000);
console.log("=== DIFF OF TRACKED FILES");
console.log(diff.output.length > 30000 ? `${diff.output.slice(0, 30000)}\n... (diff cut at 30000 characters)` : diff.output || "(none)");

const passed = tsc.ok && eslint.ok;
console.log(`=== RESULT: ${passed ? "PASS - both checks are clean" : "FAIL - fix the errors above and run this again"}`);
process.exit(passed ? 0 : 1);
