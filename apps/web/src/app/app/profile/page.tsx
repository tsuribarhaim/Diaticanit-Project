import Link from "next/link";
import { redirect } from "next/navigation";

import {
  formatActivityLevel,
  formatDateForLocale,
  formatDateTimeForLocale,
  formatDietaryPreference,
  formatExerciseModality,
  formatGender,
  formatMeasurementUnit,
  formatNutritionalGoal,
  formatNumberForLocale,
  formatPregnancyLactationStatus,
  normalizeLocale,
  tr,
} from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

const BMI_SCALE_MIN = 12;
const BMI_SCALE_MAX = 40;
const BMI_GOOD_MIN = 18.5;
const BMI_GOOD_MAX = 24.9;
const BMI_WARNING_MARGIN_FACTOR = 0.3;
const CIGARETTES_PER_PACK = 20;

const BMI_GOOD_RANGE = BMI_GOOD_MAX - BMI_GOOD_MIN;
const BMI_WARNING_LOW_MIN = Math.max(BMI_SCALE_MIN, BMI_GOOD_MIN - (BMI_GOOD_RANGE * BMI_WARNING_MARGIN_FACTOR));
const BMI_WARNING_HIGH_MAX = Math.min(BMI_SCALE_MAX, BMI_GOOD_MAX + (BMI_GOOD_RANGE * BMI_WARNING_MARGIN_FACTOR));

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bmiPositionPercent(bmi: number): number {
  const clamped = clamp(bmi, BMI_SCALE_MIN, BMI_SCALE_MAX);
  return ((clamped - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100;
}

function bmiStatus(bmi: number): "good" | "warning" | "out_of_range" {
  if (bmi >= BMI_GOOD_MIN && bmi <= BMI_GOOD_MAX) {
    return "good";
  }

  const inLowWarningBand = bmi >= BMI_WARNING_LOW_MIN && bmi < BMI_GOOD_MIN;
  const inHighWarningBand = bmi > BMI_GOOD_MAX && bmi <= BMI_WARNING_HIGH_MAX;

  if (inLowWarningBand || inHighWarningBand) {
    return "warning";
  }

  return "out_of_range";
}

function formatHabitLabel(value: string, locale: "en" | "he"): string {
  if (value === "smoking_or_vaping") return tr(locale, "Smoking", "עישון");
  if (value === "alcohol") return tr(locale, "Alcohol", "אלכוהול");
  if (value === "none") return tr(locale, "None", "ללא");
  return value;
}

function modalitySupportsSchedule(value: string): boolean {
  return value !== "none";
}

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
    .from("user_profile_enriched")
    .select(
      "first_name, last_name, date_of_birth, biological_sex, calculated_age_years, bmi, height_cm, weight_kg, activity_level, exercise_modalities, exercise_modality_other_details, exercise_schedule_by_modality, exercise_frequency_days_per_week, exercise_duration_minutes, nutritional_goal, pregnancy_lactation_status, has_medical_conditions, medical_conditions_details, has_regular_medications, regular_medications_details, hot_climate_or_heavy_sweating, habits, alcohol_times_per_week, smoking_packs_per_day, dietary_preference, additional_information, allergies, updated_at",
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
  const bmiState = profile.bmi != null ? bmiStatus(profile.bmi) : null;
  const bmiPercent = profile.bmi != null ? bmiPositionPercent(profile.bmi) : null;
  const scheduleByModality =
    profile.exercise_schedule_by_modality && typeof profile.exercise_schedule_by_modality === "object"
      ? profile.exercise_schedule_by_modality as Record<string, { days_per_week?: number; minutes_per_session?: number }>
      : {};
  const selectedScheduledModalities = (profile.exercise_modalities ?? []).filter(modalitySupportsSchedule);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Profile", "פרופיל")}</h1>
        <p className="mt-3 text-sm text-slate-600">{tr(locale, "Manage your profile details.", "ניהול פרטי הפרופיל שלך.")}</p>

        <div className="mt-5 grid gap-4">
          <section className="rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">{tr(locale, "Step 1 - Identity & Vital Statistics", "שלב 1 - זהות ומדדים")}</h2>
            <dl className="mt-3 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 [&>div>dd]:mt-0.5 [&>div>dd]:italic [&>div>dd]:text-slate-600 [&>div>dd]:before:mr-1 [&>div>dd]:before:content-['-']">
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "First name", "שם פרטי")}</dt>
                <dd>{profile.first_name ?? tr(locale, "n/a", "לא זמין")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Last name", "שם משפחה")}</dt>
                <dd>{profile.last_name ?? tr(locale, "n/a", "לא זמין")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Date of birth", "תאריך לידה")}</dt>
                <dd>{profile.date_of_birth ? formatDateForLocale(profile.date_of_birth, locale) : tr(locale, "n/a", "לא זמין")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Age", "גיל")}</dt>
                <dd>{profile.calculated_age_years ?? tr(locale, "n/a", "לא זמין")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Biological sex", "מין ביולוגי")}</dt>
                <dd>{profile.biological_sex ? formatGender(profile.biological_sex, locale) : tr(locale, "n/a", "לא זמין")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Height", "גובה")}</dt>
                <dd>{profile.height_cm ?? tr(locale, "n/a", "לא זמין")} {formatMeasurementUnit("cm", locale)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Weight", "משקל")}</dt>
                <dd>{profile.weight_kg ?? tr(locale, "n/a", "לא זמין")} {formatMeasurementUnit("kg", locale)}</dd>
              </div>
            </dl>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span>{tr(locale, "BMI scale", "סקאלת BMI")}</span>
              </div>

              {/* Numeric scale is always left-to-right, even on RTL pages, so bar position and labels stay aligned. */}
              <div dir="ltr">
                <div className="relative h-3 rounded-full bg-rose-300">
                  <div
                    className="absolute h-full bg-amber-300"
                    style={{
                      left: `${((BMI_WARNING_LOW_MIN - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100}%`,
                      width: `${((BMI_GOOD_MIN - BMI_WARNING_LOW_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100}%`,
                    }}
                  />
                  <div
                    className="absolute h-full rounded-full bg-emerald-400"
                    style={{
                      left: `${((BMI_GOOD_MIN - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100}%`,
                      width: `${((BMI_GOOD_MAX - BMI_GOOD_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100}%`,
                    }}
                  />
                  <div
                    className="absolute h-full bg-amber-300"
                    style={{
                      left: `${((BMI_GOOD_MAX - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100}%`,
                      width: `${((BMI_WARNING_HIGH_MAX - BMI_GOOD_MAX) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100}%`,
                    }}
                  />
                  {bmiPercent != null ? (
                    <div
                      className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white ${
                        bmiState === "good"
                          ? "border-emerald-600"
                          : bmiState === "warning"
                            ? "border-amber-500"
                            : "border-rose-600"
                      }`}
                      style={{ left: `${bmiPercent}%` }}
                      aria-label="bmi-marker"
                    />
                  ) : null}
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{BMI_SCALE_MIN}</span>
                  <span>{BMI_SCALE_MAX}</span>
                </div>
              </div>

              {profile.bmi != null ? (
                <p
                  className={`mt-2 text-xs font-semibold ${
                    bmiState === "good"
                      ? "text-emerald-700"
                      : bmiState === "warning"
                        ? "text-amber-700"
                        : "text-rose-700"
                  }`}
                >
                  {tr(locale, "Current BMI", "BMI נוכחי")}: {formatNumberForLocale(profile.bmi, locale, { maximumFractionDigits: 2 })}
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">{tr(locale, "Step 2 - Lifestyle & Activity", "שלב 2 - אורח חיים ופעילות")}</h2>
            <dl className="mt-3 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 [&>div>dd]:mt-0.5 [&>div>dd]:italic [&>div>dd]:text-slate-600 [&>div>dd]:before:mr-1 [&>div>dd]:before:content-['-']">
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Activity level", "רמת פעילות")}</dt>
                <dd>{formatActivityLevel(profile.activity_level, locale)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Exercise modalities", "סוגי אימון")}</dt>
                <dd>
                  {profile.exercise_modalities?.length
                    ? profile.exercise_modalities.map((value: string) => formatExerciseModality(value, locale)).join(", ")
                    : tr(locale, "None", "ללא")}
                </dd>
              </div>
              {profile.exercise_modalities?.includes("other") && profile.exercise_modality_other_details ? (
                <div>
                  <dt className="font-medium text-slate-900">{tr(locale, "Other exercise type", "סוג אימון אחר")}</dt>
                  <dd>{profile.exercise_modality_other_details}</dd>
                </div>
              ) : null}
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Frequency", "תדירות")}</dt>
                <dd>{profile.exercise_frequency_days_per_week ?? tr(locale, "n/a", "לא זמין")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Duration", "משך")}</dt>
                <dd>{profile.exercise_duration_minutes ?? tr(locale, "n/a", "לא זמין")} {tr(locale, "minutes", "דקות")}</dd>
              </div>
              {selectedScheduledModalities.length > 0 ? (
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-900">{tr(locale, "Per exercise type schedule", "תכנית לפי סוג אימון")}</dt>
                  <dd>
                    <div className="mt-2 space-y-2">
                      {selectedScheduledModalities.map((modality: string) => {
                        const schedule = scheduleByModality[modality];
                        return (
                          <p key={modality} className="not-italic text-slate-700 before:content-none">
                            <span className="font-medium text-slate-900">{formatExerciseModality(modality, locale)}</span>
                            {": "}
                            {schedule?.days_per_week != null && schedule?.minutes_per_session != null
                              ? `${schedule.days_per_week} ${tr(locale, "days/week", "ימים/שבוע")}, ${schedule.minutes_per_session} ${tr(locale, "minutes/session", "דקות לאימון")}`
                              : tr(locale, "Schedule not set", "לא הוגדרה תכנית")}
                          </p>
                        );
                      })}
                    </div>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Goal", "מטרה")}</dt>
                <dd>{profile.nutritional_goal ? formatNutritionalGoal(profile.nutritional_goal, locale) : tr(locale, "n/a", "לא זמין")}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">{tr(locale, "Step 3 - Medical & Physiology", "שלב 3 - רפואי ופיזיולוגי")}</h2>
            <dl className="mt-3 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 [&>div>dd]:mt-0.5 [&>div>dd]:italic [&>div>dd]:text-slate-600 [&>div>dd]:before:mr-1 [&>div>dd]:before:content-['-']">
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Pregnancy/lactation", "הריון/הנקה")}</dt>
                <dd>{profile.pregnancy_lactation_status ? formatPregnancyLactationStatus(profile.pregnancy_lactation_status, locale) : tr(locale, "n/a", "לא זמין")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Medical conditions", "מצבים רפואיים")}</dt>
                <dd>{profile.has_medical_conditions ? (profile.medical_conditions_details || tr(locale, "Yes", "כן")) : tr(locale, "No", "לא")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Regular medications", "תרופות קבועות")}</dt>
                <dd>{profile.has_regular_medications ? (profile.regular_medications_details || tr(locale, "Yes", "כן")) : tr(locale, "No", "לא")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Hot climate/sweating", "אקלים חם/הזעה")}</dt>
                <dd>{profile.hot_climate_or_heavy_sweating ? tr(locale, "Yes", "כן") : tr(locale, "No", "לא")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Habits", "הרגלים")}</dt>
                <dd>{profile.habits?.length ? profile.habits.map((value: string) => formatHabitLabel(value, locale)).join(", ") : tr(locale, "None", "ללא")}</dd>
              </div>
              {profile.habits?.includes("alcohol") ? (
                <div>
                  <dt className="font-medium text-slate-900">{tr(locale, "Alcohol frequency", "תדירות אלכוהול")}</dt>
                  <dd>
                    {profile.alcohol_times_per_week != null
                      ? `${formatNumberForLocale(profile.alcohol_times_per_week, locale, { maximumFractionDigits: 1 })} ${tr(locale, "times/week", "פעמים בשבוע")}`
                      : tr(locale, "n/a", "לא זמין")}
                  </dd>
                </div>
              ) : null}
              {profile.habits?.includes("smoking_or_vaping") ? (
                <div>
                  <dt className="font-medium text-slate-900">{tr(locale, "Smoking amount", "כמות עישון")}</dt>
                  <dd>
                    {profile.smoking_packs_per_day != null
                      ? `${formatNumberForLocale(profile.smoking_packs_per_day * CIGARETTES_PER_PACK, locale, { maximumFractionDigits: 0 })} ${tr(locale, "cigarettes/day", "סיגריות ביום")}`
                      : tr(locale, "n/a", "לא זמין")}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">{tr(locale, "Step 4 - Dietary Profile & Context", "שלב 4 - פרופיל תזונתי")}</h2>
            <dl className="mt-3 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 [&>div>dd]:mt-0.5 [&>div>dd]:italic [&>div>dd]:text-slate-600 [&>div>dd]:before:mr-1 [&>div>dd]:before:content-['-']">
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Dietary preference", "העדפה תזונתית")}</dt>
                <dd>{profile.dietary_preference ? formatDietaryPreference(profile.dietary_preference, locale) : tr(locale, "n/a", "לא זמין")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Allergies", "אלרגיות")}</dt>
                <dd>{profile.allergies?.length ? profile.allergies.join(", ") : tr(locale, "None", "ללא")}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium text-slate-900">{tr(locale, "Additional information", "מידע נוסף")}</dt>
                <dd>{profile.additional_information || tr(locale, "None", "ללא")}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{tr(locale, "Last updated", "עדכון אחרון")}</dt>
                <dd>{formatDateTimeForLocale(profile.updated_at, locale)}</dd>
              </div>
            </dl>
          </section>
        </div>

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
