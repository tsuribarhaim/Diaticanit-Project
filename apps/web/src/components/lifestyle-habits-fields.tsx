import {
  alcoholWeeklyFrequencyOptions,
  caffeineCupsOptions,
  smokingCigarettesRangeOptions,
  smokingStatusOptions,
} from "@/lib/profile";
import { tr, type AppLocale } from "@/lib/locale";

export type LifestyleHabitsValues = {
  alcohol_weekly_frequency: string;
  smoking_status: string;
  smoking_cigarettes_range: string;
  caffeine_cups_per_day: string;
};

export const emptyLifestyleHabitsValues: LifestyleHabitsValues = {
  alcohol_weekly_frequency: "",
  smoking_status: "",
  smoking_cigarettes_range: "",
  caffeine_cups_per_day: "",
};

type Gendered = { en: string; heF: string; heM?: string };

function pick(locale: AppLocale, fem: boolean, text: Gendered) {
  return tr(locale, text.en, fem || !text.heM ? text.heF : text.heM);
}

export const alcoholWeeklyFrequencyLabels: Record<(typeof alcoholWeeklyFrequencyOptions)[number], Gendered> = {
  none: { en: "Not at all", heF: "בכלל לא" },
  rare: { en: "Rarely (less than once a month)", heF: "לעיתים רחוקות (פחות מפעם בחודש)" },
  "1_3": { en: "1–3 drinks a week", heF: "1–3 משקאות בשבוע" },
  "4_7": { en: "4–7 drinks a week", heF: "4–7 משקאות בשבוע" },
  over_7: { en: "More than 7 drinks a week", heF: "יותר מ-7 משקאות בשבוע" },
};

export const smokingStatusLabels: Record<(typeof smokingStatusOptions)[number], Gendered> = {
  never: { en: "Never smoked", heF: "אף פעם לא עישנתי" },
  former: { en: "Smoked in the past and quit", heF: "עישנתי בעבר, ופסקתי" },
  social: { en: "Smoke sometimes (socially)", heF: "מעשנת לפעמים (חברתי)", heM: "מעשן לפעמים (חברתי)" },
  daily: { en: "Smoke every day", heF: "מעשנת כל יום", heM: "מעשן כל יום" },
};

export const smokingCigarettesRangeLabels: Record<(typeof smokingCigarettesRangeOptions)[number], Gendered> = {
  "1_5": { en: "1–5", heF: "1–5" },
  "6_10": { en: "6–10", heF: "6–10" },
  "11_20": { en: "11–20", heF: "11–20" },
  over_20: { en: "More than 20", heF: "יותר מ-20" },
};

export const caffeineCupsLabels: Record<(typeof caffeineCupsOptions)[number], Gendered> = {
  "0": { en: "0", heF: "0" },
  "1_2": { en: "1–2", heF: "1–2" },
  "3_4": { en: "3–4", heF: "3–4" },
  "5_plus": { en: "5 or more", heF: "5 ומעלה" },
};

/** Label for a stored lifestyle-habits answer (used by the profile row summary). */
export function lifestyleHabitLabel<K extends string>(
  labels: Record<K, Gendered>,
  value: string | null | undefined,
  locale: AppLocale,
  biologicalSex: string | null | undefined,
): string | null {
  if (!value || !(value in labels)) return null;
  return pick(locale, biologicalSex !== "male", labels[value as K]);
}

const pillBase = "rounded-full border px-3 py-1.5 text-xs font-medium";
const pillSelected = "border-teal-700 bg-teal-700 text-white";
const pillIdle =
  "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";

/**
 * TCK-119 "Lifestyle habits" questionnaire - shared by onboarding step 3, the
 * full profile edit form and the Habits quick-edit sheet. Every question is
 * optional: chips behave like radios, and tapping the selected chip again
 * clears it (that is how a question is skipped). Text is feminine unless the
 * user is male (also feminine when sex is unknown).
 */
export function LifestyleHabitsFields({
  locale,
  biologicalSex,
  values,
  onChange,
  hideTitle = false,
}: {
  locale: AppLocale;
  biologicalSex: string | null | undefined;
  values: LifestyleHabitsValues;
  onChange: (next: LifestyleHabitsValues) => void;
  /** The quick-edit sheet already shows the title in its own header. */
  hideTitle?: boolean;
}) {
  const fem = biologicalSex !== "male";

  function toggle(key: keyof LifestyleHabitsValues, value: string) {
    const nextValue = values[key] === value ? "" : value;
    const next: LifestyleHabitsValues = { ...values, [key]: nextValue };
    if (key === "smoking_status" && nextValue !== "daily") {
      next.smoking_cigarettes_range = "";
    }
    onChange(next);
  }

  function renderChips<K extends string>(
    key: keyof LifestyleHabitsValues,
    options: readonly K[],
    labels: Record<K, Gendered>,
    ariaLabel: string,
  ) {
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={ariaLabel}>
        {options.map((value) => {
          const selected = values[key] === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => toggle(key, value)}
              className={`${pillBase} ${selected ? pillSelected : pillIdle}`}
            >
              {pick(locale, fem, labels[value])}
            </button>
          );
        })}
      </div>
    );
  }

  const questionClass = "mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300";
  const helpClass = "mb-2 block text-xs text-slate-500 dark:text-slate-400";

  const alcoholQuestion = tr(
    locale,
    "How much alcohol do you drink per week?",
    fem ? "כמה אלכוהול את שותה בשבוע?" : "כמה אלכוהול אתה שותה בשבוע?",
  );
  const smokingQuestion = tr(locale, "What about smoking?", "מה לגבי עישון?");
  const cigarettesQuestion = tr(locale, "About how many cigarettes a day?", "כמה סיגריות ביום, בערך?");
  const caffeineQuestion = tr(
    locale,
    "How many cups of coffee (or caffeinated drinks) do you drink a day?",
    fem ? "כמה כוסות קפה (או משקאות עם קפאין) את שותה ביום?" : "כמה כוסות קפה (או משקאות עם קפאין) אתה שותה ביום?",
  );

  return (
    <div data-field="lifestyle_habits" className="space-y-4">
      <input type="hidden" name="alcohol_weekly_frequency" value={values.alcohol_weekly_frequency} />
      <input type="hidden" name="smoking_status" value={values.smoking_status} />
      <input type="hidden" name="smoking_cigarettes_range" value={values.smoking_cigarettes_range} />
      <input type="hidden" name="caffeine_cups_per_day" value={values.caffeine_cups_per_day} />

      <div>
        {hideTitle ? null : (
          <span className="mb-1 block text-sm font-semibold text-slate-800 dark:text-slate-200">
            {tr(locale, "Lifestyle habits", "הרגלי חיים")}
          </span>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {tr(
            locale,
            "A few short questions to help me fine-tune your recommendations.",
            "כמה שאלות קצרות שיעזרו לי לדייק את ההמלצות.",
          )}
          <br />
          {tr(
            locale,
            "There are no right or wrong answers, and you can skip.",
            "אין תשובות נכונות או לא נכונות, ואפשר לדלג.",
          )}
        </p>
      </div>

      <div data-field="alcohol_weekly_frequency">
        <span className={questionClass}>{alcoholQuestion}</span>
        <span className={helpClass}>
          {tr(
            locale,
            "One drink = a glass of wine (150 ml), a bottle of beer (330 ml) or a shot (40 ml).",
            "משקה אחד = כוס יין (150 מ\"ל), בקבוק בירה (330 מ\"ל) או שוט (40 מ\"ל).",
          )}
        </span>
        {renderChips("alcohol_weekly_frequency", alcoholWeeklyFrequencyOptions, alcoholWeeklyFrequencyLabels, alcoholQuestion)}
      </div>

      <div data-field="smoking_status">
        <span className={questionClass}>{smokingQuestion}</span>
        <span className={helpClass}>
          {tr(locale, "Includes e-cigarettes and hookah.", "כולל סיגריות אלקטרוניות ונרגילה.")}
        </span>
        {renderChips("smoking_status", smokingStatusOptions, smokingStatusLabels, smokingQuestion)}

        {values.smoking_status === "daily" ? (
          <div className="mt-3" data-field="smoking_cigarettes_range">
            <span className={questionClass}>{cigarettesQuestion}</span>
            {renderChips(
              "smoking_cigarettes_range",
              smokingCigarettesRangeOptions,
              smokingCigarettesRangeLabels,
              cigarettesQuestion,
            )}
          </div>
        ) : null}
      </div>

      <div data-field="caffeine_cups_per_day">
        <span className={`${questionClass} mb-2`}>{caffeineQuestion}</span>
        {renderChips("caffeine_cups_per_day", caffeineCupsOptions, caffeineCupsLabels, caffeineQuestion)}
      </div>
    </div>
  );
}
