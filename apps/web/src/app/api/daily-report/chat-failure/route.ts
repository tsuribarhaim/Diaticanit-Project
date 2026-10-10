import { NextRequest } from "next/server";

import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The chat panel reports here when its request to /api/daily-report/chat failed before or outside the server's own logging (for example
 * the hosting platform refusing a large request: our route never runs, so nothing else records it). One line in the server log with the
 * reason, the HTTP status and how big the photo was. Small, signed-in only, and never stores anything. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : undefined);
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

  logServerError("dailyReport.chat", "client_failure", {
    userId: user.id,
    reason: text(body.reason, 40),
    httpStatus: number(body.status),
    photoBytes: number(body.photoBytes),
    photoType: text(body.photoType, 40),
    message: text(body.message, 200),
    userAgent: text(request.headers.get("user-agent"), 160),
  });
  return new Response(null, { status: 204 });
}
