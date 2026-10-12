/** Fix bundles on screen (docs/design/auto-ticket-handling.md, "Fix bundles"): a bundle is told apart by its LETTER and its own hue, never
 * by colour alone. Kept out of components/bundle-ui.tsx (a client module) so server pages can call it too. Tailwind needs whole class names, so the four palettes are spelled out. */
const HUES = [
  { border: "border-teal-600 dark:border-teal-500", head: "bg-teal-50 dark:bg-teal-950/40", badge: "border-teal-600 bg-teal-100 text-teal-800 dark:border-teal-500 dark:bg-teal-950/60 dark:text-teal-300", chip: "border-teal-500 bg-teal-50 dark:bg-teal-950/40" },
  { border: "border-violet-600 dark:border-violet-400", head: "bg-violet-50 dark:bg-violet-950/40", badge: "border-violet-600 bg-violet-100 text-violet-800 dark:border-violet-400 dark:bg-violet-950/60 dark:text-violet-300", chip: "border-violet-500 bg-violet-50 dark:bg-violet-950/40" },
  { border: "border-sky-600 dark:border-sky-400", head: "bg-sky-50 dark:bg-sky-950/40", badge: "border-sky-600 bg-sky-100 text-sky-800 dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-300", chip: "border-sky-500 bg-sky-50 dark:bg-sky-950/40" },
  { border: "border-rose-600 dark:border-rose-400", head: "bg-rose-50 dark:bg-rose-950/40", badge: "border-rose-600 bg-rose-100 text-rose-800 dark:border-rose-400 dark:bg-rose-950/60 dark:text-rose-300", chip: "border-rose-500 bg-rose-50 dark:bg-rose-950/40" },
];
export const hueOf = (letter: string) => HUES[Math.max(0, (letter.toUpperCase().charCodeAt(0) || 65) - 65) % HUES.length];
