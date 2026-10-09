import { formatDefaultItemName, type AppLocale } from "@/lib/locale";

const MAX_PARTIAL_MATCHES = 3;
const MIN_PARTIAL_LENGTH = 2;

/** The saved-list kind badge colors - one shared copy for every place that
 * shows a saved item's kind (the chat composers' quick picker and match
 * chips, the Daily Report form's picker, the saved-list page). Lives here,
 * not in a "use client" component, so the server-rendered saved-list page
 * can import it too. */
export function kindBadgeClass(kind: string): string {
  if (kind === "hydration") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400";
  if (kind === "exercise") return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400";
  if (kind === "custom") return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400";
}

/**
 * Trim, lowercase, collapse whitespace and strip punctuation - except a
 * Hebrew geresh/gershayim (' or " right after a Hebrew letter, or their
 * typographic forms U+05F3/U+05F4), so names like צ'יפס or an abbreviation
 * like ש"ח keep their meaning instead of collapsing into another word. The
 * typographic forms are folded into the plain ones so either spelling
 * matches the other.
 */
export function normalizeSavedItemText(value: string): string {
  const chars = Array.from(value.toLowerCase().replace(/׳/g, "'").replace(/״/g, '"'));
  return chars
    .map((char, index) => {
      if (char === "'" || char === '"') return /[א-ת]/.test(chars[index - 1] ?? "") ? char : " ";
      return /[\p{P}\p{S}]/u.test(char) ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * TCK-37: which saved-list items the text typed into a chat composer refers
 * to. `exact` is set only when the whole text is one item's name (its
 * displayed, localized name or its raw stored name) and no other item has
 * that same name - two items that normalize alike are never auto-logged.
 * `partial` lists up to three other items whose name contains the text (2+
 * characters), same-named items first.
 */
export function matchSavedItems<T extends { name: string }>(
  text: string,
  items: T[],
  locale: AppLocale,
): { exact: T | null; partial: T[] } {
  const query = normalizeSavedItemText(text);
  if (!query || items.length === 0) return { exact: null, partial: [] };

  const namesFor = (item: T) => {
    const names = [normalizeSavedItemText(formatDefaultItemName(item.name, locale)), normalizeSavedItemText(item.name)];
    return names.filter((name) => name.length > 0);
  };

  const equal = items.filter((item) => namesFor(item).some((name) => name === query));
  const exact = equal.length === 1 ? equal[0] : null;

  const contains =
    query.length >= MIN_PARTIAL_LENGTH
      ? items.filter((item) => !equal.includes(item) && namesFor(item).some((name) => name.includes(query)))
      : [];
  const partial = [...(exact ? [] : equal), ...contains].slice(0, MAX_PARTIAL_MATCHES);

  return { exact, partial };
}
