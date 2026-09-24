"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { flagTargetsReviewPendingAction } from "@/app/app/actions";
import { applyProfilePatchAndFlagTargets } from "@/app/app/profile/actions";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { negotiateProfileChange, type ProfileChatSnapshot } from "@/lib/ai/profile-chat";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import {
  activityLevelOptions,
  biologicalSexOptions,
  calculateAgeYears,
  dietaryPreferenceOptions,
  habitOptions,
  nutritionalGoalOptions,
  pregnancyLactationOptions,
  validateAllergyEntry,
  validateFreeTextDetails,
} from "@/lib/profile";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import type { ProfileDiffRow } from "@/lib/targets";

const PROFILE_CHAT_COLUMNS =
  "first_name, last_name, date_of_birth, biological_sex, height_cm, weight_kg, activity_level, dietary_preference, nutritional_goal, pregnancy_lactation_status, hot_climate_or_heavy_sweating, additional_information, habits, alcohol_consumption_level, smoking_packs_per_day, allergies, preferred_language";

type ProfileChatRow = {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  biological_sex: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: string | null;
  dietary_preference: string | null;
  nutritional_goal: string | null;
  pregnancy_lactation_status: string | null;
  hot_climate_or_heavy_sweating: boolean | null;
  additional_information: string | null;
  habits: string[] | null;
  alcohol_consumption_level: string | null;
  smoking_packs_per_day: number | null;
  allergies: string[] | null;
  preferred_language: string | null;
};

function toSnapshot(row: ProfileChatRow): ProfileChatSnapshot {
  return {
    first_name: row.first_name ?? "",
    last_name: row.last_name ?? "",
    date_of_birth: row.date_of_birth ?? "",
    biological_sex: row.biological_sex,
    height_cm: Number(row.height_cm ?? 0),
    weight_kg: Number(row.weight_kg ?? 0),
    activity_level: row.activity_level ?? "moderate",
    dietary_preference: row.dietary_preference,
    nutritional_goal: row.nutritional_goal ?? "maintain",
    pregnancy_lactation_status: row.pregnancy_lactation_status,
    hot_climate_or_heavy_sweating: Boolean(row.hot_climate_or_heavy_sweating),
    additional_information: row.additional_information ?? "",
    habits: Array.isArray(row.habits) ? row.habits : [],
    alcohol_consumption_level: row.alcohol_consumption_level === "low" || row.alcohol_consumption_level === "high" ? row.alcohol_consumption_level : null,
    smoking_packs_per_day: row.smoking_packs_per_day,
    allergies: Array.isArray(row.allergies) ? row.allergies : [],
  };
}

/** Field labels for the chat's own diff card - independent of
 * computeProfileDiff (lib/targets.ts), which only covers the subset of
 * fields that actually feed target generation (and applies its own
 * target-relevance rules, like a 10% noise threshold on weight) - this
 * diff is a plain "here's exactly what you asked to change" preview, so
 * every in-scope field needs a row here regardless of target relevance. */
const FIELD_LABELS: Record<string, { labelEn: string; labelHe: string }> = {
  first_name: { labelEn: "First name", labelHe: "שם פרטי" },
  last_name: { labelEn: "Last name", labelHe: "שם משפחה" },
  date_of_birth: { labelEn: "Date of birth", labelHe: "תאריך לידה" },
  biological_sex: { labelEn: "Biological sex", labelHe: "מין ביולוגי" },
  height_cm: { labelEn: "Height", labelHe: "גובה" },
  weight_kg: { labelEn: "Weight", labelHe: "משקל" },
  activity_level: { labelEn: "Activity level", labelHe: "רמת פעילות" },
  dietary_preference: { labelEn: "Dietary preference", labelHe: "העדפה תזונתית" },
  nutritional_goal: { labelEn: "Nutritional goal", labelHe: "מטרה תזונתית" },
  pregnancy_lactation_status: { labelEn: "Pregnancy / lactation status", labelHe: "סטטוס היריון / הנקה" },
  hot_climate_or_heavy_sweating: { labelEn: "Hot climate / heavy sweating", labelHe: "אקלים חם / הזעה מרובה" },
  additional_information: { labelEn: "Additional information", labelHe: "מידע נוסף" },
  habits: { labelEn: "Habits", labelHe: "הרגלים" },
  alcohol_consumption_level: { labelEn: "Alcohol consumption", labelHe: "צריכת אלכוהול" },
  smoking_packs_per_day: { labelEn: "Smoking (packs/day)", labelHe: "עישון (חפיסות ליום)" },
  allergies: { labelEn: "Allergies", labelHe: "אלרגיות" },
};

function noneLabel(locale: AppLocale) {
  return tr(locale, "None", "ללא");
}

function formatEnumValue(field: string, value: string, locale: AppLocale): string {
  if (field === "activity_level") {
    return value === "sedentary" ? tr(locale, "Sedentary", "יושבני") : value === "active" ? tr(locale, "Active", "פעיל") : tr(locale, "Moderate", "בינוני");
  }
  if (field === "dietary_preference") {
    const map: Record<string, [string, string]> = {
      standard: ["Standard", "סטנדרטי"],
      vegetarian: ["Vegetarian", "צמחוני"],
      vegan: ["Vegan", "טבעוני"],
      low_carb_keto: ["Low-Carb / Keto", "דל פחמימה / קטו"],
      kosher: ["Kosher", "כשר"],
      gluten_free: ["Gluten-Free", "ללא גלוטן"],
    };
    const entry = map[value];
    return entry ? tr(locale, entry[0], entry[1]) : value;
  }
  if (field === "nutritional_goal") {
    const map: Record<string, [string, string]> = {
      weight_loss: ["Weight loss", "ירידה במשקל"],
      weight_gain: ["Weight gain", "עלייה במשקל"],
      maintain: ["Maintain weight", "שמירה על משקל"],
    };
    const entry = map[value];
    return entry ? tr(locale, entry[0], entry[1]) : value;
  }
  if (field === "pregnancy_lactation_status") {
    const map: Record<string, [string, string]> = {
      none: ["No", "לא"],
      pregnant: ["Pregnant", "בהריון"],
      lactating: ["Lactating", "מניקה"],
    };
    const entry = map[value];
    return entry ? tr(locale, entry[0], entry[1]) : value;
  }
  if (field === "biological_sex") {
    return value === "male" ? tr(locale, "Male", "זכר") : value === "female" ? tr(locale, "Female", "נקבה") : value;
  }
  if (field === "habits") {
    return value === "smoking_or_vaping" ? tr(locale, "Smoking", "עישון") : value === "alcohol" ? tr(locale, "Alcohol", "אלכוהול") : tr(locale, "None", "ללא");
  }
  return value;
}

function formatFieldValue(field: string, value: unknown, locale: AppLocale): string {
  if (value === null || value === undefined || value === "") return noneLabel(locale);
  if (field === "height_cm") return `${value} cm`;
  if (field === "weight_kg") return `${value} kg`;
  if (field === "hot_climate_or_heavy_sweating") return value ? tr(locale, "Yes", "כן") : tr(locale, "No", "לא");
  if (field === "smoking_packs_per_day") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return noneLabel(locale);
    return value.map((entry) => (typeof entry === "string" && field === "habits" ? formatEnumValue(field, entry, locale) : String(entry))).join(", ");
  }
  if (typeof value === "string" && ["activity_level", "dietary_preference", "nutritional_goal", "pregnancy_lactation_status", "biological_sex"].includes(field)) {
    return formatEnumValue(field, value, locale);
  }
  return String(value);
}

function buildDiffRows(current: ProfileChatSnapshot, patch: Record<string, unknown>, locale: AppLocale): ProfileDiffRow[] {
  const rows: ProfileDiffRow[] = [];
  for (const field of Object.keys(patch)) {
    const label = FIELD_LABELS[field];
    if (!label) continue;
    const before = formatFieldValue(field, (current as Record<string, unknown>)[field], locale);
    const after = formatFieldValue(field, patch[field], locale);
    if (before === after) continue;
    rows.push({ labelEn: label.labelEn, labelHe: label.labelHe, before, after });
  }
  return rows;
}

export type NegotiateProfileChatResult =
  | { error: string }
  | {
      reply: string;
      changed: boolean;
      patch?: Record<string, unknown>;
      diffRows?: ProfileDiffRow[];
    };

/**
 * Profile domain's own negotiate step (Phase C of the unified chat) - same
 * preview-before-write shape as negotiateActiveTargetsAction: never writes
 * anything itself, only returns a proposed patch (plus a human-readable
 * diff) for the caller to show as an Apply/Discard card.
 */
export async function negotiateProfileChatChangeAction({ message }: { message: string }): Promise<NegotiateProfileChatResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const trimmedMessage = message.trim();
  const { data: row } = await supabase.from("user_profile").select(PROFILE_CHAT_COLUMNS).eq("user_id", user.id).maybeSingle();
  const locale = normalizeLocale(row?.preferred_language);

  if (!trimmedMessage) {
    return { error: tr(locale, "Nothing to send yet.", "אין עדיין מה לשלוח.") };
  }
  if (!row) {
    return { error: tr(locale, "Your profile could not be found.", "לא ניתן למצוא את הפרופיל שלך.") };
  }

  const aiConfig = getAiExtractionConfig();
  if (!aiConfig) {
    return { error: tr(locale, "AI is not available right now. Please try again later.", "בינה מלאכותית אינה זמינה כעת. יש לנסות שוב מאוחר יותר.") };
  }

  const snapshot = toSnapshot(row as ProfileChatRow);

  try {
    const result = await negotiateProfileChange({ config: aiConfig, message: trimmedMessage, locale, profile: snapshot });
    if (!result.changed || !result.patch || Object.keys(result.patch).length === 0) {
      return { reply: result.reply, changed: false };
    }

    const diffRows = buildDiffRows(snapshot, result.patch, locale);
    if (diffRows.length === 0) {
      return { reply: result.reply, changed: false };
    }

    return { reply: result.reply, changed: true, patch: result.patch, diffRows };
  } catch (err) {
    logServerError("profile.negotiateChat", "ai_call_failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return { error: tr(locale, "Something went wrong checking that change. Please try again.", "משהו השתבש בבדיקת השינוי. יש לנסות שוב.") };
  }
}

const dobRegex = /^\d{4}-\d{2}-\d{2}$/;

const profileChatPatchSchema = z
  .object({
    first_name: z.string().trim().min(1).max(80).optional(),
    last_name: z.string().trim().min(1).max(80).optional(),
    date_of_birth: z.string().trim().regex(dobRegex).optional(),
    biological_sex: z.enum(biologicalSexOptions).optional(),
    height_cm: z.number().min(80).max(250).optional(),
    weight_kg: z.number().min(20).max(400).optional(),
    activity_level: z.enum(activityLevelOptions).optional(),
    dietary_preference: z.enum(dietaryPreferenceOptions).optional(),
    nutritional_goal: z.enum(nutritionalGoalOptions).optional(),
    pregnancy_lactation_status: z.enum(pregnancyLactationOptions).optional(),
    hot_climate_or_heavy_sweating: z.boolean().optional(),
    additional_information: z.string().trim().max(1000).optional(),
    habits: z.array(z.enum(habitOptions)).optional(),
    alcohol_consumption_level: z.enum(["low", "high"]).nullable().optional(),
    smoking_packs_per_day: z.number().min(0).max(20).nullable().optional(),
    allergies: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export type ApplyProfileChatChangeResult = { error?: string; success?: boolean };

/**
 * Profile domain's apply step - writes a patch the negotiate step above
 * already produced and the user already confirmed (Apply tap in the chat
 * widget). Re-validates every field itself rather than trusting the AI's
 * JSON as-is (same "never trust the model for a write" posture used
 * throughout this app), then reuses applyProfilePatchAndFlagTargets - the
 * exact same DB-write + target-staleness check every Profile page
 * quick-edit row already goes through - so this can't drift from that
 * page's own behavior. When the change turns out to affect target
 * generation, flags ticket #10's review-pending reminder directly (there's
 * no page redirect/modal in this flow to surface it through the way the
 * Profile page's own save does).
 */
export async function applyProfileChatChangeAction(rawPatch: Record<string, unknown>): Promise<ApplyProfileChatChangeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: row } = await supabase.from("user_profile").select(PROFILE_CHAT_COLUMNS).eq("user_id", user.id).maybeSingle();
  const locale = normalizeLocale(row?.preferred_language);

  if (!row) {
    return { error: tr(locale, "Your profile could not be found.", "לא ניתן למצוא את הפרופיל שלך.") };
  }

  const parsed = profileChatPatchSchema.safeParse(rawPatch);
  if (!parsed.success) {
    return { error: tr(locale, "That change couldn't be applied. Please try again.", "לא ניתן היה להחיל את השינוי. יש לנסות שוב.") };
  }

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return { error: tr(locale, "Nothing to change.", "אין מה לשנות.") };
  }

  const dbPatch: Record<string, unknown> = { ...patch };

  if (patch.date_of_birth) {
    const calculatedAge = calculateAgeYears(patch.date_of_birth);
    if (calculatedAge == null) {
      return {
        error: tr(
          locale,
          "Date of birth must produce a valid age between 0 and 120.",
          "תאריך הלידה חייב להפיק גיל תקין בין 0 ל-120.",
        ),
      };
    }
    dbPatch.age = calculatedAge;
  }

  if (patch.biological_sex) {
    dbPatch.gender = patch.biological_sex;
  }

  const currentRow = row as ProfileChatRow;
  if (patch.habits || patch.alcohol_consumption_level !== undefined || patch.smoking_packs_per_day !== undefined) {
    const effectiveHabits = patch.habits ?? (Array.isArray(currentRow.habits) ? currentRow.habits : []);

    if (effectiveHabits.includes("alcohol")) {
      const level = patch.alcohol_consumption_level !== undefined ? patch.alcohol_consumption_level : currentRow.alcohol_consumption_level;
      if (level !== "low" && level !== "high") {
        return { error: tr(locale, "Select a consumption level for alcohol.", "יש לבחור רמת צריכה לאלכוהול.") };
      }
      dbPatch.alcohol_consumption_level = level;
    } else if (patch.habits) {
      dbPatch.alcohol_consumption_level = null;
    }

    if (effectiveHabits.includes("smoking_or_vaping")) {
      const packs = patch.smoking_packs_per_day !== undefined ? patch.smoking_packs_per_day : currentRow.smoking_packs_per_day;
      if (!packs || packs <= 0) {
        return { error: tr(locale, "Enter cigarettes per day for smoking.", "יש להזין מספר סיגריות ליום.") };
      }
      dbPatch.smoking_packs_per_day = packs;
    } else if (patch.habits) {
      dbPatch.smoking_packs_per_day = null;
    }
  }

  if (patch.allergies) {
    for (const entry of patch.allergies) {
      const validation = validateAllergyEntry(entry);
      if (!validation.isMeaningful) {
        return { error: tr(locale, "Enter a meaningful allergy description.", "יש להזין תיאור אלרגיה משמעותי.") };
      }
    }
  }

  if (patch.additional_information) {
    const validation = validateFreeTextDetails(patch.additional_information, 5);
    if (!validation.isMeaningful) {
      return {
        error: tr(
          locale,
          "Enter meaningful additional information or leave it empty.",
          "יש להזין מידע נוסף משמעותי או להשאיר ריק.",
        ),
      };
    }
  }

  const result = await applyProfilePatchAndFlagTargets({ supabase, userId: user.id, locale, patch: dbPatch });
  if (result.error) {
    return { error: result.error };
  }

  if (result.targetsStaleChanges && result.targetsStaleChanges.length > 0) {
    await flagTargetsReviewPendingAction(result.targetsStaleChanges);
  }

  return { success: true };
}
