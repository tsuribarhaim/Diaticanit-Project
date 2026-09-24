"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { performTargetsLock } from "@/app/app/targets/actions";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import {
  evaluateCustomTargetQuickApplySafety,
  mapTargetProfileRowToPayload,
  targetGenerationPayloadSchema,
  TARGET_PROFILE_COLUMNS,
  type TargetGenerationPayload,
} from "@/lib/targets";
import { NUTRIENT_DIFF_FIELDS } from "@/lib/targets-diff";

/** Which single value on the plan a direct edit targets. Nutrients are
 * identified by their labelEn (stable, unique - see NUTRIENT_DIFF_FIELDS)
 * rather than the min/max column key pair directly, so the client only
 * ever needs to send one identifier. */
export type EditableFieldRef =
  | { kind: "nutrient"; labelEn: string }
  | { kind: "weight" }
  | { kind: "sleep" }
  | { kind: "steps" };

export type EditTargetFieldResult =
  | { applied: true; payload: TargetGenerationPayload }
  | { applied: false; outOfRange: true; lo: number; hi: number; unit: string; fieldLabelEn: string; fieldLabelHe: string; attempted: number }
  | { error: string };

/** Keeps a band's WIDTH but re-centers it on a newly-edited single value,
 * so the next edit still has a real (non-zero) band to be judged against
 * instead of every value becoming a hair-trigger "needs AI review" after
 * its first edit. Clamped at 0 - every field this is used for (nutrients,
 * sleep hours, steps) has a schema floor of 0, and a wide band centered
 * near that floor can otherwise recenter to a negative min (confirmed
 * live: editing Saturated Fat, band width ~26g, from 13g to 12g produced
 * satFatMinG = -1, which targetGenerationPayloadSchema correctly rejected
 * - surfacing as a generic "something went wrong" instead of the in-range
 * quick-save it should have been). Clamping only the floor (not also
 * capping the ceiling against each field's own upper bound) is enough to
 * fix that - an edit large enough to hit those much more generous caps
 * hasn't been observed and would go through the out-of-range/AI path
 * anyway once it's actually outside the *original* band. */
function recenterBand(oldMin: number, oldMax: number, newValue: number): { min: number; max: number } {
  const halfWidth = (oldMax - oldMin) / 2;
  const min = Math.max(0, newValue - halfWidth);
  const max = Math.max(min, newValue + halfWidth);
  return { min, max };
}

/**
 * Core "is this edit safe, and if so write it" logic - validates one
 * field's new value against its safe range (nutrient band, weight's live
 * ±10% rule, or sleep/steps plausibility bounds) and, if it's within
 * range, writes it immediately via performTargetsLock. Shared by two
 * callers that both need this exact same check: editTargetFieldAction
 * (a direct tap-to-edit on the Targets page) and the chat's own quick-
 * apply path in negotiateActiveTargetsAction (asking Daffy in plain
 * language for a literal single-field change, e.g. "reduce my weight
 * target by 1kg") - a direct edit and a chat-driven one should be judged
 * by the identical rule, not two separately-maintained copies of it.
 * Takes the caller's already-fetched profileRow/currentPayload rather
 * than fetching them itself, since both callers already have them for
 * their own purposes first.
 */
export async function applyOrCheckFieldEdit({
  supabase,
  userId,
  locale,
  profileRow,
  currentPayload,
  field,
  newValue,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  locale: AppLocale;
  profileRow: { weight_kg?: number | null };
  currentPayload: TargetGenerationPayload;
  field: EditableFieldRef;
  newValue: number;
}): Promise<EditTargetFieldResult> {
  if (!Number.isFinite(newValue)) {
    return { error: tr(locale, "Enter a valid number.", "יש להזין מספר תקין.") };
  }

  let nextPayload: TargetGenerationPayload;
  let goalText: string;

  if (field.kind === "nutrient") {
    const fieldInfo = NUTRIENT_DIFF_FIELDS.find((f) => f.labelEn === field.labelEn);
    if (!fieldInfo) {
      return { error: tr(locale, "Unknown field.", "שדה לא ידוע.") };
    }
    const lo = currentPayload[fieldInfo.minKey] as number;
    const hi = currentPayload[fieldInfo.maxKey] as number;
    if (newValue < lo || newValue > hi) {
      return { applied: false, outOfRange: true, lo, hi, unit: fieldInfo.unit, fieldLabelEn: fieldInfo.labelEn, fieldLabelHe: fieldInfo.labelHe, attempted: newValue };
    }
    const { min, max } = recenterBand(lo, hi, newValue);
    nextPayload = { ...currentPayload, [fieldInfo.minKey]: min, [fieldInfo.maxKey]: max };
    goalText = `Direct edit: ${fieldInfo.labelEn} set to ${newValue} ${fieldInfo.unit}.`;
  } else if (field.kind === "weight") {
    // The live ±10% rule: computed fresh from the most recently LOGGED
    // weight every time, never stored as fixed numbers - see the
    // onboarding-redesign design doc's own note on why (the reference
    // point itself keeps changing as the user logs new weigh-ins).
    const { data: latestReport } = await supabase
      .from("user_daily_reports")
      .select("reported_weight_kg")
      .eq("user_id", userId)
      .not("reported_weight_kg", "is", null)
      .order("report_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const referenceWeightKg = Number(latestReport?.reported_weight_kg ?? profileRow.weight_kg ?? 0);
    if (!referenceWeightKg || referenceWeightKg <= 0) {
      return {
        error: tr(
          locale,
          "Your current weight isn't on file yet, so this can't be checked. Log a weight in Daily Report first.",
          "המשקל הנוכחי שלך עדיין לא קיים במערכת, ולכן לא ניתן לבדוק זאת. יש לתעד משקל בדיווח היומי קודם.",
        ),
      };
    }
    const lo = referenceWeightKg * 0.9;
    const hi = referenceWeightKg * 1.1;
    if (newValue < lo || newValue > hi) {
      return {
        applied: false,
        outOfRange: true,
        lo,
        hi,
        unit: "kg",
        fieldLabelEn: "Target Weight",
        fieldLabelHe: "משקל יעד",
        attempted: newValue,
      };
    }
    const hasWeightEntry = currentPayload.userTargets.some((entry) => entry.id === "target_weight");
    const userTargets = hasWeightEntry
      ? currentPayload.userTargets.map((entry) =>
          entry.id === "target_weight" ? { ...entry, value: String(newValue), targetMin: newValue, targetMax: newValue } : entry,
        )
      : [
          ...currentPayload.userTargets,
          {
            id: "target_weight",
            label: tr(locale, "Target weight", "משקל יעד"),
            value: String(newValue),
            unit: "kg",
            targetMin: newValue,
            targetMax: newValue,
            higherIsBetter: true,
          },
        ];
    nextPayload = { ...currentPayload, targetWeightKg: newValue, userTargets };
    goalText = `Direct edit: target weight set to ${newValue} kg.`;
  } else {
    const entryId = field.kind === "sleep" ? "sleep_hours" : "daily_steps";
    const existing = currentPayload.userTargets.find((e) => e.id === entryId);
    // A plan generated before weight/sleep/steps became standing, always-
    // included user_targets entries (see the AI prompt's "STANDING and
    // always required" rule) may not have this entry yet - rather than
    // erroring, this is exactly a first-time set: fall back to the same
    // label/unit/band-width defaults the heuristic generator itself uses
    // for a fresh plan (lib/targets.ts), so the entry this creates is
    // indistinguishable from one that had always been there.
    const label = existing?.label ?? (field.kind === "sleep" ? tr(locale, "Sleep duration", "משך שינה") : tr(locale, "Daily steps", "צעדים יומיים"));
    const unit = existing?.unit ?? (field.kind === "sleep" ? "hours" : "steps");
    const rejection = evaluateCustomTargetQuickApplySafety({ unit, targetMin: newValue, targetMax: newValue }, locale);
    if (rejection) {
      const plausibleRange = field.kind === "sleep" ? { lo: 3, hi: 14 } : { lo: 500, hi: 40000 };
      return {
        applied: false,
        outOfRange: true,
        lo: plausibleRange.lo,
        hi: plausibleRange.hi,
        unit,
        fieldLabelEn: label,
        fieldLabelHe: label,
        attempted: newValue,
      };
    }
    const defaultHalfWidth = field.kind === "sleep" ? 1 : 1500;
    const { min, max } =
      existing?.targetMin !== undefined && existing?.targetMax !== undefined
        ? recenterBand(existing.targetMin, existing.targetMax, newValue)
        : { min: Math.max(0, newValue - defaultHalfWidth), max: newValue + defaultHalfWidth };
    const userTargets = existing
      ? currentPayload.userTargets.map((e) => (e.id === entryId ? { ...e, value: String(newValue), targetMin: min, targetMax: max } : e))
      : [...currentPayload.userTargets, { id: entryId, label, value: String(newValue), unit, targetMin: min, targetMax: max, higherIsBetter: true }];
    nextPayload = { ...currentPayload, userTargets };
    goalText = `Direct edit: ${label} set to ${newValue} ${unit}.`;
  }

  const validated = targetGenerationPayloadSchema.safeParse(nextPayload);
  if (!validated.success) {
    logServerError("targets.editField", "invalid_payload", { userId, error: validated.error.message });
    return {
      error: tr(locale, "Something went wrong applying that change. Please try again.", "משהו השתבש בהחלת השינוי. יש לנסות שוב."),
    };
  }

  const result = await performTargetsLock({
    supabase,
    userId,
    goalText,
    source: "heuristic",
    payload: validated.data,
  });

  if ("error" in result) {
    return { error: result.error };
  }

  revalidatePath("/app");
  revalidatePath("/app/targets");
  revalidatePath("/app/daily-report");
  return { applied: true, payload: validated.data };
}

/**
 * Server action wrapper around applyOrCheckFieldEdit for the Targets
 * page's own tap-to-edit UI - handles auth and fetching the profile/
 * active-plan rows this specific call site needs, then delegates the
 * actual range-check-and-write logic to the shared function above.
 */
export async function editTargetFieldAction({
  field,
  newValue,
}: {
  field: EditableFieldRef;
  newValue: number;
}): Promise<EditTargetFieldResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const [{ data: profileRow }, { data: activeRow, error: activeError }] = await Promise.all([
    supabase.from("user_profile").select("preferred_language, weight_kg").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_target_profiles").select(TARGET_PROFILE_COLUMNS).eq("user_id", user.id).eq("is_active", true).maybeSingle(),
  ]);

  // profileRow's own preferred_language is enough to localize every error
  // below even when activeRow is missing - normalizeLocale already
  // tolerates a null/undefined profileRow (falls back to "en").
  const locale = normalizeLocale(profileRow?.preferred_language);

  if (activeError || !activeRow || !profileRow) {
    return { error: tr(locale, "Your current targets could not be found. Please refresh the page.", "לא ניתן למצוא את היעדים הנוכחיים שלך. יש לרענן את הדף.") };
  }

  const currentPayload = mapTargetProfileRowToPayload(activeRow);

  return applyOrCheckFieldEdit({ supabase, userId: user.id, locale, profileRow, currentPayload, field, newValue });
}
