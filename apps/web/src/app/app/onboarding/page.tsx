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
      "age, gender, height_cm, weight_kg, activity_level, allergies, medical_conditions",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (!error && profile) {
    redirect("/app");
  }

  const locale = "en";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Onboarding", "אונבורדינג")}</h1>
        <p className="mt-3 text-sm text-slate-600">
          {tr(locale, "Complete your required profile before using the app.", "יש להשלים את הפרופיל לפני השימוש במערכת.")}
        </p>

        <OnboardingProfileForm locale={locale} />
      </section>
    </main>
  );
}
