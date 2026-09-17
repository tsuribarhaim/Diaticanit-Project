/** First glyph of the user's name for the fallback avatar circle when no
 * preset is chosen - not just the first character, since a first name can
 * start with a multi-code-unit character (most relevantly for this app: a
 * few Hebrew letters combined with punctuation marks like a geresh). Using
 * an array/iterator split (not `str[0]`) keeps it to one real glyph either
 * way instead of half of one. Falls back to "?" for a blank/missing name
 * rather than rendering an empty circle. */
export function initialFromName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  return [...trimmed][0]?.toUpperCase() ?? "?";
}
