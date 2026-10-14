import { tr, type AppLocale } from "@/lib/locale";

/**
 * TCK-148: the name a logged entry gets when it is saved to the saved list without one - what it holds, like "Add item"
 * does for a single ingredient: one item -> its name, two or three -> joined with "+", more -> the first two and
 * "+ N more" (ועוד N). The date is only a last resort, for an entry with no items at all.
 */
export function savedListNameFor(itemNames: string[], reportAt: string, locale: AppLocale): string {
  const names = itemNames.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) {
    const date = new Date(reportAt);
    return tr(locale, `Saved report ${date.toISOString().slice(0, 10)}`, `דיווח שמור ${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  if (names.length <= 3) return names.join(" + ");
  return `${names.slice(0, 2).join(" + ")} ${tr(locale, `+ ${names.length - 2} more`, `ועוד ${names.length - 2}`)}`;
}
