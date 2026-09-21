"use client";

import { useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

import { deleteDailyReportAction } from "@/app/app/daily-report/actions";
import { DailyReportEditPencilIcon } from "@/components/daily-report-entry-edit-form";
import { directionForLocale, trGendered, type AppLocale } from "@/lib/locale";

function DeleteXIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/** useFormStatus() only reflects the nearest ancestor <form>'s pending
 * state from within a child of that form - reported as the delete
 * confirmation appearing to do nothing until the server action finished,
 * with no indication anything was happening in the meantime. */
function DeleteConfirmSubmitButton({
  locale,
  userGender,
}: {
  locale: AppLocale;
  userGender?: "male" | "female" | null;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-rose-600 dark:hover:bg-rose-500"
    >
      {pending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null}
      {trGendered(locale, userGender, "Delete", "מחיקה", "מחיקה")}
    </button>
  );
}

/**
 * Two quick-action icons on each daily-report entry row's summary - a red
 * "X" that deletes the whole entry (behind a confirmation) and a pencil
 * shortcut straight to that entry's inline quantity/nutrient edit form,
 * without first needing to tap the row to expand it and then tap "Edit"
 * inside. Visually sits inside the row's own <summary> (the click-to-
 * expand toggle covering the whole row), so every handler here calls
 * stopPropagation - without it, tapping either icon would also fire the
 * native <details> toggle underneath, expanding/collapsing the row at the
 * same time as the icon's own action.
 */
export function DailyReportEntryQuickActions({
  locale,
  userGender,
  reportId,
  hasInlineEdit,
}: {
  locale: AppLocale;
  userGender?: "male" | "female" | null;
  reportId: string;
  /** Whether this report actually has an inline "Edit" section to jump to
   * (see page.tsx - some reports, e.g. a weightless custom-target-only
   * entry, don't). The pencil icon is hidden entirely rather than shown
   * disabled when there's nothing for it to open. */
  hasInlineEdit: boolean;
}) {
  const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState(false);
  // Separate from the form's own useFormStatus-driven spinner (see
  // DeleteConfirmSubmitButton) - this gates the backdrop-click-to-dismiss
  // and the "Disregard" button too, so the dialog (and its spinner) can't
  // be dismissed out from under an in-flight delete, which would leave the
  // user back at "nothing visibly happening" for whatever time remains.
  const [isDeleting, setIsDeleting] = useState(false);

  /** Opens both the row's own <details> (so the edit section is even
   * reachable) and the inline edit <details> nested inside it (marked with
   * data-inline-edit-details - see page.tsx) in one tap, exactly matching
   * what the user would see after the two separate taps this replaces
   * (expand the row, then tap "Edit"). Plain DOM writes, not React state -
   * both are native uncontrolled <details> elements owned by the
   * surrounding Server Component, not by this client island. */
  function handleEditClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const outerDetails = event.currentTarget.closest("details");
    if (!outerDetails) return;
    outerDetails.open = true;
    const innerEditDetails = outerDetails.querySelector<HTMLDetailsElement>("[data-inline-edit-details]");
    if (!innerEditDetails) return;
    innerEditDetails.open = true;
    // The outer details' own reveal hasn't laid out yet in this same tick -
    // scrolling now would measure the still-collapsed height and land short.
    requestAnimationFrame(() => {
      innerEditDetails.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  return (
    <>
      {/* gap-2.5: an explicit gap between the two icons (beyond each one's
          own tap-target padding), beyond the default flex spacing - keeps a
          mis-tap between "delete" and "edit" unlikely without pushing them
          too far apart (gap-5 read as too wide). */}
      <span className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPendingDeleteConfirm(true);
          }}
          aria-label={trGendered(locale, userGender, "Delete entry", "מחיקת רשומה", "מחיקת רשומה")}
          title={trGendered(locale, userGender, "Delete entry", "מחיקת רשומה", "מחיקת רשומה")}
          className="flex h-8 w-8 items-center justify-center rounded-full text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
        >
          <DeleteXIcon className="h-4 w-4" />
        </button>
        {hasInlineEdit ? (
          <button
            type="button"
            onClick={handleEditClick}
            aria-label={trGendered(locale, userGender, "Edit", "עריכה", "עריכה")}
            title={trGendered(locale, userGender, "Edit", "עריכה", "עריכה")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40"
          >
            <DailyReportEditPencilIcon className="h-4 w-4" />
          </button>
        ) : null}
      </span>

      {/* Portaled to document.body with dir set explicitly - the app only
          applies dir="rtl"/"ltr" on a wrapper <div> inside app/app/layout.tsx,
          not on <html>/<body>, so a portal straight to document.body escapes
          it and falls back to the document's default LTR direction (same
          root cause already found and fixed for the daily-report chat
          panel's own portaled dialogs). pendingDeleteConfirm only ever flips
          true from a real click, never during the initial render, so this
          never runs during SSR/hydration. */}
      {pendingDeleteConfirm
        ? createPortal(
            <div
              dir={directionForLocale(locale)}
              className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
              role="presentation"
              onClick={() => {
                if (!isDeleting) setPendingDeleteConfirm(false);
              }}
            >
              <div
                className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-5 py-4">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {trGendered(
                      locale,
                      userGender,
                      "Are you sure you want to delete this record?",
                      "האם אתה בטוח שברצונך למחוק את הרשומה?",
                      "האם את בטוחה שברצונך למחוק את הרשומה?",
                    )}
                  </p>
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => setPendingDeleteConfirm(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {trGendered(locale, userGender, "Disregard", "התעלם", "התעלמי")}
                  </button>
                  <form action={deleteDailyReportAction} onSubmit={() => setIsDeleting(true)}>
                    <input type="hidden" name="report_id" value={reportId} />
                    <DeleteConfirmSubmitButton locale={locale} userGender={userGender} />
                  </form>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
