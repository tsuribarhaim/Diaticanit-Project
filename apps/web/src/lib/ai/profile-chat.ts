import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";
import type { AppLocale } from "@/lib/locale";
import {
  activityLevelOptions,
  biologicalSexOptions,
  dietaryPreferenceOptions,
  habitOptions,
  nutritionalGoalOptions,
  pregnancyLactationOptions,
} from "@/lib/profile";

/** Every profile field the chat is allowed to propose changing, plus the
 * current value the AI is shown for context. Deliberately excludes medical
 * conditions, medications, exercise modalities/schedule, and preferred
 * language - see this file's own prompt comment on why. */
export type ProfileChatSnapshot = {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  biological_sex: string | null;
  height_cm: number;
  weight_kg: number;
  activity_level: string;
  dietary_preference: string | null;
  nutritional_goal: string;
  pregnancy_lactation_status: string | null;
  hot_climate_or_heavy_sweating: boolean;
  additional_information: string;
  habits: string[];
  alcohol_consumption_level: "low" | "high" | null;
  smoking_packs_per_day: number | null;
  allergies: string[];
};

/** A loose shape here on purpose - the AI's raw JSON output. Real,
 * per-field validation (types, ranges, enum membership, cross-field
 * requirements) happens server-side in applyProfileChatChangeAction before
 * anything is written, the same "never trust the model's output for a
 * write" posture negotiateActiveTargetsAction already takes for targets. */
export type ProfileChatPatch = Record<string, unknown>;

const negotiateResultSchema = z.object({
  reply: z.string().trim().min(1),
  changed: z.boolean(),
  patch: z.record(z.string(), z.unknown()).nullable().optional().default(null),
});

export type NegotiateProfileChangeResult = {
  reply: string;
  changed: boolean;
  patch: ProfileChatPatch | null;
};

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
    throw new Error("AI returned invalid JSON.");
  }
}

/**
 * Negotiates a Profile change from the unified chat (Phase C of the chat
 * redesign) - same shape as negotiateActiveTargetsAction's own AI call for
 * Targets: one message in, either a plain conversational reply (a
 * question, or a request this can't/shouldn't handle) or a reply plus a
 * proposed patch of the specific fields to change, which the caller shows
 * as a diff for the user to Apply or Discard before anything is written.
 *
 * Scoped to the same "safe subset" of profile fields the Profile page's
 * own quick-edit rows (a single value each, no multi-field interdependency
 * of their own beyond habits<->alcohol/smoking) already cover - medical
 * conditions and medications are deliberately excluded here because the
 * full Profile form gates those behind an explicit AI-extraction consent
 * checkbox, a safety-relevant friction point this conversational flow
 * shouldn't quietly bypass; exercise modalities/schedule are excluded
 * because each modality carries its own required days/minutes pair, too
 * interdependent for a first pass. For any of those, or for
 * preferred_language, this always answers conversationally and points the
 * user to the Profile page instead of proposing a patch.
 */
export async function negotiateProfileChange({
  config,
  message,
  locale,
  profile,
}: {
  config: AiExtractionConfig;
  message: string;
  locale: AppLocale;
  profile: ProfileChatSnapshot;
}): Promise<NegotiateProfileChangeResult> {
  const outOfScopeNote =
    "Medical conditions, medications, exercise types/schedule, and app language are NOT editable here - if asked about those, answer briefly and tell the user to open the Profile page to change them (never propose a patch touching them).";

  const messages = [
    {
      role: "system" as const,
      content:
        "You are Daffy, a health-tracking app's AI coach, handling a message about the user's own Profile info (not their targets, not something they logged today). Return strict JSON only, no markdown.",
    },
    {
      role: "user" as const,
      content: [
        `Reply in ${locale === "he" ? "Hebrew" : "English"}, in Daffy's normal warm, concise voice.`,
        "The user's current Profile (only fields you're allowed to change):",
        JSON.stringify(profile, null, 2),
        outOfScopeNote,
        "Editable field keys and constraints (only include a key in \"patch\" if the user is actually asking to change it):",
        `- first_name, last_name: non-empty text, at most 80 characters each.`,
        `- date_of_birth: "YYYY-MM-DD".`,
        `- biological_sex: one of ${JSON.stringify(biologicalSexOptions)}.`,
        `- height_cm: number, 80-250.`,
        `- weight_kg: number, 20-400. This is the user's CURRENT weight (a fact), not a target - if they're asking to change a target, that's a different domain and you should just say so in reply with changed:false and patch:null.`,
        `- activity_level: one of ${JSON.stringify(activityLevelOptions)}.`,
        `- dietary_preference: one of ${JSON.stringify(dietaryPreferenceOptions)}.`,
        `- nutritional_goal: one of ${JSON.stringify(nutritionalGoalOptions)}.`,
        `- pregnancy_lactation_status: one of ${JSON.stringify(pregnancyLactationOptions)}.`,
        `- hot_climate_or_heavy_sweating: boolean.`,
        `- additional_information: free text, at most 1000 characters.`,
        `- habits: array from ${JSON.stringify(habitOptions)} (use ["none"] to mean none). If you include "alcohol" in habits, you MUST also include alcohol_consumption_level ("low" or "high") in the same patch. If you include "smoking_or_vaping", you MUST also include smoking_packs_per_day (a number > 0) in the same patch. If removing alcohol/smoking from habits, set the matching level/packs field to null in the patch.`,
        `- alcohol_consumption_level: "low" | "high" | null.`,
        `- smoking_packs_per_day: number (cigarette packs per day), or null.`,
        `- allergies: full replacement array of short strings - when the user asks to add or remove one, return the COMPLETE resulting list (current list plus/minus that item), not just the delta.`,
        "If the message is a pure question (asking what's on file, or general advice) with no change requested, set changed:false and patch:null, and just answer in reply.",
        "If the message asks for a change to an out-of-scope field only, set changed:false and patch:null, and explain in reply per the note above.",
        "If the message asks for a change to one or more in-scope fields, set changed:true and patch to an object with ONLY those changed keys (plus any field required alongside it per the rules above) - never include unchanged fields.",
        "Return strict JSON with exactly this shape: {\"reply\":\"string\",\"changed\":boolean,\"patch\":object|null}",
        "message:",
        message,
      ].join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    temperature: 0.2,
    jsonMode: true,
    timeoutMs: 30_000,
  });

  const parsed = negotiateResultSchema.parse(parseJson(contentText));
  return { reply: parsed.reply, changed: parsed.changed, patch: parsed.patch ?? null };
}
