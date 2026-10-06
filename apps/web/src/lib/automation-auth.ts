import { NextResponse } from "next/server";

import { logServerError } from "@/lib/server-log";

/** Same shared-secret check every automation route uses (the n8n bridge sends
 * x-ticket-automation-secret). Returns a response to send back when the check fails, or null
 * when the caller is allowed. */
export function checkAutomationSecret(request: Request, routeName: string): NextResponse | null {
  const expectedSecret = process.env.N8N_TICKET_AUTOMATION_SECRET;
  if (!expectedSecret) {
    logServerError(routeName, "missing_secret_env", {});
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (request.headers.get("x-ticket-automation-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
