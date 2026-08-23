import Link from "next/link";
import { redirect } from "next/navigation";

import { signOutAction } from "@/app/app/actions";
import { EnvironmentBadge } from "@/components/environment-badge";
import { getEnvironmentBadgeLabel } from "@/lib/environment-badge";
import { formatActivityLevel, formatGender, formatMeasurementUnit, formatProfileValue, normalizeLocale, tr } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profile } = await supabase
    .from("user_profile")
    .select(
      "age, gender, height_cm, weight_kg, activity_level, allergies, medical_conditions",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
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
  const environmentBadgeLabel = getEnvironmentBadgeLabel();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
              {tr(locale, "Protected area", "אזור מוגן")}
            </p>
            {environmentBadgeLabel ? <EnvironmentBadge label={environmentBadgeLabel} /> : null}
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{tr(locale, "Dashboard", "לוח בקרה")}</h1>
        </div>

        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Sign out", "התנתקות")}
          </button>
        </form>
      </header>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "Profile summary", "סיכום פרופיל")}</h2>
        <p className="mt-2 text-sm text-slate-600">
          {tr(locale, "Signed in as", "מחובר בתור")} {user?.email ?? tr(locale, "unknown user", "משתמש לא ידוע")}.
        </p>
        <dl className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
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
            <dt className="font-medium text-slate-900">{tr(locale, "Allergies", "אלרגיות")}</dt>
            <dd>{profile.allergies?.length ? profile.allergies.join(", ") : tr(locale, "None", "ללא")}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-medium text-slate-900">{tr(locale, "Medical condition", "מצב רפואי")}</dt>
            <dd>
              {profile.medical_conditions?.length
                ? profile.medical_conditions.map((item: string) => formatProfileValue(item, locale)).join(", ")
                : tr(locale, "None", "ללא")}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "Next routes", "ניווט מהיר")}</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/app/profile"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Profile", "פרופיל")}
          </Link>
          <Link
            href="/app/goals"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Goals", "יעדים")}
          </Link>
          <Link
            href="/app/daily-report"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "User daily report", "דיווח יומי")}
          </Link>
          <Link
            href="/app/daily-report/defaults"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Report defaults", "ברירות מחדל לדיווח")}
          </Link>
          <Link
            href="/app/documents"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Documents", "מסמכים")}
          </Link>
        </div>
      </section>
    </main>
  );
}
