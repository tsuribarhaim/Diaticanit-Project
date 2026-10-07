"use client";

import { Fragment, useState } from "react";

import { negotiateActiveTargetsAction } from "@/app/app/targets/plan-actions";
import { editTargetFieldAction, type EditableFieldRef } from "@/app/app/targets/edit-actions";
import { InfoPopoverButton } from "@/components/info-popover";
import { formatExerciseModality, formatMeasurementUnit, formatNumberForLocale, tr, type AppLocale } from "@/lib/locale";
import { getNutrientReference } from "@/lib/nutrient-reference";
import type { TargetGenerationPayload } from "@/lib/targets";
import { ORDERED_NUTRIENT_FIELDS } from "@/components/targets-plan-view";

/** UserTargetEntry.value is free text (some entries are genuinely
 * descriptive, e.g. a habit's "2 drinks/week", not every entry is meant to
 * be a clean number) - this is the one boundary where a "should be
 * numeric" entry (sleep/steps/weight) gets treated as one, converting
 * anything that doesn't actually parse into null rather than letting
 * Number(...) produce NaN and render as the literal text "NaN". */
function parseNumericOrNull(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const num = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(num) ? num : null;
}

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

type Banner =
  | { phase: "outOfRange"; lo: number; hi: number; unit: string; attempted: number; fieldLabelEn: string; fieldLabelHe: string }
  | { phase: "checking" }
  | { phase: "error"; text: string }
  /** Daffy's full review is running in the background and will auto-apply
   * + notify once done - nothing left to approve here, just acknowledge. */
  | { phase: "queued"; text: string };

type FieldState = {
  editing: boolean;
  draft: string;
  banner: Banner | null;
  /** editTargetFieldAction in flight - the field stays open showing a
   * spinner (instead of closing right away onto the old value with no
   * sign anything was happening) and ignores repeat taps until it answers. */
  saving: boolean;
};

const emptyFieldState: FieldState = { editing: false, draft: "", banner: null, saving: false };

/** A tappable value that turns into a number input + save/cancel icons.
 * Defined at module scope (not nested inside TargetsPlanEditor) so its
 * component identity stays stable across re-renders - a component defined
 * inside another component's render function gets recreated every render,
 * which would unmount/remount this input (and drop focus) on every single
 * keystroke, since typing itself triggers the state update that causes
 * the re-render. */
function EditableValue({
  state,
  locale,
  value,
  unit,
  decimals,
  variant,
  onStartEdit,
  onDraftChange,
  onConfirm,
  onCancel,
}: {
  state: FieldState;
  locale: AppLocale;
  /** null when this target has never had a real number set (an older
   * entry saved before this field was numeric, or one the AI left as
   * descriptive text) - shown as a placeholder instead of the
   * formatNumberForLocale(NaN, ...) that used to render literally as
   * "NaN" (confirmed live: sleep duration and steps showed "NaN" for an
   * account whose plan predated this). Still tappable - editing it sets a
   * real value for the first time, going through the same in-range/AI
   * gate any other edit does. */
  value: number | null;
  unit: string;
  decimals: number;
  variant: "card" | "row";
  onStartEdit: () => void;
  onDraftChange: (draft: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (state.editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          type="number"
          step={decimals > 0 ? 10 ** -decimals : 1}
          value={state.draft}
          autoFocus
          readOnly={state.saving}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (state.saving) return;
            if (event.key === "Enter") onConfirm();
            if (event.key === "Escape") onCancel();
          }}
          className={`rounded-lg border border-teal-600 bg-white px-2 py-1 text-sm font-bold outline-none ring-teal-600 focus:ring-2 dark:bg-slate-900 dark:text-slate-100 ${variant === "card" ? "w-24" : "w-20 text-end"}`}
        />
        <button
          type="button"
          onClick={onConfirm}
          disabled={state.saving}
          aria-busy={state.saving}
          aria-label={tr(locale, "Save", "שמירה")}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
        >
          {state.saving ? (
            <Spinner className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={state.saving}
          aria-label={tr(locale, "Cancel", "ביטול")}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onStartEdit}
      className="group inline-flex items-center gap-1 rounded-lg border border-transparent px-1.5 py-0.5 hover:border-slate-300 hover:bg-white dark:hover:border-slate-700 dark:hover:bg-slate-900"
    >
      <span>
        {value === null ? (
          <span className="italic text-slate-400 dark:text-slate-500">{tr(locale, "Not set yet", "עדיין לא הוגדר")}</span>
        ) : (
          <>
            {formatNumberForLocale(value, locale, { maximumFractionDigits: decimals })}
            {/* The table-row variant shows its unit via a sibling span in
               the caller instead (lines up in its own narrower column);
               only the card variant (standing targets) needs it inline
               here. */}
            {variant === "card" ? <span className="ms-1 text-sm font-normal text-teal-700 dark:text-teal-400">{unit}</span> : null}
          </>
        )}
      </span>
      <svg
        className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}

/** The out-of-range / checking / result banner shown under a field being
 * edited - also hoisted to module scope for the same reason as
 * EditableValue above. */
function BannerView({
  banner,
  locale,
  onAskDaffy,
  onDismiss,
}: {
  banner: Banner | null;
  locale: AppLocale;
  onAskDaffy: () => void;
  onDismiss: () => void;
}) {
  if (!banner) return null;

  if (banner.phase === "outOfRange") {
    return (
      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
        <p className="font-semibold text-amber-900 dark:text-amber-300">
          {tr(locale, "That's outside the usual range", "זה חורג מהטווח הרגיל")}
        </p>
        <p className="mt-1 text-amber-800 dark:text-amber-400">
          {formatNumberForLocale(banner.attempted, locale)} {formatMeasurementUnit(banner.unit, locale)}{" "}
          {tr(locale, "is outside", "חורג מ-")}{" "}
          {formatNumberForLocale(banner.lo, locale)}–{formatNumberForLocale(banner.hi, locale)}{" "}
          {formatMeasurementUnit(banner.unit, locale)}.{" "}
          {tr(
            locale,
            "Want Daffy to check what this changes elsewhere in your plan?",
            "רוצה ש-Daffy תבדוק מה זה משנה בשאר התכנית?",
          )}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onAskDaffy}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            {tr(locale, "Yes, ask Daffy", "כן, שאל את Daffy")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {tr(locale, "Cancel", "ביטול")}
          </button>
        </div>
      </div>
    );
  }

  if (banner.phase === "checking") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
        <Spinner className="h-3.5 w-3.5 animate-spin" />
        {tr(locale, "Daffy is checking the impact…", "Daffy בודקת את ההשפעה…")}
      </div>
    );
  }

  if (banner.phase === "error") {
    return (
      <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
        <p>{banner.text}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/60"
        >
          {tr(locale, "Dismiss", "סגור")}
        </button>
      </div>
    );
  }

  // "queued" phase - the full review is running in the background; it
  // auto-applies and notifies once done, so this just acknowledges.
  return (
    <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs dark:border-emerald-800 dark:bg-emerald-950/30">
      <p className="text-emerald-900 dark:text-emerald-300">{banner.text}</p>
      <div className="mt-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
        >
          {tr(locale, "OK", "אישור")}
        </button>
      </div>
    </div>
  );
}

/**
 * The editable counterpart to TargetsPlanView (read-only, used by
 * onboarding) - same layout, but every nutrient and standing target can be
 * tapped to edit. An in-range edit writes immediately via
 * editTargetFieldAction; an out-of-range one shows an inline banner asking
 * whether to have Daffy check the impact, and only writes once the user
 * taps Apply on Daffy's actual response - mirrors the mockup the user
 * approved before this was built. Only used by the standalone /app/targets
 * page - onboarding's own Targets step stays read-only plus its
 * whole-plan chat, since editing individual values mid-onboarding wasn't
 * part of that flow's design.
 */
export function TargetsPlanEditor({
  payload,
  locale,
  onPayloadUpdated,
  onDaffyMessage,
}: {
  payload: TargetGenerationPayload;
  locale: AppLocale;
  onPayloadUpdated: (payload: TargetGenerationPayload) => void;
  onDaffyMessage: (content: string) => void;
}) {
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({});

  function getState(key: string): FieldState {
    return fieldStates[key] ?? emptyFieldState;
  }
  function patchState(key: string, patch: Partial<FieldState>) {
    setFieldStates((previous) => ({ ...previous, [key]: { ...(previous[key] ?? emptyFieldState), ...patch } }));
  }

  function startEdit(key: string, currentValue: number | null) {
    patchState(key, { editing: true, draft: currentValue === null ? "" : String(currentValue), banner: null });
  }
  function cancelEdit(key: string) {
    patchState(key, { editing: false, draft: "" });
  }

  async function confirmEdit(key: string, field: EditableFieldRef, decimals: number) {
    const state = getState(key);
    if (state.saving) return;
    const raw = Number.parseFloat(state.draft);
    if (!Number.isFinite(raw)) {
      cancelEdit(key);
      return;
    }
    const rounded = decimals > 0 ? Math.round(raw * 10 ** decimals) / 10 ** decimals : Math.round(raw);

    patchState(key, { saving: true });
    let result: Awaited<ReturnType<typeof editTargetFieldAction>>;
    try {
      result = await editTargetFieldAction({ field, newValue: rounded });
    } finally {
      patchState(key, { editing: false, saving: false });
    }

    if ("error" in result) {
      patchState(key, { banner: { phase: "error", text: result.error } });
      return;
    }

    if (result.applied) {
      onPayloadUpdated(result.payload);
      patchState(key, { banner: null });
      return;
    }

    patchState(key, {
      banner: {
        phase: "outOfRange",
        lo: result.lo,
        hi: result.hi,
        unit: result.unit,
        attempted: result.attempted,
        fieldLabelEn: result.fieldLabelEn,
        fieldLabelHe: result.fieldLabelHe,
      },
    });
  }

  function dismissBanner(key: string) {
    patchState(key, { banner: null });
  }

  async function askDaffy(key: string, banner: { attempted: number; unit: string; fieldLabelEn: string }) {
    patchState(key, { banner: { phase: "checking" } });

    const message = `I'd like to change my ${banner.fieldLabelEn} target to ${banner.attempted} ${banner.unit}.`;
    const result = await negotiateActiveTargetsAction({ message });

    if ("error" in result) {
      patchState(key, { banner: { phase: "error", text: result.error } });
      return;
    }

    onDaffyMessage(result.reply);

    if (result.quickApplied) {
      onPayloadUpdated(result.payload);
      patchState(key, { banner: null });
      return;
    }

    patchState(key, { banner: { phase: "queued", text: result.reply } });
  }

  const weightEntry = payload.userTargets.find((entry) => entry.id === "target_weight");
  const sleepEntry = payload.userTargets.find((entry) => entry.id === "sleep_hours");
  const stepsEntry = payload.userTargets.find((entry) => entry.id === "daily_steps");
  // These three cards always render, even when the underlying plan (one
  // generated before weight/sleep/steps became standing, always-included
  // user_targets entries - see the AI prompt's own "STANDING and always
  // required" rule) doesn't actually have the entry yet: weight falls back
  // to the payload's own top-level targetWeightKg (a separate field,
  // always present once any weight goal exists), and sleep/steps fall back
  // to "Not set yet" - still tappable, which creates the entry for the
  // first time via applyOrCheckFieldEdit's own fallback for a missing id.
  const weightLabel = weightEntry?.label ?? tr(locale, "Target weight", "משקל יעד");
  const sleepLabel = sleepEntry?.label ?? tr(locale, "Sleep duration", "משך שינה");
  const stepsLabel = stepsEntry?.label ?? tr(locale, "Daily steps", "צעדים יומיים");
  const otherEntries = payload.userTargets.filter(
    (entry) => entry.id !== "target_weight" && entry.id !== "sleep_hours" && entry.id !== "daily_steps",
  );

  /** Weight/Sleep/Steps, as a table row matching the nutrient rows exactly
   * (name cell + right-aligned EditableValue) - these used to be their own
   * teal card row above a separate nutrients table; merged into one table
   * with two sections (this one under "Personal Targets", nutrients under
   * "Daily nutrition targets" right after) per the approved mockup. Same
   * underlying edit mechanism as before (EditableValue + confirmEdit/
   * cancelEdit), same out-of-range banner row beneath - only the visual
   * container changed, not the interaction. No InfoPopoverButton here (no
   * reference.roleDescription/foodExamples exists for these three), so the
   * name is always the same plain, non-interactive span the nutrient rows
   * themselves fall back to when they have no reference info either. */
  function standingRow(key: string, field: EditableFieldRef, label: string, value: number | null, unit: string, decimals: number) {
    const state = getState(key);
    return (
      <Fragment key={key}>
        <tr className="border-t border-slate-100 dark:border-slate-800">
          <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">
            <span className="inline-flex items-center gap-1.5">{label}</span>
          </td>
          <td className="px-4 py-2 text-end font-bold text-teal-800 dark:text-teal-300">
            <span className="flex w-full items-center justify-end gap-1">
              <EditableValue
                state={state}
                locale={locale}
                value={value}
                unit={formatMeasurementUnit(unit, locale)}
                decimals={decimals}
                variant="row"
                onStartEdit={() => startEdit(key, value)}
                onDraftChange={(draft) => patchState(key, { draft })}
                onConfirm={() => void confirmEdit(key, field, decimals)}
                onCancel={() => cancelEdit(key)}
              />
              <span className="text-xs font-normal text-slate-500">{formatMeasurementUnit(unit, locale)}</span>
            </span>
          </td>
        </tr>
        {state.banner ? (
          <tr>
            <td colSpan={2} className="px-4 pb-3">
              <BannerView
                banner={state.banner}
                locale={locale}
                onAskDaffy={() => state.banner?.phase === "outOfRange" && void askDaffy(key, state.banner)}
                onDismiss={() => dismissBanner(key)}
              />
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }

  /** Shared styling for both section dividers below (Personal Targets,
   * Daily nutrition targets) - one continuous table now, not a card row
   * plus a separately-headed table, per the approved mockup. */
  const sectionRowClassName =
    "border-t border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400";

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td colSpan={2} className={`${sectionRowClassName} border-t-0`}>
                {tr(locale, "Personal targets", "יעדים אישיים")}
              </td>
            </tr>
            {standingRow("weight", { kind: "weight" }, weightLabel, payload.targetWeightKg ?? parseNumericOrNull(weightEntry?.value), "kg", 1)}
            {standingRow("sleep", { kind: "sleep" }, sleepLabel, parseNumericOrNull(sleepEntry?.value), "h", 1)}
            {standingRow("steps", { kind: "steps" }, stepsLabel, parseNumericOrNull(stepsEntry?.value), "steps", 0)}

            <tr>
              <td colSpan={2} className={sectionRowClassName}>
                {tr(locale, "Daily nutrition targets", "יעדי תזונה יומיים")}
              </td>
            </tr>
            {/* text-start, not the old thead's literal text-left carried
                over from before this became a plain in-table row (reported
                live: "Nutrient" sat at the left edge of its own column
                while every actual nutrient name below it - plain start-
                aligned text, no override - sits at that column's right
                edge instead, so the header visibly didn't line up with its
                own data). "Target" already used the matching logical
                text-end and needed no change. */}
            <tr className="text-start text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <td className="px-4 py-2">{tr(locale, "Nutrient", "רכיב תזונתי")}</td>
              <td className="px-4 py-2 text-end">{tr(locale, "Target", "יעד")}</td>
            </tr>
            {ORDERED_NUTRIENT_FIELDS.map((field) => {
              const min = payload[field.minKey] as number;
              const max = payload[field.maxKey] as number;
              const singleValue = Math.round((min + max) / 2);
              const fieldKey = field.labelEn;
              const state = getState(fieldKey);
              const fieldRef: EditableFieldRef = { kind: "nutrient", labelEn: field.labelEn };
              const reference = getNutrientReference(field.id);
              return (
                <Fragment key={fieldKey}>
                  <tr className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">
                      {/* TCK-64 follow-up: was the label plus a separate "?"
                          trigger next to it - with labels ranging from
                          "אבץ" to "סיבים תזונתיים", that second element
                          never lined up consistently row to row (reported
                          as "all over the place"). Removed here rather than
                          moved elsewhere - the label itself is now the
                          trigger, one fewer element in the row and nothing
                          left to misalign. Falls back to plain (non-
                          interactive) text when a row has no reference info
                          to show (reference is null) - see the fallback
                          span's own comment on why it still needs the same
                          gap-1.5 layout treatment as the InfoPopoverButton. */}
                      {reference ? (
                        <InfoPopoverButton
                          ariaLabel={tr(locale, "More information", "מידע נוסף")}
                          title={reference.nameLabel[locale]}
                          triggerContent={
                            <span className="inline-flex items-center gap-1.5 underline decoration-dotted decoration-slate-400 underline-offset-4 dark:decoration-slate-500">
                              {tr(locale, field.labelEn, field.labelHe)}
                            </span>
                          }
                          triggerClassName="inline-block border-0 bg-transparent p-0 m-0 cursor-help text-start font-medium text-slate-800 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-slate-200 dark:hover:text-teal-400"
                          panelWidthClassName="sm:w-64"
                        >
                          {/* TCK-64 follow-up: the "Full daily range" section
                              that used to open this panel is gone - min/max
                              is already the exact same range the row's own
                              target number (min+max)/2 was built from, and
                              todays_logged_totals/the goal bar already show
                              the number that matters against it, so
                              repeating a second, different-looking number
                              here read as conflicting rather than useful. */}
                          <p className="font-semibold text-amber-900 dark:text-amber-400">{tr(locale, "Role", "תפקיד")}</p>
                          <p className="mt-1">{reference.roleDescription[locale]}</p>
                          <p className="mt-2 font-semibold text-amber-900 dark:text-amber-400">{tr(locale, "Food examples", "דוגמאות מזון")}</p>
                          <p className="mt-1">{reference.foodExamples[locale]}</p>
                        </InfoPopoverButton>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">{tr(locale, field.labelEn, field.labelHe)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-end font-bold text-teal-800 dark:text-teal-300">
                      {/* TCK-64: block-level flex with an explicit
                          justify-end, not inline-flex relying on the td's
                          own text-end - an inline-flex box here sat flush
                          against the cell's LEFT edge regardless of content
                          width (confirmed live via getBoundingClientRect:
                          every row's left edge landed at the same x, while
                          the right edge - where the actual digits are -
                          drifted per row's own digit count), so numbers
                          across rows never lined up into a real column.
                          w-full + justify-end pins the whole cluster to the
                          cell's right edge explicitly, independent of
                          whatever text-align inside a table cell was doing. */}
                      <span className="flex w-full items-center justify-end gap-1">
                        <EditableValue
                          state={state}
                          locale={locale}
                          value={singleValue}
                          unit={formatMeasurementUnit(field.unit, locale)}
                          decimals={0}
                          variant="row"
                          onStartEdit={() => startEdit(fieldKey, singleValue)}
                          onDraftChange={(draft) => patchState(fieldKey, { draft })}
                          onConfirm={() => void confirmEdit(fieldKey, fieldRef, 0)}
                          onCancel={() => cancelEdit(fieldKey)}
                        />
                        <span className="text-xs font-normal text-slate-500">{formatMeasurementUnit(field.unit, locale)}</span>
                      </span>
                    </td>
                  </tr>
                  {state.banner ? (
                    <tr>
                      <td colSpan={2} className="px-4 pb-3">
                        <BannerView
                          banner={state.banner}
                          locale={locale}
                          onAskDaffy={() => state.banner?.phase === "outOfRange" && void askDaffy(fieldKey, state.banner)}
                          onDismiss={() => dismissBanner(fieldKey)}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {otherEntries.length > 0 ? (
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {tr(locale, "Also tracking", "עוקבים גם אחרי")}
          </p>
          <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            {otherEntries.map((entry) => (
              <p key={entry.id ?? entry.label}>
                <span className="font-medium">{entry.label}:</span> {entry.value}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {payload.exerciseTargets.length > 0 ? (
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {tr(locale, "Suggested exercise plan", "תכנית פעילות מוצעת")}
          </p>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
            {payload.exerciseTargets.map((entry, index) => (
              <div
                key={`${entry.modality}-${index}`}
                className="flex min-h-[80px] flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60"
              >
                <div>
                  {/* TCK-90 round 2: same fix as targets-plan-view.tsx's
                      identical card (this file duplicates that markup) -
                      activityName takes over the heading for a named
                      "other" activity, and the caption now shows
                      aiAdjustmentNote (always in the reply language)
                      instead of searchKeywords[0] (deliberately always
                      English - a YouTube search query, not user-facing
                      prose - see lib/ai/targets.ts's own language rule). */}
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {entry.activityName || formatExerciseModality(entry.modality, locale)}
                  </p>
                  {entry.aiAdjustmentNote ? (
                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">{entry.aiAdjustmentNote}</p>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {entry.frequencyPerWeek}x/{tr(locale, "week", "שבוע")} · {entry.durationMinutesPerSession} {tr(locale, "min", "דק'")}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
