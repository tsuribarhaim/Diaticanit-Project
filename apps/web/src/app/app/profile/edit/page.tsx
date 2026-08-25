import { redirect } from "next/navigation";

import { ProfileEditForm } from "@/components/profile-edit-form";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfileEditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profile, error } = await supabase
    .from("user_profile_enriched")
    .select(
      "first_name, last_name, date_of_birth, biological_sex, height_cm, weight_kg, activity_level, preferred_language, exercise_modalities, exercise_modality_other_details, exercise_schedule_by_modality, exercise_frequency_days_per_week, exercise_duration_minutes, nutritional_goal, pregnancy_lactation_status, has_medical_conditions, medical_conditions_details, has_regular_medications, regular_medications_details, hot_climate_or_heavy_sweating, habits, alcohol_times_per_week, smoking_packs_per_day, dietary_preference, additional_information, allergies, calculated_age_years, bmi, updated_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !profile) {
    redirect("/app/onboarding");
  }

  const locale = normalizeLocale(
    profile.preferred_language,
  );

  const { data: aiConsentRow } = await supabase
    .from("ai_extraction_consents")
    .select("accepted_at, revoked_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const hasAiExtractionConsent =
    Boolean(aiConsentRow?.accepted_at) && !aiConsentRow?.revoked_at;

  const formDefaults = {
    first_name: profile.first_name ?? "",
    last_name: profile.last_name ?? "",
    date_of_birth: profile.date_of_birth ?? "",
    biological_sex: profile.biological_sex ?? "male",
    height_cm: profile.height_cm ?? 170,
    weight_kg: profile.weight_kg ?? 70,
    activity_level: profile.activity_level ?? "moderate",
    exercise_modalities: profile.exercise_modalities ?? [],
    exercise_modality_other_details: profile.exercise_modality_other_details ?? "",
    exercise_schedule_by_modality: profile.exercise_schedule_by_modality ?? {},
    exercise_frequency_days_per_week: profile.exercise_frequency_days_per_week ?? 0,
    exercise_duration_minutes: profile.exercise_duration_minutes ?? 0,
    nutritional_goal: profile.nutritional_goal ?? "maintenance",
    pregnancy_lactation_status: profile.pregnancy_lactation_status ?? "none",
    has_medical_conditions: Boolean(profile.has_medical_conditions),
    medical_conditions_details: profile.medical_conditions_details ?? "",
    has_regular_medications: Boolean(profile.has_regular_medications),
    regular_medications_details: profile.regular_medications_details ?? "",
    hot_climate_or_heavy_sweating: Boolean(profile.hot_climate_or_heavy_sweating),
    habits: profile.habits ?? [],
    alcohol_times_per_week: profile.alcohol_times_per_week ?? null,
    smoking_packs_per_day: profile.smoking_packs_per_day ?? null,
    dietary_preference: profile.dietary_preference ?? "standard",
    additional_information: profile.additional_information ?? "",
    allergies: profile.allergies ?? [],
    preferred_language: locale,
    ai_extraction_consent: hasAiExtractionConsent,
    profile_updated_at: profile.updated_at ?? null,
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Edit profile", "עריכת פרופיל")}</h1>
        <p className="mt-3 text-sm text-slate-600">
          {tr(locale, "Update your health profile details.", "עדכון פרטי הפרופיל הבריאותי שלך.")}
        </p>
        <ProfileEditForm defaults={formDefaults} locale={locale} />
      </section>
    </main>
  );
}
