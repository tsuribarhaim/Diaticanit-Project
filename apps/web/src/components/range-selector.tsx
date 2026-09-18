"use client";

import Link, { useLinkStatus } from "next/link";

import { Spinner } from "@/components/spinner";
import { RANGE_VALUES, rangeLabels, type HomeRange } from "@/lib/home-overview";
import { tr, type AppLocale } from "@/lib/locale";

/**
 * Rendered inside a <Link> (a direct or nested child) - useLinkStatus()
 * reports whether THAT specific link's navigation is currently pending, so
 * this shows a spinner in place of the label for exactly the pill the user
 * clicked while the new range's data (rings, exercise, and a live AI Coach
 * call) loads server-side. Without this, clicking "30 days" left the old
 * numbers on screen with zero visual change until the new page arrived,
 * which reads as "did my tap even register?" - the same concern already
 * solved for full page navigations by app/loading.tsx, just not covered by
 * it since a same-route searchParams change doesn't always trigger that
 * Suspense boundary the same way.
 */
function PillLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : <>{label}</>;
}

/**
 * The Today/7/30/90-day range switcher, shared by the Home page and the
 * Targets page's Overview view so both stay visually and behaviorally
 * identical (see lib/home-overview.ts's own comment on why they share one
 * data-fetching path too).
 */
export function RangeSelector({
  locale,
  range,
  basePath,
  size = "md",
}: {
  locale: AppLocale;
  range: HomeRange;
  basePath: string;
  size?: "md" | "sm";
}) {
  const pillPadding = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";

  return (
    <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-800/60">
      {RANGE_VALUES.map((value) => (
        <Link
          key={value}
          href={value === "today" ? basePath : `${basePath}?range=${value}`}
          aria-label={tr(locale, rangeLabels[value].en, rangeLabels[value].he)}
          className={`flex min-w-[2.5rem] items-center justify-center rounded-md font-medium ${pillPadding} ${
            range === value ? "bg-teal-700 text-white dark:bg-teal-600" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          <PillLabel label={tr(locale, rangeLabels[value].en, rangeLabels[value].he)} />
        </Link>
      ))}
    </div>
  );
}
