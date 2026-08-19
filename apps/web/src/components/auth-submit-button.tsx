"use client";

import { useFormStatus } from "react-dom";

type AuthSubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
};

export function AuthSubmitButton({
  idleLabel,
  pendingLabel,
}: AuthSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
