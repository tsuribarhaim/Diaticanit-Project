import { redirect } from "next/navigation";

import { OnboardingProfileForm } from "@/components/onboarding-profile-form";
import { tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profile, error } = await supabase
    .from("user_profile")
    .select(
      "first_name, last_name, date_of_birth, biological_sex, height_cm, weight_kg, activity_level, preferred_language, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, exercise_frequency_days_per_week, exercise_duration_minutes, nutritional_goal, pregnancy_lactation_status, has_medical_conditions, medical_conditions_details, has_regular_medications, regular_medications_details, hot_climate_or_heavy_sweating, habits, alcohol_consumption_level, smoking_packs_per_day, dietary_preference, additional_information, allergies, medical_conditions, needs_onboarding_refresh",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const missingRefreshColumn =
    Boolean(error?.message?.includes("needs_onboarding_refresh"));

  const fallbackProfile = missingRefreshColumn
    ? (
      await supabase
        .from("user_profile")
        .select("age")
        .eq("user_id", user.id)
        .maybeSingle()
    ).data
    : null;

  const hasAnyProfile = Boolean(profile || fallbackProfile);
  const needsRefresh = Boolean(profile?.needs_onboarding_refresh);

  // Onboarding isn't actually complete once the profile (steps 1-4) is
  // saved anymore - it's complete once step 5's targets are locked in.
  // saveOnboardingProfileAction sets needs_onboarding_refresh back to
  // false as soon as step 4 saves (a no-op for a first-time user, since
  // it was never true), so hasAnyProfile alone can't tell "fully done"
  // apart from "profile saved, targets step not finished yet" - e.g. the
  // user refreshed or closed the tab mid-step-5. Checking for an active
  // target profile disambiguates the two.
  let hasActiveTargetProfile = false;
  if (hasAnyProfile && !needsRefresh) {
    const { data: activeTargetProfile } = await supabase
      .from("user_target_profiles")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    hasActiveTargetProfile = Boolean(activeTargetProfile);
  }

  if (hasAnyProfile && !needsRefresh && hasActiveTargetProfile) {
    redirect("/app");
  }

  const startAtTargetsStep = hasAnyProfile && !needsRefresh && !hasActiveTargetProfile;

  const locale = profile?.preferred_language === "he" ? "he" : "en";

  const { data: aiConsentRow } = await supabase
    .from("ai_extraction_consents")
    .select("accepted_at, revoked_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const hasAiExtractionConsent =
    Boolean(aiConsentRow?.accepted_at) && !aiConsentRow?.revoked_at;

  const formDefaults = profile
    ? {
      ...profile,
      ai_extraction_consent: hasAiExtractionConsent,
    }
    : undefined;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {tr(locale, "Welcome to Daffy — your personal AI coach for a healthier life", "ברוכים הבאים ל-Daffy - מאמן ה-AI האישי שלכם לחיים בריאים")}
        </h1>

        <OnboardingProfileForm locale={locale} defaults={formDefaults} startAtTargetsStep={startAtTargetsStep} />
      </section>
    </main>
  );
}
