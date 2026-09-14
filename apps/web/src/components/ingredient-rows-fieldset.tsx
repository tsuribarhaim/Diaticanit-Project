"use client";

import { useEffect, useRef } from "react";

import { formatDefaultItemKind, formatDefaultUnit, tr, type AppLocale } from "@/lib/locale";

export type IngredientRowValue = { name: string; kind: string; quantity: number; unit: string };

const KIND_OPTIONS = ["food", "hydration", "exercise", "custom"] as const;
const UNIT_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: "unit", labelKey: "unit" },
  { value: "ml", labelKey: "ml" },
  { value: "l", labelKey: "liters" },
  { value: "g", labelKey: "grams" },
  { value: "kg", labelKey: "kilograms" },
  { value: "m", labelKey: "meters" },
  { value: "km", labelKey: "kilometers" },
  { value: "cup", labelKey: "cups" },
  { value: "piece", labelKey: "pieces" },
  { value: "minutes", labelKey: "minutes" },
];

/**
 * A repeatable "ingredient" row (name/type/quantity/unit) used by both the
 * add-item and edit-item forms on the Saved List page, so a single item
 * ("Eggs") and a bundle of several under one name ("My Breakfast" = eggs +
 * salad + toast + yogurt) use the exact same input shape - the server side
 * treats a lone row as today's simple item and 2+ rows as a bundle (see
 * resolveBundleFields in defaults/actions.ts).
 *
 * "Add ingredient" clones the first row and "Remove" deletes a row, both
 * wired via native addEventListener/DOM cloning rather than React state -
 * consistent with this app's other dynamic-row UI (DailyReportDefaultsPicker),
 * since a real click isn't guaranteed to reach a React synthetic handler in
 * this dev environment. All rows share the same field names
 * (ingredient_name/ingredient_kind/ingredient_quantity/ingredient_unit), so
 * formData.getAll() on submit collects them as parallel arrays in DOM order
 * without needing indexed names.
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
      clone.querySelectorAll("select").forEach((select) => {
        select.selectedIndex = 0;
      });
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

    addButton.addEventListener("click", handleAdd);
    container.addEventListener("click", handleContainerClick);
    updateRemoveButtonsVisibility();
    return () => {
      addButton.removeEventListener("click", handleAdd);
      container.removeEventListener("click", handleContainerClick);
    };
  }, []);

  return (
    <div>
      <div ref={containerRef} className="space-y-2">
        {seedRows.map((row, index) => (
          <div
            key={index}
            data-ingredient-row
            className="grid items-end gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]"
          >
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">{tr(locale, "Ingredient name", "שם המרכיב")}</span>
              <input
                name="ingredient_name"
                defaultValue={row.name}
                required
                placeholder={tr(locale, "e.g. eggs", "לדוגמה: ביצים")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">{tr(locale, "Type", "סוג")}</span>
              <select name="ingredient_kind" defaultValue={row.kind} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {formatDefaultItemKind(kind, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">{tr(locale, "Quantity", "כמות")}</span>
              <input
                name="ingredient_quantity"
                type="number"
                step="1"
                defaultValue={row.quantity}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">{tr(locale, "Unit", "יחידה")}</span>
              <select name="ingredient_unit" defaultValue={row.unit} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {UNIT_OPTIONS.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {formatDefaultUnit(unit.labelKey, locale)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              data-remove-ingredient
              className="hidden rounded-lg border border-rose-300 px-2 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              {tr(locale, "Remove", "הסרה")}
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        ref={addButtonRef}
        className="mt-2 rounded-lg border border-teal-300 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"
      >
        {"+ "}
        {tr(locale, "Add ingredient", "הוספת מרכיב")}
      </button>
    </div>
  );
}
