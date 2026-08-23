import { z } from "zod";

export const activityLevelOptions = ["sedentary", "moderate", "active"] as const;
export const preferredLanguageOptions = ["en", "he"] as const;
export const biologicalSexOptions = ["male", "female"] as const;
export const exerciseModalityOptions = [
  "resistance_hypertrophy",
  "endurance_cardio",
  "martial_arts",
  "other",
  "none",
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

const exerciseOtherKeywords = [
  "running",
  "run",
  "jogging",
  "walk",
  "walking",
  "hiking",
  "swimming",
  "swim",
  "cycling",
  "bike",
  "spinning",
  "rowing",
  "crossfit",
  "hiit",
  "pilates",
  "yoga",
  "dance",
  "zumba",
  "boxing",
  "kickboxing",
  "karate",
  "taekwondo",
  "judo",
  "bjj",
  "football",
  "soccer",
  "basketball",
  "tennis",
  "padel",
  "pickleball",
  "climbing",
  "calisthenics",
  "strength",
  "resistance",
  "gym",
  "אימון",
  "ריצה",
  "הליכה",
  "שחייה",
  "שחיה",
  "אופניים",
  "אירובי",
  "יוגה",
  "פילאטיס",
  "פילטיס",
  "ריקוד",
  "אגרוף",
  "קיקבוקס",
  "קרוספיט",
  "כדורגל",
  "כדורסל",
  "טניס",
  "טיפוס",
  "כושר",
  "כוח",
] as const;

const allergyKeywords = [
  "peanut",
  "peanuts",
  "tree_nut",
  "nuts",
  "almond",
  "walnut",
  "hazelnut",
  "cashew",
  "pistachio",
  "milk",
  "dairy",
  "lactose",
  "egg",
  "eggs",
  "soy",
  "wheat",
  "gluten",
  "shellfish",
  "shrimp",
  "crab",
  "fish",
  "sesame",
  "mustard",
  "celery",
  "pollen",
  "dust",
  "penicillin",
  "latex",
  "בוטנים",
  "אגוזים",
  "שקדים",
  "חלב",
  "לקטוז",
  "ביצים",
  "סויה",
  "חיטה",
  "גלוטן",
  "דגים",
  "שומשום",
  "אבק",
  "אבקנים",
  "פניצילין",
  "לטקס",
] as const;

export type ExerciseOtherValidationResult = {
  isMeaningful: boolean;
  suggestions: string[];
};

export type AllergyValidationResult = {
  isMeaningful: boolean;
  suggestions: string[];
};

function normalizeExerciseText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z\u0590-\u05ff0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev: number[] = Array.from({ length: b.length + 1 }, (_, idx) => idx);

  for (let i = 1; i <= a.length; i += 1) {
    const next: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j < next.length; j += 1) {
      prev[j] = next[j];
    }
  }

  return prev[b.length];
}

function hasOnlyRepeatedChar(token: string): boolean {
  return /^([a-z\u0590-\u05ff])\1+$/i.test(token);
}

function rankSuggestions(normalized: string, dictionary: readonly string[]): string[] {
  const scored = dictionary.map((keyword) => ({
    keyword,
    distance: levenshteinDistance(normalized, keyword),
  }));

  return scored
    .filter((entry) => entry.distance <= 4)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((entry) => entry.keyword.replaceAll("_", " "));
}

function isCloseMatch(token: string, keyword: string): boolean {
  const distance = levenshteinDistance(token, keyword);
  const maxDistance = keyword.length >= 8 ? 3 : 2;
  return distance <= maxDistance;
}

function rankExerciseSuggestions(normalized: string): string[] {
  return rankSuggestions(normalized, exerciseOtherKeywords);
}

export function validateExerciseOtherDetails(value: string): ExerciseOtherValidationResult {
  const normalized = normalizeExerciseText(value);
  if (normalized.length < 3 || normalized.length > 80) {
    return { isMeaningful: false, suggestions: [] };
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return { isMeaningful: false, suggestions: [] };
  }

  const hasAlphabet = /[a-z\u0590-\u05ff]/i.test(normalized);
  const hasStrongToken = tokens.some((token) => token.length >= 3 && !hasOnlyRepeatedChar(token));
  if (!hasAlphabet || !hasStrongToken) {
    return { isMeaningful: false, suggestions: [] };
  }

  const exactKeyword = exerciseOtherKeywords.some((keyword) => normalized.includes(keyword));
  if (exactKeyword) {
    return { isMeaningful: true, suggestions: [] };
  }

  const nearKeyword = tokens.some((token) => {
    if (token.length < 3) return false;
    return exerciseOtherKeywords.some((keyword) => {
      if (keyword.startsWith(token) || token.startsWith(keyword)) {
        return true;
      }
      return isCloseMatch(token, keyword);
    });
  });

  if (!nearKeyword) {
    return {
      isMeaningful: false,
      suggestions: rankExerciseSuggestions(normalized),
    };
  }

  return {
    isMeaningful: true,
    suggestions: rankExerciseSuggestions(normalized),
  };
}

export function validateAllergyEntry(value: string): AllergyValidationResult {
    const isCloseAllergyKeyword = (token: string, keyword: string): boolean => {
      const distance = levenshteinDistance(token, keyword);
      const maxDistance = keyword.length <= 6 ? 1 : 2;
      const lengthGap = Math.abs(token.length - keyword.length);
      return lengthGap <= 2 && distance <= maxDistance;
    };

  const normalized = normalizeExerciseText(value);
  if (normalized.length < 3 || normalized.length > 80) {
    return { isMeaningful: false, suggestions: [] };
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return { isMeaningful: false, suggestions: [] };
  }

  const hasAlphabet = /[a-z\u0590-\u05ff]/i.test(normalized);
  const hasStrongToken = tokens.some((token) => token.length >= 3 && !hasOnlyRepeatedChar(token));
  if (!hasAlphabet || !hasStrongToken) {
    return { isMeaningful: false, suggestions: [] };
  }

  if (/^[a-z\u0590-\u05ff]{3,}$/i.test(normalized) && !normalized.includes(" ")) {
    const nearKeyword = allergyKeywords.some((keyword) => isCloseMatch(normalized, keyword));
    if (!nearKeyword) {
      return {
        isMeaningful: false,
        suggestions: rankSuggestions(normalized, allergyKeywords),
      };
    }
  }

  const exactKeyword = allergyKeywords.some((keyword) => normalized.includes(keyword));
  const nearKeyword = tokens.some((token) => {
    if (token.length < 3) return false;
    return allergyKeywords.some((keyword) => {
      if (keyword.startsWith(token) || token.startsWith(keyword)) {
        return true;
      }
      return isCloseAllergyKeyword(token, keyword);
    });
  });

  if (!exactKeyword && !nearKeyword) {
    return {
      isMeaningful: false,
      suggestions: rankSuggestions(normalized, allergyKeywords),
    };
  }

  return {
    isMeaningful: true,
    suggestions: rankSuggestions(normalized, allergyKeywords),
  };
}

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
  exercise_modality_other_details: z
    .string()
    .trim()
    .max(80, "Other exercise type must be at most 80 characters.")
    .optional()
    .default(""),
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
  alcohol_times_per_week: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce
      .number({ error: "Alcohol frequency must be a number." })
      .min(0, "Alcohol frequency cannot be negative.")
      .max(200, "Alcohol frequency must be at most 200 per week.")
      .optional(),
  ),
  smoking_packs_per_day: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce
      .number({ error: "Smoking amount must be a number." })
      .min(0, "Smoking amount cannot be negative.")
      .max(20, "Smoking amount must be at most 20 packs per day.")
      .optional(),
  ),
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
}).superRefine((data, ctx) => {
  const includesAlcohol = data.habits.includes("alcohol");
  const includesSmoking = data.habits.includes("smoking_or_vaping");
  const includesExerciseOther = data.exercise_modalities.includes("other");

  if (includesAlcohol && (data.alcohol_times_per_week == null || data.alcohol_times_per_week <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["alcohol_times_per_week"],
      message: "Enter alcohol frequency per week.",
    });
  }

  if (includesSmoking && (data.smoking_packs_per_day == null || data.smoking_packs_per_day <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["smoking_packs_per_day"],
      message: "Enter smoking packs per day.",
    });
  }

  if (includesExerciseOther) {
    const validationResult = validateExerciseOtherDetails(data.exercise_modality_other_details);
    if (!validationResult.isMeaningful) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exercise_modality_other_details"],
        message: "Enter a meaningful exercise type related to physical activity.",
      });
    }
  }

  data.allergies.forEach((entry, index) => {
    const validationResult = validateAllergyEntry(entry);
    if (!validationResult.isMeaningful) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allergies", index],
        message: "Enter a meaningful allergy description.",
      });
    }
  });
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
