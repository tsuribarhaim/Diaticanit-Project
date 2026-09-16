import Link from "next/link";
import { redirect } from "next/navigation";

import { signOutAction } from "@/app/app/actions";
import {
  deleteDocumentAction,
  openOriginalDocumentAction,
} from "@/app/app/documents/actions";
import { DocumentUploadForm } from "@/components/document-upload-form";
import { TargetsStaleModal } from "@/components/targets-stale-modal";
import { formatFileSize } from "@/lib/documents";
import {
  formatActivityLevel,
  formatDateForLocale,
  formatDateTimeForLocale,
  formatDietaryPreference,
  formatExerciseModality,
  formatGender,
  formatHabit,
  formatMeasurementUnit,
  formatNutritionalGoal,
  formatNumberForLocale,
  formatPregnancyLactationStatus,
  normalizeLocale,
  tr,
} from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { computeProfileDiff, parseProfileSnapshot, type ProfileForTargets } from "@/lib/targets";

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

function modalitySupportsSchedule(value: string): boolean {
  return value !== "none" && value !== "other";
}

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ targetsStale?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profile, error } = await supabase
    .from("user_profile_enriched")
    .select(
      "first_name, last_name, date_of_birth, gender, biological_sex, calculated_age_years, bmi, height_cm, weight_kg, activity_level, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, exercise_frequency_days_per_week, exercise_duration_minutes, nutritional_goal, pregnancy_lactation_status, has_medical_conditions, medical_conditions, medical_conditions_details, has_regular_medications, regular_medications_details, hot_climate_or_heavy_sweating, habits, alcohol_consumption_level, smoking_packs_per_day, dietary_preference, additional_information, allergies, updated_at",
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

  // Only computed when the profile-save action just flagged this via the
  // one-time query param (see updateProfileAction) - reuses the exact same
  // snapshot-diff the Targets page's own banner already shows.
  let targetsStaleChanges: ReturnType<typeof computeProfileDiff> | null = null;
  if (resolvedSearchParams.targetsStale === "1") {
    const { data: activeTargetProfile } = await supabase
      .from("user_target_profiles")
      .select("profile_snapshot")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const snapshot = activeTargetProfile ? parseProfileSnapshot(activeTargetProfile.profile_snapshot) : null;
    if (snapshot) {
      const currentProfileForTargets: ProfileForTargets = {
        age: profile.calculated_age_years ?? 0,
        gender: profile.gender ?? null,
        biological_sex: profile.biological_sex ?? null,
        height_cm: Number(profile.height_cm ?? 0),
        weight_kg: Number(profile.weight_kg ?? 0),
        activity_level: profile.activity_level,
        allergies: Array.isArray(profile.allergies) ? profile.allergies : [],
        medical_conditions: Array.isArray(profile.medical_conditions) ? profile.medical_conditions : [],
        medical_conditions_details: profile.medical_conditions_details ?? null,
        regular_medications_details: profile.regular_medications_details ?? null,
        dietary_preference: profile.dietary_preference ?? null,
        exercise_modalities: Array.isArray(profile.exercise_modalities) ? profile.exercise_modalities : [],
        exercise_other_activities: Array.isArray(profile.exercise_other_activities)
          ? (profile.exercise_other_activities as ProfileForTargets["exercise_other_activities"])
          : [],
        exercise_schedule_by_modality: profile.exercise_schedule_by_modality ?? null,
        habits: Array.isArray(profile.habits) ? profile.habits : [],
        pregnancy_lactation_status: profile.pregnancy_lactation_status ?? null,
        hot_climate_or_heavy_sweating: Boolean(profile.hot_climate_or_heavy_sweating),
      };
      const diff = computeProfileDiff(snapshot, currentProfileForTargets, locale);
      if (diff.length > 0) {
        targetsStaleChanges = diff;
      }
    }
  }
  const bmiState = profile.bmi != null ? bmiStatus(profile.bmi) : null;
  const bmiPercent = profile.bmi != null ? bmiPositionPercent(profile.bmi) : null;
  const scheduleByModality =
    profile.exercise_schedule_by_modality && typeof profile.exercise_schedule_by_modality === "object"
      ? profile.exercise_schedule_by_modality as Record<string, { days_per_week?: number; minutes_per_session?: number }>
      : {};
  const selectedScheduledModalities = (profile.exercise_modalities ?? []).filter(modalitySupportsSchedule);

  const { data: documents } = await supabase
    .from("user_documents")
    .select(
      "id, category, file_name, mime_type, file_size_bytes, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      {targetsStaleChanges ? (
        <TargetsStaleModal locale={locale} changes={targetsStaleChanges} dismissHref="/app/profile" />
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-end gap-3">
          <Link
            href="/app/profile/edit"
            aria-label={tr(locale, "Edit profile", "עריכת פרופיל")}
            title={tr(locale, "Edit profile", "עריכת פרופיל")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-teal-300 text-teal-700 hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M16.862 4.487a2.06 2.06 0 1 1 2.915 2.914L7.5 19.68l-4 1 1-4L16.862 4.487Z" />
              <path d="M15 6.5 17.5 9" />
            </svg>
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-sm text-slate-600">{tr(locale, "Manage your profile details.", "ניהול פרטי הפרופיל שלך.")}</p>
          <p className="text-sm text-slate-500">
            <span className="text-slate-300"> • </span>
            {tr(locale, "Last updated", "עדכון אחרון")} - {formatDateForLocale(profile.updated_at, locale)}
          </p>
        </div>

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
              {Array.isArray(profile.exercise_other_activities) && profile.exercise_other_activities.length > 0 ? (
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-900">{tr(locale, "Other exercise activities", "פעילויות גופניות אחרות")}</dt>
                  <dd>
                    <div className="mt-2 space-y-2">
                      {(profile.exercise_other_activities as Array<{ name: string; days_per_week?: number; minutes_per_session?: number }>).map((activity, index) => (
                        <p key={`${activity.name}-${index}`} className="not-italic text-slate-700 before:content-none">
                          <span className="font-medium text-slate-900">{activity.name}</span>
                          {": "}
                          {activity.days_per_week != null && activity.minutes_per_session != null
                            ? `${activity.days_per_week} ${tr(locale, "days/week", "ימים/שבוע")}, ${activity.minutes_per_session} ${tr(locale, "minutes/session", "דקות לאימון")}`
                            : tr(locale, "Schedule not set", "לא הוגדרה תכנית")}
                        </p>
                      ))}
                    </div>
                  </dd>
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
                <dd>{profile.habits?.length ? profile.habits.map((value: string) => formatHabit(value, locale)).join(", ") : tr(locale, "None", "ללא")}</dd>
              </div>
              {profile.habits?.includes("alcohol") ? (
                <div>
                  <dt className="font-medium text-slate-900">{tr(locale, "Alcohol consumption", "צריכת אלכוהול")}</dt>
                  <dd>
                    {profile.alcohol_consumption_level === "low"
                      ? tr(locale, "Low consumption", "צריכה נמוכה")
                      : profile.alcohol_consumption_level === "high"
                        ? tr(locale, "High consumption", "צריכה גבוהה")
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
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">{tr(locale, "Step 5 - Medical Documents", "שלב 5 - מסמכים רפואיים")}</h2>
            <p className="mt-2 text-xs text-slate-600">
              {tr(
                locale,
                "Upload lab results and other medical reports so the AI engine can use them alongside your profile.",
                "יש להעלות תוצאות בדיקות דם ומסמכים רפואיים נוספים כדי שמנוע ה-AI יוכל להשתמש בהם יחד עם הפרופיל שלך.",
              )}
            </p>

            <div className="mt-4">
              <DocumentUploadForm locale={locale} />
            </div>

            {!documents?.length ? (
              <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
                {tr(locale, "No documents uploaded yet.", "עדיין לא הועלו מסמכים.")}
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {documents.map((doc) => {
                  return (
                    <li
                      key={doc.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{doc.file_name}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            {doc.category} • {doc.mime_type ?? tr(locale, "Unknown type", "סוג לא ידוע")} •{" "}
                            {formatFileSize(doc.file_size_bytes)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {tr(locale, "Uploaded", "הועלה")} {formatDateTimeForLocale(doc.created_at, locale)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/app/documents/${doc.id}/extraction`}
                            className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                          >
                            {tr(locale, "View", "צפייה")}
                          </Link>

                          <form action={openOriginalDocumentAction}>
                            <input type="hidden" name="document_id" value={doc.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                            >
                              {tr(locale, "Original file", "קובץ מקור")}
                            </button>
                          </form>

                          <form action={deleteDocumentAction}>
                            <input type="hidden" name="document_id" value={doc.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              {tr(locale, "Delete", "מחיקה")}
                            </button>
                          </form>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Home for destinations that don't fit AppBottomNav's 4 tabs -
              Manage Saved List, Settings, and Sign out stay in the top nav
              on desktop unchanged, but only reach mobile users through here. */}
          <section className="rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">{tr(locale, "Account", "חשבון")}</h2>
            <div className="mt-3 flex flex-col gap-2">
              <Link
                href="/app/daily-report/defaults"
                className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {tr(locale, "Manage Saved List", "ניהול רשימה שמורה")}
              </Link>
              <Link
                href="/app/settings"
                className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {tr(locale, "Settings", "הגדרות")}
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full rounded-lg border border-rose-200 px-4 py-3 text-start text-sm font-medium text-rose-700 hover:bg-rose-50"
                >
                  {tr(locale, "Sign out", "התנתקות")}
                </button>
              </form>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
