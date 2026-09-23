"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { generateTargetsPayload, hasAiTargetsConsent, performTargetsLock } from "@/app/app/targets/actions";
import { applyOrCheckFieldEdit, type EditableFieldRef } from "@/app/app/targets/edit-actions";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { classifyTargetsFieldEdit } from "@/lib/ai/targets-quick-apply";
import { formatNumberForLocale, normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import {
  mapTargetProfileRowToPayload,
  targetGenerationPayloadSchema,
  toProfileForTargets,
  TARGET_PROFILE_COLUMNS,
  type TargetGenerationPayload,
} from "@/lib/targets";
import { computeTargetsDiff, NUTRIENT_DIFF_FIELDS } from "@/lib/targets-diff";

/** Maps the classifier's plain string field_key (one of the 19 nutrient
 * labelEn values, or "weight"/"sleep"/"steps") back to the typed
 * EditableFieldRef applyOrCheckFieldEdit expects. */
function fieldRefFromKey(fieldKey: string): EditableFieldRef | null {
  if (fieldKey === "weight" || fieldKey === "sleep" || fieldKey === "steps") {
    return { kind: fieldKey };
  }
  const nutrient = NUTRIENT_DIFF_FIELDS.find((f) => f.labelEn === fieldKey);
  return nutrient ? { kind: "nutrient", labelEn: nutrient.labelEn } : null;
}

/** Plain-language label + unit for the quick-apply confirmation message -
 * same display names the field already uses elsewhere (its own label, or
 * the nutrient table's). */
function describeField(field: EditableFieldRef): { labelEn: string; labelHe: string; unit: string } {
  if (field.kind === "nutrient") {
    const nutrient = NUTRIENT_DIFF_FIELDS.find((f) => f.labelEn === field.labelEn);
    return { labelEn: field.labelEn, labelHe: nutrient?.labelHe ?? field.labelEn, unit: nutrient?.unit ?? "" };
  }
  if (field.kind === "weight") return { labelEn: "Target Weight", labelHe: "משקל יעד", unit: "kg" };
  if (field.kind === "sleep") return { labelEn: "Sleep Duration", labelHe: "משך שינה", unit: "h" };
  return { labelEn: "Daily Steps", labelHe: "צעדים יומיים", unit: "steps" };
}

const PROFILE_COLUMNS_FOR_TARGETS =
  "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating, preferred_language, first_name, nutritional_goal";

export type NegotiateActiveTargetsResult =
  | { error: string }
  | {
      payload: TargetGenerationPayload;
      source: "ai" | "heuristic";
      reply: string;
      changed: boolean;
      /** True when `payload` has ALREADY been written (the chat quick-
       * apply path below) - the caller should update its own displayed
       * state immediately rather than showing an Apply/Discard step, the
       * same way a direct in-range edit doesn't need one either. */
      quickApplied?: boolean;
    };

/**
 * The standalone Targets page's own chat/negotiation - deliberately the
 * same simple, synchronous shape as the onboarding Targets step's
 * negotiateOnboardingTargetsAction (see that file's own comment on why:
 * no quick-apply/queued distinction, no background job, no notification),
 * rather than the old, more complex SSE-based /api/targets/chat route this
 * page is replacing. The one real difference: this negotiates against the
 * user's CURRENTLY ACTIVE (already locked-in) plan, read fresh from the
 * database rather than held in not-yet-persisted client state, since
 * there's no "finish onboarding" step here - every value on this page is
 * already live. Never writes anything itself; the result is only applied
 * if the caller then calls applyActiveTargetsAction, so a chat message
 * always previews before it changes anything real.
 */
export async function negotiateActiveTargetsAction({
  message,
}: {
  message: string;
}): Promise<NegotiateActiveTargetsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const [{ data: profileRow, error: profileError }, { data: activeRow, error: activeError }] = await Promise.all([
    supabase.from("user_profile").select(PROFILE_COLUMNS_FOR_TARGETS).eq("user_id", user.id).maybeSingle(),
    supabase.from("user_target_profiles").select(TARGET_PROFILE_COLUMNS).eq("user_id", user.id).eq("is_active", true).maybeSingle(),
  ]);

  const locale = normalizeLocale(profileRow?.preferred_language);

  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return { error: tr(locale, "Nothing to send yet.", "אין עדיין מה לשלוח.") };
  }

  if (profileError || !profileRow) {
    return { error: tr(locale, "Your profile could not be found.", "לא ניתן למצוא את הפרופיל שלך.") };
  }
  if (activeError || !activeRow) {
    return { error: tr(locale, "Your current targets could not be found. Please refresh the page.", "לא ניתן למצוא את היעדים הנוכחיים שלך. יש לרענן את הדף.") };
  }

  const currentPayload = mapTargetProfileRowToPayload(activeRow);
  const profile = toProfileForTargets(profileRow);
  const aiConfig = getAiExtractionConfig();
  const hasConsent = aiConfig ? await hasAiTargetsConsent({ supabase, userId: user.id }) : false;

  // Chat quick-apply: try to resolve this message to one field + one exact
  // number first (see classifyTargetsFieldEdit's own comment). A literal,
  // in-range ask like "reduce my weight target by 1kg" is written
  // immediately and just confirmed in chat - the same outcome a direct
  // tap-to-edit gets for an in-range value - instead of always forcing a
  // review-then-tap-Apply step even for a trivially safe change (the gap
  // the user explicitly asked to close). Only attempted when AI is
  // actually available and consented to; otherwise (or if the classifier
  // itself fails, or the ask isn't a clean single-field one) this falls
  // straight through to the full negotiate flow below, unchanged.
  if (aiConfig && hasConsent) {
    try {
      const classification = await classifyTargetsFieldEdit({
        config: aiConfig,
        message: trimmedMessage,
        currentTargets: currentPayload,
        locale,
      });

      if (!classification.needsFullReview && classification.fieldKey && classification.newValue !== null) {
        const field = fieldRefFromKey(classification.fieldKey);
        if (field) {
          const editResult = await applyOrCheckFieldEdit({
            supabase,
            userId: user.id,
            locale,
            profileRow,
            currentPayload,
            field,
            newValue: classification.newValue,
          });

          if ("error" in editResult) {
            return { error: editResult.error };
          }

          if (editResult.applied) {
            const info = describeField(field);
            const valueText = `${formatNumberForLocale(classification.newValue, locale)} ${info.unit}`.trim();
            const doneReply = tr(
              locale,
              `Done - ${info.labelEn} is now ${valueText}.`,
              `בוצע - ${info.labelHe} עודכן ל-${valueText}.`,
            );
            return { payload: editResult.payload, source: "heuristic", reply: doneReply, changed: true, quickApplied: true };
          }
          // Out of range - fall through to the full negotiate flow below.
          // No separate "want Daffy to check this?" confirmation needed
          // here the way a direct edit's banner asks one: sending this
          // chat message already WAS the explicit request to look into it.
        }
      }
    } catch (err) {
      logServerError("targets.negotiateActive", "quick_apply_classify_failed", {
        userId: user.id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const { payload, source, safetyRejectionMessage, notActionableMessage } = await generateTargetsPayload({
    goalText: trimmedMessage,
    profile,
    locale,
    aiConfig,
    hasConsent,
    currentTargets: currentPayload,
    supabase,
    userId: user.id,
  });

  if (safetyRejectionMessage) {
    return { error: safetyRejectionMessage };
  }

  if (notActionableMessage) {
    return { payload: currentPayload, source, reply: notActionableMessage, changed: false };
  }

  const validated = targetGenerationPayloadSchema.safeParse(payload);
  if (!validated.success) {
    logServerError("targets.negotiateActive", "invalid_payload", {
      userId: user.id,
      error: validated.error.message,
    });
    return { error: tr(locale, "Something went wrong checking that change. Please try again.", "משהו השתבש בבדיקת השינוי. יש לנסות שוב.") };
  }

  const diffRows = computeTargetsDiff(currentPayload, validated.data, locale);

  if (diffRows.length === 0) {
    return {
      payload: currentPayload,
      source,
      reply:
        validated.data.aiRationaleExplanation ||
        tr(locale, "I reviewed this and nothing needs to change.", "בדקתי את זה ואין צורך בשינוי."),
      changed: false,
    };
  }

  // The AI's own explanation leads - it's the actual answer to whatever
  // was asked (including *why* the specific thing asked for didn't
  // happen, e.g. a declined unsafe calorie jump), which a mechanical diff
  // list can't convey on its own. Confirmed live as a real gap: a user
  // asked to raise calories to an unsafe level, the model correctly left
  // calories untouched but reworded a couple of unrelated fields in the
  // process, and this used to show ONLY the mechanical "Here's what I'd
  // update" diff for those incidental changes - with no explanation of
  // calories at all, reading as if the request had just been ignored.
  const changeSummary = diffRows
    .slice(0, 6)
    .map((row) => `${tr(locale, row.labelEn, row.labelHe)}: ${row.before} → ${row.after}`)
    .join("\n");
  const updatedLabel = tr(locale, "Updated:", "עודכן:");
  const reply = validated.data.aiRationaleExplanation
    ? `${validated.data.aiRationaleExplanation}\n\n${updatedLabel}\n${changeSummary}`
    : tr(locale, `Here's what I'd update:\n${changeSummary}`, `הנה מה שהייתי מעדכן:\n${changeSummary}`);

  return { payload: validated.data, source, reply, changed: true };
}

export type ApplyActiveTargetsState = { error?: string };

/**
 * Writes a negotiated (or directly edited) payload as the new active plan -
 * reuses performTargetsLock, the same safety-critical insert/deactivate
 * logic every other lock-in flow in the app already uses. Unlike
 * lockOnboardingTargetsAction, this never redirects: the user is already on
 * the page they'll keep seeing, just with fresh numbers.
 */
export async function applyActiveTargetsAction({
  payload,
  source,
  goalText,
}: {
  payload: TargetGenerationPayload;
  source: "ai" | "heuristic";
  goalText: string;
}): Promise<ApplyActiveTargetsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profileRow } = await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle();
  const locale = normalizeLocale(profileRow?.preferred_language);

  const validated = targetGenerationPayloadSchema.safeParse(payload);
  if (!validated.success) {
    logServerError("targets.applyActive", "invalid_payload", { userId: user.id, error: validated.error.message });
    return { error: tr(locale, "This change could not be validated. Please try again.", "לא ניתן היה לאמת את השינוי הזה. יש לנסות שוב.") };
  }

  const result = await performTargetsLock({
    supabase,
    userId: user.id,
    goalText,
    source,
    payload: validated.data,
  });

  if ("error" in result) {
    return { error: result.error };
  }

  revalidatePath("/app");
  revalidatePath("/app/targets");
  revalidatePath("/app/daily-report");
  return {};
}
