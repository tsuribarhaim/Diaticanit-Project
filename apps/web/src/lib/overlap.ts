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
export type Blocker = { seq: number; files: string[]; why: "fix" | "queue" | "bundle" };

/** A bundle never has more tickets than this: more is too much to test and to send back as one. */
export const MAX_BUNDLE_SIZE = 4;

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
export function overlapBlockers(
  queue: TicketFiles[],
  inFlight: TicketFiles[],
  overridden: ReadonlySet<number> = new Set(),
  /** ticket number -> bundle id: members of one bundle are built together, so they never wait for each other. */
  bundleOf: ReadonlyMap<number, string> = new Map(),
): Map<number, Blocker[]> {
  const result = new Map<number, Blocker[]>();
  const ordered = [...queue].sort((a, b) => a.seq - b.seq);
  for (const ticket of ordered) {
    if (overridden.has(ticket.seq)) continue;
    const blockers: Blocker[] = [];
    const mine = bundleOf.get(ticket.seq);
    const together = (seq: number) => mine !== undefined && bundleOf.get(seq) === mine;
    for (const other of inFlight) {
      if (other.seq === ticket.seq || together(other.seq)) continue;
      const common = sharedFiles(ticket.files, other.files);
      if (common.length > 0) blockers.push({ seq: other.seq, files: common, why: "fix" });
    }
    for (const other of ordered) {
      if (other.seq >= ticket.seq) break;
      if (together(other.seq)) continue;
      const common = sharedFiles(ticket.files, other.files);
      if (common.length > 0) blockers.push({ seq: other.seq, files: common, why: "queue" });
    }
    if (blockers.length > 0) result.set(ticket.seq, blockers);
  }
  return result;
}

/** Groups of tickets that change the same files, to suggest as bundles: at least two tickets, in ticket-number order, at most
 * MAX_BUNDLE_SIZE each (a bigger overlapping group is cut into chunks in number order; a chunk of one stays on its own). */
export function suggestBundles(tickets: TicketFiles[], max: number = MAX_BUNDLE_SIZE): number[][] {
  const ordered = [...tickets].sort((a, b) => a.seq - b.seq);
  const parent = new Map<number, number>(ordered.map((t) => [t.seq, t.seq]));
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      if (sharedFiles(ordered[i].files, ordered[j].files).length > 0) parent.set(find(ordered[j].seq), find(ordered[i].seq));
    }
  }
  const groups = new Map<number, number[]>();
  for (const t of ordered) groups.set(find(t.seq), [...(groups.get(find(t.seq)) ?? []), t.seq]);
  const result: number[][] = [];
  for (const members of groups.values()) {
    for (let i = 0; i < members.length; i += max) {
      const chunk = members.slice(i, i + max);
      if (chunk.length >= 2) result.push(chunk);
    }
  }
  return result.sort((a, b) => a[0] - b[0]);
}

/** The first letter (A, B, ...) that no active bundle uses. */
export function nextBundleLetter(used: readonly string[]): string {
  const taken = new Set(used);
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    if (!taken.has(letter)) return letter;
  }
  return String(used.length + 1);
}
