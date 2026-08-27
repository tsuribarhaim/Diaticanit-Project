export type AppLocale = "en" | "he";

export function normalizeLocale(value: unknown): AppLocale {
  return value === "he" ? "he" : "en";
}

export function localeTag(locale: AppLocale): string {
  return locale === "he" ? "he-IL" : "en-US";
}

export function directionForLocale(locale: AppLocale): "rtl" | "ltr" {
  return locale === "he" ? "rtl" : "ltr";
}

export function tr(locale: AppLocale, en: string, he: string): string {
  return locale === "he" ? he : en;
}

export function formatDateTimeForLocale(value: Date | string, locale: AppLocale): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }

  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDateForLocale(value: Date | string, locale: AppLocale): string {
  const date = typeof value === "string"
    ? (() => {
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        return new Date(year, month, day);
      }
      return new Date(value);
    })()
    : value;

  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());

  if (locale === "he") {
    return `${day}/${month}/${year}`;
  }

  return new Intl.DateTimeFormat(localeTag(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatNumberForLocale(
  value: number,
  locale: AppLocale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeTag(locale), options).format(value);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function titleCase(value: string): string {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1).toLowerCase();
}

export function formatActivityLevel(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "sedentary") return tr(locale, "Sedentary", "יושבני");
  if (token === "moderate") return tr(locale, "Moderate", "בינוני");
  if (token === "active") return tr(locale, "Active", "פעיל");
  return locale === "he" ? value : titleCase(value);
}

export function formatExerciseModality(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "resistance_hypertrophy") return tr(locale, "Resistance / Hypertrophy", "התנגדות / היפרטרופיה");
  if (token === "endurance_cardio") return tr(locale, "Endurance / Cardio", "סבולת / אירובי");
  if (token === "martial_arts") return tr(locale, "Martial Arts", "אומנויות לחימה");
  if (token === "other") return tr(locale, "Other", "אחר");
  if (token === "none") return tr(locale, "None", "ללא");
  return locale === "he" ? value : titleCase(value.replace(/_/g, " "));
}

export function formatGender(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "male") return tr(locale, "Male", "זכר");
  if (token === "female") return tr(locale, "Female", "נקבה");
  if (token === "other") return tr(locale, "Other", "אחר");
  return locale === "he" ? value : titleCase(value);
}

export function formatExtractionStatus(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "not_started") return tr(locale, "Not started", "לא התחיל");
  if (token === "queued") return tr(locale, "Queued", "ממתין");
  if (token === "processing") return tr(locale, "Processing", "בעיבוד");
  if (token === "extracted") return tr(locale, "Extracted", "חולץ");
  if (token === "needs_review") return tr(locale, "Needs review", "דורש בדיקה");
  if (token === "confirmed") return tr(locale, "Confirmed", "מאושר");
  if (token === "failed") return tr(locale, "Failed", "נכשל");
  if (token === "deleted") return tr(locale, "Deleted", "נמחק");
  if (token === "unknown") return tr(locale, "Unknown", "לא ידוע");
  return locale === "he" ? value : titleCase(value.replace(/_/g, " ")); 
}

export function formatMeasurementUnit(unit: string, locale: AppLocale): string {
  if (locale !== "he") return unit;

  const token = normalizeToken(unit);
  if (token === "cm") return "ס\"מ";
  if (token === "kg") return "ק\"ג";
  if (token === "g") return "גרם";
  if (token === "mg") return "מ\"ג";
  if (token === "ml") return "מ\"ל";
  if (token === "l") return "ליטר";
  if (token === "min" || token === "minutes") return "דקות";
  if (token === "mcg") return "מק\"ג";
  if (token === "kcal") return "קק\"ל";
  return unit;
}

export function formatProfileValue(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "good") return tr(locale, "Good", "טוב");
  if (token === "none") return tr(locale, "None", "ללא");
  if (token === "healthy") return tr(locale, "Healthy", "בריא");
  return locale === "he" ? value : titleCase(value);
}

export function formatDietaryPreference(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "standard") return tr(locale, "Standard", "סטנדרטי");
  if (token === "vegetarian") return tr(locale, "Vegetarian", "צמחוני");
  if (token === "vegan") return tr(locale, "Vegan", "טבעוני");
  if (token === "low_carb_keto") return tr(locale, "Low-Carb / Keto", "דל פחמימה / קטו");
  return locale === "he" ? value : titleCase(value.replace(/_/g, " "));
}

export function formatNutritionalGoal(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "maintenance") return tr(locale, "Maintenance", "שימור");
  if (token === "weight_loss") return tr(locale, "Weight Loss", "ירידה במשקל");
  if (token === "muscle_hypertrophy") return tr(locale, "Muscle Hypertrophy", "היפרטרופיה");
  if (token === "body_recomposition") return tr(locale, "Body Recomposition", "הרכב גוף");
  if (token === "athletic_performance") return tr(locale, "Athletic Performance", "ביצועים אתלטיים");
  return locale === "he" ? value : titleCase(value.replace(/_/g, " "));
}

export function formatPregnancyLactationStatus(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "none") return tr(locale, "No", "לא");
  if (token === "pregnant") return tr(locale, "Pregnant", "בהריון");
  if (token === "lactating") return tr(locale, "Lactating", "מניקה");
  return locale === "he" ? value : titleCase(value.replace(/_/g, " "));
}

export function formatDefaultItemKind(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "food") return tr(locale, "Food", "אוכל");
  if (token === "hydration") return tr(locale, "Hydration", "נוזלים");
  if (token === "exercise") return tr(locale, "Exercise", "פעילות");
  if (token === "custom") return tr(locale, "Custom", "מותאם אישית");
  return locale === "he" ? value : titleCase(value);
}

export function formatDefaultUnit(value: string, locale: AppLocale): string {
  const token = normalizeToken(value);
  if (token === "unit") return tr(locale, "unit", "יחידה");
  if (token === "ml") return tr(locale, "ml", "מ\"ל");
  if (token === "l" || token === "liters") return tr(locale, "liters", "ליטר");
  if (token === "g" || token === "grams") return tr(locale, "grams", "גרם");
  if (token === "kg" || token === "kilograms") return tr(locale, "kilograms", "ק\"ג");
  if (token === "m" || token === "meters") return tr(locale, "meters", "מטר");
  if (token === "km" || token === "kilometers") return tr(locale, "kilometers", "ק\"מ");
  if (token === "cup" || token === "cups") return tr(locale, "cups", "כוסות");
  if (token === "piece" || token === "pieces") return tr(locale, "pieces", "יחידות");
  if (token === "min" || token === "minutes") return tr(locale, "minutes", "דקות");
  return value;
}

export function formatDefaultItemName(value: string, locale: AppLocale): string {
  if (locale !== "he") return value;

  const normalized = normalizeToken(value);
  const known: Record<string, string> = {
    chicken_lunch: "ארוחת צהריים עוף",
    chicken_dinner: "ארוחת ערב עוף",
    protein_shake: "שייק חלבון",
    boiled_eggs: "ביצים קשות",
    water: "מים",
    walk: "הליכה",
    running: "ריצה",
    morning_exercise: "פעילות בוקר",
    morning_exercis: "פעילות בוקר",
    cup_of_water: "כוס מים",
    jog: "ריצה קלה",
  };

  if (known[normalized]) {
    return known[normalized];
  }

  return value
    .replace(/\bchicken\b/gi, "עוף")
    .replace(/\blunch\b/gi, "ארוחת צהריים")
    .replace(/\bbreakfast\b/gi, "ארוחת בוקר")
    .replace(/\bdinner\b/gi, "ארוחת ערב")
    .replace(/\bprotein\b/gi, "חלבון")
    .replace(/\bshake\b/gi, "שייק")
    .replace(/\bcup of\b/gi, "כוס")
    .replace(/\bmorning\b/gi, "בוקר")
    .replace(/\bwater\b/gi, "מים")
    .replace(/\bexercise\b/gi, "פעילות")
    .replace(/\bexercis\b/gi, "פעילות")
    .replace(/\bwalk\b/gi, "הליכה");
}
