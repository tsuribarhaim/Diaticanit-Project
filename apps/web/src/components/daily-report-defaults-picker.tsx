"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { directionForLocale, formatDefaultItemKind, formatDefaultItemName, formatDefaultUnit, tr, type AppLocale } from "@/lib/locale";

export type DailyReportDefaultItem = {
  id: string;
  name: string;
  kind: "food" | "hydration" | "exercise" | "custom";
  default_quantity: number;
  default_unit: string;
  /** Present (length > 1) when this item bundles several ingredients under
   * one name (e.g. "My Breakfast") - shown as a breakdown under the item's
   * name so the user knows what's inside before selecting it. A single
   * plain item has 0 or 1 entries here and shows no breakdown. */
  ingredients?: Array<{ name: string; kind: string; quantity: number; unit: string }> | null;
  is_active: boolean;
};

export type SelectedSavedListItem = {
  name: string;
  quantity: number;
  unit: string;
  /** Carried straight from the matching DailyReportDefaultItem - lets the
   * caller echo what's actually inside a bundled item (e.g. "My Breakfast")
   * rather than just its name, without re-deriving anything. */
  ingredients?: Array<{ name: string; kind: string; quantity: number; unit: string }> | null;
};

function kindBadgeClass(kind: DailyReportDefaultItem["kind"]): string {
  if (kind === "hydration") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400";
  if (kind === "exercise") return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400";
  if (kind === "custom") return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400";
}

/**
 * A compact icon that opens a dropdown for picking saved-list items to
 * include in this report - the same selected_default_ids[]/
 * quantity_default_<id> form fields the save action has always read, just
 * tucked behind a click instead of an always-expanded grid (which got
 * unwieldy as the list grows). The grid stays mounted at all times (the
 * <details> element only hides it visually via the browser's native
 * disclosure behavior), so checkbox state survives opening/closing, and the
 * native-DOM-driven sync below keeps working regardless of visibility.
 *
 * Checking/unchecking a row (or editing its quantity) reports the current
 * full selection via onSelectionChange immediately - the caller uses this to
 * show live feedback (e.g. echoing it into a chat transcript) as the user
 * picks, rather than waiting for a separate "commit" click. The button is
 * therefore just a dismiss action once the user is done browsing the list.
 */
export function DailyReportDefaultsPicker({
  locale,
  defaultItems,
  onSelectionChange,
  dropDirection = "down",
  showQuickAdd = false,
  formId,
  portalPopover = false,
}: {
  locale: AppLocale;
  defaultItems: DailyReportDefaultItem[];
  onSelectionChange: (selected: SelectedSavedListItem[]) => void;
  /** "up" anchors the popover above the icon (for a picker sitting at the
   * bottom of the chat compose row); "down" (default) anchors it below,
   * for a picker placed near the top of a section. Ignored when
   * `portalPopover` is set - that mode has its own fixed placement. */
  dropDirection?: "up" | "down";
  /** Renders a row of one-tap "quick add" chips for every saved item, above
   * the dropdown trigger, horizontally scrollable - each toggles the exact
   * same underlying checkbox the dropdown grid itself uses (found by value
   * and given a native change event) rather than duplicating selection
   * state, so it stays consistent with this component's own DOM-driven
   * design. */
  showQuickAdd?: boolean;
  /** The id of the `<form>` this picker's checkboxes/quantity inputs belong
   * to, for when this component is rendered somewhere other than a DOM
   * descendant of that form - e.g. portaled to document.body (see the
   * daily-report chat panel's mobile sheet). Native HTML form submission
   * is DOM-ancestry-based, so without this, a portaled picker's selections
   * would silently never reach the form's submitted data. */
  formId?: string;
  /** Renders the popover content via a portal to document.body, as a fixed
   * bottom sheet with its own backdrop, instead of `position: absolute`
   * anchored to the trigger icon. Needed specifically where this picker
   * lives inside another `overflow-hidden` + `transform` container (the
   * mobile daily-report chat sheet) - a plain absolutely-positioned popover
   * there gets silently clipped by that ancestor's overflow the moment it's
   * taller than the remaining space above the trigger, which read as "the
   * icon doesn't do anything" (it was opening, just invisible). `position:
   * fixed` can't escape a `transform`-ed ancestor either (it still resolves
   * relative to it, not the true viewport), so only an actual DOM-level
   * portal actually escapes both. */
  portalPopover?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const selectedCountRef = useRef<HTMLSpanElement | null>(null);
  const selectAllButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  /**
   * The "selected" counter, quantity-input enable/disable, and each row's
   * checked-state ring highlight are all synced natively from the real DOM
   * checkbox state rather than React state: a real click's change event
   * isn't guaranteed to reach a React onChange handler in this dev
   * environment, but the checkbox's own native `checked` property always
   * updates correctly (and is what the browser actually submits), so UI
   * feedback is driven off of that instead. This same pass also reports the
   * live selection up to the caller, so every check/uncheck/quantity edit
   * shows up immediately wherever the caller displays it.
   */
  const syncSelectionUi = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const checkboxes = grid.querySelectorAll<HTMLInputElement>('input[name="selected_default_ids"]');
    let checkedCount = 0;
    const selected: SelectedSavedListItem[] = [];
    checkboxes.forEach((checkbox) => {
      const labelEl = checkbox.closest<HTMLElement>("label");
      labelEl?.classList.toggle("ring-2", checkbox.checked);
      labelEl?.classList.toggle("ring-teal-100", checkbox.checked);
      labelEl?.classList.toggle("dark:ring-teal-900", checkbox.checked);
      labelEl?.classList.toggle("border-teal-300", checkbox.checked);
      labelEl?.classList.toggle("dark:border-teal-700", checkbox.checked);
      const row = checkbox.closest<HTMLElement>("[data-default-name]");
      const quantityInput = row?.querySelector<HTMLInputElement>('input[type="number"]');
      if (quantityInput) quantityInput.disabled = !checkbox.checked;
      if (checkbox.checked) {
        checkedCount += 1;
        const match = defaultItems.find((item) => item.id === checkbox.value);
        if (match) {
          const quantity = quantityInput ? Number(quantityInput.value) || match.default_quantity : match.default_quantity;
          selected.push({
            name: formatDefaultItemName(match.name, locale),
            quantity,
            unit: match.default_unit,
            ingredients: match.ingredients,
          });
        }
      }
    });

    if (selectedCountRef.current) {
      selectedCountRef.current.textContent = String(checkedCount);
    }
    onSelectionChange(selected);
  }, [defaultItems, locale, onSelectionChange]);

  const toggleQuickItem = useCallback((itemId: string, chipEl: HTMLButtonElement) => {
    const grid = gridRef.current;
    if (!grid) return;
    const checkbox = grid.querySelector<HTMLInputElement>(`input[name="selected_default_ids"][value="${itemId}"]`);
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    chipEl.classList.toggle("border-teal-700", checkbox.checked);
    chipEl.classList.toggle("dark:border-teal-600", checkbox.checked);
    chipEl.classList.toggle("bg-teal-700", checkbox.checked);
    chipEl.classList.toggle("dark:bg-teal-600", checkbox.checked);
    chipEl.classList.toggle("text-white", checkbox.checked);
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

  // Only needed for portalPopover mode - the portaled content isn't a DOM
  // descendant of <details> anymore, so it can't rely on the browser's own
  // open/closed visibility of a descendant; it needs to know as real React
  // state instead. The <details> element's native "toggle" event (fired for
  // both the summary click that opens it and the .open=false a "Close"/
  // backdrop click sets) is the single source of truth for this, so this
  // only mirrors it - it never itself decides open/closed.
  useEffect(() => {
    if (!portalPopover) return;
    const details = detailsRef.current;
    if (!details) return;

    const handleToggle = () => setIsOpen(details.open);
    details.addEventListener("toggle", handleToggle);
    return () => details.removeEventListener("toggle", handleToggle);
  }, [portalPopover]);

  // "Select all" / "Clear" / "Close" are wired via native addEventListener
  // rather than React's onClick, for the same reason as the checkbox grid: a
  // real click's event isn't guaranteed to reach a React synthetic handler
  // in this dev environment, even though the handlers themselves are
  // otherwise state-light.
  useEffect(() => {
    const selectAllButton = selectAllButtonRef.current;
    const clearButton = clearButtonRef.current;
    const closeButton = closeButtonRef.current;
    if (!selectAllButton || !clearButton || !closeButton) return;

    const handleSelectAll = () => setAllChecked(true);
    const handleClear = () => setAllChecked(false);
    const handleClose = () => {
      if (detailsRef.current) detailsRef.current.open = false;
    };

    selectAllButton.addEventListener("click", handleSelectAll);
    clearButton.addEventListener("click", handleClear);
    closeButton.addEventListener("click", handleClose);
    return () => {
      selectAllButton.removeEventListener("click", handleSelectAll);
      clearButton.removeEventListener("click", handleClear);
      closeButton.removeEventListener("click", handleClose);
    };
  }, [setAllChecked]);

  // A native (non-React-driven) filter for the saved-list search box: a
  // plain DOM `input` listener toggling each row's visibility directly,
  // rather than React state gating a `.filter()` in the render. This must
  // not depend on React's onChange firing for a real keystroke.
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

  // Every saved item, not just the first few - previously capped at 4 with
  // no way to reach the rest, reported as only seeing "4 that can move
  // right and left but no other list items appear". The row already
  // scrolls horizontally (overflow-x-auto below), so showing the full list
  // just means there's more to scroll through, not a layout change.
  const quickItems = showQuickAdd ? defaultItems : [];

  function closeDetails() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  const pickerBody = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <span ref={selectedCountRef}>0</span> {tr(locale, "selected", "נבחרו")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            ref={selectAllButtonRef}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {tr(locale, "Select all", "בחירת הכל")}
          </button>
          <button
            type="button"
            ref={clearButtonRef}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
          placeholder={tr(locale, "Search your saved list...", "חיפוש ברשימה השמורה שלך...")}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900"
        />
      ) : null}

      <div ref={gridRef} className={`mt-2 space-y-2 overflow-y-auto ${portalPopover ? "max-h-[50vh]" : "max-h-64"}`}>
        {defaultItems.map((item) => (
          <div key={item.id} data-default-name={formatDefaultItemName(item.name, locale).toLowerCase()}>
            <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-start gap-2">
                  <input type="checkbox" name="selected_default_ids" form={formId} value={item.id} defaultChecked={false} className="mt-0.5" />
                  <span>
                    <span className="block font-medium text-slate-800 dark:text-slate-200">{formatDefaultItemName(item.name, locale)}</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      {tr(locale, "Usual amount", "כמות רגילה")}: {item.default_quantity} {formatDefaultUnit(item.default_unit, locale)}
                    </span>
                    {item.ingredients && item.ingredients.length > 1 ? (
                      <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                        {item.ingredients
                          .map((ingredient) => `${ingredient.quantity} ${formatDefaultUnit(ingredient.unit, locale)} ${formatDefaultItemName(ingredient.name, locale)}`)
                          .join(", ")}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${kindBadgeClass(item.kind)}`}>
                  {formatDefaultItemKind(item.kind, locale)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-400">{tr(locale, "Quantity", "כמות")}</span>
                <input
                  name={`quantity_default_${item.id}`}
                  form={formId}
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={item.default_quantity}
                  disabled
                  className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
                />
              </div>
            </label>
          </div>
        ))}
      </div>

      <button
        type="button"
        ref={closeButtonRef}
        className="mt-3 w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
      >
        {tr(locale, "Close", "סגירה")}
      </button>
    </>
  );

  return (
    <>
      {quickItems.length ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:flex-none">
          {quickItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={(event) => toggleQuickItem(item.id, event.currentTarget)}
              className="shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {formatDefaultItemName(item.name, locale)}
            </button>
          ))}
        </div>
      ) : null}
      <details ref={detailsRef} className="relative shrink-0">
        <summary
          aria-label={tr(locale, "Add from your saved list", "הוספה מהרשימה השמורה")}
          title={tr(locale, "Add from your saved list", "הוספה מהרשימה השמורה")}
          className="flex h-9 w-9 list-none items-center justify-center rounded-full border border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-400 dark:hover:bg-teal-950/40 [&::-webkit-details-marker]:hidden"
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

        {portalPopover
          ? null
          : (
            <div
              className={`absolute z-10 w-[min(22rem,85vw)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900 ${
                dropDirection === "up" ? "bottom-full mb-2" : "top-full mt-2"
              }`}
            >
              {pickerBody}
            </div>
          )}
      </details>

      {/* Portaled straight to document.body, escaping both this picker's
          own (non-transformed) ancestors AND, more importantly, the mobile
          chat sheet's overflow-hidden + transform-gpu ancestor further up -
          see portalPopover's own comment for why a plain absolute/fixed
          popover can't escape that on its own. A simple fixed bottom sheet
          (not trying to anchor precisely above the small trigger icon) so
          no position measurement/JS is needed at all.
          Always portaled (not only while isOpen) and toggled with `hidden`
          instead - only the backdrop is conditionally mounted. The
          checkboxes inside pickerBody must stay mounted at all times
          exactly like the non-portal branch above always has (see this
          component's own top-of-file comment: "the grid stays mounted at
          all times... so checkbox state survives opening/closing") -
          portaling only while open would unmount them on every close,
          silently dropping the user's selections from the form the moment
          they closed this instead of only when they actually cleared them. */}
      {portalPopover
        ? createPortal(
            // dir set explicitly - the app only applies dir="rtl"/"ltr" on a
            // wrapper <div> inside app/app/layout.tsx, not on <html>/<body>,
            // so a portal straight to document.body escapes it and falls
            // back to the document's default LTR direction (same root cause
            // already found and fixed for the daily-report chat panel's own
            // mobile sheet).
            <div dir={directionForLocale(locale)}>
              {isOpen ? <div role="presentation" onClick={closeDetails} className="fixed inset-0 z-[60] bg-slate-900/40" /> : null}
              <div
                className={`fixed inset-x-3 bottom-[calc(8rem+env(safe-area-inset-bottom))] z-[60] max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-800 dark:bg-slate-900 ${
                  isOpen ? "" : "hidden"
                }`}
              >
                {pickerBody}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
