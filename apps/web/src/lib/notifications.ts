import type { createClient } from "@/lib/supabase/server";

export type NotificationRow = {
  id: string;
  severity: "info" | "concern";
  message: string;
  field_keys: string[];
  read_at: string | null;
  resolved_at: string | null;
  created_at: string;
  target_profile_id: string | null;
};

export async function createNotification({
  supabase,
  userId,
  targetProfileId,
  severity,
  message,
  fieldKeys,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  targetProfileId: string | null;
  severity: "info" | "concern";
  message: string;
  fieldKeys: string[];
}): Promise<{ id: string } | null> {
  // Returns the created row's id - the one caller that needs it
  // (runBackgroundTargetsCheck's "ready to review" notification) stores it
  // on the draft it announces, so approving/discarding that draft later
  // can mark this exact notification read too (see
  // user_target_profile_drafts.notification_id's own migration comment).
  // Every other caller already just awaits this without using the return
  // value, so adding it here is not a breaking change for them.
  const { data } = await supabase
    .from("user_notifications")
    .insert({
      user_id: userId,
      target_profile_id: targetProfileId,
      severity,
      message,
      field_keys: fieldKeys,
    })
    .select("id")
    .single();
  return data ?? null;
}

export async function listNotifications({
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<NotificationRow[]> {
  const { data } = await supabase
    .from("user_notifications")
    .select("id, severity, message, field_keys, read_at, resolved_at, created_at, target_profile_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []) as NotificationRow[];
}

/** The set of RingMetric-style field keys currently flagged by an
 * unresolved notification, for the Home/Targets rings' own warning-icon
 * lookup (see daily-report-progress-rings.tsx's flagged prop) - read state
 * is irrelevant here on purpose (see the migration's own comment: opening
 * a notification doesn't clear the flag, only a later resolved check
 * does). */
export async function getFlaggedFieldKeys({
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<Set<string>> {
  const { data } = await supabase
    .from("user_notifications")
    .select("field_keys")
    .eq("user_id", userId)
    .is("resolved_at", null);

  const flagged = new Set<string>();
  for (const row of data ?? []) {
    const keys = Array.isArray(row.field_keys) ? (row.field_keys as string[]) : [];
    keys.forEach((key) => flagged.add(key));
  }
  return flagged;
}

export async function markNotificationRead({
  supabase,
  userId,
  notificationId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  notificationId: string;
}): Promise<void> {
  await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .is("read_at", null);
}

/**
 * Called from approveTargetsDraftAction right after a successful save -
 * without this, every OTHER still-unread targets notification from earlier
 * background checks (a "ready to review" for a draft that got superseded
 * before it was ever acted on, an older "still accurate" confirmation, a
 * stale profile-discrepancy note) keeps sitting in the list pointing at
 * numbers that are no longer current, with no way for the user to tell
 * which one - if any - is still relevant. Reported directly in testing:
 * "confusing for the user to see several with the target changes not
 * knowing what changed." A fresh, successful save makes every earlier one
 * moot regardless of what it said, so this clears the whole backlog at
 * once rather than requiring the user to dismiss each individually.
 *
 * target_profile_id is not null is what scopes this to targets specifically
 * - every createNotification call for a targets concern/review passes a
 * real target profile id, while the ticket-status-change trigger (the only
 * other source of info notifications) never sets one, so this can't
 * accidentally sweep up an unrelated ticket notification.
 */
export async function markAllTargetsNotificationsRead({
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<void> {
  await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .not("target_profile_id", "is", null)
    .is("read_at", null);
}
