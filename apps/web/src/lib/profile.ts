import { z } from "zod";

export const activityLevelOptions = ["sedentary", "moderate", "active"] as const;
export const preferredLanguageOptions = ["en", "he"] as const;

export const onboardingProfileSchema = z.object({
  age: z.coerce
    .number({ error: "Age must be a number." })
    .int("Age must be a whole number.")
    .min(10, "Age must be at least 10.")
    .max(120, "Age must be at most 120."),
  gender: z
    .string()
    .trim()
    .min(1, "Gender is required.")
    .max(30, "Gender must be at most 30 characters."),
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
