"use client";

import type { SavedListPickerRow } from "@/components/saved-list-quick-picker";
import { formatDefaultItemKind, formatDefaultItemName, formatDefaultUnit, tr, type AppLocale } from "@/lib/locale";
import { kindBadgeClass } from "@/lib/saved-list-match";

/**
 * TCK-37: the saved-list items matching what's currently typed in a chat
 * composer (see matchSavedItems), as one compact row of chips right above
 * the input - sideways-scrollable on a phone rather than wrapping. Tapping
 * a chip logs that item at its saved default, the same as picking it from
 * the saved-list popover. Renders nothing when there are no matches.
 */
export function SavedListMatchChips({
  items,
  locale,
  onSelect,
}: {
  items: SavedListPickerRow[];
  locale: AppLocale;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={tr(locale, "Saved list matches", "התאמות מהרשימה השמורה")}
      className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          onMouseDown={(event) => event.preventDefault()}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white py-1 pe-1 ps-2.5 text-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <span className="max-w-[9rem] truncate font-semibold text-slate-800 dark:text-slate-200">{formatDefaultItemName(item.name, locale)}</span>
          <span className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">
            {item.quantity} {formatDefaultUnit(item.unit, locale)}
          </span>
          {item.kind !== "custom" ? (
            <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold ${kindBadgeClass(item.kind)}`}>
              {formatDefaultItemKind(item.kind, locale)}
            </span>
          ) : null}
          <span className="rounded-full bg-teal-700 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-teal-600">{tr(locale, "Report", "דווח")}</span>
        </button>
      ))}
    </div>
  );
}
