import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/server-log";

export const dynamic = "force-dynamic";

/**
 * n8n's Phase A daily-digest workflow (docs/planning/n8n-automation-backlog.md)
 * calls this on a schedule and emails the result to every admin - n8n never
 * holds Supabase credentials directly, it only knows this one shared secret,
 * keeping "what counts as a user / an open ticket / an admin" defined in one
 * place in the codebase rather than re-derived inside the workflow itself.
 * Always reads whichever Supabase project this deployment's own env points
 * at, so pointing n8n at the production URL is what makes this "production
 * data only" - there's nothing environment-specific inside this route itself.
 */
// A handful of early accounts (including both current admins) have their
// first/last name stored in Hebrew, which reads fine in-app (the UI is
// bilingual) but not in this English-only ops email. Scoped to just this
// digest - doesn't touch the real profile data or any in-app greeting that
// reads from it. Keyed by user_id (stable) rather than matching the Hebrew
// text itself. Add an entry here for any future admin whose stored name
// should display in English in this email too.
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "a2999c09-c4b0-4f69-82e8-d88d24aa09ff": "Tsuri Bar-Haim",
  "66bb2ec7-6319-4fe5-8e80-ae742595955c": "Orit Shenhar",
};

const TICKET_STATUS_ORDER = ["open", "reopened", "deferred", "resolved", "closed", "duplicate", "cancelled", "draft"] as const;
const TICKET_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  reopened: "Reopened",
  deferred: "Deferred",
  resolved: "Resolved",
  closed: "Closed",
  duplicate: "Duplicate",
  cancelled: "Cancelled",
  draft: "Draft",
};

function daysSince(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function joinWithAnd(names: string[]): string {
  if (names.length === 0) return "there";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export async function GET(request: Request) {
  const expectedSecret = process.env.N8N_DIGEST_SECRET;
  if (!expectedSecret) {
    logServerError("adminDailyDigest", "missing_secret_env", {});
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  const providedSecret = request.headers.get("x-digest-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createAdminClient();

  const [ticketsResult, profilesResult] = await Promise.all([
    adminClient.from("tickets").select("status"),
    adminClient.from("user_profile").select("user_id, first_name, last_name, is_admin, created_at").order("created_at", { ascending: true }),
  ]);

  if (ticketsResult.error || profilesResult.error) {
    logServerError("adminDailyDigest", "query_failed", {
      ticketsError: ticketsResult.error?.message,
      profilesError: profilesResult.error?.message,
    });
    return NextResponse.json({ error: "Failed to load digest data." }, { status: 500 });
  }

  const ticketCountsByStatus: Record<string, number> = {};
  for (const row of ticketsResult.data ?? []) {
    ticketCountsByStatus[row.status] = (ticketCountsByStatus[row.status] ?? 0) + 1;
  }
  const totalTickets = ticketsResult.data?.length ?? 0;

  const profiles = profilesResult.data ?? [];
  // Email isn't stored on user_profile (see onboarding-profile-form.tsx's
  // own note on why) - resolved from auth.users per user, same pattern
  // tickets/page.tsx already uses for its own admin-only user list.
  const emailById = new Map(
    await Promise.all(
      profiles.map(async (profile) => {
        const { data } = await adminClient.auth.admin.getUserById(profile.user_id);
        return [profile.user_id, data.user?.email ?? null] as const;
      }),
    ),
  );

  function displayName(profile: { user_id: string; first_name: string | null; last_name: string | null }): string {
    const fallback = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "(unnamed)";
    return DISPLAY_NAME_OVERRIDES[profile.user_id] ?? fallback;
  }

  const adminEmails = profiles.filter((p) => p.is_admin).map((p) => emailById.get(p.user_id)).filter((email): email is string => Boolean(email));
  const adminFirstNames = profiles.filter((p) => p.is_admin).map((p) => displayName(p).split(" ")[0]).filter((name): name is string => Boolean(name));

  const statusLines = TICKET_STATUS_ORDER.filter((status) => ticketCountsByStatus[status] > 0).map(
    (status) => `  ${TICKET_STATUS_LABELS[status]} ${ticketCountsByStatus[status]}`,
  );

  const userLines = profiles.map((profile) => {
    const adminTag = profile.is_admin ? " (Admin)" : "";
    return `${displayName(profile)}${adminTag} - ${daysSince(profile.created_at)} Days`;
  });

  const emailBody = [
    `Good Morning ${joinWithAnd(adminFirstNames)},`,
    "",
    "The following are statistics from Daffy Production:",
    `Total Tickets in the system are ${totalTickets}. Here is a breakdown per their status -`,
    ...statusLines,
    "",
    "Total Users in the system -",
    ...userLines,
    "",
    "I wish you a pleasant day!",
  ].join("\n");

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      adminEmails,
      emailSubject: "Daffy Production - Daily Digest",
      emailBody,
      tickets: { total: totalTickets, byStatus: ticketCountsByStatus },
      users: { total: profiles.length },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
