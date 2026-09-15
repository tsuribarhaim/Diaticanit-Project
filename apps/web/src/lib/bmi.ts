import { tr, type AppLocale } from "@/lib/locale";

export const BMI_GOOD_MIN = 18.5;
export const BMI_GOOD_MAX = 24.9;

const BMI_WARNING_MARGIN_FACTOR = 0.3;
const BMI_GOOD_RANGE = BMI_GOOD_MAX - BMI_GOOD_MIN;

export function computeBmi(weightKg: number, heightCm: number): number {
  if (!heightCm || heightCm <= 0) return 0;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/** Mirrors the BMI scale used on the Profile page: "good" (green), "warning"
 * (yellow, a margin either side of the good range), "out_of_range" (red). */
export function classifyBmi(bmi: number, scaleMin = 12, scaleMax = 40): "good" | "warning" | "out_of_range" {
  if (bmi >= BMI_GOOD_MIN && bmi <= BMI_GOOD_MAX) {
    return "good";
  }

  const warningLowMin = Math.max(scaleMin, BMI_GOOD_MIN - BMI_GOOD_RANGE * BMI_WARNING_MARGIN_FACTOR);
  const warningHighMax = Math.min(scaleMax, BMI_GOOD_MAX + BMI_GOOD_RANGE * BMI_WARNING_MARGIN_FACTOR);

  const inLowWarningBand = bmi >= warningLowMin && bmi < BMI_GOOD_MIN;
  const inHighWarningBand = bmi > BMI_GOOD_MAX && bmi <= warningHighMax;

  if (inLowWarningBand || inHighWarningBand) {
    return "warning";
  }

  return "out_of_range";
}

/** Deterministic (not AI-generated) BMI safety message, shared by every
 * place a fresh weight can surface an unhealthy BMI - the Daily Report save
 * flow and the Targets profile-change banner - so the wording stays
 * identical and available instantly, without depending on an AI call. */
export function buildBmiWarningMessage(weightKg: number, heightCm: number, locale: AppLocale): string | undefined {
  const bmi = computeBmi(weightKg, heightCm);
  if (bmi <= 0 || classifyBmi(bmi) === "good") return undefined;

  const isUnderweight = bmi < BMI_GOOD_MIN;
  return tr(
    locale,
    `Your reported weight puts your BMI at ${bmi.toFixed(1)}, ${isUnderweight ? "below" : "above"} the generally healthy range (${BMI_GOOD_MIN}–${BMI_GOOD_MAX}). ${
      isUnderweight
        ? "Consider gradually increasing your calorie intake with nutrient-dense foods, and talk to a healthcare provider if this continues or was unintended."
        : "Consider a gradual, moderate calorie reduction alongside regular activity, and talk to a healthcare provider before making major changes."
    } This is general information, not a medical diagnosis.`,
    `לפי המשקל שדיווחת, מדד מסת הגוף (BMI) שלך הוא ${bmi.toFixed(1)}, ${isUnderweight ? "מתחת" : "מעל"} לטווח הבריא המקובל (${BMI_GOOD_MIN}–${BMI_GOOD_MAX}). ${
      isUnderweight
        ? "מומלץ לשקול העלאה הדרגתית של צריכת הקלוריות עם מזונות עתירי ערך תזונתי, ולפנות לאיש מקצוע רפואי אם המצב נמשך או לא היה מתוכנן."
        : "מומלץ לשקול הפחתה הדרגתית ומתונה של הקלוריות לצד פעילות גופנית סדירה, ולהתייעץ עם איש מקצוע רפואי לפני ביצוע שינויים משמעותיים."
    } מידע זה כללי בלבד ואינו מהווה אבחנה רפואית.`,
  );
}
