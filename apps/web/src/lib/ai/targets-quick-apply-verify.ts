import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";
import { parseJson } from "@/lib/ai/targets-quick-apply";
import type { AppLocale } from "@/lib/locale";
import type { ProfileForTargets } from "@/lib/targets";

/**
 * The quiet safety net behind an instant quick-apply write (a direct tap-
 * to-edit, or a chat ask that resolved to one field + one in-range
 * number). Quick-apply only ever checks the new value against the
 * CURRENT min/max band - itself the product of an earlier full AI safety
 * review - so it's safe by construction against the profile at the time
 * that band was set. The real gap: if the profile changed since (a new
 * condition, a new medication) but no full review has run yet, that band
 * could be stale, and quick-apply has no way to know.
 *
 * This is a small, targeted, single-purpose call - NOT a re-run of the
 * full plan generation. Deliberately narrow: it only asks "does this one
 * specific just-changed value raise a real, specific concern for this
 * person's actual profile" rather than regenerating the whole plan and
 * diffing it, which would risk flagging harmless differences from normal
 * AI run-to-run variance as if they were real safety issues. Per the
 * user's explicit requirement: silent when nothing is wrong, a single
 * notification only when something genuinely is.
 */

const verifySchema = z.object({
  has_concern: z.boolean(),
  concern_message: z.string().trim().max(400).optional().default(""),
});

export type QuickApplyVerifyResult = {
  hasConcern: boolean;
  concernMessage: string;
};

export async function verifyQuickAppliedFieldSafety({
  config,
  profile,
  fieldLabelEn,
  fieldLabelHe,
  newValue,
  unit,
  locale,
}: {
  config: AiExtractionConfig;
  profile: ProfileForTargets;
  fieldLabelEn: string;
  fieldLabelHe: string;
  newValue: number;
  unit: string;
  locale: AppLocale;
}): Promise<QuickApplyVerifyResult> {
  const languageName = locale === "he" ? "Hebrew" : "English";
  const fieldLabel = locale === "he" ? fieldLabelHe : fieldLabelEn;

  const messages = [
    {
      role: "system" as const,
      content:
        "You are a focused safety-verification step in a health-targets app. A user just directly edited one specific target value, within its previously-computed safe range. Your ONLY job is to check whether this specific new value raises a real, specific medical/safety concern given the user's actual profile - NOT to re-derive or second-guess the range itself, and NOT to flag normal variation or a value merely because it changed. Return strict JSON only, no markdown.",
    },
    {
      role: "user" as const,
      content: [
        'Return strict JSON with exactly this shape: {"has_concern":boolean,"concern_message":"string"}',
        "Rules:",
        "- Set has_concern true ONLY for a genuine, specific reason: this value conflicts with a stated medical condition, medication, or allergy, or is an extreme/risky value for this specific person's profile (age, sex, pregnancy status, etc.). When in doubt, set this false - a false alarm here is worse than a missed one, since the underlying range was already safety-reviewed once.",
        `- concern_message: only when has_concern is true - the complete, ready-to-show notification text in ${languageName}, starting with something like "We noticed your recent change to [field] might be worth reconsidering" (translated naturally, not a literal template), then one short sentence naming the SPECIFIC concern, then a brief suggestion to discuss it with Daffy to reconsider the value. Empty string otherwise.`,
        `- Address the user directly in second person ("you"/"your"). Never third person.`,
        locale === "he"
          ? 'In Hebrew specifically, prefer gender-neutral or mixed-form second-person phrasing (e.g. "שלך", "את/ה") over a gendered third-person construction.'
          : "",
        "",
        `The user just set "${fieldLabel}" to ${newValue} ${unit}.`,
        "",
        "user_profile:",
        `age: ${profile.age}, biological_sex: ${profile.biological_sex ?? profile.gender ?? "unknown"}`,
        `medical_conditions: ${profile.medical_conditions.join(", ") || "none"}`,
        `medical_conditions_details: ${profile.medical_conditions_details || "none"}`,
        `regular_medications_details: ${profile.regular_medications_details || "none"}`,
        `allergies: ${profile.allergies.join(", ") || "none"}`,
        `dietary_preference: ${profile.dietary_preference ?? "standard"}`,
        `pregnancy_lactation_status: ${profile.pregnancy_lactation_status ?? "none"}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    temperature: 0,
    jsonMode: true,
    // Small, single-purpose check - same reasoning as
    // classifyTargetsFieldEdit's own timeout: if this ever runs long,
    // silently skipping it (see the caller's catch) is the safe default
    // rather than leaving anything user-visible waiting on it.
    timeoutMs: 15_000,
  });

  const parsed = verifySchema.parse(parseJson(contentText));
  return { hasConcern: parsed.has_concern, concernMessage: parsed.concern_message };
}
