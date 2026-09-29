"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { generateTargetsPayload, hasAiTargetsConsent, performTargetsLock } from "@/app/app/targets/actions";
import { applyOrCheckFieldEdit, type EditableFieldRef } from "@/app/app/targets/edit-actions";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { classifyTargetsFieldEdit } from "@/lib/ai/targets-quick-apply";
import { formatNumberForLocale, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createNotification, markAllTargetsNotificationsRead } from "@/lib/notifications";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import {
  mapTargetProfileRowToPayload,
  targetGenerationPayloadSchema,
  toProfileForTargets,
  TARGET_PROFILE_COLUMNS,
  type ProfileForTargets,
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
      /** True when `payload` has ALREADY been written (the chat quick-
       * apply path below) - the caller should update its own displayed
       * state immediately. */
      quickApplied: true;
      payload: TargetGenerationPayload;
      reply: string;
    }
  | {
      /** Nothing beyond quick-apply's narrow scope resolves synchronously
       * anymore (see this function's own doc comment) - the full review
       * runs in the background and reports back via a notification once
       * it's done, auto-applying anything it decides to change. */
      quickApplied: false;
      queued: true;
      reply: string;
    };

/**
 * The standalone Targets page's own chat/negotiation. Quick-apply (a
 * literal, in-range single-field ask) still resolves synchronously and
 * writes immediately, same as before. Anything beyond that used to make
 * the user wait synchronously for the full ~50-90s AI call and then
 * required a second explicit tap to actually save it - both replaced
 * (per the async-review redesign) by: acknowledge immediately, run the
 * full review in the background (runTargetsBackgroundReview below), and
 * auto-apply whatever it decides, reporting back via a notification. No
 * approval step - the earlier draft/approve design this superseded was
 * itself already dead code with no live caller by the time this was
 * built (see docs/design/targets-background-auto-apply.md).
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
            return { quickApplied: true, payload: editResult.payload, reply: doneReply };
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

  // Quick-apply didn't resolve this - queue the full review in the
  // background instead of making the user wait synchronously for it
  // (previously ~50-90s, then a second explicit tap to save). Mark this
  // as the CURRENT request for this user before dispatching, so
  // runTargetsBackgroundReview can tell whether it's still the latest
  // one by the time it finishes - see user_target_update_requests' own
  // migration comment on why this matters (an older, slower request
  // finishing after a newer one otherwise silently wins).
  const requestId = crypto.randomUUID();
  const { error: requestMarkerError } = await supabase
    .from("user_target_update_requests")
    .upsert(
      { user_id: user.id, request_id: requestId, goal_text: trimmedMessage, status: "pending", completed_at: null },
      { onConflict: "user_id" },
    );

  if (requestMarkerError) {
    logServerError("targets.negotiateActive", "request_marker_failed", { userId: user.id, error: requestMarkerError.message });
    return { error: tr(locale, "Something went wrong starting that review. Please try again.", "משהו השתבש בהתחלת הבדיקה. יש לנסות שוב.") };
  }

  after(() =>
    runTargetsBackgroundReview({
      supabase,
      userId: user.id,
      requestId,
      goalText: trimmedMessage,
      profile,
      locale,
      aiConfig,
      hasConsent,
    }),
  );

  return {
    quickApplied: false,
    queued: true,
    reply: tr(
      locale,
      "Got it - let me think this through carefully and make sure your targets are properly tuned. I'll let you know once it's done.",
      "קיבלתי - תני לי לחשוב על זה כמו שצריך ולוודא שהיעדים שלך מכוונים נכון. אעדכן אותך ברגע שאסיים.",
    ),
  };
}

/**
 * The slow, thorough half of the async redesign - runs the full AI review
 * and, if it decides on a real change, applies it automatically (no
 * approval step - see negotiateActiveTargetsAction's own doc comment) and
 * notifies the user what changed. Called via Next's after() so it keeps
 * running once the "I'll think it over" acknowledgment has already gone
 * out. Every exit path is intentionally silent-on-failure (logged, not
 * thrown) - there's no request left to fail back to by the time this
 * runs.
 */
async function runTargetsBackgroundReview({
  supabase,
  userId,
  requestId,
  goalText,
  profile,
  locale,
  aiConfig,
  hasConsent,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  requestId: string;
  goalText: string;
  profile: ProfileForTargets;
  locale: AppLocale;
  aiConfig: ReturnType<typeof getAiExtractionConfig>;
  hasConsent: boolean;
}): Promise<void> {
  try {
    const { data: activeRow } = await supabase
      .from("user_target_profiles")
      .select(TARGET_PROFILE_COLUMNS)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (!activeRow) return;

    const currentTargets = mapTargetProfileRowToPayload(activeRow);

    const { payload: rawPayload, source, safetyRejectionMessage, notActionableMessage } = await generateTargetsPayload({
      goalText,
      profile,
      locale,
      aiConfig,
      hasConsent,
      currentTargets,
      supabase,
      userId,
    });

    // Supersession check: if a newer request has replaced this one while
    // the AI call was running, discard silently - that newer request's
    // own background review will report back once IT finishes.
    const { data: latestRequest } = await supabase
      .from("user_target_update_requests")
      .select("request_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (latestRequest?.request_id !== requestId) return;

    const markComplete = (status: "complete" | "failed") =>
      supabase
        .from("user_target_update_requests")
        .update({ status, completed_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("request_id", requestId);

    if (safetyRejectionMessage) {
      await createNotification({
        supabase,
        userId,
        targetProfileId: activeRow.id,
        severity: "concern",
        message: safetyRejectionMessage,
        fieldKeys: [],
      });
      await markComplete("failed");
      return;
    }

    if (notActionableMessage) {
      // Nothing concrete was actually asked for - the user already got
      // the "let me look into this" acknowledgment, and there's genuinely
      // nothing to report back now.
      await markComplete("complete");
      return;
    }

    const validatedPayload = targetGenerationPayloadSchema.safeParse(rawPayload);
    if (!validatedPayload.success) {
      logServerError("targets.backgroundReview", "invalid_generated_payload", { userId, error: validatedPayload.error.message });
      await markComplete("failed");
      return;
    }
    const payload = validatedPayload.data;

    const diffRows = computeTargetsDiff(currentTargets, payload, locale);

    if (diffRows.length === 0) {
      await createNotification({
        supabase,
        userId,
        targetProfileId: activeRow.id,
        severity: "info",
        message: tr(
          locale,
          "I reviewed this and your targets are still accurate as-is - no changes needed.",
          "בדקתי את זה והיעדים שלך עדיין מדויקים כפי שהם - אין צורך בשינויים.",
        ),
        fieldKeys: [],
      });
      await markComplete("complete");
      return;
    }

    const lockResult = await performTargetsLock({ supabase, userId, goalText, source, payload });
    if ("error" in lockResult) {
      logServerError("targets.backgroundReview", "lock_failed", { userId, error: lockResult.error });
      await markComplete("failed");
      return;
    }

    // Same "explanation leads, diff supports" reasoning as the old
    // synchronous preview reply used - see the git history on this file
    // for the original comment this was ported from.
    const changeSummary = diffRows
      .slice(0, 6)
      .map((row) => `${tr(locale, row.labelEn, row.labelHe)}: ${row.before} → ${row.after}`)
      .join("\n");
    const updatedLabel = tr(locale, "Updated:", "עודכן:");
    const message = payload.aiRationaleExplanation
      ? `${payload.aiRationaleExplanation}\n\n${updatedLabel}\n${changeSummary}`
      : tr(locale, `Here's what I updated:\n${changeSummary}`, `הנה מה שעודכן:\n${changeSummary}`);

    // Clear any earlier still-unread targets notifications first (a stale
    // "still accurate" confirmation, an old profile-discrepancy note) - a
    // fresh successful save makes them all moot regardless of what they
    // said. See markAllTargetsNotificationsRead's own comment.
    await markAllTargetsNotificationsRead({ supabase, userId });
    await createNotification({
      supabase,
      userId,
      targetProfileId: activeRow.id,
      severity: "info",
      message,
      fieldKeys: [],
    });
    await markComplete("complete");
  } catch (error) {
    logServerError("targets.backgroundReview", "unhandled_error", {
      userId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    await supabase
      .from("user_target_update_requests")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("request_id", requestId);
  }
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

/**
 * Ticket #10: turns off the pending-review flag applyProfilePatchAndFlagTargets
 * sets (see app/app/profile/actions.ts) once Daffy's chat-opened reminder has
 * been handled - either the user asked for the check (called right after that
 * negotiation's own response comes back, not before, so a reload mid-check
 * doesn't silently drop the reminder) or explicitly declined it. Complements
 * that function's own automatic resync (ticket #70): this clears the flag on
 * explicit user interaction, that one keeps it in sync with reality
 * (including clearing it) as the underlying profile changes.
 */
export async function clearTargetsReviewPendingAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { error } = await supabase
    .from("user_profile")
    .update({ targets_review_pending: false, targets_review_changes: null })
    .eq("user_id", user.id);

  if (error) {
    logServerError("targets.clearReviewPending", "update_failed", { userId: user.id, error: error.message });
  }
}
