import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/server-log";
import { computeUsageWeek, renderUsageReport, type UsageInput } from "@/lib/usage-report";

export const dynamic = "force-dynamic";

/**
 * n8n's "Daffy - Weekly Usage Report" workflow calls this every Sunday morning and mails the result (to the admin only,
 * for now). Same shared secret as the daily digest (x-digest-secret), so n8n never holds database credentials. This route
 * only reads the rows; what the e-mail says is decided in lib/usage-report.ts.
 */
const PUBLIC_URL = "https://daffy-pilot.vercel.app";
/** Test and bot accounts never appear in the report. */
const NOT_A_PERSON = /@daffy-internal\.test$|@example\.|claude-debug|^pw-/i;

type Row = Record<string, unknown>;
const hasItems = (value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value && typeof value === "object" && Object.keys(value).length > 0));

export async function GET(request: Request) {
  const expectedSecret = process.env.N8N_DIGEST_SECRET;
  if (!expectedSecret) {
    logServerError("adminUsageReport", "missing_secret_env", {});
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (request.headers.get("x-digest-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  // A little more than the week (time zones), and a longer lookback for "last reported on".
  const since = new Date(now.getTime() - 9 * 86400000).toISOString();
  const lookback = new Date(now.getTime() - 60 * 86400000).toISOString();

  const emails = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      logServerError("adminUsageReport", "list_users_failed", { error: error.message });
      return NextResponse.json({ error: "Could not read users." }, { status: 500 });
    }
    for (const user of data.users) emails.set(user.id, user.email ?? "");
    if (data.users.length < 200) break;
  }

  const [profiles, reports, recentReports, plans, planRequests, savedItems, notifications, ticketsOpened, ticketsUpdated] = await Promise.all([
    admin.from("user_profile").select("user_id, first_name, last_name, created_at, last_active_at"),
    admin.from("user_daily_reports").select("user_id, report_at, created_at, reported_weight_kg, exercise_minutes, parsed_exercises, calories_kcal, parsed_items").gte("created_at", since).limit(10000),
    admin.from("user_daily_reports").select("user_id, created_at").gte("created_at", lookback).order("created_at", { ascending: false }).limit(20000),
    admin.from("user_target_profiles").select("user_id, created_at, analysis_source").gte("created_at", since).limit(5000),
    admin.from("user_target_update_requests").select("user_id, created_at").gte("created_at", since).limit(5000),
    admin.from("user_default_items").select("user_id, created_at, updated_at").gte("updated_at", since).limit(5000),
    admin.from("user_notifications").select("user_id, created_at, read_at").gte("created_at", since).limit(5000),
    admin.from("tickets").select("created_by, created_at").gte("created_at", since).limit(5000),
    admin.from("tickets").select("created_by, description").gte("updated_at", since).limit(5000),
  ]);
  const failed = [profiles, reports, recentReports, plans, planRequests, savedItems, notifications, ticketsOpened, ticketsUpdated].find((result) => result.error);
  if (failed?.error) {
    logServerError("adminUsageReport", "query_failed", { error: failed.error.message });
    return NextResponse.json({ error: "Could not read usage." }, { status: 500 });
  }

  const people = ((profiles.data ?? []) as Row[])
    .filter((p) => !NOT_A_PERSON.test(emails.get(String(p.user_id)) ?? ""))
    .map((p) => ({
      id: String(p.user_id),
      name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || (emails.get(String(p.user_id)) ?? "").split("@")[0] || "?",
      joinedAt: String(p.created_at),
      lastActiveAt: (p.last_active_at as string | null) ?? null,
    }));

  const lastReportAt: Record<string, string> = {};
  for (const r of (recentReports.data ?? []) as Row[]) {
    const id = String(r.user_id);
    if (!lastReportAt[id]) lastReportAt[id] = String(r.created_at);
  }

  // AI cost (ai_usage_daily, db/migrations/083_ai_usage.sql): this week and the one before, one row per day x person x page x
  // feature x model, so it stays small. Read on its own: if it fails, the report still goes out, without the AI section.
  let aiCalls: UsageInput["aiCalls"] = null;
  const aiSince = new Date(now.getTime() - 16 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const aiDaily = await admin.from("ai_usage_daily").select("day, user_id, is_admin, page, cost_usd, calls").gte("day", aiSince).limit(20000);
  if (aiDaily.error) {
    logServerError("adminUsageReport", "ai_usage_query_failed", { error: aiDaily.error.message });
  } else {
    aiCalls = ((aiDaily.data ?? []) as Row[]).map((r) => ({
      userId: (r.user_id as string | null) ?? null,
      day: String(r.day),
      page: (r.page as string | null) ?? null,
      costUsd: Number(r.cost_usd ?? 0),
      calls: Number(r.calls ?? 0),
      isAdmin: Boolean(r.is_admin),
    }));
  }

  const ticketUpdates: UsageInput["ticketUpdates"] = [];
  for (const t of (ticketsUpdated.data ?? []) as Row[]) {
    // Every dated entry in the ticket's own log ("=== 2026-10-10T15:28:56.573Z ===") is one update.
    for (const match of String(t.description ?? "").matchAll(/\n=== (\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/g)) ticketUpdates.push({ userId: String(t.created_by), at: match[1] });
  }

  const input: UsageInput = {
    now,
    people,
    reports: ((reports.data ?? []) as Row[]).map((r) => ({
      userId: String(r.user_id),
      at: String(r.report_at ?? r.created_at),
      weight: r.reported_weight_kg != null,
      exercise: Number(r.exercise_minutes ?? 0) > 0 || hasItems(r.parsed_exercises),
      food: Number(r.calories_kcal ?? 0) > 0 || hasItems(r.parsed_items),
    })),
    lastReportAt,
    targetPlans: ((plans.data ?? []) as Row[]).map((r) => ({ userId: String(r.user_id), at: String(r.created_at), ai: r.analysis_source === "ai" })),
    targetRequests: ((planRequests.data ?? []) as Row[]).map((r) => ({ userId: String(r.user_id), at: String(r.created_at) })),
    savedListAdded: ((savedItems.data ?? []) as Row[]).filter((r) => String(r.created_at) >= since).map((r) => ({ userId: String(r.user_id), at: String(r.created_at) })),
    savedListEdited: ((savedItems.data ?? []) as Row[]).filter((r) => String(r.created_at) < since).map((r) => ({ userId: String(r.user_id), at: String(r.updated_at) })),
    notifications: ((notifications.data ?? []) as Row[]).map((r) => ({ userId: String(r.user_id), at: String(r.created_at), read: Boolean(r.read_at) })),
    ticketsOpened: ((ticketsOpened.data ?? []) as Row[]).map((r) => ({ userId: String(r.created_by), at: String(r.created_at) })),
    ticketUpdates,
    aiCalls,
  };

  const week = computeUsageWeek(input);
  const email = renderUsageReport(week, now, PUBLIC_URL);
  return NextResponse.json(
    { emailSubject: email.subject, emailBody: email.html, emailText: email.text, week: { start: week.start, end: week.end, totals: week.totals } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
