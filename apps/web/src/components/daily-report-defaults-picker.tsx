"use client";

import { useCallback, useEffect, useRef } from "react";

import { formatDefaultItemKind, formatDefaultItemName, formatDefaultUnit, tr, type AppLocale } from "@/lib/locale";

export type DailyReportDefaultItem = {
  id: string;
  name: string;
  kind: "food" | "hydration" | "exercise" | "custom";
  default_quantity: number;
  default_unit: string;
  is_active: boolean;
};

function kindBadgeClass(kind: DailyReportDefaultItem["kind"]): string {
  if (kind === "hydration") return "border-sky-200 bg-sky-50 text-sky-700";
  if (kind === "exercise") return "border-violet-200 bg-violet-50 text-violet-700";
  if (kind === "custom") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

/**
 * A compact icon that opens a dropdown for picking saved defaults to
 * include in this report - the same selected_default_ids[]/
 * quantity_default_<id> form fields the save action has always read, just
 * tucked behind a click instead of an always-expanded grid (which got
 * unwieldy as the default list grows). The grid stays mounted at all times
 * (the <details> element only hides it visually via the browser's native
 * disclosure behavior), so checkbox state survives opening/closing, and the
 * native-DOM-driven sync below keeps working regardless of visibility.
 */
export function DailyReportDefaultsPicker({
  locale,
  defaultItems,
  onAdd,
  dropDirection = "down",
}: {
  locale: AppLocale;
  defaultItems: DailyReportDefaultItem[];
  onAdd: (selectedNames: string[]) => void;
  /** "up" anchors the popover above the icon (for a picker sitting at the
   * bottom of the chat compose row); "down" (default) anchors it below,
   * for a picker placed near the top of a section. */
  dropDirection?: "up" | "down";
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const selectedCountRef = useRef<HTMLSpanElement | null>(null);
  const selectAllButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  /**
   * The "selected" counter, quantity-input enable/disable, and each row's
   * checked-state ring highlight are all synced natively from the real DOM
   * checkbox state rather than React state: a real click's change event
   * isn't guaranteed to reach a React onChange handler in this dev
   * environment, but the checkbox's own native `checked` property always
   * updates correctly (and is what the browser actually submits), so UI
   * feedback is driven off of that instead.
   */
  const syncSelectionUi = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const checkboxes = grid.querySelectorAll<HTMLInputElement>('input[name="selected_default_ids"]');
    let checkedCount = 0;
    checkboxes.forEach((checkbox) => {
      const labelEl = checkbox.closest<HTMLElement>("label");
      labelEl?.classList.toggle("ring-2", checkbox.checked);
      labelEl?.classList.toggle("ring-teal-100", checkbox.checked);
      labelEl?.classList.toggle("border-teal-300", checkbox.checked);
      const row = checkbox.closest<HTMLElement>("[data-default-name]");
      const quantityInput = row?.querySelector<HTMLInputElement>('input[type="number"]');
      if (quantityInput) quantityInput.disabled = !checkbox.checked;
      if (checkbox.checked) checkedCount += 1;
    });

    if (selectedCountRef.current) {
      selectedCountRef.current.textContent = String(checkedCount);
    }
  }, []);

  const setAllChecked = useCallback(
    (checked: boolean) => {
      const grid = gridRef.current;
      if (!grid) return;
      grid.querySelectorAll<HTMLInputElement>('input[name="selected_default_ids"]').forEach((checkbox) => {
        checkbox.checked = checked;
      });
      syncSelectionUi();
    },
    [syncSelectionUi],
  );

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    grid.addEventListener("change", syncSelectionUi);
    syncSelectionUi();
    return () => grid.removeEventListener("change", syncSelectionUi);
  }, [syncSelectionUi]);

  // "Select all" / "Clear" / "Add" are wired via native addEventListener
  // rather than React's onClick, for the same reason as the checkbox grid: a
  // real click's event isn't guaranteed to reach a React synthetic handler
  // in this dev environment, even though the handlers themselves are
  // otherwise state-light.
  useEffect(() => {
    const selectAllButton = selectAllButtonRef.current;
    const clearButton = clearButtonRef.current;
    const addButton = addButtonRef.current;
    if (!selectAllButton || !clearButton || !addButton) return;

    const handleSelectAll = () => setAllChecked(true);
    const handleClear = () => setAllChecked(false);
    const handleAdd = () => {
      const grid = gridRef.current;
      const checkedNames: string[] = [];
      if (grid) {
        grid.querySelectorAll<HTMLInputElement>('input[name="selected_default_ids"]:checked').forEach((checkbox) => {
          const match = defaultItems.find((item) => item.id === checkbox.value);
          if (match) checkedNames.push(formatDefaultItemName(match.name, locale));
        });
      }
      onAdd(checkedNames);
      if (detailsRef.current) detailsRef.current.open = false;
    };

    selectAllButton.addEventListener("click", handleSelectAll);
    clearButton.addEventListener("click", handleClear);
    addButton.addEventListener("click", handleAdd);
    return () => {
      selectAllButton.removeEventListener("click", handleSelectAll);
      clearButton.removeEventListener("click", handleClear);
      addButton.removeEventListener("click", handleAdd);
    };
  }, [setAllChecked, defaultItems, locale, onAdd]);

  // A native (non-React-driven) filter for the defaults search box: a plain
  // DOM `input` listener toggling each row's visibility directly, rather
  // than React state gating a `.filter()` in the render. This must not
  // depend on React's onChange firing for a real keystroke.
  useEffect(() => {
    const input = searchInputRef.current;
    const grid = gridRef.current;
    if (!input || !grid) return;

    function handleInput() {
      const query = (input!.value || "").trim().toLowerCase();
      const rows = grid!.querySelectorAll<HTMLElement>("[data-default-name]");
      rows.forEach((row) => {
        const name = row.dataset.defaultName ?? "";
        row.classList.toggle("hidden", query.length > 0 && !name.includes(query));
      });
    }

    input.addEventListener("input", handleInput);
    return () => input.removeEventListener("input", handleInput);
  }, []);

  if (!defaultItems.length) return null;

  return (
    <details ref={detailsRef} className="relative shrink-0">
      <summary
        aria-label={tr(locale, "Add from your saved defaults", "הוספה מברירות המחדל השמורות")}
        title={tr(locale, "Add from your saved defaults", "הוספה מברירות המחדל השמורות")}
        className="flex h-9 w-9 list-none items-center justify-center rounded-full border border-teal-300 text-teal-700 hover:bg-teal-50 [&::-webkit-details-marker]:hidden"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </summary>

      <div
        className={`absolute z-10 w-[min(22rem,85vw)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg ${
          dropDirection === "up" ? "bottom-full mb-2" : "top-full mt-2"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
            <span ref={selectedCountRef}>0</span> {tr(locale, "selected", "נבחרו")}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              ref={selectAllButtonRef}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {tr(locale, "Select all", "בחירת הכל")}
            </button>
            <button
              type="button"
              ref={clearButtonRef}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {tr(locale, "Clear", "ניקוי")}
            </button>
          </div>
        </div>

        {defaultItems.length > 5 ? (
          <input
            ref={searchInputRef}
            type="text"
            defaultValue=""
            placeholder={tr(locale, "Search your defaults...", "חיפוש בברירות המחדל שלך...")}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2"
          />
        ) : null}

        <div ref={gridRef} className="mt-2 max-h-64 space-y-2 overflow-y-auto">
          {defaultItems.map((item) => (
            <div key={item.id} data-default-name={formatDefaultItemName(item.name, locale).toLowerCase()}>
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-start gap-2">
                    <input type="checkbox" name="selected_default_ids" value={item.id} defaultChecked={false} className="mt-0.5" />
                    <span>
                      <span className="block font-medium text-slate-800">{formatDefaultItemName(item.name, locale)}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {tr(locale, "Default", "ברירת מחדל")}: {item.default_quantity} {formatDefaultUnit(item.default_unit, locale)}
                      </span>
                    </span>
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${kindBadgeClass(item.kind)}`}>
                    {formatDefaultItemKind(item.kind, locale)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-600">{tr(locale, "Quantity", "כמות")}</span>
                  <input
                    name={`quantity_default_${item.id}`}
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={item.default_quantity}
                    disabled
                    className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </label>
            </div>
          ))}
        </div>

        <button
          type="button"
          ref={addButtonRef}
          className="mt-3 w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          {tr(locale, "Add", "הוספה")}
        </button>
      </div>
    </details>
  );
}
