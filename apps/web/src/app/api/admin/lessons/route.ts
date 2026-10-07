import { NextResponse } from "next/server";

import { checkAutomationSecret } from "@/lib/automation-auth";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const AGENTS = ["analyst", "night", "both"] as const;
/** Standing lessons are added to every agent run, so the list stays short: past this many, the oldest are retired. */
const MAX_ACTIVE = 25;

/**
 * The bridge reads the active lessons before each run (GET ?agent=analyst|night) and stores a new one after it
 * distilled the admin's correction (POST). Lessons only ever add cautions to the agents' instructions; the admin
 * switches any of them off on the Ticket Automation page.
 */
export async function GET(request: Request) {
  const denied = checkAutomationSecret(request, "adminLessons");
  if (denied) return denied;
  const agent = new URL(request.url).searchParams.get("agent");
  const adminClient = createAdminClient();
  let query = adminClient.from("automation_lessons").select("id, agent, lesson, source_ticket_seq, created_at").eq("active", true).order("created_at", { ascending: false }).limit(MAX_ACTIVE);
  if (agent === "analyst" || agent === "night") query = query.in("agent", [agent, "both"]);
  const { data, error } = await query;
  if (error) {
    logServerError("adminLessons", "query_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to load lessons." }, { status: 500 });
  }
  return NextResponse.json({ lessons: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = checkAutomationSecret(request, "adminLessons");
  if (denied) return denied;
  let body: { agent?: unknown; lesson?: unknown; sourceTicketSeq?: unknown; sourceKind?: unknown; sourceComment?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const lesson = typeof body.lesson === "string" ? body.lesson.trim().slice(0, 600) : "";
  if (!lesson || typeof body.agent !== "string" || !(AGENTS as readonly string[]).includes(body.agent)) {
    return NextResponse.json({ error: "agent and lesson are required." }, { status: 400 });
  }
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("automation_lessons")
    .insert({
      agent: body.agent,
      lesson,
      source_ticket_seq: typeof body.sourceTicketSeq === "number" ? body.sourceTicketSeq : null,
      source_kind: typeof body.sourceKind === "string" ? body.sourceKind.slice(0, 40) : null,
      source_comment: typeof body.sourceComment === "string" ? body.sourceComment.slice(0, 2000) : null,
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    logServerError("adminLessons", "insert_failed", { error: error?.message });
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
  // Keep the active list short: retire the oldest beyond the cap.
  const { data: active } = await adminClient.from("automation_lessons").select("id").eq("active", true).order("created_at", { ascending: false });
  const extra = (active ?? []).slice(MAX_ACTIVE).map((row) => row.id);
  if (extra.length > 0) await adminClient.from("automation_lessons").update({ active: false, disabled_at: new Date().toISOString() }).in("id", extra);
  return NextResponse.json({ success: true, id: data.id }, { headers: { "Cache-Control": "no-store" } });
}
