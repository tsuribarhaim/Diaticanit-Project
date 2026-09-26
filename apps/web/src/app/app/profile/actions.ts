"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isAvatarColorId } from "@/lib/avatar-colors";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { evaluateProfileTextWithAi } from "@/lib/ai/profile-text";
import { revalidateNavChrome } from "@/lib/nav-chrome";
import {
  activityLevelOptions,
  biologicalSexOptions,
  calculateAgeYears,
  deriveExerciseSummaryFromSchedule,
  dietaryPreferenceOptions,
  exerciseModalityOptions,
  exerciseOtherActivitiesSchema,
  exerciseScheduleByModalitySchema,
  habitOptions,
  medicalConditionOptions,
  modalityRequiresSchedule,
  nutritionalGoalOptions,
  onboardingProfileSchema,
  parseBooleanField,
  parseDelimitedList,
  parseMultiSelect,
  pregnancyLactationOptions,
  validateAllergyEntry,
  validateExerciseOtherDetails,
  validateFreeTextDetails,
  validateMedicalConditionOtherDetails,
  validateMedicationDetails,
} from "@/lib/profile";
import { normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import { computeProfileDiff, parseProfileSnapshot, type ProfileDiffRow, type ProfileForTargets } from "@/lib/targets";

export type ProfileUpdateActionState = {
  error?: string;
  fieldErrors?: Array<{ field: string; message: string }>;
};

export type AvatarActionState = {
  error?: string;
  success?: string;
};

async function resolveUserLocale(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("user_profile")
    .select("preferred_language")
    .eq("user_id", userId)
    .maybeSingle();
  return normalizeLocale(data?.preferred_language);
}

/**
 * Sets which solid color the user's initial-letter avatar shows in - no
 * file upload, no icon set, just picking one of a small fixed palette (see
 * lib/avatar-colors.ts), so there's nothing here beyond validating the
 * chosen id is one of that fixed set and writing it. Always sets a real
 * color (there's no "None" option - the avatar always shows the initial on
 * some color, defaulting to the app's own teal when nothing's chosen yet).
 */
export async function setAvatarColorAction(_prevState: AvatarActionState, formData: FormData): Promise<AvatarActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  // Read straight from the form (see profile-header-card.tsx's hidden
  // preferred_language input) rather than a resolveUserLocale DB round
  // trip - this action already pays for auth.getUser() plus the update
  // itself, and a third sequential round trip just to translate an error
  // message that's almost never shown was real, avoidable latency on every
  // single color change (reported as the picker taking ~4s with no
  // feedback while it ran).
  const locale = requestLocale(formData);

  const colorRaw = formData.get("color")?.toString() ?? "";
  if (!isAvatarColorId(colorRaw)) {
    return { error: tr(locale, "Unknown color option.", "אפשרות צבע לא מוכרת.") };
  }

  const { error: updateError } = await supabase
    .from("user_profile")
    .update({ avatar_color: colorRaw })
    .eq("user_id", user.id);

  if (updateError) {
    logServerError("profile.avatar", "set_color_failed", { userId: user.id, error: updateError.message });
    return {
      error: updateError.message.includes("avatar_color")
        ? tr(
            locale,
            "Database migration missing: apply db/migrations/033_phase11_profile_avatar_color.sql, then try again.",
            "חסרה מיגרציית בסיס נתונים: יש להחיל את db/migrations/033_phase11_profile_avatar_color.sql ואז לנסות שוב.",
          )
        : tr(locale, "Failed to update your avatar. Please try again.", "עדכון האווטאר נכשל. יש לנסות שוב."),
    };
  }

  revalidateNavChrome();
  revalidatePath("/app");
  revalidatePath("/app/profile");

  return { success: tr(locale, "Avatar color updated.", "צבע האווטאר עודכן.") };
}

const LOCALE_COOKIE = "phc_locale";

function isMissingPreferredLanguageColumn(errorMessage: string): boolean {
  return errorMessage.includes("preferred_language") && errorMessage.includes("schema cache");
}

function isMissingOnboardingV2Columns(errorMessage: string): boolean {
  return (
    errorMessage.includes("date_of_birth")
    || errorMessage.includes("first_name")
    || errorMessage.includes("nutritional_goal")
    || errorMessage.includes("exercise_modality_other_details")
    || errorMessage.includes("exercise_other_activities")
    || errorMessage.includes("exercise_schedule_by_modality")
    || errorMessage.includes("alcohol_consumption_level")
    || errorMessage.includes("smoking_packs_per_day")
    || errorMessage.includes("needs_onboarding_refresh")
  );
}

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function requestLocale(formData: FormData): "en" | "he" {
  return normalizeLocale(getFormString(formData, "preferred_language"));
}

function buildAiFieldMessage({
  locale,
  fallback,
  clarificationQuestion,
  suggestedRewrite,
  options,
  optionsLead,
}: {
  locale: "en" | "he";
  fallback: { en: string; he: string };
  clarificationQuestion: string;
  suggestedRewrite: string;
  options: string[];
  optionsLead?: { en: string; he: string };
}): string {
  const question = clarificationQuestion.trim();
  const rewrite = suggestedRewrite.trim();
  const optionsText = options.filter(Boolean).slice(0, 3).join(", ");

  const base = tr(locale, fallback.en, fallback.he);
  const parts = [base];

  if (question) {
    parts.push(question);
  }
  if (rewrite) {
    parts.push(tr(locale, `If it helps, you can write: ${rewrite}`, `אם זה עוזר, אפשר לכתוב כך: ${rewrite}`));
  }
  if (optionsText) {
    parts.push(
      tr(
        locale,
        `${optionsLead?.en ?? "You can choose one of these options:"} ${optionsText}`,
        `${optionsLead?.he ?? "אפשר לבחור אחת מהאפשרויות הבאות:"} ${optionsText}`,
      ),
    );
  }

  return parts.join(" ");
}

export async function updateProfileAction(
  _prevState: ProfileUpdateActionState,
  formData: FormData,
): Promise<ProfileUpdateActionState> {
  const locale = requestLocale(formData);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const parsed = onboardingProfileSchema.safeParse({
    first_name: getFormString(formData, "first_name"),
    last_name: getFormString(formData, "last_name"),
    date_of_birth: getFormString(formData, "date_of_birth"),
    biological_sex: getFormString(formData, "biological_sex"),
    height_cm: getFormString(formData, "height_cm"),
    weight_kg: getFormString(formData, "weight_kg"),
    activity_level: getFormString(formData, "activity_level"),
    preferred_language: getFormString(formData, "preferred_language"),
    exercise_modalities: parseMultiSelect(formData, "exercise_modalities"),
    exercise_other_activities: getFormString(formData, "exercise_other_activities"),
    exercise_schedule_by_modality: getFormString(formData, "exercise_schedule_by_modality"),
    exercise_frequency_days_per_week: getFormString(formData, "exercise_frequency_days_per_week"),
    exercise_duration_minutes: getFormString(formData, "exercise_duration_minutes"),
    nutritional_goal: getFormString(formData, "nutritional_goal"),
    pregnancy_lactation_status: getFormString(formData, "pregnancy_lactation_status") || "none",
    has_medical_conditions: parseBooleanField(formData.get("has_medical_conditions")),
    medical_conditions_details: getFormString(formData, "medical_conditions_details"),
    has_regular_medications: parseBooleanField(formData.get("has_regular_medications")),
    regular_medications_details: getFormString(formData, "regular_medications_details"),
    hot_climate_or_heavy_sweating: parseBooleanField(formData.get("hot_climate_or_heavy_sweating")),
    habits: parseMultiSelect(formData, "habits"),
    alcohol_consumption_level: getFormString(formData, "alcohol_consumption_level"),
    smoking_packs_per_day: getFormString(formData, "smoking_packs_per_day"),
    dietary_preference: getFormString(formData, "dietary_preference"),
    additional_information: getFormString(formData, "additional_information"),
    allergies: parseDelimitedList(formData.get("allergies")),
    medical_conditions: parseDelimitedList(formData.get("medical_conditions")),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.issues.map((issue) => ({
      field: issue.path[0]?.toString() || "form",
      message: issue.message,
    }));

    logServerError("profile.update", "validation_failed", {
      userId: user.id,
      issues: parsed.error.issues,
    });
    return {
      error: tr(
        locale,
        "An error occurred while saving. Please review and update the marked fields above.",
        "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
      ),
      fieldErrors,
    };
  }

  const calculatedAge = calculateAgeYears(parsed.data.date_of_birth);
  if (calculatedAge == null) {
    return {
      error: tr(
        locale,
        "An error occurred while saving. Please review and update the marked fields above.",
        "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
      ),
      fieldErrors: [
        {
          field: "date_of_birth",
          message: tr(
            locale,
            "Date of birth must produce a valid age between 0 and 120.",
            "תאריך הלידה חייב להפיק גיל תקין בין 0 ל-120.",
          ),
        },
      ],
    };
  }

  const legacyMedicalConditions = parsed.data.has_medical_conditions
    ? (parsed.data.medical_conditions.length > 0
      ? parsed.data.medical_conditions
      : parseDelimitedList(parsed.data.medical_conditions_details))
    : [];

  const acceptedAiExtraction = formData.get("accept_ai_extraction")?.toString() === "yes";
  const aiConfig = getAiExtractionConfig();

  const exerciseSummary = deriveExerciseSummaryFromSchedule(
    parsed.data.exercise_modalities,
    parsed.data.exercise_schedule_by_modality,
    parsed.data.exercise_modalities.includes("other") ? parsed.data.exercise_other_activities : [],
    parsed.data.exercise_frequency_days_per_week,
    parsed.data.exercise_duration_minutes,
  );

  if (!acceptedAiExtraction) {
    return {
      error: tr(
        locale,
        "An error occurred while saving. Please review and update the marked fields above.",
        "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
      ),
      fieldErrors: [
        {
          field: "accept_ai_extraction",
          message: tr(
            locale,
            "Consent is required before saving changes.",
            "נדרשת הסכמה לפני שמירת השינויים.",
          ),
        },
      ],
    };
  }

  if (parsed.data.has_medical_conditions && parsed.data.medical_conditions.includes("other")) {
    const medicalText = parsed.data.medical_conditions_details.trim();
    const deterministicValidation = validateMedicalConditionOtherDetails(medicalText);

    if (aiConfig) {
      try {
        const aiValidation = await evaluateProfileTextWithAi({
          config: aiConfig,
          userId: user.id,
          field: "medical_condition",
          text: medicalText,
          locale,
        });

        if (!aiValidation.isRelevant) {
          return {
            error: tr(
              locale,
              "An error occurred while saving. Please review and update the marked fields above.",
              "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
            ),
            fieldErrors: [
              {
                field: "medical_conditions_details",
                message: buildAiFieldMessage({
                  locale,
                  fallback: {
                    en: "I want to help you describe this accurately in your medical profile.",
                    he: "אני רוצה לעזור לך לתאר זאת בצורה מדויקת בפרופיל הרפואי.",
                  },
                  clarificationQuestion: aiValidation.clarificationQuestion,
                  suggestedRewrite: aiValidation.suggestedRewrite,
                  options: aiValidation.options,
                  optionsLead: {
                    en: "Here are possible condition names you can enter in this field:",
                    he: "להלן מחלות אפשריות עבורך לציין בשדה הנכון:",
                  },
                }),
              },
            ],
          };
        }
      } catch (error) {
        logServerError("profile.update", "ai_medical_validation_failed", {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!deterministicValidation.isMeaningful) {
          return {
            error: tr(
              locale,
              "An error occurred while saving. Please review and update the marked fields above.",
              "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
            ),
            fieldErrors: [
              {
                field: "medical_conditions_details",
                message: tr(
                  locale,
                  "Please describe a diagnosed medical condition (name, symptom, or diagnosis).",
                  "יש לתאר מצב רפואי מאובחן (שם, תסמין או אבחנה).",
                ),
              },
            ],
          };
        }
      }
    } else if (!deterministicValidation.isMeaningful) {
      return {
        error: tr(
          locale,
          "An error occurred while saving. Please review and update the marked fields above.",
          "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
        ),
        fieldErrors: [
          {
            field: "medical_conditions_details",
            message: tr(
              locale,
              "Please describe a diagnosed medical condition (name, symptom, or diagnosis).",
              "יש לתאר מצב רפואי מאובחן (שם, תסמין או אבחנה).",
            ),
          },
        ],
      };
    }
  }

  if (parsed.data.has_regular_medications) {
    const medicationText = parsed.data.regular_medications_details.trim();
    const deterministicValidation = validateMedicationDetails(medicationText);

    if (aiConfig) {
      try {
        const aiValidation = await evaluateProfileTextWithAi({
          config: aiConfig,
          userId: user.id,
          field: "medication",
          text: medicationText,
          locale,
        });

        if (!aiValidation.isRelevant) {
          return {
            error: tr(
              locale,
              "An error occurred while saving. Please review and update the marked fields above.",
              "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
            ),
            fieldErrors: [
              {
                field: "regular_medications_details",
                message: buildAiFieldMessage({
                  locale,
                  fallback: {
                    en: "I want to help you record medication details clearly.",
                    he: "אני רוצה לעזור לך לרשום את פרטי התרופות בצורה ברורה.",
                  },
                  clarificationQuestion: aiValidation.clarificationQuestion,
                  suggestedRewrite: aiValidation.suggestedRewrite,
                  options: aiValidation.options,
                  optionsLead: {
                    en: "Here are possible medication names/details you can enter:",
                    he: "להלן אפשרויות אפשריות לרישום שם תרופה או פרטי מינון:",
                  },
                }),
              },
            ],
          };
        }
      } catch (error) {
        logServerError("profile.update", "ai_medication_validation_failed", {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!deterministicValidation.isMeaningful) {
          return {
            error: tr(
              locale,
              "An error occurred while saving. Please review and update the marked fields above.",
              "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
            ),
            fieldErrors: [
              {
                field: "regular_medications_details",
                message: tr(
                  locale,
                  "Please include medication name and/or dosage/frequency.",
                  "יש לכלול שם תרופה ו/או מינון ותדירות.",
                ),
              },
            ],
          };
        }
      }
    } else if (!deterministicValidation.isMeaningful) {
      return {
        error: tr(
          locale,
          "An error occurred while saving. Please review and update the marked fields above.",
          "אירעה שגיאה בשמירה. יש לבדוק ולעדכן את השדות המסומנים למעלה.",
        ),
        fieldErrors: [
          {
            field: "regular_medications_details",
            message: tr(
              locale,
              "Please include medication name and/or dosage/frequency.",
              "יש לכלול שם תרופה ו/או מינון ותדירות.",
            ),
          },
        ],
      };
    }
  }

  const payload = {
    age: calculatedAge,
    first_name: parsed.data.first_name,
    last_name: parsed.data.last_name,
    date_of_birth: parsed.data.date_of_birth,
    gender: parsed.data.biological_sex,
    biological_sex: parsed.data.biological_sex,
    height_cm: parsed.data.height_cm,
    weight_kg: parsed.data.weight_kg,
    activity_level: parsed.data.activity_level,
    preferred_language: parsed.data.preferred_language,
    nutritional_goal: parsed.data.nutritional_goal,
    dietary_preference: parsed.data.dietary_preference,
    hot_climate_or_heavy_sweating: parsed.data.hot_climate_or_heavy_sweating,
    exercise_modalities: parsed.data.exercise_modalities,
    exercise_modality_other_details: null,
    exercise_other_activities: parsed.data.exercise_modalities.includes("other")
      ? parsed.data.exercise_other_activities
      : [],
    exercise_schedule_by_modality: parsed.data.exercise_schedule_by_modality,
    exercise_frequency_days_per_week: exerciseSummary.frequencyDaysPerWeek,
    exercise_duration_minutes: exerciseSummary.durationMinutes,
    pregnancy_lactation_status: parsed.data.pregnancy_lactation_status,
    has_medical_conditions: parsed.data.has_medical_conditions,
    medical_conditions_details: parsed.data.medical_conditions_details,
    has_regular_medications: parsed.data.has_regular_medications,
    regular_medications_details: parsed.data.regular_medications_details,
    habits: parsed.data.habits,
    alcohol_consumption_level: parsed.data.habits.includes("alcohol") ? parsed.data.alcohol_consumption_level : null,
    smoking_packs_per_day: parsed.data.habits.includes("smoking_or_vaping") ? parsed.data.smoking_packs_per_day : null,
    additional_information: parsed.data.additional_information,
    allergies: parsed.data.allergies,
    medical_conditions: legacyMedicalConditions,
    onboarding_version: 2,
    needs_onboarding_refresh: false,
    weight_unit: "kg",
    height_unit: "cm",
  };

  const { error } = await supabase
    .from("user_profile")
    .update(payload)
    .eq("user_id", user.id);

  if (error) {
    logServerError("profile.update", "update_failed", {
      userId: user.id,
      error: error.message,
    });

    if (isMissingPreferredLanguageColumn(error.message)) {
      return {
        error: tr(
          locale,
          "Database migration missing: apply db/migrations/010_phase4_profile_preferred_language.sql, then try again.",
          "חסרה מיגרציית בסיס נתונים: יש להחיל את db/migrations/010_phase4_profile_preferred_language.sql ואז לנסות שוב.",
        ),
      };
    }

    if (isMissingOnboardingV2Columns(error.message)) {
      return {
        error: tr(
          locale,
          "Database migration missing: apply db/migrations/014_phase5_profile_versions_onboarding_fields.sql, db/migrations/015_phase5_habit_magnitude_fields.sql, db/migrations/017_phase5_exercise_other_details.sql, and db/migrations/018_phase5_exercise_schedule_by_modality.sql, then try again.",
          "חסרות מיגרציות בסיס נתונים: יש להחיל את 014, 015, 017 ו-018 תחת db/migrations ואז לנסות שוב.",
        ),
      };
    }

    return {
      error: tr(
        locale,
        "Failed to update profile. Please try again.",
        "עדכון הפרופיל נכשל. יש לנסות שוב.",
      ),
    };
  }

  const provider = aiConfig?.provider ?? "openai-compatible";

  const { error: aiConsentError } = await supabase
    .from("ai_extraction_consents")
    .upsert(
      {
        user_id: user.id,
        provider,
        accepted_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: "user_id" },
    );

  if (aiConsentError) {
    logServerError("profile.update", "ai_consent_upsert_failed", {
      userId: user.id,
      error: aiConsentError.message,
    });
  }

  revalidateNavChrome();
  revalidatePath("/app");
  revalidatePath("/app/profile");
  revalidatePath("/app/profile/edit");

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, parsed.data.preferred_language, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  // Reuses the exact same snapshot-diff mechanism that already powers the
  // "your profile changed" banner on the Targets page (see
  // computeProfileDiff/parseProfileSnapshot) - if this save changed any of
  // the fields that feed target generation, flag it via a one-time query
  // param so the profile page can prompt the user to go review their
  // targets, instead of only surfacing it if/when they happen to visit
  // Targets on their own.
  const { data: activeTargetProfileForDiff } = await supabase
    .from("user_target_profiles")
    .select("profile_snapshot")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  let targetsStale = false;
  if (activeTargetProfileForDiff) {
    const snapshot = parseProfileSnapshot(activeTargetProfileForDiff.profile_snapshot);
    if (snapshot) {
      const updatedProfileForTargets: ProfileForTargets = {
        age: calculatedAge,
        gender: payload.gender,
        biological_sex: payload.biological_sex,
        height_cm: payload.height_cm,
        weight_kg: payload.weight_kg,
        activity_level: payload.activity_level,
        allergies: payload.allergies,
        medical_conditions: payload.medical_conditions,
        medical_conditions_details: payload.medical_conditions_details,
        regular_medications_details: payload.regular_medications_details,
        dietary_preference: payload.dietary_preference ?? null,
        exercise_modalities: payload.exercise_modalities,
        exercise_other_activities: payload.exercise_other_activities,
        exercise_schedule_by_modality: payload.exercise_schedule_by_modality,
        habits: payload.habits,
        pregnancy_lactation_status: payload.pregnancy_lactation_status,
        hot_climate_or_heavy_sweating: payload.hot_climate_or_heavy_sweating,
      };
      targetsStale = computeProfileDiff(snapshot, updatedProfileForTargets, locale).length > 0;
    }
  }

  redirect(targetsStale ? "/app/profile?targetsStale=1" : "/app/profile");
}

// ---------------------------------------------------------------------------
// Quick-edit actions - the redesigned Profile page's chevron rows each save
// just their own field(s) through one of these small, focused actions
// instead of routing every change through the full onboardingProfileSchema
// form above. Deliberately NOT sharing code with updateProfileAction's own
// AI-validation branches (medical conditions/medications) even though the
// logic is very similar - that action is working, thoroughly exercised code,
// and extracting a shared helper out of it risked introducing a regression
// there for the sake of a few dozen duplicated lines here.
// ---------------------------------------------------------------------------

export type QuickEditState = {
  error?: string;
  success?: boolean;
  /** Set when this save changed something the active Targets plan was
   * generated from - callers navigate to /app/profile?targetsStale=1 on
   * success when this is true, reusing the exact same staleness banner
   * updateProfileAction's own save flow already triggers (see its
   * targetsStale computation above), instead of a second parallel
   * notification mechanism. */
  targetsStale?: boolean;
  /** Same signal as targetsStale, but the actual rows behind it - only
   * populated when targetsStale is true. The Profile page's own form
   * callers ignore this (they only redirect on the boolean), but the
   * unified chat's profile-domain apply step (see
   * app/app/profile/chat-actions.ts) uses it to flag ticket #10's
   * "your profile changed, want me to check your targets?" reminder
   * directly, since there's no page redirect/modal step in that flow to
   * surface it through instead. */
  targetsStaleChanges?: ProfileDiffRow[];
};

const PROFILE_FOR_TARGETS_COLUMNS =
  "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating";

async function loadProfileForTargetsDiff(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ProfileForTargets | null> {
  const { data } = await supabase
    .from("user_profile")
    .select(PROFILE_FOR_TARGETS_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;

  return {
    age: Number(data.age ?? 0),
    gender: data.gender ?? null,
    biological_sex: data.biological_sex ?? null,
    height_cm: Number(data.height_cm ?? 0),
    weight_kg: Number(data.weight_kg ?? 0),
    activity_level: data.activity_level,
    allergies: Array.isArray(data.allergies) ? data.allergies : [],
    medical_conditions: Array.isArray(data.medical_conditions) ? data.medical_conditions : [],
    medical_conditions_details: data.medical_conditions_details ?? null,
    regular_medications_details: data.regular_medications_details ?? null,
    dietary_preference: data.dietary_preference ?? null,
    exercise_modalities: Array.isArray(data.exercise_modalities) ? data.exercise_modalities : [],
    exercise_other_activities: Array.isArray(data.exercise_other_activities) ? data.exercise_other_activities : [],
    exercise_schedule_by_modality: data.exercise_schedule_by_modality ?? null,
    habits: Array.isArray(data.habits) ? data.habits : [],
    pregnancy_lactation_status: data.pregnancy_lactation_status ?? null,
    hot_climate_or_heavy_sweating: Boolean(data.hot_climate_or_heavy_sweating),
  };
}

/**
 * Shared "write one small patch, then report back" tail for every quick-edit
 * action below - the actual update, cache revalidation, and the same
 * targets-staleness check updateProfileAction's own save flow already does,
 * so a small single-field edit flags a stale Targets plan exactly as
 * reliably as the full form does.
 */
export async function applyProfilePatchAndFlagTargets({
  supabase,
  userId,
  locale,
  patch,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  locale: "en" | "he";
  patch: Record<string, unknown>;
}): Promise<QuickEditState> {
  const { error } = await supabase.from("user_profile").update(patch).eq("user_id", userId);

  if (error) {
    logServerError("profile.quick_edit", "update_failed", { userId, error: error.message });
    return { error: tr(locale, "Failed to save. Please try again.", "השמירה נכשלה. יש לנסות שוב.") };
  }

  // Unconditional even though only some callers (e.g. updateIdentityAction,
  // which writes first_name) actually touch a nav-chrome field - this
  // shared helper backs every quick-edit action (allergies, medical
  // conditions, habits, etc.), and revalidating a few extra times for
  // fields nav chrome doesn't use is free compared to the alternative of
  // threading "does this patch touch a nav-chrome field" through every
  // caller.
  revalidateNavChrome();
  revalidatePath("/app");
  revalidatePath("/app/profile");
  revalidatePath("/app/targets");

  const { data: activeTargetProfileForDiff } = await supabase
    .from("user_target_profiles")
    .select("profile_snapshot")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  let targetsStale = false;
  let targetsStaleChanges: ProfileDiffRow[] | undefined;
  if (activeTargetProfileForDiff) {
    const storedSnapshot = parseProfileSnapshot(activeTargetProfileForDiff.profile_snapshot);
    if (storedSnapshot) {
      const updatedProfile = await loadProfileForTargetsDiff(supabase, userId);
      if (updatedProfile) {
        const diffRows = computeProfileDiff(storedSnapshot, updatedProfile, locale);
        targetsStale = diffRows.length > 0;
        if (targetsStale) targetsStaleChanges = diffRows;

        // Always resync Daffy's "your profile changed" reminder (ticket #10)
        // to this freshly-computed diff, on every save that touches a
        // target-feeding field - not just when this specific save produced
        // a new one. Confirmed live as a real bug (ticket #70): the
        // previous design only ever SET this flag (from TargetsStaleModal's
        // acknowledge, or the profile chat's own apply step) and never
        // cleared it, so reverting a change back to the locked baseline
        // (e.g. an out-of-range weight edit, then undoing it) left a
        // stale, no-longer-true comparison sitting there indefinitely -
        // Daffy kept citing a change that no longer exists. Since this
        // diff is recomputed against the true baseline (the target
        // profile's own locked-in snapshot) on every relevant save
        // regardless of which field that save touched, writing it here
        // unconditionally keeps the flag always in sync with reality.
        await supabase
          .from("user_profile")
          .update({
            targets_review_pending: targetsStale,
            targets_review_changes: targetsStale ? diffRows : null,
            targets_review_flagged_at: targetsStale ? new Date().toISOString() : null,
          })
          .eq("user_id", userId);
      }
    }
  }

  return { success: true, targetsStale, targetsStaleChanges };
}

/** First/last name + date of birth - the header "Edit Profile" button's own
 * small editor, covering the identity fields that don't belong to any single
 * biometric row below. */
export async function updateIdentityAction(_prevState: QuickEditState, formData: FormData): Promise<QuickEditState> {
  const locale = requestLocale(formData);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const firstName = getFormString(formData, "first_name").trim();
  const lastName = getFormString(formData, "last_name").trim();
  const dateOfBirth = getFormString(formData, "date_of_birth").trim();

  if (!firstName || firstName.length > 80) {
    return { error: tr(locale, "Enter a valid first name.", "יש להזין שם פרטי תקין.") };
  }
  if (!lastName || lastName.length > 80) {
    return { error: tr(locale, "Enter a valid last name.", "יש להזין שם משפחה תקין.") };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return { error: tr(locale, "Enter a valid date of birth.", "יש להזין תאריך לידה תקין.") };
  }

  const calculatedAge = calculateAgeYears(dateOfBirth);
  if (calculatedAge == null) {
    return {
      error: tr(
        locale,
        "Date of birth must produce a valid age between 0 and 120.",
        "תאריך הלידה חייב להפיק גיל תקין בין 0 ל-120.",
      ),
    };
  }

  return applyProfilePatchAndFlagTargets({
    supabase,
    userId: user.id,
    locale,
    patch: { first_name: firstName, last_name: lastName, date_of_birth: dateOfBirth, age: calculatedAge },
  });
}

type SimpleFieldConfig = {
  column: string;
  schema: z.ZodType;
  invalidMessage: { en: string; he: string };
  /** Extra columns written with the same value - only biological_sex needs
   * this today (gender is a legacy duplicate column updateProfileAction
   * also keeps in sync with it). */
  mirrorTo?: string[];
};

/** One action, several rows: every SIMPLE scalar field (a single enum/
 * number/short-text value, no cross-field rules of its own) shares this one
 * action keyed by a hardcoded field whitelist below - not an arbitrary
 * column name from the client, just a small fixed set each with its own real
 * validation. Keeps the action count sane without a real safety trade-off. */
const SIMPLE_FIELD_CONFIG: Record<string, SimpleFieldConfig> = {
  biological_sex: {
    column: "biological_sex",
    schema: z.enum(biologicalSexOptions),
    invalidMessage: { en: "Select a valid sex.", he: "יש לבחור מין תקין." },
    mirrorTo: ["gender"],
  },
  height_cm: {
    column: "height_cm",
    schema: z.coerce.number().min(80).max(250),
    invalidMessage: { en: "Height must be between 80 and 250 cm.", he: "הגובה חייב להיות בין 80 ל-250 ס\"מ." },
  },
  weight_kg: {
    column: "weight_kg",
    schema: z.coerce.number().min(20).max(400),
    invalidMessage: { en: "Weight must be between 20 and 400 kg.", he: "המשקל חייב להיות בין 20 ל-400 ק\"ג." },
  },
  activity_level: {
    column: "activity_level",
    schema: z.enum(activityLevelOptions),
    invalidMessage: { en: "Select a valid activity level.", he: "יש לבחור רמת פעילות תקינה." },
  },
  dietary_preference: {
    column: "dietary_preference",
    schema: z.enum(dietaryPreferenceOptions),
    invalidMessage: { en: "Select a valid dietary preference.", he: "יש לבחור העדפה תזונתית תקינה." },
  },
  nutritional_goal: {
    column: "nutritional_goal",
    schema: z.enum(nutritionalGoalOptions),
    invalidMessage: { en: "Select a valid goal.", he: "יש לבחור מטרה תקינה." },
  },
  pregnancy_lactation_status: {
    column: "pregnancy_lactation_status",
    schema: z.enum(pregnancyLactationOptions),
    invalidMessage: { en: "Select a valid option.", he: "יש לבחור אפשרות תקינה." },
  },
  hot_climate_or_heavy_sweating: {
    column: "hot_climate_or_heavy_sweating",
    schema: z.enum(["true", "false"]).transform((value) => value === "true"),
    invalidMessage: { en: "Invalid value.", he: "ערך לא תקין." },
  },
  additional_information: {
    column: "additional_information",
    schema: z.string().trim().max(1000),
    invalidMessage: {
      en: "Additional information must be at most 1000 characters.",
      he: "המידע הנוסף יכול לכלול עד 1000 תווים.",
    },
  },
};

export async function updateSimpleProfileFieldAction(_prevState: QuickEditState, formData: FormData): Promise<QuickEditState> {
  const locale = requestLocale(formData);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const field = getFormString(formData, "field");
  const config = SIMPLE_FIELD_CONFIG[field];
  if (!config) {
    return { error: tr(locale, "Unknown field.", "שדה לא מוכר.") };
  }

  const parsed = config.schema.safeParse(getFormString(formData, "value"));
  if (!parsed.success) {
    return { error: tr(locale, config.invalidMessage.en, config.invalidMessage.he) };
  }

  // additional_information gets the same "meaningful text" check the full
  // form applies (see onboardingProfileSchema's superRefine) - empty is
  // always fine (it's optional), but non-empty junk/gibberish is rejected
  // the same way here.
  if (field === "additional_information" && typeof parsed.data === "string" && parsed.data) {
    const validation = validateFreeTextDetails(parsed.data, 5);
    if (!validation.isMeaningful) {
      return {
        error: tr(
          locale,
          "Enter meaningful additional information or leave it empty.",
          "יש להזין מידע נוסף משמעותי או להשאיר ריק.",
        ),
      };
    }
  }

  const patch: Record<string, unknown> = { [config.column]: parsed.data };
  for (const mirrorColumn of config.mirrorTo ?? []) {
    patch[mirrorColumn] = parsed.data;
  }

  return applyProfilePatchAndFlagTargets({ supabase, userId: user.id, locale, patch });
}

export async function updateAllergiesAction(_prevState: QuickEditState, formData: FormData): Promise<QuickEditState> {
  const locale = requestLocale(formData);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const allergies = parseDelimitedList(formData.get("allergies"));
  for (const entry of allergies) {
    const validation = validateAllergyEntry(entry);
    if (!validation.isMeaningful) {
      return { error: tr(locale, "Enter a meaningful allergy description.", "יש להזין תיאור אלרגיה משמעותי.") };
    }
  }

  return applyProfilePatchAndFlagTargets({ supabase, userId: user.id, locale, patch: { allergies } });
}

/** Modalities + per-modality schedule + any named "other" activities - the
 * one inherently multi-field row in Section 1/2, since these values only
 * make sense together (picking "Endurance / Cardio" without its own
 * days/minutes leaves an incomplete plan). Mirrors the same cross-field
 * rules onboardingProfileSchema's superRefine enforces for this same data,
 * just applied directly here instead of through that shared schema (which
 * also carries every OTHER onboarding field this action doesn't touch). */
export async function updateExercisePreferencesAction(_prevState: QuickEditState, formData: FormData): Promise<QuickEditState> {
  const locale = requestLocale(formData);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const modalitiesParsed = z.array(z.enum(exerciseModalityOptions)).min(1).safeParse(parseMultiSelect(formData, "exercise_modalities"));
  if (!modalitiesParsed.success) {
    return { error: tr(locale, "Select at least one exercise type.", "יש לבחור לפחות סוג אימון אחד.") };
  }
  const modalities = modalitiesParsed.data;

  if (modalities.includes("none") && modalities.length > 1) {
    return {
      error: tr(
        locale,
        "Select either \"None\" or active exercise types, not both.",
        "יש לבחור \"ללא\" או סוגי אימון פעילים, לא את שניהם.",
      ),
    };
  }

  const otherActivitiesParsed = exerciseOtherActivitiesSchema.safeParse(getFormString(formData, "exercise_other_activities"));
  if (!otherActivitiesParsed.success) {
    return {
      error: tr(
        locale,
        "Enter a valid schedule for your other activities.",
        "יש להזין תכנית תקינה לפעילויות האחרות שלך.",
      ),
    };
  }
  const otherActivities = modalities.includes("other") ? otherActivitiesParsed.data : [];

  if (modalities.includes("other")) {
    if (otherActivities.length === 0) {
      return { error: tr(locale, "Add at least one other activity type.", "יש להוסיף לפחות פעילות אחרת אחת.") };
    }
    for (const activity of otherActivities) {
      const validation = validateExerciseOtherDetails(activity.name);
      if (!validation.isMeaningful) {
        return {
          error: tr(
            locale,
            "Enter a meaningful exercise type related to physical activity.",
            "יש להזין סוג פעילות גופנית משמעותי.",
          ),
        };
      }
    }
  }

  const scheduleParsed = exerciseScheduleByModalitySchema.safeParse(getFormString(formData, "exercise_schedule_by_modality"));
  if (!scheduleParsed.success) {
    return {
      error: tr(
        locale,
        "Enter a valid schedule for your selected exercise types.",
        "יש להזין תכנית תקינה לסוגי האימון שנבחרו.",
      ),
    };
  }
  const schedule = scheduleParsed.data;

  const selectedScheduledModalities = modalities.filter(modalityRequiresSchedule);
  for (const modality of selectedScheduledModalities) {
    if (!schedule[modality]) {
      return {
        error: tr(
          locale,
          "Set frequency and duration for each selected exercise type.",
          "יש להגדיר תדירות ומשך לכל סוג אימון שנבחר.",
        ),
      };
    }
  }

  const exerciseSummary = deriveExerciseSummaryFromSchedule(modalities, schedule, otherActivities, 0, 0);

  return applyProfilePatchAndFlagTargets({
    supabase,
    userId: user.id,
    locale,
    patch: {
      exercise_modalities: modalities,
      exercise_modality_other_details: null,
      exercise_other_activities: otherActivities,
      exercise_schedule_by_modality: schedule,
      exercise_frequency_days_per_week: exerciseSummary.frequencyDaysPerWeek,
      exercise_duration_minutes: exerciseSummary.durationMinutes,
    },
  });
}

/** Same AI-assisted "is this actually a medical condition" validation
 * updateProfileAction applies when "Other" is selected - see this file's own
 * top-of-section comment for why this isn't factored into a shared helper
 * with that action. */
export async function updateMedicalConditionsAction(_prevState: QuickEditState, formData: FormData): Promise<QuickEditState> {
  const locale = requestLocale(formData);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const hasMedicalConditions = parseBooleanField(formData.get("has_medical_conditions"));

  if (!hasMedicalConditions) {
    return applyProfilePatchAndFlagTargets({
      supabase,
      userId: user.id,
      locale,
      patch: { has_medical_conditions: false, medical_conditions: [], medical_conditions_details: "" },
    });
  }

  const medicalConditionsParsed = z.array(z.enum(medicalConditionOptions)).safeParse(parseMultiSelect(formData, "medical_conditions"));
  const medicalConditions = medicalConditionsParsed.success ? medicalConditionsParsed.data : [];
  const detailsRaw = getFormString(formData, "medical_conditions_details").trim().slice(0, 250);

  if (medicalConditions.length === 0) {
    return { error: tr(locale, "Select at least one medical condition option.", "יש לבחור לפחות אפשרות מצב רפואי אחת.") };
  }
  if (medicalConditions.includes("prefer_not_to_disclose") && medicalConditions.length > 1) {
    return {
      error: tr(
        locale,
        "\"Prefer not to disclose\" cannot be combined with other options.",
        "\"מעדיף/ה לא לחשוף\" לא ניתן לשלב עם אפשרויות אחרות.",
      ),
    };
  }

  if (medicalConditions.includes("other")) {
    const deterministicValidation = validateMedicalConditionOtherDetails(detailsRaw);
    const aiConfig = getAiExtractionConfig();

    if (aiConfig) {
      try {
        const aiValidation = await evaluateProfileTextWithAi({
          config: aiConfig,
          userId: user.id,
          field: "medical_condition",
          text: detailsRaw,
          locale,
        });

        if (!aiValidation.isRelevant) {
          return {
            error: buildAiFieldMessage({
              locale,
              fallback: {
                en: "I want to help you describe this accurately in your medical profile.",
                he: "אני רוצה לעזור לך לתאר זאת בצורה מדויקת בפרופיל הרפואי.",
              },
              clarificationQuestion: aiValidation.clarificationQuestion,
              suggestedRewrite: aiValidation.suggestedRewrite,
              options: aiValidation.options,
              optionsLead: {
                en: "Here are possible condition names you can enter in this field:",
                he: "להלן מחלות אפשריות עבורך לציין בשדה הנכון:",
              },
            }),
          };
        }
      } catch (error) {
        logServerError("profile.quick_edit", "ai_medical_validation_failed", {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!deterministicValidation.isMeaningful) {
          return {
            error: tr(
              locale,
              "Please describe a diagnosed medical condition (name, symptom, or diagnosis).",
              "יש לתאר מצב רפואי מאובחן (שם, תסמין או אבחנה).",
            ),
          };
        }
      }
    } else if (!deterministicValidation.isMeaningful) {
      return {
        error: tr(
          locale,
          "Please describe a diagnosed medical condition (name, symptom, or diagnosis).",
          "יש לתאר מצב רפואי מאובחן (שם, תסמין או אבחנה).",
        ),
      };
    }
  }

  return applyProfilePatchAndFlagTargets({
    supabase,
    userId: user.id,
    locale,
    patch: { has_medical_conditions: true, medical_conditions: medicalConditions, medical_conditions_details: detailsRaw },
  });
}

/** Same AI-assisted validation updateProfileAction applies to medication
 * details - see this file's own top-of-section comment on why this isn't
 * factored into a shared helper with that action. */
export async function updateMedicationsAction(_prevState: QuickEditState, formData: FormData): Promise<QuickEditState> {
  const locale = requestLocale(formData);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const hasRegularMedications = parseBooleanField(formData.get("has_regular_medications"));
  const detailsRaw = getFormString(formData, "regular_medications_details").trim().slice(0, 2000);

  if (!hasRegularMedications) {
    return applyProfilePatchAndFlagTargets({
      supabase,
      userId: user.id,
      locale,
      patch: { has_regular_medications: false, regular_medications_details: "" },
    });
  }

  const deterministicValidation = validateMedicationDetails(detailsRaw);
  const aiConfig = getAiExtractionConfig();

  if (aiConfig) {
    try {
      const aiValidation = await evaluateProfileTextWithAi({
        config: aiConfig,
        userId: user.id,
        field: "medication",
        text: detailsRaw,
        locale,
      });

      if (!aiValidation.isRelevant) {
        return {
          error: buildAiFieldMessage({
            locale,
            fallback: {
              en: "I want to help you record medication details clearly.",
              he: "אני רוצה לעזור לך לרשום את פרטי התרופות בצורה ברורה.",
            },
            clarificationQuestion: aiValidation.clarificationQuestion,
            suggestedRewrite: aiValidation.suggestedRewrite,
            options: aiValidation.options,
            optionsLead: {
              en: "Here are possible medication names/details you can enter:",
              he: "להלן אפשרויות אפשריות לרישום שם תרופה או פרטי מינון:",
            },
          }),
        };
      }
    } catch (error) {
      logServerError("profile.quick_edit", "ai_medication_validation_failed", {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });

      if (!deterministicValidation.isMeaningful) {
        return {
          error: tr(
            locale,
            "Please include medication name and/or dosage/frequency.",
            "יש לכלול שם תרופה ו/או מינון ותדירות.",
          ),
        };
      }
    }
  } else if (!deterministicValidation.isMeaningful) {
    return {
      error: tr(
        locale,
        "Please include medication name and/or dosage/frequency.",
        "יש לכלול שם תרופה ו/או מינון ותדירות.",
      ),
    };
  }

  return applyProfilePatchAndFlagTargets({
    supabase,
    userId: user.id,
    locale,
    patch: { has_regular_medications: true, regular_medications_details: detailsRaw },
  });
}

export async function updateHabitsAction(_prevState: QuickEditState, formData: FormData): Promise<QuickEditState> {
  const locale = requestLocale(formData);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const habitsParsed = z.array(z.enum(habitOptions)).safeParse(parseMultiSelect(formData, "habits"));
  if (!habitsParsed.success) {
    return { error: tr(locale, "Select a valid habit option.", "יש לבחור אפשרות הרגל תקינה.") };
  }
  const habits = habitsParsed.data;

  let alcoholConsumptionLevel: "low" | "high" | null = null;
  if (habits.includes("alcohol")) {
    const level = getFormString(formData, "alcohol_consumption_level");
    if (level !== "low" && level !== "high") {
      return { error: tr(locale, "Select a consumption level.", "יש לבחור רמת צריכה.") };
    }
    alcoholConsumptionLevel = level;
  }

  let smokingPacksPerDay: number | null = null;
  if (habits.includes("smoking_or_vaping")) {
    const packsParsed = z.coerce.number().min(0).max(20).safeParse(getFormString(formData, "smoking_packs_per_day"));
    if (!packsParsed.success || packsParsed.data <= 0) {
      return { error: tr(locale, "Enter cigarettes per day.", "יש להזין מספר סיגריות ליום.") };
    }
    smokingPacksPerDay = packsParsed.data;
  }

  return applyProfilePatchAndFlagTargets({
    supabase,
    userId: user.id,
    locale,
    patch: { habits, alcohol_consumption_level: alcoholConsumptionLevel, smoking_packs_per_day: smokingPacksPerDay },
  });
}

/** Plain callable action (not form-bound via useActionState) for the AI
 * consent toggle - there's no existing standalone revoke path anywhere in
 * the app today (only updateProfileAction's own always-accept upsert, run
 * once during a full profile save), so this is the first place consent can
 * actually be turned back off after being granted. */
export async function updateAiConsentAction(accepted: boolean): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = await resolveUserLocale(supabase, user.id);
  const aiConfig = getAiExtractionConfig();
  const provider = aiConfig?.provider ?? "openai-compatible";
  const now = new Date().toISOString();

  const { error } = await supabase.from("ai_extraction_consents").upsert(
    accepted
      ? { user_id: user.id, provider, accepted_at: now, revoked_at: null }
      : { user_id: user.id, provider, revoked_at: now },
    { onConflict: "user_id" },
  );

  if (error) {
    logServerError("profile.ai_consent", "toggle_failed", { userId: user.id, error: error.message });
    return { error: tr(locale, "Failed to update. Please try again.", "העדכון נכשל. יש לנסות שוב.") };
  }

  revalidatePath("/app");
  revalidatePath("/app/profile");
  revalidatePath("/app/targets");
  revalidatePath("/app/daily-report");

  return {};
}
