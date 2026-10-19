import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

/**
 * The admin AI usage page (app/app/tickets/ai-usage): AI cost per person and per page over a day, week, month or year,
 * read from ai_usage / ai_usage_daily (db/migrations/083_ai_usage.sql). Everything is counted by Israel day; weeks run
 * Sunday to Saturday. Test and bot accounts are left out, as in the weekly email; admins are in unless switched off.
 */

type Client = Awaited<ReturnType<typeof createClient>>;
export type Granularity = "day" | "week" | "month" | "year";

const TZ = "Asia/Jerusalem";
/** Test and bot accounts never count (the same rule as the weekly usage email). */
export const NOT_A_PERSON = /@daffy-internal\.test$|@example\.|claude-debug|^pw-/i;

export const israelDate = (value: string | Date) => new Date(value).toLocaleDateString("en-CA", { timeZone: TZ });
const israelHour = (value: string) => Number(new Date(value).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).slice(0, 2)) % 24;
const shiftDate = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const weekdayOf = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`).getUTCDay();
const lastDayOfMonth = (isoDate: string) => {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export type Period = { gran: Granularity; from: string; to: string };

/** The period of a granularity that contains anchor (an Israel date). */
export function periodOf(gran: Granularity, anchor: string): Period {
  if (gran === "day") return { gran, from: anchor, to: anchor };
  if (gran === "week") {
    const from = shiftDate(anchor, -weekdayOf(anchor));
    return { gran, from, to: shiftDate(from, 6) };
  }
  if (gran === "month") {
    const from = `${anchor.slice(0, 7)}-01`;
    return { gran, from, to: lastDayOfMonth(from) };
  }
  return { gran, from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
}

/** The period just before (step -1) or after (step 1) p. */
export function shiftPeriod(p: Period, step: -1 | 1): Period {
  if (p.gran === "day") return periodOf("day", shiftDate(p.from, step));
  if (p.gran === "week") return periodOf("week", shiftDate(p.from, 7 * step));
  if (p.gran === "month") return periodOf("month", step < 0 ? shiftDate(p.from, -1) : shiftDate(p.to, 1));
  return periodOf("year", `${Number(p.from.slice(0, 4)) + step}-01-01`);
}

export function parsePeriod(gran: string | undefined, date: string | undefined, today: string): Period {
  const g: Granularity = gran === "day" || gran === "month" || gran === "year" ? gran : "week";
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  return periodOf(g, anchor);
}

export type AiSummary = { cost: number; calls: number; users: number; avgPerUser: number; avgPerCall: number };
export type AiBucket = { key: string; cost: number; calls: number; users: number };
export type AiPersonRow = { id: string; name: string; isAdmin: boolean; cost: number; calls: number; avgPerCall: number; share: number; topPage: string | null };
export type AiPageRow = { page: string | null; cost: number; calls: number; users: number; avgPerUser: number; avgPerCall: number; share: number };
export type AiGroup = { cost: number; users: number; calls: number };

export type AiUsageData = {
  period: Period;
  previous: Period;
  hasNext: boolean;
  today: string;
  includeAdmins: boolean;
  current: AiSummary;
  before: AiSummary;
  buckets: AiBucket[];
  people: AiPersonRow[];
  pages: AiPageRow[];
  /** People who opened Daffy in the period without using AI (by their last activity). */
  activeWithoutAi: string[];
  admins: AiGroup;
  nonAdmins: AiGroup;
  failedCalls: number;
  unpricedCalls: number;
  firstDay: string | null;
};

type DailyRow = { day: string; user_id: string | null; is_admin: boolean; page: string | null; calls: number; failed_calls: number; cost_usd: number; unpriced_calls: number };

/** Reads every row of a query in pages: the API returns at most 1000 rows per request. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await page(start, start + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

export type PersonDirectory = Map<string, { name: string; email: string; lastActiveAt: string | null }>;

/** Names, e-mails (to leave test accounts out) and last activity of everyone. */
export async function loadPeople(): Promise<PersonDirectory> {
  const admin = createAdminClient();
  const emails = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    for (const user of data.users) emails.set(user.id, user.email ?? "");
    if (data.users.length < 200) break;
  }
  const profiles = await readAll<{ user_id: string; first_name: string | null; last_name: string | null; last_active_at: string | null }>((from, to) =>
    admin.from("user_profile").select("user_id, first_name, last_name, last_active_at").range(from, to),
  );
  const people: PersonDirectory = new Map();
  for (const p of profiles) {
    const email = emails.get(p.user_id) ?? "";
    people.set(p.user_id, { name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || email.split("@")[0] || "?", email, lastActiveAt: p.last_active_at });
  }
  return people;
}

function summarize(rows: { user_id: string | null; calls: number; cost_usd: number }[]): AiSummary {
  const cost = rows.reduce((s, r) => s + Number(r.cost_usd), 0);
  const calls = rows.reduce((s, r) => s + Number(r.calls), 0);
  const users = new Set(rows.map((r) => r.user_id ?? "-")).size;
  return { cost, calls, users, avgPerUser: users ? cost / users : 0, avgPerCall: calls ? cost / calls : 0 };
}

export async function loadAiUsage(supabase: Client, period: Period, includeAdmins: boolean, today: string): Promise<AiUsageData> {
  const previous = shiftPeriod(period, -1);
  const people = await loadPeople();
  const counts = (userId: string | null) => !userId || !NOT_A_PERSON.test(people.get(userId)?.email ?? "");

  const everyone = (
    await readAll<DailyRow>((from, to) =>
      supabase.from("ai_usage_daily").select("day, user_id, is_admin, page, calls, failed_calls, cost_usd, unpriced_calls").gte("day", previous.from).lte("day", period.to).order("day").range(from, to),
    )
  )
    .map((r) => ({ ...r, calls: Number(r.calls), failed_calls: Number(r.failed_calls), cost_usd: Number(r.cost_usd), unpriced_calls: Number(r.unpriced_calls) }))
    .filter((r) => counts(r.user_id));
  const daily = everyone.filter((r) => includeAdmins || !r.is_admin);
  const inPeriod = (p: Period) => (r: { day: string }) => r.day >= p.from && r.day <= p.to;
  const rows = daily.filter(inPeriod(period));
  const current = summarize(rows);

  // The chart: hours for a day (from the raw calls), days for a week or month, months for a year.
  let buckets: AiBucket[];
  if (period.gran === "day") {
    const raw = await readAll<{ created_at: string; user_id: string | null; is_admin: boolean; cost_usd: number | null }>((from, to) =>
      supabase.from("ai_usage").select("created_at, user_id, is_admin, cost_usd").gte("created_at", `${shiftDate(period.from, -1)}T00:00:00Z`).lt("created_at", `${shiftDate(period.to, 1)}T23:59:59Z`).range(from, to),
    );
    const ofDay = raw.filter((r) => israelDate(r.created_at) === period.from && counts(r.user_id) && (includeAdmins || !r.is_admin));
    buckets = Array.from({ length: 24 }, (_, h) => {
      const b = ofDay.filter((r) => israelHour(r.created_at) === h);
      return { key: String(h).padStart(2, "0"), cost: b.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0), calls: b.length, users: new Set(b.map((r) => r.user_id)).size };
    });
  } else if (period.gran === "year") {
    buckets = Array.from({ length: 12 }, (_, m) => {
      const month = `${period.from.slice(0, 4)}-${String(m + 1).padStart(2, "0")}`;
      const b = rows.filter((r) => r.day.startsWith(month));
      return { key: month, cost: b.reduce((s, r) => s + r.cost_usd, 0), calls: b.reduce((s, r) => s + r.calls, 0), users: new Set(b.map((r) => r.user_id)).size };
    });
  } else {
    buckets = [];
    for (let d = period.from; d <= period.to; d = shiftDate(d, 1)) {
      const b = rows.filter((r) => r.day === d);
      buckets.push({ key: d, cost: b.reduce((s, r) => s + r.cost_usd, 0), calls: b.reduce((s, r) => s + r.calls, 0), users: new Set(b.map((r) => r.user_id)).size });
    }
  }

  const byPerson = new Map<string, { cost: number; calls: number; isAdmin: boolean; pages: Map<string, number> }>();
  const byPage = new Map<string, { cost: number; calls: number; users: Set<string> }>();
  for (const r of rows) {
    const id = r.user_id ?? "-";
    const person = byPerson.get(id) ?? { cost: 0, calls: 0, isAdmin: false, pages: new Map<string, number>() };
    person.cost += r.cost_usd;
    person.calls += r.calls;
    person.isAdmin ||= r.is_admin;
    person.pages.set(r.page ?? "", (person.pages.get(r.page ?? "") ?? 0) + r.cost_usd);
    byPerson.set(id, person);
    const page = byPage.get(r.page ?? "") ?? { cost: 0, calls: 0, users: new Set<string>() };
    page.cost += r.cost_usd;
    page.calls += r.calls;
    page.users.add(id);
    byPage.set(r.page ?? "", page);
  }
  const total = current.cost || 1;
  const usedAi = new Set(byPerson.keys());
  const group = (admin: boolean): AiGroup => {
    const g = everyone.filter(inPeriod(period)).filter((r) => r.is_admin === admin);
    return { cost: g.reduce((s, r) => s + r.cost_usd, 0), calls: g.reduce((s, r) => s + r.calls, 0), users: new Set(g.map((r) => r.user_id)).size };
  };

  const { data: first } = await supabase.from("ai_usage").select("created_at").order("created_at").limit(1).maybeSingle();

  return {
    period,
    previous,
    hasNext: shiftPeriod(period, 1).from <= today,
    today,
    includeAdmins,
    current,
    before: summarize(daily.filter(inPeriod(previous))),
    buckets,
    people: [...byPerson.entries()]
      .map(([id, p]) => ({
        id,
        name: id === "-" ? "" : (people.get(id)?.name ?? "?"),
        isAdmin: p.isAdmin,
        cost: p.cost,
        calls: p.calls,
        avgPerCall: p.calls ? p.cost / p.calls : 0,
        share: p.cost / total,
        topPage: [...p.pages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      }))
      .sort((a, b) => b.cost - a.cost),
    pages: [...byPage.entries()]
      .map(([page, p]) => ({ page: page || null, cost: p.cost, calls: p.calls, users: p.users.size, avgPerUser: p.cost / p.users.size, avgPerCall: p.calls ? p.cost / p.calls : 0, share: p.cost / total }))
      .sort((a, b) => b.cost - a.cost),
    activeWithoutAi: [...people.entries()]
      .filter(([id, p]) => !NOT_A_PERSON.test(p.email) && !usedAi.has(id) && p.lastActiveAt && israelDate(p.lastActiveAt) >= period.from && israelDate(p.lastActiveAt) <= period.to)
      .map(([, p]) => p.name),
    admins: group(true),
    nonAdmins: group(false),
    failedCalls: rows.reduce((s, r) => s + r.failed_calls, 0),
    unpricedCalls: rows.reduce((s, r) => s + r.unpriced_calls, 0),
    firstDay: first?.created_at ? israelDate(first.created_at as string) : null,
  };
}

export type AiPersonDetail = {
  name: string;
  isAdmin: boolean;
  daily: { day: string; cost: number }[];
  pages: { page: string | null; cost: number; calls: number }[];
  latest: { at: string; page: string | null; feature: string; surface: string; model: string; tokensIn: number; tokensOut: number; cost: number | null; status: string }[];
};

/** One person: cost per day over the 30 days up to the period's end, cost per page in the period, and their latest calls. */
export async function loadAiPerson(supabase: Client, userId: string, period: Period, today: string): Promise<AiPersonDetail> {
  const end = period.to < today ? period.to : today;
  const start = shiftDate(end, -29);
  const from = period.from < start ? period.from : start;
  const people = await loadPeople();
  const daily = await readAll<DailyRow>((a, b) =>
    supabase.from("ai_usage_daily").select("day, user_id, is_admin, page, calls, failed_calls, cost_usd, unpriced_calls").eq("user_id", userId).gte("day", from).lte("day", period.to).range(a, b),
  );
  const days: { day: string; cost: number }[] = [];
  for (let d = start; d <= end; d = shiftDate(d, 1)) days.push({ day: d, cost: daily.filter((r) => r.day === d).reduce((s, r) => s + Number(r.cost_usd), 0) });
  const pageMap = new Map<string, { cost: number; calls: number }>();
  for (const r of daily.filter((r) => r.day >= period.from && r.day <= period.to)) {
    const p = pageMap.get(r.page ?? "") ?? { cost: 0, calls: 0 };
    p.cost += Number(r.cost_usd);
    p.calls += Number(r.calls);
    pageMap.set(r.page ?? "", p);
  }
  const { data: latest } = await supabase
    .from("ai_usage")
    .select("created_at, page, feature, surface, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, status")
    .eq("user_id", userId)
    .gte("created_at", `${shiftDate(period.from, -1)}T00:00:00Z`)
    .lt("created_at", `${shiftDate(period.to, 1)}T23:59:59Z`)
    .order("created_at", { ascending: false })
    .limit(40);
  return {
    name: people.get(userId)?.name ?? "?",
    isAdmin: daily.some((r) => r.is_admin),
    daily: days,
    pages: [...pageMap.entries()].map(([page, p]) => ({ page: page || null, ...p })).sort((a, b) => b.cost - a.cost),
    latest: ((latest ?? []) as Record<string, unknown>[])
      .filter((r) => { const d = israelDate(String(r.created_at)); return d >= period.from && d <= period.to; })
      .slice(0, 15)
      .map((r) => ({
        at: String(r.created_at),
        page: (r.page as string | null) ?? null,
        feature: String(r.feature),
        surface: String(r.surface),
        model: String(r.model),
        tokensIn: Number(r.input_tokens ?? 0) + Number(r.cache_read_tokens ?? 0) + Number(r.cache_write_tokens ?? 0),
        tokensOut: Number(r.output_tokens ?? 0),
        cost: r.cost_usd == null ? null : Number(r.cost_usd),
        status: String(r.status),
      })),
  };
}
