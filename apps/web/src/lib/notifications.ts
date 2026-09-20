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
}): Promise<void> {
  await supabase.from("user_notifications").insert({
    user_id: userId,
    target_profile_id: targetProfileId,
    severity,
    message,
    field_keys: fieldKeys,
  });
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
