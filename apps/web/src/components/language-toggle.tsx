"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateLocaleAction } from "@/app/app/actions";
import { ProfileRow, QuickEditSheet } from "@/components/profile-quick-edit";
import { tr, type AppLocale } from "@/lib/locale";

// Each language is always shown in its own language, never translated (TCK-175).
const LANGUAGE_OPTIONS: Array<{ value: AppLocale; label: string }> = [
  { value: "he", label: "עברית" },
  { value: "en", label: "English" },
];

/** Settings' Language row (TCK-175): a regular chevron row that opens a
 * bottom sheet with the two languages, the current one checked. Switching
 * goes through updateLocaleAction + router.refresh(), so the layout flips
 * lang/dir in place without a full reload. */
export function LanguageRow({ locale }: { locale: AppLocale }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const label = tr(locale, "Language", "שפה");

  function select(next: AppLocale) {
    setOpen(false);
    if (next === locale) return;
    startTransition(async () => {
      await updateLocaleAction(next);
      router.refresh();
    });
  }

  return (
    <>
      <ProfileRow
        label={label}
        labelWeight="normal"
        value={locale === "he" ? "עברית" : "English"}
        onClick={() => setOpen(true)}
        disabled={isPending}
      />
      <QuickEditSheet locale={locale} isOpen={open} onClose={() => setOpen(false)} title={label}>
        <div role="radiogroup" aria-label={label} className="-mx-2">
          {LANGUAGE_OPTIONS.map((option) => {
            const checked = option.value === locale;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                lang={option.value}
                onClick={() => select(option.value)}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-2 text-start text-sm font-normal text-slate-900 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60"
              >
                <span>{option.label}</span>
                {checked ? (
                  <svg className="h-5 w-5 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      </QuickEditSheet>
    </>
  );
}
