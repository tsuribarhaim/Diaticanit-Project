"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Spinner } from "@/components/spinner";

/** Plain form-action submit button plus the same pending state as
 * DeleteConfirmSubmitButton (saved-item-row-actions.tsx) - disabled with
 * the shared Spinner before the label while the enclosing <form>'s server
 * action runs. Exists so buttons rendered directly inside server-component
 * pages (which can't call useFormStatus themselves) still give feedback
 * instead of looking like the tap did nothing. The spinner is inline (not
 * a flex child) so each caller's existing classes/layout stay untouched. */
export function PendingSubmitButton({
  className,
  children,
  spinnerClassName = "h-3.5 w-3.5",
}: {
  className: string;
  children: ReactNode;
  spinnerClassName?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-70`}
    >
      {pending ? <Spinner className={`${spinnerClassName} me-1.5 inline-block animate-spin align-[-0.125em]`} /> : null}
      {children}
    </button>
  );
}
