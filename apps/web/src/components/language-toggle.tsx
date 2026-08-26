"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { updateLocaleAction } from "@/app/app/actions";
import type { AppLocale } from "@/lib/locale";

export function LanguageToggle({ locale }: { locale: AppLocale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectLocale(nextLocale: AppLocale) {
    if (nextLocale === locale || isPending) return;
    startTransition(async () => {
      await updateLocaleAction(nextLocale);
      router.refresh();
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm font-semibold"
    >
      <button
        type="button"
        role="radio"
        aria-checked={locale === "en"}
        disabled={isPending}
        onClick={() => selectLocale("en")}
        className={`px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-70 ${
          locale === "en" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-100"
        }`}
      >
        English
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={locale === "he"}
        disabled={isPending}
        onClick={() => selectLocale("he")}
        className={`px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-70 ${
          locale === "he" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-100"
        }`}
      >
        עברית
      </button>
    </div>
  );
}
