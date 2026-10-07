// Gives the Auto-Fix Bot test account something to look at: a copy of the developer's own DEV data
// (profile numbers, active targets, recent daily reports, saved items), so the night agent's screenshots
// of Targets, Daily Report and the chat show real-looking content instead of empty pages.
//
//   node tools/seed-bot-data.js
//
// Dev database only (refuses the production project), and it only ever writes rows that belong to the
// bot. Names, e-mail and admin rights are never copied. Report dates are shifted so the newest report is
// "today". Safe to run repeatedly: it replaces the bot's copied rows each time. The bridge runs it at the
// start of every night run; a failure is logged and never stops the run.
const fs = require("fs");
const path = require("path");

const PRODUCTION_REF = "stkffdsfpjznckfrfyul";

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

async function main() {
  const bridgeEnv = loadEnv(process.env.BRIDGE_ENV_FILE || path.join(__dirname, "..", ".env.local"));
  const sourceEmail = bridgeEnv.SEED_SOURCE_EMAIL;
  if (!sourceEmail) return console.log("seed skipped: SEED_SOURCE_EMAIL is not set");
  const webEnv = loadEnv(path.join(bridgeEnv.REPO_PATH, bridgeEnv.WEB_APP_SUBDIR || "apps/web", ".env.local"));
  const url = webEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key = webEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return console.log("seed skipped: no Supabase settings found");
  if (url.includes(PRODUCTION_REF)) throw new Error("refusing to seed: this is the production project");
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" };
  const rest = async (p, init = {}) => {
    const res = await fetch(`${url}/rest/v1/${p}`, { headers: H, ...init });
    if (!res.ok) throw new Error(`${init.method || "GET"} ${p.split("?")[0]} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 || init.method === "DELETE" || init.method === "PATCH" || init.method === "POST" ? null : res.json();
  };
  const get = async (p) => (await fetch(`${url}/rest/v1/${p}`, { headers: H })).json();

  const users = (await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: H })).json()).users || [];
  const source = users.find((u) => (u.email || "").toLowerCase() === sourceEmail.toLowerCase());
  const bot = users.find((u) => (u.email || "").toLowerCase() === (bridgeEnv.AUTOFIX_BOT_EMAIL || "").toLowerCase());
  if (!source || !bot) return console.log("seed skipped: source or bot account not found");
  if (source.id === bot.id) throw new Error("source and bot are the same account");

  const strip = (row, extra = []) => {
    const out = { ...row };
    for (const k of ["id", "user_id", "created_at", "updated_at", ...extra]) delete out[k];
    return out;
  };
  // Some tables have generated columns (computed by the database); copying them is refused, so drop
  // whichever ones the database names and try again.
  const insertRows = async (table, rows) => {
    let current = rows;
    for (let attempt = 0; attempt < 25; attempt++) {
      const res = await fetch(`${url}/rest/v1/${table}`, { method: "POST", headers: H, body: JSON.stringify(current) });
      if (res.ok) return;
      const body = await res.json().catch(() => ({}));
      const column = body && body.code === "428C9" ? (String(body.message || "").match(/column "([^"]+)"/i) || [])[1] || (String(body.details || "").match(/Column "([^"]+)"/i) || [])[1] : null;
      if (!column) throw new Error(`POST ${table} -> HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      current = current.map((r) => { const copy = { ...r }; delete copy[column]; return copy; });
    }
    throw new Error(`POST ${table}: too many generated columns`);
  };
  const done = [];

  // profile: numbers only (never names, admin rights or the language choice)
  const [profile] = await get(`user_profile?user_id=eq.${source.id}&select=*`);
  if (profile) {
    const patch = strip(profile, ["first_name", "last_name", "is_admin", "preferred_language", "email"]);
    await rest(`user_profile?user_id=eq.${bot.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    done.push("profile");
  }

  // saved items and goals, then active targets
  for (const [table, filter] of [["user_default_items", ""], ["user_target_profiles", "&is_active=eq.true"]]) {
    const rows = await get(`${table}?user_id=eq.${source.id}${filter}&select=*&limit=200`);
    await rest(`${table}?user_id=eq.${bot.id}`, { method: "DELETE" });
    if (Array.isArray(rows) && rows.length) {
      await insertRows(table, rows.map((r) => ({ ...strip(r), user_id: bot.id })));
      done.push(`${table}:${rows.length}`);
    }
  }

  // daily reports of the last 30 days, shifted so the newest one is now
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const reports = await get(`user_daily_reports?user_id=eq.${source.id}&report_at=gte.${since}&select=*&order=report_at.desc&limit=200`);
  await rest(`user_daily_reports?user_id=eq.${bot.id}`, { method: "DELETE" });
  if (Array.isArray(reports) && reports.length) {
    const shift = Date.now() - new Date(reports[0].report_at).getTime();
    const rows = reports.map((r) => ({ ...strip(r, ["goal_id"]), user_id: bot.id, report_at: new Date(new Date(r.report_at).getTime() + shift).toISOString(), confirmed_at: r.confirmed_at ? new Date(new Date(r.confirmed_at).getTime() + shift).toISOString() : null }));
    await insertRows("user_daily_reports", rows);
    done.push(`user_daily_reports:${rows.length}`);
  }
  console.log("seeded bot data:", done.join(", ") || "nothing to copy");
}

main().catch((e) => {
  console.error("seed failed:", e.message);
  process.exit(1);
});
