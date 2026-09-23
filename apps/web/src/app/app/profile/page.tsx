import Link from "next/link";
import { redirect } from "next/navigation";

import { signOutAction } from "@/app/app/actions";
import { deleteDocumentAction, openOriginalDocumentAction } from "@/app/app/documents/actions";
import { hasAiTargetsConsent } from "@/app/app/targets/actions";
import {
  AiConsentToggleRow,
  ComingSoonRow,
  DataPrivacyRow,
  PasskeysRow,
} from "@/components/profile-app-settings-rows";
import { DocumentUploadForm } from "@/components/document-upload-form";
import {
  AllergiesFieldRow,
  ExercisePreferencesRow,
  HabitsRow,
  MedicalConditionsRow,
  MedicationsRow,
} from "@/components/profile-health-detail-rows";
import { LocalDateTime } from "@/components/local-time";
import { ProfileHeaderCard } from "@/components/profile-header-card";
import { ExpandableRow, ProfileRow, ProfileRowGroup, ProfileSectionTitle, QuickBooleanFieldRow, QuickScalarFieldRow } from "@/components/profile-quick-edit";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { TargetsStaleModal } from "@/components/targets-stale-modal";
import { DEFAULT_AVATAR_COLOR, isAvatarColorId } from "@/lib/avatar-colors";
import { formatFileSize } from "@/lib/documents";
import { getEnvironmentBadgeLabel } from "@/lib/environment-badge";
import {
  activityLevelOptions,
  biologicalSexOptions,
  dietaryPreferenceOptions,
  nutritionalGoalOptions,
  pregnancyLactationOptions,
} from "@/lib/profile";
import {
  formatActivityLevel,
  formatDietaryPreference,
  formatGender,
  formatMeasurementUnit,
  formatNutritionalGoal,
  formatPregnancyLactationStatus,
  normalizeLocale,
  tr,
} from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { computeProfileDiff, parseProfileSnapshot, type ProfileForTargets } from "@/lib/targets";
import { normalizeTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

function formatMemberSince(createdAt: string | undefined, locale: "en" | "he"): string {
  if (!createdAt) return tr(locale, "Member", "חבר/ה");
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return tr(locale, "Member", "חבר/ה");
  const formatted = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { month: "short", year: "numeric" }).format(date);
  return tr(locale, `Member since ${formatted}`, `חבר/ה מאז ${formatted}`);
}

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

  // None of these six queries depend on each other's result - all six only
  // need user.id (and, for the target-snapshot lookup, whether the
  // targetsStale query param is set, already known here) - so they're all
  // fired together instead of paying up to six sequential round trips
  // before this page can even start rendering.
  const [
    { data: profile, error },
    localeAndAvatarSelect,
    { data: activeTargetProfileForStaleCheck },
    { data: documents },
    { data: earliestWeightReport },
    hasAiConsent,
  ] = await Promise.all([
    supabase
      .from("user_profile_enriched")
      .select(
        "first_name, last_name, date_of_birth, gender, biological_sex, calculated_age_years, bmi, height_cm, weight_kg, activity_level, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, exercise_frequency_days_per_week, exercise_duration_minutes, nutritional_goal, pregnancy_lactation_status, has_medical_conditions, medical_conditions, medical_conditions_details, has_regular_medications, regular_medications_details, hot_climate_or_heavy_sweating, habits, alcohol_consumption_level, smoking_packs_per_day, dietary_preference, additional_information, allergies, updated_at",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    // Falls back to a query without avatar_color when that column doesn't
    // exist yet (migration 033 not applied) - same reasoning/pattern as
    // layout.tsx's own copy of this fallback.
    supabase
      .from("user_profile")
      .select("preferred_language, avatar_color, theme_preference")
      .eq("user_id", user.id)
      .maybeSingle(),
    resolvedSearchParams.targetsStale === "1"
      ? supabase.from("user_target_profiles").select("profile_snapshot").eq("user_id", user.id).eq("is_active", true).maybeSingle()
      : Promise.resolve({ data: null as { profile_snapshot: unknown } | null }),
    supabase
      .from("user_documents")
      .select("id, category, file_name, mime_type, file_size_bytes, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("user_daily_reports")
      .select("reported_weight_kg, report_at")
      .eq("user_id", user.id)
      .not("reported_weight_kg", "is", null)
      .order("report_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    hasAiTargetsConsent({ supabase, userId: user.id }),
  ]);

  if (error || !profile) {
    redirect("/app/onboarding");
  }

  let preferredLanguage: string | null = localeAndAvatarSelect.data?.preferred_language ?? null;
  let avatarColorRaw: string | null = localeAndAvatarSelect.data?.avatar_color ?? null;
  if (localeAndAvatarSelect.error?.message.includes("avatar_color")) {
    preferredLanguage = (
      await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()
    ).data?.preferred_language ?? null;
    avatarColorRaw = null;
  }

  const locale = normalizeLocale(preferredLanguage);
  const theme = normalizeTheme(localeAndAvatarSelect.data?.theme_preference);
  const avatarColor = isAvatarColorId(avatarColorRaw) ? avatarColorRaw : DEFAULT_AVATAR_COLOR;
  // Same badge the standalone /app/settings page already shows - duplicated
  // here since mobile has no other path to it now that Language/Theme/
  // Passkeys all live inline on this page too (see this redesign's own
  // decision to leave /app/settings itself untouched rather than remove it).
  const environmentBadgeLabel = getEnvironmentBadgeLabel();

  // Only computed when the profile-save action just flagged this via the
  // one-time query param (see updateProfileAction / the quick-edit actions'
  // shared applyProfilePatchAndFlagTargets) - reuses the exact same
  // snapshot-diff the Targets page's own banner already shows.
  let targetsStaleChanges: ReturnType<typeof computeProfileDiff> | null = null;
  if (resolvedSearchParams.targetsStale === "1") {
    const snapshot = activeTargetProfileForStaleCheck
      ? parseProfileSnapshot(activeTargetProfileForStaleCheck.profile_snapshot)
      : null;
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

  const scheduleByModality =
    profile.exercise_schedule_by_modality && typeof profile.exercise_schedule_by_modality === "object"
      ? (profile.exercise_schedule_by_modality as Record<string, { days_per_week: number; minutes_per_session: number }>)
      : {};
  const otherActivities = Array.isArray(profile.exercise_other_activities)
    ? (profile.exercise_other_activities as Array<{ name: string; days_per_week: number; minutes_per_session: number }>)
    : [];

  return (
    <main dir="auto" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6 sm:py-10">
      {targetsStaleChanges ? <TargetsStaleModal locale={locale} changes={targetsStaleChanges} dismissHref="/app/profile" /> : null}

      <ProfileHeaderCard
        locale={locale}
        avatarColor={avatarColor}
        firstName={profile.first_name ?? ""}
        lastName={profile.last_name ?? ""}
        dateOfBirth={profile.date_of_birth ?? ""}
        email={user.email ?? null}
        memberSinceLabel={formatMemberSince(user.created_at, locale)}
      />

      <div>
        <ProfileSectionTitle>{tr(locale, "Personal Attributes & Biometrics", "מדדים אישיים וביומטריים")}</ProfileSectionTitle>
        <ProfileRowGroup>
          <ProfileRow
            label={tr(locale, "Age", "גיל")}
            value={profile.calculated_age_years != null ? String(profile.calculated_age_years) : tr(locale, "n/a", "לא זמין")}
            caption={tr(locale, "From your date of birth - edit it above", "מתאריך הלידה שלך - ניתן לערוך למעלה")}
          />
          <QuickScalarFieldRow
            locale={locale}
            label={tr(locale, "Sex", "מין")}
            field="biological_sex"
            value={profile.biological_sex ?? "male"}
            displayValue={profile.biological_sex ? formatGender(profile.biological_sex, locale) : tr(locale, "n/a", "לא זמין")}
            kind="select"
            options={biologicalSexOptions.map((option) => ({ value: option, label: formatGender(option, locale) }))}
          />
          <QuickScalarFieldRow
            locale={locale}
            label={tr(locale, "Height", "גובה")}
            field="height_cm"
            value={String(profile.height_cm ?? "")}
            unit={formatMeasurementUnit("cm", locale)}
            kind="number"
            min={80}
            max={250}
          />
          <QuickScalarFieldRow
            locale={locale}
            label={tr(locale, "Current weight", "משקל נוכחי")}
            field="weight_kg"
            value={String(profile.weight_kg ?? "")}
            unit={formatMeasurementUnit("kg", locale)}
            caption={profile.bmi != null ? `${tr(locale, "BMI", "BMI")} ${profile.bmi.toFixed(1)}` : undefined}
            kind="number"
            min={20}
            max={400}
            step={0.1}
          />
          <ProfileRow
            label={tr(locale, "Starting weight", "משקל התחלתי")}
            value={earliestWeightReport?.reported_weight_kg != null ? `${earliestWeightReport.reported_weight_kg} ${formatMeasurementUnit("kg", locale)}` : tr(locale, "n/a", "לא זמין")}
            caption={
              earliestWeightReport?.report_at ? (
                <>
                  {tr(locale, "From your first Daily Report entry, ", "מהדיווח היומי הראשון שלך, ")}
                  <LocalDateTime value={earliestWeightReport.report_at} locale={locale} />
                </>
              ) : (
                tr(locale, "Log a weight in Daily Report to set this", "רשמו משקל בדיווח היומי כדי להגדיר זאת")
              )
            }
          />
          <QuickScalarFieldRow
            locale={locale}
            label={tr(locale, "Activity level", "רמת פעילות")}
            field="activity_level"
            value={profile.activity_level}
            displayValue={formatActivityLevel(profile.activity_level, locale)}
            kind="select"
            options={activityLevelOptions.map((option) => ({ value: option, label: formatActivityLevel(option, locale) }))}
          />
        </ProfileRowGroup>
      </div>

      <div>
        <ProfileSectionTitle subtitle={tr(locale, "Feeds directly into how the AI generates and adjusts your daily targets.", "משפיע ישירות על האופן שבו ה-AI יוצר ומעדכן את היעדים היומיים שלך.")}>
          {tr(locale, "Health & Target Preferences", "העדפות בריאות ויעדים")}
        </ProfileSectionTitle>
        <ProfileRowGroup>
          <QuickScalarFieldRow
            locale={locale}
            label={tr(locale, "Dietary preference", "העדפה תזונתית")}
            field="dietary_preference"
            value={profile.dietary_preference ?? "standard"}
            displayValue={profile.dietary_preference ? formatDietaryPreference(profile.dietary_preference, locale) : tr(locale, "n/a", "לא זמין")}
            kind="select"
            options={dietaryPreferenceOptions.map((option) => ({ value: option, label: formatDietaryPreference(option, locale) }))}
          />
          <QuickScalarFieldRow
            locale={locale}
            label={tr(locale, "Nutritional goal", "מטרה תזונתית")}
            field="nutritional_goal"
            value={profile.nutritional_goal ?? "maintenance"}
            displayValue={profile.nutritional_goal ? formatNutritionalGoal(profile.nutritional_goal, locale) : tr(locale, "n/a", "לא זמין")}
            kind="select"
            options={nutritionalGoalOptions.map((option) => ({ value: option, label: formatNutritionalGoal(option, locale) }))}
          />
          <AllergiesFieldRow locale={locale} allergies={profile.allergies ?? []} />
          <ExercisePreferencesRow
            locale={locale}
            modalities={profile.exercise_modalities ?? []}
            otherActivities={otherActivities}
            scheduleByModality={scheduleByModality}
          />
          <MedicalConditionsRow
            locale={locale}
            hasMedicalConditions={Boolean(profile.has_medical_conditions)}
            medicalConditions={profile.medical_conditions ?? []}
            medicalConditionsDetails={profile.medical_conditions_details ?? ""}
          />
          <MedicationsRow
            locale={locale}
            hasRegularMedications={Boolean(profile.has_regular_medications)}
            regularMedicationsDetails={profile.regular_medications_details ?? ""}
          />
          {profile.biological_sex === "female" ? (
            <QuickScalarFieldRow
              locale={locale}
              label={tr(locale, "Pregnancy / lactation", "הריון / הנקה")}
              field="pregnancy_lactation_status"
              value={profile.pregnancy_lactation_status ?? "none"}
              displayValue={profile.pregnancy_lactation_status ? formatPregnancyLactationStatus(profile.pregnancy_lactation_status, locale) : tr(locale, "n/a", "לא זמין")}
              kind="select"
              options={pregnancyLactationOptions.map((option) => ({ value: option, label: formatPregnancyLactationStatus(option, locale) }))}
            />
          ) : null}
          <HabitsRow
            locale={locale}
            habits={profile.habits ?? []}
            alcoholConsumptionLevel={(profile.alcohol_consumption_level as "low" | "high" | null) ?? null}
            smokingPacksPerDay={profile.smoking_packs_per_day ?? null}
          />
          <QuickBooleanFieldRow
            locale={locale}
            label={tr(locale, "Hot climate / heavy sweating", "אקלים חם / הזעה מרובה")}
            field="hot_climate_or_heavy_sweating"
            checked={Boolean(profile.hot_climate_or_heavy_sweating)}
          />
          <QuickScalarFieldRow
            locale={locale}
            label={tr(locale, "Additional information", "מידע נוסף")}
            field="additional_information"
            value={profile.additional_information ?? ""}
            displayValue={profile.additional_information || tr(locale, "None", "ללא")}
            kind="textarea"
            maxLength={1000}
          />
          <ExpandableRow
            label={tr(locale, "Medical documents", "מסמכים רפואיים")}
            value={documents?.length ? String(documents.length) : tr(locale, "None", "ללא")}
          >
            <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
              {tr(
                locale,
                "Upload lab results and other medical reports so the AI engine can use them alongside your profile.",
                "יש להעלות תוצאות בדיקות דם ומסמכים רפואיים נוספים כדי שמנוע ה-AI יוכל להשתמש בהם יחד עם הפרופיל שלך.",
              )}
            </p>
            <DocumentUploadForm locale={locale} />
            {!documents?.length ? (
              <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
                {tr(locale, "No documents uploaded yet.", "עדיין לא הועלו מסמכים.")}
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {documents.map((doc) => (
                  <li key={doc.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{doc.file_name}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                          {doc.category} • {doc.mime_type ?? tr(locale, "Unknown type", "סוג לא ידוע")} • {formatFileSize(doc.file_size_bytes)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {tr(locale, "Uploaded", "הועלה")} <LocalDateTime value={doc.created_at} locale={locale} />
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/app/documents/${doc.id}/extraction`}
                          className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-400 dark:hover:bg-teal-950/40"
                        >
                          {tr(locale, "View", "צפייה")}
                        </Link>
                        <form action={openOriginalDocumentAction}>
                          <input type="hidden" name="document_id" value={doc.id} />
                          <button type="submit" className="rounded-lg border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-400 dark:hover:bg-sky-950/40">
                            {tr(locale, "Original file", "קובץ מקור")}
                          </button>
                        </form>
                        <form action={deleteDocumentAction}>
                          <input type="hidden" name="document_id" value={doc.id} />
                          <button type="submit" className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40">
                            {tr(locale, "Delete", "מחיקה")}
                          </button>
                        </form>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ExpandableRow>
          <AiConsentToggleRow locale={locale} checked={hasAiConsent} />
        </ProfileRowGroup>
      </div>

      <div>
        <ProfileSectionTitle>{tr(locale, "App & Feature Settings", "הגדרות אפליקציה ותכונות")}</ProfileSectionTitle>
        <ProfileRowGroup>
          <ProfileRow label={tr(locale, "Language", "שפה")} endSlot={<LanguageToggle locale={locale} />} />
          <ProfileRow label={tr(locale, "Theme", "ערכת נושא")} endSlot={<ThemeToggle locale={locale} theme={theme} />} />
          <ComingSoonRow locale={locale} label={tr(locale, "Measurement units", "יחידות מידה")} caption={tr(locale, "Metric (kg, cm)", "מטרי (ק\"ג, ס\"מ)")} />
          <ComingSoonRow locale={locale} label={tr(locale, "Connected apps & devices", "אפליקציות ומכשירים מחוברים")} />
          <PasskeysRow locale={locale} />
          <ProfileRow label={tr(locale, "Manage saved meals list", "ניהול רשימת ארוחות שמורות")} href="/app/daily-report/defaults" />
          <DataPrivacyRow locale={locale} />
          {/* Plain text, not the pill/badge treatment EnvironmentBadge
              renders elsewhere (Settings, sign-in) - a ticket (TCK-6)
              reported the highlighted frame looked out of place next to
              every other row on this page, which all show their value as
              plain text via ProfileRow's own `value` prop. */}
          {environmentBadgeLabel ? (
            <ProfileRow label={tr(locale, "Environment", "סביבה")} value={environmentBadgeLabel} />
          ) : null}
        </ProfileRowGroup>
      </div>

      <div>
        <ProfileSectionTitle>{tr(locale, "Account & Support", "חשבון ותמיכה")}</ProfileSectionTitle>
        <ProfileRowGroup>
          {/* Always available here regardless of whether anything's
              pending - the nav bar's own Notifications link (see
              app-nav.tsx) only shows up at all once there's something
              unread/unresolved to act on, so this is the way in the rest
              of the time. The notification-preferences row that used to
              live under App & Feature Settings above (still not built)
              was dropped rather than kept alongside this one. */}
          <ProfileRow label={tr(locale, "Notifications", "התראות")} href="/app/notifications" />
          <ProfileRow label={tr(locale, "Support Tickets", "פניות תמיכה")} href="/app/tickets" />
          <ComingSoonRow locale={locale} label={tr(locale, "Help Center / FAQ", "מרכז עזרה / שאלות נפוצות")} />
          <ComingSoonRow locale={locale} label={tr(locale, "Terms of Service", "תנאי שימוש")} />
        </ProfileRowGroup>
      </div>

      <form action={signOutAction}>
        <button
          type="submit"
          className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-center text-sm font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50"
        >
          {tr(locale, "Log Out", "התנתקות")}
        </button>
      </form>
    </main>
  );
}
