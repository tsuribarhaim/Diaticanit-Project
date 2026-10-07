import { logServerError } from "@/lib/server-log";
import type { createClient } from "@/lib/supabase/server";

// Deliberately NOT a "use server" module - an internal helper for server
// actions, not an action itself, and must not be callable from the client.

/**
 * Two-way weight sync (ticket TCK-42): a weight change made on the Profile
 * (inline row, full edit form, or profile chat) is logged as a weight-only
 * Daily Report entry at the current time, exactly like logging a weight from
 * Daily Report itself. Every other column relies on its DB default.
 * Best-effort: a failure is logged and swallowed - the profile update that
 * triggered it already succeeded and must not be undone. Deliberately does
 * NOT resync the profile weight from reports - the profile already holds it.
 */
export async function logProfileWeightAsWeighIn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  weightKg: number,
): Promise<void> {
  try {
    const { data: activeTargetProfile } = await supabase
      .from("user_target_profiles")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    const now = new Date().toISOString();
    const { error } = await supabase.from("user_daily_reports").insert({
      user_id: userId,
      target_profile_id: activeTargetProfile?.id ?? null,
      raw_report_text: "",
      report_at: now,
      status: "confirmed",
      requires_confirmation: false,
      confirmed_at: now,
      reported_weight_kg: weightKg,
    });

    if (error) {
      logServerError("profile.weightWeighIn", "insert_failed", { userId, error: error.message });
    }
  } catch (error) {
    logServerError("profile.weightWeighIn", "insert_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
