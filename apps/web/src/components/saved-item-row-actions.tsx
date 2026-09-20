"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { deleteDefaultItemAction, toggleDefaultItemActiveAction } from "@/app/app/daily-report/defaults/actions";
import { directionForLocale, tr, type AppLocale } from "@/lib/locale";

function DeleteXIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function PencilIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M16.862 4.487a2.06 2.06 0 1 1 2.915 2.914L7.5 19.68l-4 1 1-4L16.862 4.487Z" />
      <path d="M15 6.5 17.5 9" />
    </svg>
  );
}

function ActiveDotIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

/**
 * Ticket #5 (Aggregated Tickets): replaces the Saved Items list's old
 * inconsistent layout (a static Active/Inactive pill, a separate "Edit"
 * <details> disclosure, a separate "Delete" form below) with the same
 * icon-row pattern already used for logged Daily Report entries (see
 * DailyReportEntryQuickActions) - a delete "X" on the leading side, an
 * edit pencil and an Active toggle clustered on the trailing side. Lives
 * inside the row's own <summary>, so every handler stops propagation to
 * avoid also firing the native <details> toggle underneath.
 */
export function SavedItemRowActions({
  locale,
  itemId,
  itemName,
  isActive,
}: {
  locale: AppLocale;
  itemId: string;
  itemName: string;
  isActive: boolean;
}) {
  const [activeState, setActiveState] = useState(isActive);
  const [isToggling, setIsToggling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timeoutId = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timeoutId);
  }, [toast]);

  function handleEditClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const details = event.currentTarget.closest("details");
    if (!details) return;
    details.open = true;
    requestAnimationFrame(() => details.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  async function handleToggleActive(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (isToggling) return;
    const nextActive = !activeState;
    setIsToggling(true);
    const result = await toggleDefaultItemActiveAction({ id: itemId, isActive: nextActive });
    setIsToggling(false);
    if (result.error) {
      setToast(tr(locale, "Couldn't update - please try again.", "לא ניתן היה לעדכן - יש לנסות שוב."));
      return;
    }
    setActiveState(nextActive);
    setToast(nextActive ? tr(locale, "Active", "פעיל") : tr(locale, "Deactivated", "הושבת"));
  }

  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setPendingDeleteConfirm(true);
        }}
        aria-label={tr(locale, `Delete ${itemName}`, `מחיקת ${itemName}`)}
        title={tr(locale, "Delete", "מחיקה")}
        className="flex h-8 w-8 items-center justify-center rounded-full text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
      >
        <DeleteXIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleEditClick}
        aria-label={tr(locale, "Edit", "עריכה")}
        title={tr(locale, "Edit", "עריכה")}
        className="flex h-8 w-8 items-center justify-center rounded-full text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40"
      >
        <PencilIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleToggleActive}
        disabled={isToggling}
        aria-label={activeState ? tr(locale, "Active - tap to deactivate", "פעיל - יש להקיש להשבתה") : tr(locale, "Inactive - tap to activate", "לא פעיל - יש להקיש להפעלה")}
        title={activeState ? tr(locale, "Active - tap to deactivate", "פעיל - יש להקיש להשבתה") : tr(locale, "Inactive - tap to activate", "לא פעיל - יש להקיש להפעלה")}
        className={`flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-60 ${
          activeState
            ? "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
            : "text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800"
        }`}
      >
        <ActiveDotIcon className="h-3.5 w-3.5" />
      </button>

      {toast
        ? createPortal(
            <div
              dir={directionForLocale(locale)}
              className="pointer-events-none fixed inset-x-0 top-16 z-[80] flex justify-center px-4"
              role="status"
            >
              <div className="rounded-full bg-slate-900/90 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-slate-100/90 dark:text-slate-900">
                {toast}
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Portaled straight to document.body with dir set explicitly - same
          reasoning as DailyReportEntryQuickActions' own identical dialog:
          the app only applies dir on a wrapper <div>, not <html>/<body>, so
          a portal escapes it and falls back to LTR otherwise. */}
      {pendingDeleteConfirm
        ? createPortal(
            <div
              dir={directionForLocale(locale)}
              className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
              role="presentation"
              onClick={() => setPendingDeleteConfirm(false)}
            >
              <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
                <div className="px-5 py-4">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {tr(locale, `Delete "${itemName}" from your saved list?`, `למחוק את "${itemName}" מהרשימה השמורה?`)}
                  </p>
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setPendingDeleteConfirm(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {tr(locale, "Cancel", "ביטול")}
                  </button>
                  <form action={deleteDefaultItemAction}>
                    <input type="hidden" name="id" value={itemId} />
                    <button type="submit" className="rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500">
                      {tr(locale, "Delete", "מחיקה")}
                    </button>
                  </form>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
