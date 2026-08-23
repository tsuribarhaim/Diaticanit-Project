import { z } from "zod";

export const activityLevelOptions = ["sedentary", "moderate", "active"] as const;
export const preferredLanguageOptions = ["en", "he"] as const;
export const biologicalSexOptions = ["male", "female"] as const;
export const exerciseModalityOptions = [
  "resistance_hypertrophy",
  "endurance_cardio",
  "martial_arts",
  "other",
] as const;
export const nutritionalGoalOptions = [
  "maintenance",
  "weight_loss",
  "muscle_hypertrophy",
  "body_recomposition",
  "athletic_performance",
] as const;
export const pregnancyLactationOptions = ["none", "pregnant", "lactating"] as const;
export const dietaryPreferenceOptions = [
  "standard",
  "vegetarian",
  "vegan",
  "low_carb_keto",
] as const;
export const habitOptions = ["smoking_or_vaping", "alcohol", "none"] as const;

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const onboardingProfileSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, "First name is required.")
    .max(80, "First name must be at most 80 characters."),
  last_name: z
    .string()
    .trim()
    .min(1, "Last name is required.")
    .max(80, "Last name must be at most 80 characters."),
  date_of_birth: z
    .string()
    .trim()
    .regex(isoDateRegex, "Date of birth is required."),
  biological_sex: z.enum(biologicalSexOptions, {
    error: "Select a valid biological sex.",
  }),
  height_cm: z.coerce
    .number({ error: "Height must be a number." })
    .min(80, "Height must be at least 80 cm.")
    .max(250, "Height must be at most 250 cm."),
  weight_kg: z.coerce
    .number({ error: "Weight must be a number." })
    .min(20, "Weight must be at least 20 kg.")
    .max(400, "Weight must be at most 400 kg."),
  activity_level: z.enum(activityLevelOptions, {
    error: "Select a valid activity level.",
  }),
  preferred_language: z.enum(preferredLanguageOptions, {
    error: "Select a valid language.",
  }),
  exercise_modalities: z
    .array(z.enum(exerciseModalityOptions, { error: "Select a valid exercise modality." }))
    .min(1, "Select at least one exercise modality."),
  exercise_frequency_days_per_week: z.coerce
    .number({ error: "Exercise frequency must be a number." })
    .int("Exercise frequency must be a whole number.")
    .min(0, "Exercise frequency cannot be negative.")
    .max(14, "Exercise frequency must be at most 14 days per week."),
  exercise_duration_minutes: z.coerce
    .number({ error: "Exercise duration must be a number." })
    .int("Exercise duration must be a whole number.")
    .min(0, "Exercise duration cannot be negative.")
    .max(600, "Exercise duration must be at most 600 minutes."),
  nutritional_goal: z.enum(nutritionalGoalOptions, {
    error: "Select a valid nutritional goal.",
  }),
  pregnancy_lactation_status: z.enum(pregnancyLactationOptions, {
    error: "Select a valid pregnancy/lactation status.",
  }),
  has_medical_conditions: z.boolean(),
  medical_conditions_details: z.string().trim().max(2000).optional().default(""),
  has_regular_medications: z.boolean(),
  regular_medications_details: z.string().trim().max(2000).optional().default(""),
  hot_climate_or_heavy_sweating: z.boolean(),
  habits: z
    .array(z.enum(habitOptions, { error: "Select a valid habit option." }))
    .default([]),
  dietary_preference: z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() === "") {
        return undefined;
      }
      return value;
    },
    z
      .enum(dietaryPreferenceOptions, {
        error: "Select a valid dietary preference.",
      })
      .optional(),
  ),
  additional_information: z
    .string()
    .trim()
    .max(1000, "Additional information must be at most 1000 characters.")
    .optional()
    .default(""),
  allergies: z.array(z.string().trim().min(1)).default([]),
  medical_conditions: z.array(z.string().trim().min(1)).default([]),
});

export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>;

export function parseDelimitedList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseBooleanField(value: FormDataEntryValue | null): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

export function parseMultiSelect(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function calculateAgeYears(dateOfBirth: string): number | null {
  const date = new Date(dateOfBirth);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - date.getUTCMonth();
  const dayDiff = today.getUTCDate() - date.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  if (age < 0 || age > 120) {
    return null;
  }

  return age;
}
