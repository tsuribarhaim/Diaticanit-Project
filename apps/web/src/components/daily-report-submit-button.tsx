"use client";

import { useFormStatus } from "react-dom";

import { tr, type AppLocale } from "@/lib/locale";

/**
 * Submits the shared daily-report <form> regardless of which component
 * renders it - useFormStatus() reflects the nearest ancestor form's pending
 * state no matter where in the tree this button sits, so both the chat
 * panel (quick save) and the non-AI fallback textarea can use the exact
 * same button/behavior.
 */
export function SubmitButton({
  locale,
  onClick,
  isEditing = false,
}: {
  locale: AppLocale;
  onClick?: () => void;
  /** True when this save will update a previously saved report (see the
   * "Edit entry" button on the daily-report list) rather than create a new
   * one - swaps the label so it's clear a save here overwrites, not adds. */
  isEditing?: boolean;
}) {
  const { pending } = useFormStatus();

  const idleLabel = isEditing ? tr(locale, "Save changes", "שמירת שינויים") : tr(locale, "Conclude & Report", "סיום ודיווח");
  const pendingLabel = isEditing ? tr(locale, "Saving changes...", "שומר שינויים...") : tr(locale, "Saving...", "שומר...");

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
