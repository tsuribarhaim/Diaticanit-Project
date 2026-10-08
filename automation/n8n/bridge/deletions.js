"use strict";
/**
 * Files the night agent asks the bridge to delete.
 *
 * The agent has no delete tool (its shell is locked down on purpose), so a fix that leaves a component unused used to stop as
 * "incomplete" on its very last step (TCK-112). It now lists those files in `filesToDelete` and the bridge removes them, but only
 * what is plainly safe: a tracked file inside the app's own source folder, never a migration, config, env file or anything outside it.
 * The bridge then runs the type check and lint on the result itself, so a deletion that breaks something fails the fix instead of
 * shipping.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ALLOWED_PREFIX = "apps/web/src/";
const MAX_FILES = 10;

/** @returns {{ deleted: string[], rejected: { file: string, why: string }[] }} */
function applyDeletions(worktreeDir, files) {
  const deleted = [];
  const rejected = [];
  for (const raw of (Array.isArray(files) ? files : []).slice(0, MAX_FILES)) {
    const file = String(raw || "").replace(/\\/g, "/").replace(/^\.?\//, "");
    const why = problem(worktreeDir, file);
    if (why) {
      rejected.push({ file, why });
      continue;
    }
    fs.unlinkSync(path.join(worktreeDir, file));
    deleted.push(file);
  }
  return { deleted, rejected };
}

function problem(worktreeDir, file) {
  if (!file) return "empty path";
  if (file.includes("..")) return "path leaves the project";
  if (!file.startsWith(ALLOWED_PREFIX)) return `only files under ${ALLOWED_PREFIX} can be deleted`;
  if (!/\.(tsx?|css)$/.test(file)) return "only source files (.ts, .tsx, .css) can be deleted";
  if (/(^|\/)(middleware\.ts|layout\.tsx|globals\.css)$/.test(file)) return "that file is too central to delete automatically";
  const full = path.join(worktreeDir, file);
  if (!fs.existsSync(full)) return "the file does not exist";
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", file], { cwd: worktreeDir, stdio: "ignore" });
  } catch {
    return "the file is not tracked by git";
  }
  return null;
}

module.exports = { applyDeletions, ALLOWED_PREFIX, MAX_FILES };
