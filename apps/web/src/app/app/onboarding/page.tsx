import { redirect } from "next/navigation";

import { OnboardingProfileForm } from "@/components/onboarding-profile-form";
import { tr } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profile, error } = await supabase
    .from("user_profile")
    .select(
      "first_name, last_name, date_of_birth, biological_sex, height_cm, weight_kg, activity_level, preferred_language, exercise_modalities, exercise_modality_other_details, exercise_frequency_days_per_week, exercise_duration_minutes, nutritional_goal, pregnancy_lactation_status, has_medical_conditions, medical_conditions_details, has_regular_medications, regular_medications_details, hot_climate_or_heavy_sweating, habits, alcohol_times_per_week, smoking_packs_per_day, dietary_preference, additional_information, allergies, medical_conditions, needs_onboarding_refresh",
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

  if (hasAnyProfile && !needsRefresh) {
    redirect("/app");
  }

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
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Onboarding", "אונבורדינג")}</h1>
        <p className="mt-3 text-sm text-slate-600">
          {tr(locale, "Complete your required profile before using the app.", "יש להשלים את הפרופיל לפני השימוש במערכת.")}
        </p>

        <OnboardingProfileForm locale={locale} defaults={formDefaults} />
      </section>
    </main>
  );
}
