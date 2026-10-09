/** Overlap guard (docs/design/auto-ticket-handling.md, "Overlap guard"): two tickets that change the same files must not be built
 * in parallel on the same production base - the second one conflicts with the first when it is merged to dev or promoted
 * (TCK-117, 118 and 119 all rewrote the onboarding form). A ticket that overlaps with another one waits for it.
 *
 * Pure functions, no imports: the dashboard, the night-run queue and the tests all use exactly these. */

/** Files that nearly every ticket touches with a small, separate addition (labels). They would block everything, and git
 * merges them without trouble, so they never count as an overlap. */
export const SHARED_FILES: readonly string[] = ["apps/web/src/lib/locale.ts"];

export type TicketFiles = { seq: number; files: string[] };
/** why "fix": the other ticket already has a fix that is not promoted yet. why "queue": it is queued too and goes first. */
export type Blocker = { seq: number; files: string[]; why: "fix" | "queue" };

const normalize = (file: string) => file.replace(/\\/g, "/").replace(/^\.?\//, "").trim();

/** Every source path the analyst's brief names. Older proposals have no file list of their own, but their brief always names the files. */
export function filesFromText(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const found = text.match(/apps\/web\/src\/[A-Za-z0-9_./[\]()@-]+?\.(?:tsx?|css)(?![A-Za-z0-9])/g) ?? [];
  return found.map(normalize);
}

/** The union of file lists, each given as an array of strings (anything else is ignored). */
export function collectFiles(...lists: unknown[]): string[] {
  const all = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) if (typeof item === "string" && item.trim()) all.add(normalize(item));
  }
  return [...all];
}

export function sharedFiles(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return a.filter((file) => other.has(file) && !SHARED_FILES.includes(file));
}

/** For every queued ticket, who it has to wait for. Tickets without a blocker are not in the result.
 * - inFlight: tickets with a fix that is on its branch, on dev or approved, but not promoted yet.
 * - overridden: tickets the admin said to build anyway. */
export function overlapBlockers(queue: TicketFiles[], inFlight: TicketFiles[], overridden: ReadonlySet<number> = new Set()): Map<number, Blocker[]> {
  const result = new Map<number, Blocker[]>();
  const ordered = [...queue].sort((a, b) => a.seq - b.seq);
  for (const ticket of ordered) {
    if (overridden.has(ticket.seq)) continue;
    const blockers: Blocker[] = [];
    for (const other of inFlight) {
      if (other.seq === ticket.seq) continue;
      const common = sharedFiles(ticket.files, other.files);
      if (common.length > 0) blockers.push({ seq: other.seq, files: common, why: "fix" });
    }
    for (const other of ordered) {
      if (other.seq >= ticket.seq) break;
      const common = sharedFiles(ticket.files, other.files);
      if (common.length > 0) blockers.push({ seq: other.seq, files: common, why: "queue" });
    }
    if (blockers.length > 0) result.set(ticket.seq, blockers);
  }
  return result;
}
