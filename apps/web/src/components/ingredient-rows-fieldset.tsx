"use client";

import { useEffect, useRef } from "react";

import { formatDefaultItemKind, formatDefaultUnit, tr, type AppLocale } from "@/lib/locale";

export type IngredientRowValue = { name: string; kind: string; quantity: number; unit: string };

const KIND_OPTIONS = ["food", "hydration", "exercise", "custom"] as const;
type Kind = (typeof KIND_OPTIONS)[number];

type UnitOption = { value: string; labelKey: string };

/**
 * TCK-20: units are scoped to what's actually plausible for each kind
 * (distance/time only make sense for exercise; food/hydration never do),
 * instead of one flat list showing e.g. "minutes" and "km" on a food row.
 * "ml" and "cup" deliberately appear on BOTH food and hydration - Orit's
 * own note on the ticket: there's real overlap there (soup, a milkshake),
 * unlike the exercise units which never belong on either. "unit" (a bare
 * count) is kept available everywhere since it's the universal fallback
 * for anything else. "custom" gets the full list since it's a catch-all
 * with no narrower meaning to filter against.
 */
const UNIT_OPTIONS_BY_KIND: Record<Kind, UnitOption[]> = {
  food: [
    { value: "unit", labelKey: "unit" },
    { value: "g", labelKey: "grams" },
    { value: "kg", labelKey: "kilograms" },
    { value: "ml", labelKey: "ml" },
    { value: "cup", labelKey: "cups" },
    { value: "piece", labelKey: "pieces" },
    { value: "tbsp", labelKey: "tbsp" },
    { value: "tsp", labelKey: "tsp" },
  ],
  hydration: [
    { value: "ml", labelKey: "ml" },
    { value: "l", labelKey: "liters" },
    { value: "cup", labelKey: "cups" },
    { value: "unit", labelKey: "unit" },
  ],
  exercise: [
    { value: "minutes", labelKey: "minutes" },
    { value: "km", labelKey: "kilometers" },
    { value: "m", labelKey: "meters" },
    { value: "unit", labelKey: "unit" },
  ],
  custom: [
    { value: "unit", labelKey: "unit" },
    { value: "ml", labelKey: "ml" },
    { value: "l", labelKey: "liters" },
    { value: "g", labelKey: "grams" },
    { value: "kg", labelKey: "kilograms" },
    { value: "m", labelKey: "meters" },
    { value: "km", labelKey: "kilometers" },
    { value: "cup", labelKey: "cups" },
    { value: "piece", labelKey: "pieces" },
    { value: "tbsp", labelKey: "tbsp" },
    { value: "tsp", labelKey: "tsp" },
    { value: "minutes", labelKey: "minutes" },
  ],
};

function normalizeKind(kind: string): Kind {
  return (KIND_OPTIONS as readonly string[]).includes(kind) ? (kind as Kind) : "custom";
}

/** The kind's own curated unit list, with `currentValue` appended if it
 * isn't already in it - so editing an existing saved item never silently
 * drops whatever unit it was actually saved with (e.g. older data saved
 * before this filtering existed), even if that unit wouldn't normally be
 * offered for its kind. */
function unitOptionsFor(kind: string, currentValue?: string): UnitOption[] {
  const base = UNIT_OPTIONS_BY_KIND[normalizeKind(kind)];
  if (!currentValue || base.some((option) => option.value === currentValue)) return base;
  return [...base, { value: currentValue, labelKey: currentValue }];
}

function populateUnitSelect(select: HTMLSelectElement, kind: string, locale: AppLocale, preferredValue?: string) {
  const options = unitOptionsFor(kind, preferredValue);
  select.innerHTML = "";
  for (const option of options) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = formatDefaultUnit(option.labelKey, locale);
    select.appendChild(optionEl);
  }
  select.value = preferredValue && options.some((o) => o.value === preferredValue) ? preferredValue : options[0]?.value ?? "";
}

/**
 * A repeatable "ingredient" row (name/type/unit/quantity) used by both the
 * add-item and edit-item forms on the Saved List page, so a single item
 * ("Eggs") and a bundle of several under one name ("My Breakfast" = eggs +
 * salad + toast + yogurt) use the exact same input shape - the server side
 * treats a lone row as today's simple item and 2+ rows as a bundle (see
 * resolveBundleFields in defaults/actions.ts).
 *
 * TCK-21: unit comes before quantity (both in the field order below and in
 * tab/visual order) - deciding "this is grams" before "80 of them" is the
 * natural order to fill these in; asking for the number first means
 * holding an unanswered "of what?" in mind. Pure field reorder, no change
 * to the posted field names.
 *
 * "Add ingredient" clones the first row and "Remove" deletes a row, both
 * wired via native addEventListener/DOM cloning rather than React state -
 * consistent with this app's other dynamic-row UI (DailyReportDefaultsPicker),
 * since a real click isn't guaranteed to reach a React synthetic handler in
 * this dev environment. All rows share the same field names
 * (ingredient_name/ingredient_kind/ingredient_quantity/ingredient_unit), so
 * formData.getAll() on submit collects them as parallel arrays in DOM order
 * without needing indexed names. The unit <select>'s options are rebuilt
 * (not just re-filtered via hidden attributes) whenever its row's kind
 * changes, via the same native-DOM approach, to stay consistent with that.
 */
export function IngredientRowsFieldset({
  locale,
  initialRows,
}: {
  locale: AppLocale;
  initialRows?: IngredientRowValue[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  const seedRows: IngredientRowValue[] =
    initialRows && initialRows.length > 0 ? initialRows : [{ name: "", kind: "food", quantity: 1, unit: "unit" }];

  useEffect(() => {
    const container = containerRef.current;
    const addButton = addButtonRef.current;
    if (!container || !addButton) return;

    function updateRemoveButtonsVisibility() {
      const rows = container!.querySelectorAll<HTMLElement>("[data-ingredient-row]");
      rows.forEach((row) => {
        const removeButton = row.querySelector<HTMLButtonElement>("[data-remove-ingredient]");
        removeButton?.classList.toggle("hidden", rows.length <= 1);
      });
    }

    function handleAdd() {
      const template = container!.querySelector<HTMLElement>("[data-ingredient-row]");
      if (!template) return;
      const clone = template.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input").forEach((input) => {
        input.value = input.type === "number" ? "1" : "";
      });
      const kindSelect = clone.querySelector<HTMLSelectElement>('select[name="ingredient_kind"]');
      const unitSelect = clone.querySelector<HTMLSelectElement>('select[name="ingredient_unit"]');
      if (kindSelect) kindSelect.selectedIndex = 0;
      // Rebuilt for the (now-reset) kind rather than just resetting its own
      // selectedIndex - the cloned template's unit options reflect whatever
      // kind THAT row was last showing, which can mismatch the new row's
      // reset-to-first kind (see populateUnitSelect's own reasoning).
      if (unitSelect) populateUnitSelect(unitSelect, kindSelect?.value ?? "food", locale);
      container!.appendChild(clone);
      updateRemoveButtonsVisibility();
      clone.querySelector<HTMLInputElement>('input[name="ingredient_name"]')?.focus();
    }

    function handleContainerClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const removeButton = target.closest<HTMLElement>("[data-remove-ingredient]");
      if (!removeButton) return;
      const rows = container!.querySelectorAll("[data-ingredient-row]");
      if (rows.length <= 1) return;
      removeButton.closest<HTMLElement>("[data-ingredient-row]")?.remove();
      updateRemoveButtonsVisibility();
    }

    function handleContainerChange(event: Event) {
      const target = event.target as HTMLElement;
      if (!(target instanceof HTMLSelectElement) || target.name !== "ingredient_kind") return;
      const row = target.closest<HTMLElement>("[data-ingredient-row]");
      const unitSelect = row?.querySelector<HTMLSelectElement>('select[name="ingredient_unit"]');
      if (unitSelect) populateUnitSelect(unitSelect, target.value, locale);
    }

    addButton.addEventListener("click", handleAdd);
    container.addEventListener("click", handleContainerClick);
    container.addEventListener("change", handleContainerChange);
    updateRemoveButtonsVisibility();
    return () => {
      addButton.removeEventListener("click", handleAdd);
      container.removeEventListener("click", handleContainerClick);
      container.removeEventListener("change", handleContainerChange);
    };
  }, [locale]);

  return (
    <div>
      <div ref={containerRef} className="space-y-2">
        {seedRows.map((row, index) => (
          <div
            key={index}
            data-ingredient-row
            className="grid items-end gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]"
          >
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Ingredient name", "שם המרכיב")}</span>
              <input
                name="ingredient_name"
                defaultValue={row.name}
                required
                placeholder={tr(locale, "e.g. eggs", "לדוגמה: ביצים")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Type", "סוג")}</span>
              <select name="ingredient_kind" defaultValue={row.kind} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">
                {KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {formatDefaultItemKind(kind, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Unit", "יחידה")}</span>
              <select name="ingredient_unit" defaultValue={row.unit} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">
                {unitOptionsFor(row.kind, row.unit).map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {formatDefaultUnit(unit.labelKey, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Quantity", "כמות")}</span>
              <input
                name="ingredient_quantity"
                type="number"
                step="1"
                defaultValue={row.quantity}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
              />
            </label>
            <button
              type="button"
              data-remove-ingredient
              className="hidden rounded-lg border border-rose-300 px-2 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              {tr(locale, "Remove", "הסרה")}
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        ref={addButtonRef}
        className="mt-2 rounded-lg border border-teal-300 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-400 dark:hover:bg-teal-950/40"
      >
        {"+ "}
        {tr(locale, "Add ingredient", "הוספת מרכיב")}
      </button>
    </div>
  );
}
