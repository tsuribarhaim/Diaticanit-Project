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
    .from("user_profile")
    .select(
      "age, gender, height_cm, weight_kg, activity_level, allergies, medical_conditions",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !profile) {
    redirect("/app/onboarding");
  }

  const locale = normalizeLocale(
    (
      await supabase
        .from("user_profile")
        .select("preferred_language")
        .eq("user_id", user.id)
        .maybeSingle()
    ).data?.preferred_language,
  );

  const { data: aiConsentRow } = await supabase
    .from("ai_extraction_consents")
    .select("accepted_at, revoked_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const hasAiExtractionConsent =
    Boolean(aiConsentRow?.accepted_at) && !aiConsentRow?.revoked_at;

  const formDefaults = {
    ...profile,
    preferred_language: locale,
    ai_extraction_consent: hasAiExtractionConsent,
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
