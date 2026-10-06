import { NextResponse } from "next/server";

import { computeDigestStats, renderDigest, snapshotOf, type DigestSnapshot, type DigestTicket, type DigestUser } from "@/lib/daily-digest";
import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/server-log";

export const dynamic = "force-dynamic";

/**
 * n8n's daily-digest workflow (docs/planning/n8n-automation-backlog.md) calls this on a schedule
 * and emails the result to every admin - n8n never holds Supabase credentials directly, it only
 * knows this one shared secret, keeping "what counts as a user / an open ticket / an admin" defined
 * in one place in the codebase rather than re-derived inside the workflow itself. Always reads
 * whichever Supabase project this deployment's own env points at, so pointing n8n at the production
 * URL is what makes this "production data only".
 *
 * The email itself (HTML plus a plain-text copy) is built in lib/daily-digest.ts. Each real call
 * also remembers the day's numbers in daily_digest_snapshots so the next digest can show "since
 * yesterday". Add ?dryRun=1 to read without remembering anything (test sends).
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

const PUBLIC_URL = "https://daffy-pilot.vercel.app";

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
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  const adminClient = createAdminClient();
  const now = new Date();
  // The calendar day in Israel, so a digest sent at 07:00 and a re-run at 23:00 are the same day.
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

  const [ticketsResult, profilesResult, proposalsResult, snapshotResult] = await Promise.all([
    adminClient.from("tickets").select("id, ticket_seq, status, priority, ticket_type, area, auto_handle, auto_handle_notes, created_at"),
    adminClient.from("user_profile").select("user_id, first_name, last_name, is_admin, created_at").order("created_at", { ascending: true }),
    adminClient.from("ticket_proposals").select("ticket_id, kind, status, created_at"),
    adminClient.from("daily_digest_snapshots").select("snapshot_date, counts").lt("snapshot_date", today).order("snapshot_date", { ascending: false }).limit(1),
  ]);

  if (ticketsResult.error || profilesResult.error || proposalsResult.error || snapshotResult.error) {
    logServerError("adminDailyDigest", "query_failed", {
      ticketsError: ticketsResult.error?.message,
      profilesError: profilesResult.error?.message,
      proposalsError: proposalsResult.error?.message,
      snapshotError: snapshotResult.error?.message,
    });
    return NextResponse.json({ error: "Failed to load digest data." }, { status: 500 });
  }

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
  const users: DigestUser[] = profiles.map((profile) => ({ name: displayName(profile), isAdmin: Boolean(profile.is_admin), createdAt: profile.created_at }));

  const stats = computeDigestStats({
    tickets: (ticketsResult.data ?? []) as DigestTicket[],
    proposals: proposalsResult.data ?? [],
    users,
    now,
  });
  const previous = (snapshotResult.data?.[0]?.counts as DigestSnapshot | undefined) ?? null;
  const email = renderDigest({ stats, previous, users, adminFirstNames, now, publicUrl: PUBLIC_URL });

  if (!dryRun) {
    const { error: snapshotError } = await adminClient
      .from("daily_digest_snapshots")
      .upsert({ snapshot_date: today, counts: snapshotOf(stats) }, { onConflict: "snapshot_date" });
    // Losing a snapshot only means tomorrow's "since yesterday" column shows dashes - never block the email for it.
    if (snapshotError) logServerError("adminDailyDigest", "snapshot_failed", { error: snapshotError.message });
  }

  return NextResponse.json(
    {
      generatedAt: now.toISOString(),
      dryRun,
      adminEmails,
      emailSubject: email.subject,
      emailBody: email.html,
      emailBodyText: email.text,
      tickets: { total: stats.total, byStatus: stats.statuses },
      users: { total: users.length },
      comparedWith: previous ? "previous digest" : "nothing yet",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
