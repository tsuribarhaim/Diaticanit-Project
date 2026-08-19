import Link from "next/link";
import { redirect } from "next/navigation";

import { formatActivityLevel, formatDateTimeForLocale, formatGender, formatMeasurementUnit, formatProfileValue, normalizeLocale, tr } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
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
      "age, gender, height_cm, weight_kg, activity_level, allergies, medical_conditions, updated_at",
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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Profile", "פרופיל")}</h1>
        <p className="mt-3 text-sm text-slate-600">{tr(locale, "Manage your profile details.", "ניהול פרטי הפרופיל שלך.")}</p>

        <dl className="mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Age", "גיל")}</dt>
            <dd>{profile.age}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Gender", "מגדר")}</dt>
            <dd>{formatGender(profile.gender, locale)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Height", "גובה")}</dt>
            <dd>{profile.height_cm} {formatMeasurementUnit("cm", locale)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Weight", "משקל")}</dt>
            <dd>{profile.weight_kg} {formatMeasurementUnit("kg", locale)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Activity", "רמת פעילות")}</dt>
            <dd>{formatActivityLevel(profile.activity_level, locale)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Last updated", "עדכון אחרון")}</dt>
            <dd>{formatDateTimeForLocale(profile.updated_at, locale)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Language", "שפה")}</dt>
            <dd>{locale === "he" ? "עברית" : "English"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Allergies", "אלרגיות")}</dt>
            <dd>{profile.allergies.length ? profile.allergies.join(", ") : tr(locale, "None", "ללא")}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">{tr(locale, "Medical condition", "מצב רפואי")}</dt>
            <dd>
              {profile.medical_conditions.length
                ? profile.medical_conditions.map((item: string) => formatProfileValue(item, locale)).join(", ")
                : tr(locale, "None", "ללא")}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/app/profile/edit"
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
          >
            {tr(locale, "Edit profile", "עריכת פרופיל")}
          </Link>
          <Link
            href="/app"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Back to dashboard", "חזרה ללוח הבקרה")}
          </Link>
        </div>
      </section>
    </main>
  );
}
