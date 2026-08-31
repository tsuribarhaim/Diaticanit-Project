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
export function SubmitButton({ locale, onClick }: { locale: AppLocale; onClick?: () => void }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? tr(locale, "Saving...", "שומר...") : tr(locale, "Conclude & Report", "סיום ודיווח")}
    </button>
  );
}
