import { tr, type AppLocale } from "@/lib/locale";
import type { ProfileDiffRow } from "@/lib/targets";

// Unicode first-strong isolate / pop directional isolate.
const FSI = "⁨";
const PDI = "⁩";

function display(value: string, locale: AppLocale): string {
  return value.trim() === "" ? tr(locale, "None", "ללא") : value;
}

function arrow(locale: AppLocale): string {
  return tr(locale, "→", "←");
}

// TCK-18 / TCK-97: a before→after value follows the page direction - in
// Hebrew "before" sits on the right with a left-pointing arrow
// ("ללא ← פניצילין"), in English "None → Penicillin". Separate flex items
// are used because bidi text reordering cannot move flex items, so mixed
// Hebrew/Latin values (e.g. "B12") can't flip the order; no dir attribute is
// set, the direction comes from the app root. The earlier forced dir="ltr"
// made Hebrew read backwards.
export function ProfileDiffValue({ before, after, locale }: { before: string; after: string; locale: AppLocale }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span>{display(before, locale)}</span>
      <span aria-hidden="true">{arrow(locale)}</span>
      <span>{display(after, locale)}</span>
    </span>
  );
}

// Plain-text form for message strings: each value is wrapped in a bidi
// isolate so it can't reorder relative to the arrow.
export function formatProfileDiffText(row: ProfileDiffRow, locale: AppLocale): string {
  return `${tr(locale, row.labelEn, row.labelHe)} (${FSI}${display(row.before, locale)}${PDI} ${arrow(locale)} ${FSI}${display(row.after, locale)}${PDI})`;
}
