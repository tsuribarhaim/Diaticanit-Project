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
  recenterBand,
  targetGenerationPayloadSchema,
  toProfileForTargets,
  TARGET_PROFILE_COLUMNS,
  type ExplicitFieldRequest,
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
  "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, alcohol_weekly_frequency, smoking_status, smoking_cigarettes_range, caffeine_cups_per_day, pregnancy_lactation_status, hot_climate_or_heavy_sweating, preferred_language, first_name, nutritional_goal";

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
  // Carried into the full review below when a quick-apply resolved to
  // exactly one nutrient + one number but that number fell outside the
  // field's safe range - see ExplicitFieldRequest's own comment (lib/
  // targets.ts) for why this is threaded through explicitly instead of
  // being discarded (which is what let the full-review AI call silently
  // apply a THIRD, different number than either the user's ask or its own
  // stated explanation - confirmed live via tickets #74/#95). Scoped to
  // nutrient fields only: weight already has its own independent,
  // deterministic safety check (evaluateTargetWeightSafety) that runs
  // regardless, and sleep/steps aren't the reported failure mode.
  let explicitFieldRequest: ExplicitFieldRequest | undefined;

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
          if (field.kind === "nutrient") {
            explicitFieldRequest = {
              fieldLabelEn: editResult.fieldLabelEn,
              fieldLabelHe: editResult.fieldLabelHe,
              unit: editResult.unit,
              requestedValue: editResult.attempted,
              currentLo: editResult.lo,
              currentHi: editResult.hi,
            };
          }
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
      explicitFieldRequest,
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
  explicitFieldRequest,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  requestId: string;
  goalText: string;
  profile: ProfileForTargets;
  locale: AppLocale;
  aiConfig: ReturnType<typeof getAiExtractionConfig>;
  hasConsent: boolean;
  /** See ExplicitFieldRequest's own comment (lib/targets.ts). Bounds are
   * re-derived fresh below against this function's own just-fetched
   * activeRow rather than trusting the ones captured back when the chat
   * message first came in - closes a narrow staleness gap if the active
   * plan changed in between. */
  explicitFieldRequest?: ExplicitFieldRequest;
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

    const explicitFieldNutrientInfo = explicitFieldRequest
      ? NUTRIENT_DIFF_FIELDS.find((f) => f.labelEn === explicitFieldRequest.fieldLabelEn)
      : undefined;
    const effectiveFieldRequest: ExplicitFieldRequest | undefined =
      explicitFieldRequest && explicitFieldNutrientInfo
        ? {
            ...explicitFieldRequest,
            currentLo: currentTargets[explicitFieldNutrientInfo.minKey] as number,
            currentHi: currentTargets[explicitFieldNutrientInfo.maxKey] as number,
          }
        : undefined;

    const {
      payload: rawPayload,
      source,
      safetyRejectionMessage,
      notActionableMessage,
      explicitFieldRejectionMessage,
    } = await generateTargetsPayload({
      goalText,
      profile,
      locale,
      aiConfig,
      hasConsent,
      currentTargets,
      explicitFieldRequest: effectiveFieldRequest,
      supabase,
      userId,
    });

    // Supersession check: if a newer FULL-REVIEW request has replaced this
    // one while the AI call was running, discard silently - that newer
    // request's own background review will report back once IT finishes.
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

    // Staleness check: the supersession check above only catches another
    // QUEUED request racing this one - it says nothing about a quick-apply
    // (a direct edit, or a chat ask that resolved to one field) written
    // in the meantime, since quick-apply never touches
    // user_target_update_requests at all. Confirmed live as a real bug:
    // a quick-apply protein change was silently overwritten by a slower,
    // already-in-flight full review completing afterward, with the
    // review's own notification not even mentioning protein, since its
    // snapshot (activeRow, captured at the very start of this function)
    // predated the quick-apply. The fix: re-check the active row's id
    // right before acting on anything computed from that now-possibly-
    // stale snapshot - if it moved, something else was written while this
    // review was thinking, and applying our stale result now would
    // silently discard it. Never silently overwrite something the user
    // already saw applied.
    const { data: currentActiveRow } = await supabase
      .from("user_target_profiles")
      .select("id, version")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (currentActiveRow?.id !== activeRow.id) {
      await createNotification({
        supabase,
        userId,
        targetProfileId: currentActiveRow?.id ?? activeRow.id,
        severity: "info",
        message: tr(
          locale,
          `I reviewed version ${currentTargets.version ?? "?"}, but your plan is now at version ${currentActiveRow?.version ?? "?"} - it changed while I was thinking this over, so I didn't want to risk overwriting your update. Ask me to take another look if you'd still like a full review.`,
          `בדקתי את גרסה ${currentTargets.version ?? "?"}, אך התוכנית שלך נמצאת כעת בגרסה ${currentActiveRow?.version ?? "?"} - היא השתנתה בזמן שחשבתי על כך, ולכן לא רציתי לסכן דריסה של העדכון שלך. אפשר לבקש ממני לבדוק שוב אם עדיין תרצה/י סקירה מלאה.`,
        ),
        fieldKeys: [],
      });
      await markComplete("failed");
      return;
    }

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

    if (explicitFieldRejectionMessage && effectiveFieldRequest) {
      // Binary accept/reject for the one field the user explicitly asked
      // about (see ExplicitFieldRequest's own comment) - a reject here
      // means that field was NOT touched at all, never a negotiated
      // substitute number. Framed with the field/value named explicitly
      // since the model's own reason text doesn't necessarily restate
      // what was being asked about.
      await createNotification({
        supabase,
        userId,
        targetProfileId: activeRow.id,
        severity: "concern",
        message: tr(
          locale,
          `I didn't change ${effectiveFieldRequest.fieldLabelEn} to ${effectiveFieldRequest.requestedValue} ${effectiveFieldRequest.unit} as asked: ${explicitFieldRejectionMessage}`,
          `לא שיניתי את ${effectiveFieldRequest.fieldLabelHe} ל-${effectiveFieldRequest.requestedValue} ${effectiveFieldRequest.unit} כפי שהתבקש: ${explicitFieldRejectionMessage}`,
        ),
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

    // Binary accept path: never trust the model's own number for the field
    // it was explicitly asked about (see ExplicitFieldRequest's own
    // comment) - force the user's exact literal requested value in, the
    // same recentering logic the quick-apply edit path itself uses, so the
    // eventual diff/notification shows precisely what was asked for and
    // nothing else.
    let payloadWithExplicitField: TargetGenerationPayload = rawPayload;
    if (effectiveFieldRequest && explicitFieldNutrientInfo) {
      const { min, max } = recenterBand(
        effectiveFieldRequest.currentLo,
        effectiveFieldRequest.currentHi,
        effectiveFieldRequest.requestedValue,
      );
      payloadWithExplicitField = { ...rawPayload, [explicitFieldNutrientInfo.minKey]: min, [explicitFieldNutrientInfo.maxKey]: max };
    }

    const validatedPayload = targetGenerationPayloadSchema.safeParse(payloadWithExplicitField);
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
          `I reviewed version ${currentTargets.version ?? "?"} and your targets are still accurate as-is - no changes needed.`,
          `בדקתי את גרסה ${currentTargets.version ?? "?"} והיעדים שלך עדיין מדויקים כפי שהם - אין צורך בשינויים.`,
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
    const updatedLabel = tr(
      locale,
      `Updated (version ${currentTargets.version ?? "?"} → ${lockResult.version}):`,
      `עודכן (גרסה ${currentTargets.version ?? "?"} → ${lockResult.version}):`,
    );
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
