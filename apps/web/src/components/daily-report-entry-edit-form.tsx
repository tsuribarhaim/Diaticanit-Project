"use client";

import { useRef, useState } from "react";

import { adjustDailyReportItemQuantitiesAction } from "@/app/app/daily-report/actions";
import { formatDefaultUnit, formatMeasurementUnit, tr, trGendered, type AppLocale } from "@/lib/locale";

type EditableFoodItem = { index: number; name: string; quantity: number; unit: string };
type EditableExerciseItem = { index: number; name: string; minutes: number };
type EditableCustomTarget = { id: string; label: string; unit: string; value: number };
type EditableNutrientField = {
  dbColumn: string;
  labelEn: string;
  labelHe: string;
  unit: string;
  value: number;
  /** Whether this field is currently pinned to a manually-entered value
   * (see nutrient_overrides on the report row) rather than automatically
   * derived from this report's own items - shown as a small badge so it's
   * clear why, say, calories didn't change after an item edit. */
  overridden: boolean;
};

function PencilIcon({ className }: { className: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M16.862 4.487a2.06 2.06 0 1 1 2.915 2.914L7.5 19.68l-4 1 1-4L16.862 4.487Z" />
      <path d="M15 6.5 17.5 9" />
    </svg>
  );
}

function TrashIcon({ className }: { className: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * The full "Edit" form for one already-saved daily-report entry - weight,
 * custom targets (sleep, etc.), per-item quantities (with a delete button
 * per row), and now the report's own nutrient totals directly. All of it
 * posts to the same adjustDailyReportItemQuantitiesAction the simpler
 * quantity-only version always has; the only genuinely new server-side
 * behavior is nutrient_value__<column>[__touched] (see that action's own
 * comment on why "touched" has to be tracked explicitly here rather than
 * inferred from the submitted number differing from the current one).
 *
 * A client component (not the plain <form action={...}> the old version
 * got away with) specifically because "touched" tracking and the delete
 * buttons both need real interactivity - clicking delete has to visibly
 * cross out a row before Save is even pressed, and a nutrient field has to
 * know the difference between "the user typed in this box" and "this box
 * still shows what it loaded with" to decide whether to pin it.
 */
export function DailyReportEntryEditForm({
  locale,
  reportId,
  selectedDateParam,
  hasWeight,
  reportedWeightKg,
  customTargets,
  foodItems,
  exerciseItems,
  nutrientFields,
  userGender,
}: {
  locale: AppLocale;
  reportId: string;
  selectedDateParam?: string;
  hasWeight: boolean;
  reportedWeightKg: number | null;
  customTargets: EditableCustomTarget[];
  foodItems: EditableFoodItem[];
  exerciseItems: EditableExerciseItem[];
  nutrientFields: EditableNutrientField[];
  /** For the singular, gender-correct Hebrew footnote below (see
   * lib/ai/persona.ts's resolveUserGenderForAddressing) - null/unknown
   * falls back to the male form, same convention used everywhere else. */
  userGender?: "male" | "female" | null;
}) {
  // Keyed "food-<index>" / "exercise-<index>" - a deleted row stays in the
  // DOM (still submits, as a hidden 0-quantity field the server already
  // treats as "remove this item" - see adjustDailyReportItemQuantitiesAction's
  // own flatMap) but renders struck through with an Undo instead of its
  // normal editable fields, so nothing is actually gone until Save is
  // pressed.
  const [deletedRows, setDeletedRows] = useState<Set<string>>(new Set());
  const [touchedNutrients, setTouchedNutrients] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);

  function toggleDeleted(key: string) {
    setDeletedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * Discards every change made since this form opened and collapses it back
   * to the read-only view, without submitting anything. Undoing the delete
   * marks and the nutrient "touched" flags is state this component owns
   * directly; the actual input *values* (weight, quantities, nutrient
   * numbers typed over their loaded defaults) aren't React state at all
   * here (plain uncontrolled defaultValue inputs) - form.reset() is the
   * native browser behavior that reverts exactly those back to their
   * original defaultValue in one call, so there's no need to track every
   * field's own dirty value separately just to be able to undo it.
   * closest("details") reaches the <details> this form's own summary/
   * trigger lives in - owned by the server-rendered parent page, not this
   * component, but a plain DOM lookup like this needs no ref passed down
   * across that boundary to close it.
   */
  function handleCancel(event: React.MouseEvent<HTMLButtonElement>) {
    setDeletedRows(new Set());
    setTouchedNutrients(new Set());
    formRef.current?.reset();
    const details = event.currentTarget.closest("details");
    if (details) details.open = false;
  }

  return (
    <form
      ref={formRef}
      action={adjustDailyReportItemQuantitiesAction}
      className="mt-2 w-full space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3"
    >
      <input type="hidden" name="report_id" value={reportId} />
      {selectedDateParam ? <input type="hidden" name="selected_date" value={selectedDateParam} /> : null}

      {hasWeight ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-[120px] flex-1 text-xs text-slate-700">{tr(locale, "Weight", "משקל")}</span>
          <input
            type="number"
            name="reported_weight_kg"
            min={20}
            max={400}
            step="0.1"
            inputMode="decimal"
            defaultValue={reportedWeightKg ?? undefined}
            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none ring-teal-600 focus:ring-2"
          />
          <span className="text-xs text-slate-500">{formatMeasurementUnit("kg", locale)}</span>
        </div>
      ) : null}

      {customTargets.map((target) => (
        <div key={target.id} className="flex flex-wrap items-center gap-2">
          <span className="min-w-[120px] flex-1 text-xs text-slate-700">{target.label}</span>
          <input
            type="number"
            name={`custom_target_value__${target.id}`}
            step="any"
            inputMode="decimal"
            defaultValue={target.value}
            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none ring-teal-600 focus:ring-2"
          />
          <span className="text-xs text-slate-500">{formatMeasurementUnit(target.unit, locale)}</span>
        </div>
      ))}

      {foodItems.map((item) => {
        const key = `food-${item.index}`;
        const isDeleted = deletedRows.has(key);
        return (
          <div key={key} className="flex flex-wrap items-center gap-2">
            {isDeleted ? (
              <>
                <input type="hidden" name={`food_quantity__${item.index}`} value={0} />
                <span className="min-w-0 flex-1 text-xs text-slate-400 line-through">{item.name}</span>
                <button
                  type="button"
                  onClick={() => toggleDeleted(key)}
                  className="text-xs font-medium text-teal-700 hover:text-teal-800"
                >
                  {tr(locale, "Undo", "ביטול")}
                </button>
              </>
            ) : (
              <>
                <input
                  type="number"
                  name={`food_quantity__${item.index}`}
                  min={0}
                  step="any"
                  defaultValue={item.quantity}
                  className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none ring-teal-600 focus:ring-2"
                />
                <span className="text-xs text-slate-500">{formatDefaultUnit(item.unit, locale)}</span>
                <span className="min-w-0 flex-1 text-xs text-slate-700">{item.name}</span>
                <button
                  type="button"
                  onClick={() => toggleDeleted(key)}
                  aria-label={tr(locale, "Delete item", "מחיקת פריט")}
                  title={tr(locale, "Delete item", "מחיקת פריט")}
                  className="shrink-0 text-rose-500 hover:text-rose-700"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        );
      })}

      {exerciseItems.map((item) => {
        const key = `exercise-${item.index}`;
        const isDeleted = deletedRows.has(key);
        return (
          <div key={key} className="flex flex-wrap items-center gap-2">
            {isDeleted ? (
              <>
                <input type="hidden" name={`exercise_minutes__${item.index}`} value={0} />
                <span className="min-w-0 flex-1 text-xs text-slate-400 line-through">{item.name}</span>
                <button
                  type="button"
                  onClick={() => toggleDeleted(key)}
                  className="text-xs font-medium text-teal-700 hover:text-teal-800"
                >
                  {tr(locale, "Undo", "ביטול")}
                </button>
              </>
            ) : (
              <>
                <input
                  type="number"
                  name={`exercise_minutes__${item.index}`}
                  min={0}
                  step="any"
                  defaultValue={item.minutes}
                  className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none ring-teal-600 focus:ring-2"
                />
                <span className="text-xs text-slate-500">{tr(locale, "min", "דק'")}</span>
                <span className="min-w-0 flex-1 text-xs text-slate-700">{item.name}</span>
                <button
                  type="button"
                  onClick={() => toggleDeleted(key)}
                  aria-label={tr(locale, "Delete item", "מחיקת פריט")}
                  title={tr(locale, "Delete item", "מחיקת פריט")}
                  className="shrink-0 text-rose-500 hover:text-rose-700"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        );
      })}

      {nutrientFields.length > 0 ? (
        <div className="space-y-2 border-t border-dashed border-teal-200 pt-2">
          <p className="text-xs font-semibold text-slate-600">
            {tr(locale, "Nutrient totals", "סך הכל תזונתי")}
          </p>
          {nutrientFields.map((field) => (
            <div key={field.dbColumn} className="flex flex-wrap items-center gap-2">
              <span className="min-w-[120px] flex-1 text-xs text-slate-700">
                {tr(locale, field.labelEn, field.labelHe)}
                {field.overridden ? (
                  <span className="ms-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                    {tr(locale, "manual", "ידני")}
                  </span>
                ) : null}
              </span>
              <input
                type="number"
                name={`nutrient_value__${field.dbColumn}`}
                min={0}
                step="any"
                defaultValue={field.value}
                onChange={() => setTouchedNutrients((prev) => new Set(prev).add(field.dbColumn))}
                className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none ring-teal-600 focus:ring-2"
              />
              <span className="text-xs text-slate-500">{formatMeasurementUnit(field.unit, locale)}</span>
              {touchedNutrients.has(field.dbColumn) ? (
                <input type="hidden" name={`nutrient_value__${field.dbColumn}__touched`} value="1" />
              ) : null}
            </div>
          ))}
          <p className="text-[11px] text-slate-500">
            {/* Singular, gender-correct Hebrew (תעדכן/תעדכני) - the original
                used the plural form ("תעדכנו"), inconsistent with the
                app's one-user addressing (see lib/ai/persona.ts). */}
            {trGendered(
              locale,
              userGender,
              "Editing a total directly locks it in - it won't change again just because items above changed, until you edit it again.",
              "עריכת סך הכל ישירות נועלת אותו - הוא לא ישתנה שוב רק כי הפריטים למעלה השתנו, עד שתעדכן אותו שוב.",
              "עריכת סך הכל ישירות נועלת אותו - הוא לא ישתנה שוב רק כי הפריטים למעלה השתנו, עד שתעדכני אותו שוב.",
            )}
          </p>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
        >
          {tr(locale, "Save", "שמור")}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          {tr(locale, "Cancel", "ביטול")}
        </button>
      </div>
    </form>
  );
}

export { PencilIcon as DailyReportEditPencilIcon };
