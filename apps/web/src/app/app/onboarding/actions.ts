"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAiExtractionConfig } from "@/lib/ai/env";
import {
  calculateAgeYears,
  onboardingProfileSchema,
  parseBooleanField,
  parseDelimitedList,
  parseMultiSelect,
} from "@/lib/profile";
import { normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export type OnboardingActionState = {
  error?: string;
  fieldErrors?: Array<{
    field: string;
    message: string;
  }>;
};

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
    || errorMessage.includes("alcohol_times_per_week")
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

export async function saveOnboardingProfileAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
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
    exercise_modality_other_details: getFormString(formData, "exercise_modality_other_details"),
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
    alcohol_times_per_week: getFormString(formData, "alcohol_times_per_week"),
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

    logServerError("onboarding.saveProfile", "validation_failed", {
      userId: user.id,
      issues: parsed.error.issues,
    });

    return {
      error: tr(locale, "Please correct the highlighted fields and try again.", "יש לתקן את השדות המסומנים ולנסות שוב."),
      fieldErrors,
    };
  }

  const calculatedAge = calculateAgeYears(parsed.data.date_of_birth);
  if (calculatedAge == null) {
    return {
      error: tr(
        locale,
        "Date of birth must produce a valid age between 0 and 120.",
        "תאריך הלידה חייב להפיק גיל תקין בין 0 ל-120.",
      ),
    };
  }

  const legacyMedicalConditions = parsed.data.has_medical_conditions
    ? (parsed.data.medical_conditions.length > 0
      ? parsed.data.medical_conditions
      : parseDelimitedList(parsed.data.medical_conditions_details))
    : [];

  const payload = {
    user_id: user.id,
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
    exercise_modality_other_details: parsed.data.exercise_modalities.includes("other")
      ? parsed.data.exercise_modality_other_details
      : null,
    exercise_frequency_days_per_week: parsed.data.exercise_frequency_days_per_week,
    exercise_duration_minutes: parsed.data.exercise_duration_minutes,
    pregnancy_lactation_status: parsed.data.pregnancy_lactation_status,
    has_medical_conditions: parsed.data.has_medical_conditions,
    medical_conditions_details: parsed.data.medical_conditions_details,
    has_regular_medications: parsed.data.has_regular_medications,
    regular_medications_details: parsed.data.regular_medications_details,
    habits: parsed.data.habits,
    alcohol_times_per_week: parsed.data.habits.includes("alcohol") ? parsed.data.alcohol_times_per_week : null,
    smoking_packs_per_day: parsed.data.habits.includes("smoking_or_vaping") ? parsed.data.smoking_packs_per_day : null,
    additional_information: parsed.data.additional_information,
    allergies: parsed.data.allergies,
    medical_conditions: legacyMedicalConditions,
    onboarding_version: 2,
    needs_onboarding_refresh: false,
    weight_unit: "kg",
    height_unit: "cm",
  };

  const acceptedAiExtraction = formData.get("accept_ai_extraction")?.toString() === "yes";

  if (!acceptedAiExtraction) {
    return {
      error: tr(
        locale,
        "Consent is required before saving your profile.",
        "נדרשת הסכמה לפני שמירת הפרופיל.",
      ),
      fieldErrors: [
        {
          field: "accept_ai_extraction",
          message: tr(
            locale,
            "Please confirm AI consent to continue.",
            "יש לאשר הסכמה לשימוש ב-AI כדי להמשיך.",
          ),
        },
      ],
    };
  }

  const { error } = await supabase
    .from("user_profile")
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    logServerError("onboarding.saveProfile", "upsert_failed", {
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
          "Database migration missing: apply db/migrations/014_phase5_profile_versions_onboarding_fields.sql, db/migrations/015_phase5_habit_magnitude_fields.sql, and db/migrations/017_phase5_exercise_other_details.sql, then try again.",
          "חסרות מיגרציות בסיס נתונים: יש להחיל את 014, 015 ו-017 תחת db/migrations ואז לנסות שוב.",
        ),
      };
    }

    return {
      error: tr(
        locale,
        "Failed to save profile. Please try again.",
        "שמירת הפרופיל נכשלה. יש לנסות שוב.",
      ),
    };
  }

  if (acceptedAiExtraction) {
    const aiConfig = getAiExtractionConfig();
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
      logServerError("onboarding.saveProfile", "ai_consent_upsert_failed", {
        userId: user.id,
        error: aiConsentError.message,
      });
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, parsed.data.preferred_language, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/app");
}
