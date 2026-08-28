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
