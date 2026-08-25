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
export type ExerciseModalityOption = (typeof exerciseModalityOptions)[number];
export type ExerciseScheduleModalityOption = Exclude<ExerciseModalityOption, "none">;

export type ExerciseScheduleEntry = {
  days_per_week: number;
  minutes_per_session: number;
};

export type ExerciseScheduleByModality = Partial<
  Record<ExerciseScheduleModalityOption, ExerciseScheduleEntry>
>;
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
export const medicalConditionOptions = [
  "celiac_disease",
  "hypertension",
  "kidney_renal_failure",
  "diabetes",
  "other",
  "prefer_not_to_disclose",
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

const medicalConditionKeywords = [
  "diabetes",
  "hypertension",
  "hypotension",
  "celiac",
  "crohn",
  "colitis",
  "asthma",
  "copd",
  "thyroid",
  "hypothyroidism",
  "hyperthyroidism",
  "anemia",
  "migraine",
  "epilepsy",
  "renal",
  "kidney",
  "liver",
  "heart",
  "arrhythmia",
  "cholesterol",
  "obesity",
  "arthritis",
  "autoimmune",
  "psoriasis",
  "eczema",
  "ibd",
  "gerd",
  "ulcer",
  "syndrome",
  "cancer",
  "סוכרת",
  "צליאק",
  "לחץ דם",
  "יתר לחץ דם",
  "כליות",
  "אי ספיקת כליות",
  "אסתמה",
  "תת פעילות",
  "בלוטת התריס",
  "מחלה",
  "תסמונת",
  "דלקת",
  "כרוני",
  "כאב",
] as const;

const medicationKeywords = [
  "metformin",
  "insulin",
  "levothyroxine",
  "atorvastatin",
  "rosuvastatin",
  "lisinopril",
  "amlodipine",
  "losartan",
  "valsartan",
  "omeprazole",
  "pantoprazole",
  "aspirin",
  "vitamin",
  "supplement",
  "tablet",
  "pill",
  "capsule",
  "dose",
  "dosage",
  "daily",
  "twice",
  "times",
  "morning",
  "evening",
  "weekly",
  "medication",
  "medicine",
  "תרופה",
  "תרופות",
  "כדור",
  "כדורים",
  "מינון",
  "פעמיים",
  "פעם",
  "ביום",
  "בשבוע",
  "ויטמין",
] as const;

export type ExerciseOtherValidationResult = {
  isMeaningful: boolean;
  suggestions: string[];
};

export type AllergyValidationResult = {
  isMeaningful: boolean;
  suggestions: string[];
};

export type MedicalConditionOtherValidationResult = {
  isMeaningful: boolean;
  suggestions: string[];
};

export type FreeTextValidationResult = {
  isMeaningful: boolean;
};

const junkTextFragments = [
  "asdf",
  "qwer",
  "zxcv",
  "qwerty",
  "asdfgh",
  "lorem",
  "ipsum",
  "test",
  "1234",
  "אבגד",
  "בדיקה",
  "סתם",
] as const;

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

function hasSuspiciousHebrewFinalFormPlacement(token: string): boolean {
  if (token.length < 4) {
    return false;
  }

  const finalForms = new Set(["ך", "ם", "ן", "ף", "ץ"]);
  for (let index = 0; index < token.length - 1; index += 1) {
    if (finalForms.has(token[index])) {
      return true;
    }
  }

  return false;
}

function isLikelyJunkText(normalized: string, minLength: number): boolean {
  if (normalized.length < minLength) {
    return true;
  }

  const condensed = normalized.replace(/\s+/g, "");
  if (condensed.length < minLength) {
    return true;
  }

  if (/^(.)\1{3,}$/i.test(condensed)) {
    return true;
  }

  if (/(?:abc|abcd|qwe|qwer|asd|asdf|zxc|zxcv|123|1234)/i.test(condensed)) {
    return true;
  }

  if (junkTextFragments.some((fragment) => condensed.includes(fragment))) {
    return true;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  const uniqueTokens = new Set(tokens);
  if (tokens.length >= 3 && uniqueTokens.size === 1) {
    return true;
  }

  const strongTokens = tokens.filter((token) => token.length >= 3);
  if (strongTokens.length > 0) {
    const repeatedStrong = strongTokens.filter((token) => {
      const occurrences = strongTokens.filter((candidate) => candidate === token).length;
      return occurrences >= 3;
    });
    if (repeatedStrong.length > 0) {
      return true;
    }
  }

  const lettersCount = (normalized.match(/[a-z\u0590-\u05ff]/gi) ?? []).length;
  const nonSpaceCount = normalized.replace(/\s+/g, "").length;
  if (nonSpaceCount === 0 || (lettersCount / nonSpaceCount) < 0.4) {
    return true;
  }

  return false;
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

function isStrictDomainCloseMatch(token: string, keyword: string): boolean {
  if (token.length < 4 || keyword.length < 4) return false;

  const samePrefix = token[0] === keyword[0] || token.slice(0, 2) === keyword.slice(0, 2);
  if (!samePrefix) return false;

  const distance = levenshteinDistance(token, keyword);
  const lengthGap = Math.abs(token.length - keyword.length);
  const relativeDistance = distance / Math.max(token.length, keyword.length);

  return lengthGap <= 2 && distance <= 2 && relativeDistance <= 0.34;
}

function hasExactKeyword(normalized: string, tokens: string[], dictionary: readonly string[]): boolean {
  const tokenSet = new Set(tokens);
  return dictionary.some((keyword) => {
    if (keyword.includes(" ")) {
      return normalized.includes(keyword);
    }
    return tokenSet.has(keyword);
  });
}

function rankExerciseSuggestions(normalized: string): string[] {
  return rankSuggestions(normalized, exerciseOtherKeywords);
}

function rankStrictSuggestionsFromTokens(tokens: string[], dictionary: readonly string[]): string[] {
  const tokenCandidates = tokens.filter((token) => token.length >= 4);
  if (tokenCandidates.length === 0) return [];

  const suggestions: Array<{ keyword: string; distance: number }> = [];

  tokenCandidates.forEach((token) => {
    dictionary.forEach((keyword) => {
      if (keyword.length < 4 || keyword.includes(" ")) return;
      if (!(token[0] === keyword[0] || token.slice(0, 2) === keyword.slice(0, 2))) return;

      const distance = levenshteinDistance(token, keyword);
      const relativeDistance = distance / Math.max(token.length, keyword.length);
      if (distance <= 2 && relativeDistance <= 0.34) {
        suggestions.push({ keyword, distance });
      }
    });
  });

  return suggestions
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.keyword.replaceAll("_", " "))
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 3);
}

function hasNearKeyword(tokens: string[], dictionary: readonly string[], strict = false): boolean {
  return tokens.some((token) => {
    if (token.length < 3) return false;
    return dictionary.some((keyword) => {
      if (keyword.startsWith(token) || token.startsWith(keyword)) {
        return true;
      }
      return strict ? isStrictDomainCloseMatch(token, keyword) : isCloseMatch(token, keyword);
    });
  });
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

  if (tokens.some(hasSuspiciousHebrewFinalFormPlacement)) {
    return { isMeaningful: false, suggestions: rankStrictSuggestionsFromTokens(tokens, medicalConditionKeywords) };
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

export function validateMedicalConditionOtherDetails(value: string): MedicalConditionOtherValidationResult {
  const normalized = normalizeExerciseText(value);
  if (normalized.length < 3 || normalized.length > 250) {
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

  if (/([a-z\u0590-\u05ff])\1{3,}/i.test(normalized)) {
    return { isMeaningful: false, suggestions: [] };
  }

  const lettersCount = (normalized.match(/[a-z\u0590-\u05ff]/gi) ?? []).length;
  const nonSpaceCount = normalized.replace(/\s+/g, "").length;
  if (nonSpaceCount === 0 || (lettersCount / nonSpaceCount) < 0.4) {
    return { isMeaningful: false, suggestions: [] };
  }

  if (isLikelyJunkText(normalized, 3)) {
    return { isMeaningful: false, suggestions: [] };
  }

  const hasConditionSuffix = tokens.some((token) => /(?:itis|osis|emia|pathy|algia|oma)$/i.test(token));
  const hasHebrewConditionCue = tokens.some((token) => /(?:דלקת|מחלה|תסמונת|כרוני|כאב)/.test(token));
  const exactKeyword = hasExactKeyword(normalized, tokens, medicalConditionKeywords);
  const nearKeyword = hasNearKeyword(tokens, medicalConditionKeywords, true);

  if (!exactKeyword && !nearKeyword && !hasConditionSuffix && !hasHebrewConditionCue) {
    return {
      isMeaningful: false,
      suggestions: rankStrictSuggestionsFromTokens(tokens, medicalConditionKeywords),
    };
  }

  return { isMeaningful: true, suggestions: rankStrictSuggestionsFromTokens(tokens, medicalConditionKeywords) };
}

export function validateMedicationDetails(value: string): FreeTextValidationResult {
  const normalized = normalizeExerciseText(value);
  if (normalized.length < 3 || normalized.length > 2000) {
    return { isMeaningful: false };
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return { isMeaningful: false };
  }

  const hasAlphabet = /[a-z\u0590-\u05ff]/i.test(normalized);
  const hasStrongToken = tokens.some((token) => token.length >= 3 && !hasOnlyRepeatedChar(token));
  if (!hasAlphabet || !hasStrongToken || isLikelyJunkText(normalized, 3)) {
    return { isMeaningful: false };
  }

  if (tokens.some(hasSuspiciousHebrewFinalFormPlacement)) {
    return { isMeaningful: false };
  }

  const hasDosePattern = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml)\b/i.test(normalized);
  const hasDrugSuffix = tokens.some((token) => /(?:pril|sartan|olol|dipine|statin|azole|cillin|mab|oxetine|prazole)$/i.test(token));
  const exactKeyword = hasExactKeyword(normalized, tokens, medicationKeywords);
  const nearKeyword = hasNearKeyword(tokens, medicationKeywords, true);

  if (!exactKeyword && !nearKeyword && !hasDosePattern && !hasDrugSuffix) {
    return { isMeaningful: false };
  }

  return { isMeaningful: true };
}

export function validateFreeTextDetails(value: string, minLength = 3): FreeTextValidationResult {
  const normalized = normalizeExerciseText(value);
  if (!normalized) {
    return { isMeaningful: true };
  }

  if (isLikelyJunkText(normalized, minLength)) {
    return { isMeaningful: false };
  }

  return { isMeaningful: true };
}

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const exerciseScheduleByModalitySchema = z.preprocess(
  (value) => {
    if (value == null) {
      return {};
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return {};
      }

      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }

    return value;
  },
  z.record(
    z.string(),
    z.object({
      days_per_week: z.coerce
        .number({ error: "Exercise frequency must be a number." })
        .int("Exercise frequency must be a whole number.")
        .min(1, "Exercise frequency must be at least 1 day per week.")
        .max(14, "Exercise frequency must be at most 14 days per week."),
      minutes_per_session: z.coerce
        .number({ error: "Exercise duration must be a number." })
        .int("Exercise duration must be a whole number.")
        .min(1, "Exercise duration must be at least 1 minute.")
        .max(600, "Exercise duration must be at most 600 minutes."),
    }),
  ).default({}),
);

export function modalityRequiresSchedule(
  modality: ExerciseModalityOption,
): modality is ExerciseScheduleModalityOption {
  return modality !== "none";
}

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
  exercise_schedule_by_modality: exerciseScheduleByModalitySchema,
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
  medical_conditions_details: z.string().trim().max(250).optional().default(""),
  medical_conditions: z.array(
    z.enum(medicalConditionOptions, { error: "Select a valid medical condition option." }),
  ).default([]),
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
      .max(20, "Smoking amount must be at most 400 cigarettes per day.")
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
}).superRefine((data, ctx) => {
  const includesAlcohol = data.habits.includes("alcohol");
  const includesSmoking = data.habits.includes("smoking_or_vaping");
  const includesExerciseOther = data.exercise_modalities.includes("other");
  const includesNoExercise = data.exercise_modalities.includes("none");
  const selectedScheduledModalities = data.exercise_modalities.filter(modalityRequiresSchedule);
  const allowedScheduledModalities = new Set<ExerciseScheduleModalityOption>(selectedScheduledModalities);
  const scheduleKeys = Object.keys(data.exercise_schedule_by_modality ?? {});

  if (includesNoExercise && data.exercise_modalities.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exercise_modalities"],
      message: "Select either 'None' or active exercise types, not both.",
    });
  }

  if (includesNoExercise) {
    if (scheduleKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exercise_schedule_by_modality"],
        message: "Exercise schedule must be empty when no exercise is selected.",
      });
    }
  } else {
    selectedScheduledModalities.forEach((modality) => {
      const schedule = data.exercise_schedule_by_modality[modality];
      if (!schedule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exercise_schedule_by_modality", modality],
          message: "Set frequency and duration for each selected exercise type.",
        });
      }
    });

    scheduleKeys.forEach((modality) => {
      if (!allowedScheduledModalities.has(modality as ExerciseScheduleModalityOption)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exercise_schedule_by_modality", modality],
          message: "Exercise schedule contains an unselected exercise type.",
        });
      }
    });
  }

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
      message: "Enter cigarettes per day.",
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

  if (data.has_medical_conditions) {
    if (data.medical_conditions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["medical_conditions"],
        message: "Select at least one medical condition option.",
      });
    }

    const includesPreferNotToDisclose = data.medical_conditions.includes("prefer_not_to_disclose");
    if (includesPreferNotToDisclose && data.medical_conditions.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["medical_conditions"],
        message: "Prefer not to disclose cannot be combined with other options.",
      });
    }

    const includesMedicalOther = data.medical_conditions.includes("other");
    if (includesMedicalOther) {
      const normalizedDetails = data.medical_conditions_details.trim();
      if (normalizedDetails.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["medical_conditions_details"],
          message: "Please describe a diagnosed condition (name, symptom, or diagnosis) or uncheck 'Others'.",
        });
      }
    }
  }

  if (data.has_regular_medications) {
    const normalizedDetails = data.regular_medications_details.trim();
    if (normalizedDetails.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regular_medications_details"],
        message: "Please include medication name and/or dosage/frequency (for example: Metformin 500mg twice daily).",
      });
    }
  }

  if (data.additional_information) {
    const additionalInfoValidation = validateFreeTextDetails(data.additional_information, 5);
    if (!additionalInfoValidation.isMeaningful) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["additional_information"],
        message: "Enter meaningful additional information or leave it empty.",
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

export function deriveExerciseSummaryFromSchedule(
  modalities: ExerciseModalityOption[],
  scheduleByModality: ExerciseScheduleByModality,
  fallbackFrequency: number,
  fallbackDuration: number,
): { frequencyDaysPerWeek: number; durationMinutes: number } {
  const selectedScheduledModalities = modalities.filter(modalityRequiresSchedule);

  if (selectedScheduledModalities.length === 0) {
    return {
      frequencyDaysPerWeek: 0,
      durationMinutes: 0,
    };
  }

  const entries = selectedScheduledModalities
    .map((modality) => scheduleByModality[modality])
    .filter(
      (entry): entry is ExerciseScheduleEntry =>
        Boolean(entry)
        && Number.isFinite(entry.days_per_week)
        && Number.isFinite(entry.minutes_per_session)
        && entry.days_per_week > 0
        && entry.minutes_per_session > 0,
    );

  if (entries.length === 0) {
    return {
      frequencyDaysPerWeek: fallbackFrequency,
      durationMinutes: fallbackDuration,
    };
  }

  const totalDays = entries.reduce((sum, entry) => sum + entry.days_per_week, 0);
  const weightedMinutes = entries.reduce(
    (sum, entry) => sum + (entry.days_per_week * entry.minutes_per_session),
    0,
  );

  return {
    frequencyDaysPerWeek: Math.min(14, Math.round(totalDays)),
    durationMinutes: Math.round(weightedMinutes / totalDays),
  };
}

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
