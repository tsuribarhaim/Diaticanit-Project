import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";
import { callAiChatCompletion } from "@/lib/ai/provider-client";
import type { AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";

/**
 * The "lang only" mode's second call (see
 * docs/design/targets-generation-latency-and-hebrew-redesign.md, and
 * targets-update-mode.ts for the 3-mode selector this belongs to):
 * generateTargetsWithAi is run with the generation language forced to
 * English (cheaper/faster per the measured Hebrew-vs-English penalty),
 * then this function renders ONLY the free-text fields into the user's
 * real display locale. Every numeric field, id, unit, and enum in the
 * input payload is guaranteed untouched by construction - this call's
 * tool schema has no numeric fields at all, so there's nothing for it to
 * alter even if the model tried. search_keywords are deliberately never
 * translated (decision: they stay English YouTube search phrases
 * regardless of locale).
 */

const translationOutputSchema = z.object({
  global_coaching_explanation: z.string(),
  profile_discrepancy_message: z.string().default(""),
  exercise_notes: z.array(z.object({ index: z.number().int(), ai_adjustment_note: z.string() })).default([]),
  habits_do: z.array(z.object({ index: z.number().int(), habit_instruction: z.string(), rationale: z.string() })).default([]),
  habits_dont: z.array(z.object({ index: z.number().int(), habit_instruction: z.string(), rationale: z.string() })).default([]),
  user_targets: z.array(z.object({ index: z.number().int(), label: z.string(), value: z.string() })).default([]),
});

const TOOL_NAME = "translate_targets_text";

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    global_coaching_explanation: { type: "string" },
    profile_discrepancy_message: { type: "string" },
    exercise_notes: {
      type: "array",
      items: { type: "object", properties: { index: { type: "number" }, ai_adjustment_note: { type: "string" } }, required: ["index", "ai_adjustment_note"] },
    },
    habits_do: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "number" }, habit_instruction: { type: "string" }, rationale: { type: "string" } },
        required: ["index", "habit_instruction", "rationale"],
      },
    },
    habits_dont: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "number" }, habit_instruction: { type: "string" }, rationale: { type: "string" } },
        required: ["index", "habit_instruction", "rationale"],
      },
    },
    user_targets: {
      type: "array",
      items: { type: "object", properties: { index: { type: "number" }, label: { type: "string" }, value: { type: "string" } }, required: ["index", "label", "value"] },
    },
  },
  required: ["global_coaching_explanation", "exercise_notes", "habits_do", "habits_dont", "user_targets"],
} as const;

/** Only meaningful when targetLocale isn't already English - callers
 * should skip calling this entirely for an English-preference user (see
 * targets-update-mode.ts's mode dispatch). */
export async function translateTargetsPayload({
  config,
  payload,
  targetLocale,
}: {
  config: AiExtractionConfig;
  payload: TargetGenerationPayload;
  targetLocale: AppLocale;
}): Promise<TargetGenerationPayload> {
  const languageName = targetLocale === "he" ? "Hebrew" : "English";

  const messages = [
    {
      role: "system" as const,
      content:
        "You are a precise translation step in a nutrition coaching pipeline. All content was already generated and safety-reviewed in English - your ONLY job is to render the given free-text fields into the target language, preserving meaning and tone exactly. Never change a number, add or remove information, or alter any recommendation. Call the translate_targets_text tool exactly once with your answer.",
    },
    {
      role: "user" as const,
      content: [
        `Translate every field below into ${languageName}. Address the user directly in second person ("you"/"your"). Never third person.`,
        targetLocale === "he"
          ? 'In Hebrew specifically, prefer gender-neutral or mixed-form second-person phrasing (e.g. "שלך", "את/ה") over a gendered third-person construction.'
          : "",
        "Echo back the same `index` values given below unchanged, so each translation maps back to the right entry.",
        "",
        `global_coaching_explanation:\n${payload.aiRationaleExplanation}`,
        `profile_discrepancy_message:\n${payload.profileDiscrepancyMessage || "(empty)"}`,
        "",
        "exercise_notes (JSON):",
        JSON.stringify(payload.exerciseTargets.map((entry, index) => ({ index, ai_adjustment_note: entry.aiAdjustmentNote }))),
        "habits_do (JSON):",
        JSON.stringify(payload.habitsDo.map((entry, index) => ({ index, habit_instruction: entry.habitInstruction, rationale: entry.rationale }))),
        "habits_dont (JSON):",
        JSON.stringify(payload.habitsDont.map((entry, index) => ({ index, habit_instruction: entry.habitInstruction, rationale: entry.rationale }))),
        "user_targets (JSON) - label/value only, never touch id/unit/targetMin/targetMax:",
        JSON.stringify(payload.userTargets.map((entry, index) => ({ index, label: entry.label, value: entry.value }))),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    tool: { name: TOOL_NAME, description: "Translate the free-text fields of an already-decided targets plan.", inputSchema: TOOL_INPUT_SCHEMA },
    // A full payload's worth of free text (exercise notes, up to 8
    // habits, the global explanation, user targets) is a genuinely large
    // translation task, not a small one - found via real testing: 30s
    // was too tight and this call hit the ceiling. 60s mirrors the same
    // headroom logic as generateTargetsWithAi's own 90s (see its comment)
    // relative to its typical run time.
    timeoutMs: 60_000,
  });

  const raw = translationOutputSchema.parse(JSON.parse(contentText));

  const exerciseNoteByIndex = new Map(raw.exercise_notes.map((entry) => [entry.index, entry.ai_adjustment_note]));
  const habitsDoByIndex = new Map(raw.habits_do.map((entry) => [entry.index, entry]));
  const habitsDontByIndex = new Map(raw.habits_dont.map((entry) => [entry.index, entry]));
  const userTargetsByIndex = new Map(raw.user_targets.map((entry) => [entry.index, entry]));

  return {
    ...payload,
    aiRationaleExplanation: raw.global_coaching_explanation,
    profileDiscrepancyMessage: raw.profile_discrepancy_message,
    exerciseTargets: payload.exerciseTargets.map((entry, index) => ({
      ...entry,
      aiAdjustmentNote: exerciseNoteByIndex.get(index) ?? entry.aiAdjustmentNote,
    })),
    habitsDo: payload.habitsDo.map((entry, index) => {
      const translated = habitsDoByIndex.get(index);
      return translated ? { ...entry, habitInstruction: translated.habit_instruction, rationale: translated.rationale } : entry;
    }),
    habitsDont: payload.habitsDont.map((entry, index) => {
      const translated = habitsDontByIndex.get(index);
      return translated ? { ...entry, habitInstruction: translated.habit_instruction, rationale: translated.rationale } : entry;
    }),
    userTargets: payload.userTargets.map((entry, index) => {
      const translated = userTargetsByIndex.get(index);
      return translated ? { ...entry, label: translated.label, value: translated.value } : entry;
    }),
  };
}

/**
 * EXPERIMENTAL - built to measure option 2 from the design doc's open
 * question on "lang_only", not yet the production implementation. Same
 * idea as translateTargetsPayload, but only translates entries that
 * actually differ from the prior plan (previousPayload) - matched by
 * modality (exercise) or id (habits/user_targets) - and reuses the prior
 * plan's own already-localized text for everything unchanged, instead of
 * translating the full payload regardless of what changed.
 */
export async function translateTargetsPayloadScoped({
  config,
  payload,
  previousPayload,
  targetLocale,
}: {
  config: AiExtractionConfig;
  payload: TargetGenerationPayload;
  /** The prior, already-localized plan (currentTargets) - unchanged
   * entries reuse THIS text, never the untranslated English from
   * `payload`. */
  previousPayload: TargetGenerationPayload;
  targetLocale: AppLocale;
}): Promise<{ result: TargetGenerationPayload; translatedCount: number; skippedCount: number }> {
  const languageName = targetLocale === "he" ? "Hebrew" : "English";

  const prevExerciseByModality = new Map(previousPayload.exerciseTargets.map((entry) => [entry.modality, entry]));
  const prevHabitsDoById = new Map(previousPayload.habitsDo.map((entry) => [entry.id, entry]));
  const prevHabitsDontById = new Map(previousPayload.habitsDont.map((entry) => [entry.id, entry]));
  const prevUserTargetsById = new Map(previousPayload.userTargets.filter((e) => e.id).map((entry) => [entry.id, entry]));

  const exerciseChanged = payload.exerciseTargets.map((entry) => {
    const prev = prevExerciseByModality.get(entry.modality);
    return !prev || prev.frequencyPerWeek !== entry.frequencyPerWeek || prev.durationMinutesPerSession !== entry.durationMinutesPerSession;
  });
  const habitsDoChanged = payload.habitsDo.map((entry) => !prevHabitsDoById.has(entry.id));
  const habitsDontChanged = payload.habitsDont.map((entry) => !prevHabitsDontById.has(entry.id));
  const userTargetsChanged = payload.userTargets.map((entry) => {
    const prev = entry.id ? prevUserTargetsById.get(entry.id) : undefined;
    return !prev || prev.targetMin !== entry.targetMin || prev.targetMax !== entry.targetMax || prev.unit !== entry.unit;
  });

  const changedFlags = [...exerciseChanged, ...habitsDoChanged, ...habitsDontChanged, ...userTargetsChanged];
  // +1 for global_coaching_explanation, which is always translated fresh
  // every call (it's per-request content, not something to carry forward).
  const translatedCount = changedFlags.filter(Boolean).length + 1;
  const skippedCount = changedFlags.filter((c) => !c).length;

  const messages = [
    {
      role: "system" as const,
      content:
        "You are a precise translation step in a nutrition coaching pipeline. All content was already generated and safety-reviewed in English - your ONLY job is to render the given free-text fields into the target language, preserving meaning and tone exactly. Never change a number, add or remove information, or alter any recommendation. Call the translate_targets_text tool exactly once with your answer.",
    },
    {
      role: "user" as const,
      content: [
        `Translate every field below into ${languageName}. Address the user directly in second person ("you"/"your"). Never third person.`,
        targetLocale === "he"
          ? 'In Hebrew specifically, prefer gender-neutral or mixed-form second-person phrasing (e.g. "שלך", "את/ה") over a gendered third-person construction.'
          : "",
        "Echo back the same `index` values given below unchanged, so each translation maps back to the right entry. Only entries that changed from the prior plan are included below - there is nothing else to translate.",
        "",
        `global_coaching_explanation:\n${payload.aiRationaleExplanation}`,
        `profile_discrepancy_message:\n${payload.profileDiscrepancyMessage || "(empty)"}`,
        "",
        "exercise_notes (JSON, changed entries only):",
        JSON.stringify(
          payload.exerciseTargets
            .map((entry, index) => ({ index, ai_adjustment_note: entry.aiAdjustmentNote, changed: exerciseChanged[index] }))
            .filter((e) => e.changed)
            .map(({ index, ai_adjustment_note }) => ({ index, ai_adjustment_note })),
        ),
        "habits_do (JSON, changed entries only):",
        JSON.stringify(
          payload.habitsDo
            .map((entry, index) => ({ index, habit_instruction: entry.habitInstruction, rationale: entry.rationale, changed: habitsDoChanged[index] }))
            .filter((e) => e.changed)
            .map(({ index, habit_instruction, rationale }) => ({ index, habit_instruction, rationale })),
        ),
        "habits_dont (JSON, changed entries only):",
        JSON.stringify(
          payload.habitsDont
            .map((entry, index) => ({ index, habit_instruction: entry.habitInstruction, rationale: entry.rationale, changed: habitsDontChanged[index] }))
            .filter((e) => e.changed)
            .map(({ index, habit_instruction, rationale }) => ({ index, habit_instruction, rationale })),
        ),
        "user_targets (JSON, changed entries only) - label/value only, never touch id/unit/targetMin/targetMax:",
        JSON.stringify(
          payload.userTargets
            .map((entry, index) => ({ index, label: entry.label, value: entry.value, changed: userTargetsChanged[index] }))
            .filter((e) => e.changed)
            .map(({ index, label, value }) => ({ index, label, value })),
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const contentText = await callAiChatCompletion({
    config,
    messages,
    tool: { name: TOOL_NAME, description: "Translate only the changed free-text fields of an already-decided targets plan.", inputSchema: TOOL_INPUT_SCHEMA },
    timeoutMs: 60_000,
  });

  const raw = translationOutputSchema.parse(JSON.parse(contentText));

  const exerciseNoteByIndex = new Map(raw.exercise_notes.map((entry) => [entry.index, entry.ai_adjustment_note]));
  const habitsDoByIndex = new Map(raw.habits_do.map((entry) => [entry.index, entry]));
  const habitsDontByIndex = new Map(raw.habits_dont.map((entry) => [entry.index, entry]));
  const userTargetsByIndex = new Map(raw.user_targets.map((entry) => [entry.index, entry]));

  const result: TargetGenerationPayload = {
    ...payload,
    aiRationaleExplanation: raw.global_coaching_explanation,
    profileDiscrepancyMessage: raw.profile_discrepancy_message,
    exerciseTargets: payload.exerciseTargets.map((entry, index) => {
      if (!exerciseChanged[index]) {
        const prev = prevExerciseByModality.get(entry.modality);
        return prev ? { ...entry, aiAdjustmentNote: prev.aiAdjustmentNote } : entry;
      }
      return { ...entry, aiAdjustmentNote: exerciseNoteByIndex.get(index) ?? entry.aiAdjustmentNote };
    }),
    habitsDo: payload.habitsDo.map((entry, index) => {
      if (!habitsDoChanged[index]) {
        const prev = prevHabitsDoById.get(entry.id);
        return prev ? { ...entry, habitInstruction: prev.habitInstruction, rationale: prev.rationale } : entry;
      }
      const translated = habitsDoByIndex.get(index);
      return translated ? { ...entry, habitInstruction: translated.habit_instruction, rationale: translated.rationale } : entry;
    }),
    habitsDont: payload.habitsDont.map((entry, index) => {
      if (!habitsDontChanged[index]) {
        const prev = prevHabitsDontById.get(entry.id);
        return prev ? { ...entry, habitInstruction: prev.habitInstruction, rationale: prev.rationale } : entry;
      }
      const translated = habitsDontByIndex.get(index);
      return translated ? { ...entry, habitInstruction: translated.habit_instruction, rationale: translated.rationale } : entry;
    }),
    userTargets: payload.userTargets.map((entry, index) => {
      if (!userTargetsChanged[index]) {
        const prev = entry.id ? prevUserTargetsById.get(entry.id) : undefined;
        return prev ? { ...entry, label: prev.label, value: prev.value } : entry;
      }
      const translated = userTargetsByIndex.get(index);
      return translated ? { ...entry, label: translated.label, value: translated.value } : entry;
    }),
  };

  return { result, translatedCount, skippedCount };
}
