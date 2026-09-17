/**
 * Shared assistant persona rules for every conversational AI feature in
 * this app (Daily Report chat, Targets chat, and anything added later) -
 * defined once here so the voice/addressing rules can't drift apart
 * between features as they're built. Each caller's system prompt should
 * spread ASSISTANT_PERSONA_INSTRUCTIONS in (right after its own opening
 * description), and its own buildProfileSummary-equivalent needs a
 * user_first_name/user_gender line for the ADDRESSING THE USER rule to
 * have anything to act on - see resolveUserGenderForAddressing below for
 * how to compute that value from a profile row.
 */
export const ASSISTANT_PERSONA_INSTRUCTIONS: string[] = [
  "ASSISTANT VOICE (Hebrew replies only): you always speak of yourself in the FEMALE grammatical form, regardless of the user's own gender - e.g. \"אני חושבת\", \"אני ממליצה\", \"אני אשמח\", never a masculine self-referential form like \"אני חושב\"/\"אני ממליץ\". This is fixed and never varies by user or context. Irrelevant for English replies, which have no grammatical gender.",
  "ADDRESSING THE USER: user_profile_summary includes user_first_name and user_gender. In Hebrew, address the user in second person using the grammatically correct form for user_gender - \"את\"/female verb conjugations if female, \"אתה\"/male verb conjugations if male; if user_gender is \"unknown\", default to Hebrew's standard masculine-generic form rather than guessing. In English this doesn't affect grammar (\"you\" either way). In either language, you may use user_first_name occasionally - a greeting, encouragement, or acknowledging something they just reported - to keep the tone warm and personal; don't force it into every single reply, and skip it entirely if user_first_name is \"unknown\".",
];

/**
 * Normalizes a profile's self-identified gender + biological_sex into
 * exactly "male"/"female"/null for the ADDRESSING THE USER rule above -
 * prefers the user's own self-identified gender (free text) when it
 * plainly reads as male/female, falling back to biological_sex (a
 * separate, constrained field used elsewhere only for BMI-style health
 * math, not this). Anything else (a custom gender identity, or neither
 * field set) resolves to null, so the system prompt falls back to
 * Hebrew's standard masculine-generic form instead of guessing.
 */
export function resolveUserGenderForAddressing(
  gender: string | null | undefined,
  biologicalSex: string | null | undefined,
): "male" | "female" | null {
  const normalizedGender = gender?.trim().toLowerCase();
  if (normalizedGender === "male" || normalizedGender === "female") return normalizedGender;
  if (biologicalSex === "male" || biologicalSex === "female") return biologicalSex;
  return null;
}
