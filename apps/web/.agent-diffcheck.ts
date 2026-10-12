import { computeTargetsDiff } from "@/lib/targets-diff";
import type { TargetGenerationPayload } from "@/lib/targets";

const base = {
  caloriesMin: 1400, caloriesMax: 1600, exerciseTargets: [], habitsDo: [], habitsDont: [], userTargets: [],
  goalType: "general", targetWeightKg: 60, durationDays: null,
} as unknown as TargetGenerationPayload;
const after = {
  ...base,
  targetWeightKg: 58,
  exerciseTargets: [
    { modality: "martial_arts", activityName: null, frequencyPerWeek: 4, durationMinutesPerSession: 50 },
    { modality: "other", activityName: "Pilates", frequencyPerWeek: 2, durationMinutesPerSession: 50 },
  ],
} as unknown as TargetGenerationPayload;

for (const locale of ["he", "en"] as const) {
  for (const row of computeTargetsDiff(base, after, locale)) console.log(locale, row.labelEn, "|", row.before, "->", row.after);
}
