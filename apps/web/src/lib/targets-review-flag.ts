import type { AppLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import type { createClient } from "@/lib/supabase/server";
import { computeProfileDiff, parseProfileSnapshot, type ProfileDiffRow, type ProfileForTargets } from "@/lib/targets";

// Deliberately NOT a "use server" module - these are internal helpers for
// server actions, not actions themselves, and must not be callable from the
// client.

export const PROFILE_FOR_TARGETS_COLUMNS =
  "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating";

export async function loadProfileForTargetsDiff(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ProfileForTargets | null> {
  const { data } = await supabase
    .from("user_profile")
    .select(PROFILE_FOR_TARGETS_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;

  return {
    age: Number(data.age ?? 0),
    gender: data.gender ?? null,
    biological_sex: data.biological_sex ?? null,
    height_cm: Number(data.height_cm ?? 0),
    weight_kg: Number(data.weight_kg ?? 0),
    activity_level: data.activity_level,
    allergies: Array.isArray(data.allergies) ? data.allergies : [],
    medical_conditions: Array.isArray(data.medical_conditions) ? data.medical_conditions : [],
    medical_conditions_details: data.medical_conditions_details ?? null,
    regular_medications_details: data.regular_medications_details ?? null,
    dietary_preference: data.dietary_preference ?? null,
    exercise_modalities: Array.isArray(data.exercise_modalities) ? data.exercise_modalities : [],
    exercise_other_activities: Array.isArray(data.exercise_other_activities) ? data.exercise_other_activities : [],
    exercise_schedule_by_modality: data.exercise_schedule_by_modality ?? null,
    habits: Array.isArray(data.habits) ? data.habits : [],
    pregnancy_lactation_status: data.pregnancy_lactation_status ?? null,
    hot_climate_or_heavy_sweating: Boolean(data.hot_climate_or_heavy_sweating),
  };
}

/**
 * Recomputes Daffy's "your profile changed" reminder (ticket #10's
 * targets_review_pending/changes/flagged_at) from scratch: the live profile
 * vs. the active target profile's locked-in snapshot. Must run after EVERY
 * write to a target-feeding user_profile field, whatever the path (profile
 * form, quick edits, daily-report weight sync) - ticket #70: a flag only
 * ever set by one path and never resynced by the others kept citing a
 * change that no longer existed. Clears the flag when there's no baseline
 * or no real difference anymore. Returns the diff rows when there is one.
 */
export async function resyncTargetsReviewFlag(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  locale: AppLocale,
): Promise<ProfileDiffRow[] | null> {
  const { data: activeTargetProfile } = await supabase
    .from("user_target_profiles")
    .select("profile_snapshot")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  const snapshot = activeTargetProfile ? parseProfileSnapshot(activeTargetProfile.profile_snapshot) : null;

  let diffRows: ProfileDiffRow[] = [];
  if (snapshot) {
    const liveProfile = await loadProfileForTargetsDiff(supabase, userId);
    if (!liveProfile) return null;
    diffRows = computeProfileDiff(snapshot, liveProfile, locale);
  }

  const pending = diffRows.length > 0;
  const { error } = await supabase
    .from("user_profile")
    .update({
      targets_review_pending: pending,
      targets_review_changes: pending ? diffRows : null,
      targets_review_flagged_at: pending ? new Date().toISOString() : null,
    })
    .eq("user_id", userId);

  if (error) {
    logServerError("targets.reviewFlag", "resync_failed", { userId, error: error.message });
  }

  return pending ? diffRows : null;
}
