"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { formatDefaultItemKind, formatDefaultItemName, formatDefaultUnit, tr, type AppLocale } from "@/lib/locale";

export type SavedListPickerRow = {
  id: string;
  name: string;
  kind: string;
  quantity: number;
  unit: string;
};

// Must match the desktop popover's own w-72 Tailwind class below - used to
// clamp its computed position so it can never be positioned past the
// right edge of the viewport (a real risk once portaled to fixed viewport
// coordinates rather than a panel-relative, page-clipped position).
const DESKTOP_POPOVER_WIDTH_PX = 288;
const VIEWPORT_MARGIN_PX = 12;

function kindBadgeClass(kind: string): string {
  if (kind === "hydration") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400";
  if (kind === "exercise") return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400";
  if (kind === "custom") return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400";
}

/**
 * The "tap the icon, tap an item, it's logged immediately" saved-list
 * popover shared by both chat surfaces (the Daily Report chat panel and
 * the global Daffy chat bubble) - previously each maintained its own,
 * nearly identical copy with no search (ticket #81: fine with a handful of
 * items, unusable with dozens - "no way to type the first letter, very
 * small and uncomfortable to scroll"). The search box uses the same live
 * substring-filter idea already proven on the main Daily Report form's own
 * picker (DailyReportDefaultsPicker), just as plain React state here since
 * this component (unlike that one) has no native-form-field/checkbox grid
 * whose stability constraints that technique was actually working around.
 *
 * Always portaled to document.body, on desktop as well as mobile - not
 * just for mobile's full sheet. Confirmed live: both chat surfaces' own
 * floating panel is itself `overflow-hidden` (to clip its scrolling
 * message thread to a rounded card), and this picker is now tall enough
 * (title + search + several rows) to get silently clipped by that
 * ancestor the moment the panel itself is short (few messages yet) - the
 * exact same failure DailyReportDefaultsPicker's own portalPopover mode
 * exists to avoid, just not one a short w-56/max-h-56 popover used to be
 * tall enough to trigger. Desktop position is measured off the trigger
 * button's own rect on open (a fixed floating chat widget doesn't move
 * under the trigger while a picker is open, so one measurement suffices)
 * rather than anchored via a non-portaled ancestor.
 */
export function SavedListQuickPicker({
  isOpen,
  onClose,
  items,
  isLoading,
  locale,
  onSelect,
  triggerRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: SavedListPickerRow[];
  isLoading?: boolean;
  locale: AppLocale;
  onSelect: (id: string) => void;
  /** The saved-list toggle button each caller already renders - measured
   * once on open to place the desktop popover just above it. */
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [desktopAnchor, setDesktopAnchor] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    // Deferred a tick (matching this codebase's established pattern for a
    // setState inside an effect) rather than called synchronously in the
    // effect body.
    const timeout = setTimeout(() => {
      setQuery("");
      if (trigger) {
        const rect = trigger.getBoundingClientRect();
        const maxLeft = window.innerWidth - DESKTOP_POPOVER_WIDTH_PX - VIEWPORT_MARGIN_PX;
        const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN_PX), Math.max(maxLeft, VIEWPORT_MARGIN_PX));
        setDesktopAnchor({ left, bottom: window.innerHeight - rect.top + 8 });
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [isOpen, triggerRef]);

  if (!isOpen) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery ? items.filter((item) => item.name.toLowerCase().includes(normalizedQuery)) : items;

  function renderList(maxHeightClassName: string) {
    if (isLoading) {
      return <p className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{tr(locale, "Loading…", "טוען…")}</p>;
    }
    if (filtered.length === 0) {
      return (
        <p className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
          {items.length === 0
            ? tr(locale, "No saved items yet.", "אין עדיין פריטים שמורים.")
            : tr(locale, `No saved item matches "${query}".`, `לא נמצא פריט שמור התואם ל"${query}".`)}
        </p>
      );
    }
    return (
      <div className={`overflow-y-auto ${maxHeightClassName}`}>
        {filtered.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800"
          >
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                {formatDefaultItemName(item.name, locale)}
              </span>
              <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                {item.quantity} {formatDefaultUnit(item.unit, locale)}
              </span>
            </span>
            {item.kind !== "custom" ? (
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${kindBadgeClass(item.kind)}`}>
                {formatDefaultItemKind(item.kind, locale)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

  const searchBox =
    items.length > 5 ? (
      <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="shrink-0 text-slate-400" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr(locale, "Search your saved list…", "חיפוש ברשימה השמורה שלך…")}
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </div>
    ) : null;

  return createPortal(
    <>
      {/* Desktop/tablet: compact popover positioned just above the trigger
          icon, hidden until its position is measured (avoids a one-frame
          flash at the top-left origin). */}
      {desktopAnchor ? (
        <div
          style={{ left: desktopAnchor.left, bottom: desktopAnchor.bottom }}
          className="fixed z-[60] hidden w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:block"
        >
          <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {tr(locale, "Your saved list", "הרשימה השמורה שלך")}
            </p>
            {searchBox}
          </div>
          {renderList("max-h-56")}
        </div>
      ) : null}

      {/* Mobile: full-width bottom sheet with a backdrop. */}
      <div className="sm:hidden">
        <div role="presentation" onClick={onClose} className="fixed inset-0 z-[60] bg-slate-900/40" />
        <div className="fixed inset-x-3 bottom-[calc(8rem+env(safe-area-inset-bottom))] z-[60] flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {tr(locale, "Your saved list", "הרשימה השמורה שלך")}
            </p>
            {searchBox}
          </div>
          {renderList("max-h-[45vh]")}
          <button
            type="button"
            onClick={onClose}
            className="w-full border-t border-slate-200 px-3 py-2.5 text-sm font-semibold text-teal-700 dark:border-slate-800 dark:text-teal-400"
          >
            {tr(locale, "Close", "סגירה")}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
