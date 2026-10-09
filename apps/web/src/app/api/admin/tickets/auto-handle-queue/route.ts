import { NextResponse } from "next/server";

import { loadOverlapBlockers } from "@/lib/automation-overlap";
import type { Blocker } from "@/lib/overlap";
import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/server-log";

export const dynamic = "force-dynamic";

/**
 * Auto Ticket Handling via n8n (see docs/design/auto-ticket-handling.md) -
 * the bridge's daily pickup. Returns every ticket an admin has explicitly
 * opted in (auto_handle = 'Y') that's still live (open or reopened - a
 * ticket closed/resolved/etc. some other way in the meantime is no longer
 * eligible even if it was once marked Y). Deliberately returns the full
 * ticket content (not just ids) so the bridge/Claude has everything needed
 * to start investigating without a second round-trip.
 */
export async function GET(request: Request) {
  const expectedSecret = process.env.N8N_TICKET_AUTOMATION_SECRET;
  if (!expectedSecret) {
    logServerError("adminAutoHandleQueue", "missing_secret_env", {});
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  const providedSecret = request.headers.get("x-ticket-automation-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("tickets")
    .select("id, ticket_seq, subject, ticket_type, area, priority, description, status, created_at, bundle_id")
    .in("status", ["open", "reopened"])
    .eq("auto_handle", "Y")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    logServerError("adminAutoHandleQueue", "query_failed", { error: error.message });
    return NextResponse.json({ error: "Failed to load queue." }, { status: 500 });
  }

  // Tickets that change the same files as another ticket wait for it (lib/overlap.ts): the bridge skips those with a non-empty heldBy.
  const blockers = await loadOverlapBlockers(adminClient).catch(() => new Map<string, Blocker[]>());
  const bundleIds = [...new Set((data ?? []).map((ticket) => ticket.bundle_id as string | null).filter((id): id is string => Boolean(id)))];
  const letters = new Map<string, string>();
  if (bundleIds.length > 0) {
    const { data: bundleRows } = await adminClient.from("automation_bundles").select("id, letter").in("id", bundleIds);
    for (const row of (bundleRows ?? []) as { id: string; letter: string }[]) letters.set(row.id, row.letter);
  }
  const tickets = (data ?? []).map((ticket) => ({ ...ticket, bundleLetter: ticket.bundle_id ? letters.get(ticket.bundle_id as string) ?? null : null, heldBy: (blockers.get(ticket.id) ?? []).map((b) => ({ seq: b.seq, why: b.why, files: b.files.slice(0, 5) })) }));
  return NextResponse.json({ tickets }, { headers: { "Cache-Control": "no-store" } });
}
