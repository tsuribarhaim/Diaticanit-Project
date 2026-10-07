// Takes a screenshot of a page on the bridge's disposable dev server (the one running the
// worktree being worked on), signed in as the Auto-Fix Bot test account.
//
//   node tools/shot.js <path-without-leading-slash> <outFile.jpg> [--mobile] [--full] [--locale he|en] [--wait 1500]
//                       [--do "click:Save"] [--do "fill:Weight=72"] [--do "press:Enter"] [--do "wait:800"]
//
// --do steps run in order after the page has loaded, BEFORE the screenshot, so the image shows the
// result (a clicked button, a typed value, an opened chat). Steps (repeat --do for several):
//   click:<visible text or aria-label of a button/link/tab, or a CSS selector>
//   fill:<label, placeholder or CSS selector>=<text to type>
//   press:<key, e.g. Enter or Escape>      wait:<milliseconds, at most 8000>
// A step that cannot be done is reported ("ACTION FAILED ...") and the screenshot is still taken.
//
// <path> is an app path such as app/profile (write it WITHOUT a leading slash: Git Bash rewrites
// /app/... into a Windows path) or auth/sign-in?reason=password_changed - pages that do not need a
// session work too. The agent runs this to LOOK at its own change (it can read the
// image), and the bridge runs it to attach the final screenshots to the ticket.
// Config comes from the bridge's env file (BRIDGE_ENV_FILE, default ../.env.local).

const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq !== -1) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return env;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

/** One --do step. Texts are matched the way a person would find them: by what is written on screen. */
async function perform(page, spec) {
  const at = spec.indexOf(":");
  const kind = at === -1 ? spec : spec.slice(0, at);
  const arg1 = at === -1 ? "" : spec.slice(at + 1);
  if (kind === "wait") return page.waitForTimeout(Math.min(Number(arg1) || 500, 8000));
  if (kind === "press") return page.keyboard.press(arg1 || "Enter");
  const looksLikeSelector = /[#.\[\]>=]/.test(arg1);
  if (kind === "click") {
    const candidates = [
      page.getByRole("button", { name: arg1 }),
      page.getByRole("link", { name: arg1 }),
      page.getByRole("tab", { name: arg1 }),
      page.getByLabel(arg1),
      page.getByText(arg1),
    ];
    if (looksLikeSelector) candidates.unshift(page.locator(arg1));
    for (const c of candidates) {
      if ((await c.count().catch(() => 0)) > 0) return c.first().click({ timeout: 8000 });
    }
    throw new Error("nothing on the page matches");
  }
  if (kind === "fill") {
    const eq = arg1.indexOf("=");
    if (eq === -1) throw new Error("use fill:<label>=<text>");
    const target = arg1.slice(0, eq);
    const value = arg1.slice(eq + 1);
    const candidates = [page.getByLabel(target), page.getByPlaceholder(target)];
    if (looksLikeSelector) candidates.unshift(page.locator(target));
    for (const c of candidates) {
      if ((await c.count().catch(() => 0)) > 0) return c.first().fill(value, { timeout: 8000 });
    }
    throw new Error("no field matches");
  }
  throw new Error("unknown step kind");
}

async function main() {
  const [target, outFile] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--") && ["--locale", "--wait", "--do"].includes(all[i - 1])));
  if (!target || !outFile) throw new Error("usage: node shot.js <path> <outFile.jpg> [--mobile] [--full] [--locale he|en] [--wait ms]");

  const bridgeEnv = loadEnv(process.env.BRIDGE_ENV_FILE || path.join(__dirname, "..", ".env.local"));
  const webEnv = loadEnv(path.join(bridgeEnv.REPO_PATH, bridgeEnv.WEB_APP_SUBDIR || "apps/web", ".env.local"));
  const port = Number(bridgeEnv.DEV_SERVER_PORT || 3100);
  const supabaseUrl = webEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = webEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || webEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const chromium = bridgeEnv.CHROMIUM_PATH || "C:/Users/tsuri/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
  const { chromium: pw } = require("playwright-core");

  const mobile = process.argv.includes("--mobile");
  const browser = await pw.launch({ headless: true, executablePath: chromium });
  try {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1000, height: 800 },
      deviceScaleFactor: 1,
    });

    // Sign in as the bot through Supabase's password grant and hand the browser the same cookie the
    // app's own sign-in would set (@supabase/ssr: base64url JSON, split in 3180-character chunks).
    const grant = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: bridgeEnv.AUTOFIX_BOT_EMAIL, password: bridgeEnv.AUTOFIX_BOT_PASSWORD }),
    });
    const session = await grant.json();
    const cookies = [];
    if (session.access_token) {
      const ref = new URL(supabaseUrl).hostname.split(".")[0];
      const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
      const chunks = value.match(/.{1,3180}/g);
      chunks.forEach((chunk, i) => cookies.push({ name: chunks.length === 1 ? `sb-${ref}-auth-token` : `sb-${ref}-auth-token.${i}`, value: chunk, domain: "localhost", path: "/" }));
    }
    const locale = arg("--locale", null);
    if (locale === "he" || locale === "en") cookies.push({ name: "phc_locale", value: locale, domain: "localhost", path: "/" });
    if (cookies.length) await context.addCookies(cookies);

    const page = await context.newPage();
    const steps = [];
    process.argv.forEach((a, i) => { if (a === "--do" && process.argv[i + 1]) steps.push(process.argv[i + 1]); });
    // Git Bash rewrites an argument like /app/profile into C:/Program Files/Git/app/profile before node
  // ever sees it - undo that, and also accept the path with no leading slash (app/profile).
  const cleanTarget = target.replace(/^[A-Za-z]:[\/]Program Files[\/]Git[\/]/i, "/");
  const url = cleanTarget.startsWith("http") ? cleanTarget : `http://localhost:${port}${cleanTarget.startsWith("/") ? "" : "/"}${cleanTarget}`;
    const response = await page.goto(url, { waitUntil: "load", timeout: 90000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(Number(arg("--wait", 1500)));
    const failed = [];
    for (const spec of steps.slice(0, 12)) {
      try {
        await perform(page, spec);
      } catch (e) {
        failed.push(`${spec} (${String(e.message).split("\n")[0].slice(0, 120)})`);
      }
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    await page.screenshot({ path: outFile, type: "jpeg", quality: 62, fullPage: process.argv.includes("--full") });
    for (const f of failed) console.log(`ACTION FAILED: ${f}`);
    console.log(`saved ${outFile} (HTTP ${response ? response.status() : "?"}, ${fs.statSync(outFile).size} bytes, ${session.access_token ? "signed in" : "NOT signed in"})`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("shot failed:", e.message);
  process.exit(1);
});
