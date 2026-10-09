/** Shared types and small helpers for the spec-first Auto Ticket Handling review flow (see
 * docs/design/auto-ticket-handling.md and db/migrations/065_phase22_ticket_proposals.sql).
 * Everything here is admin-only data: it is read and written with the admin's own session or
 * the automation secret, never shown to a ticket's creator. */

export type ProposalKind = "proposal" | "questions" | "fix";
export type ProposalStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "superseded"
  | "answered"
  | "taken_out"
  | "merged"
  | "returned"
  | "released";

export type ProposalOption = { label: string; rec?: boolean };
export type ProposalDecision = { q: string; options: ProposalOption[]; why?: string };
export type ProposalMockup = { title: string; html: string };

/** kind "proposal": what the analyst hands over before the night run. */
export type ProposalPayload = {
  summary?: string;
  nature?: "bug" | "logic" | "ui_ux";
  findings: string[];
  blastRadius: string[];
  decisions: ProposalDecision[];
  mockups: ProposalMockup[];
  brief: string;
  /** Every source file the brief tells the night agent to change (repo-relative paths): the overlap guard compares these. */
  expectedFiles?: string[];
  outOfScope: string[];
  /** true when the analyst judges this a change to build together with the admin. */
  needsPairing?: boolean;
  pairingReason?: string;
};

/** kind "questions": the night run read the real code and stopped. */
export type QuestionsPayload = {
  why: string;
  questions: ProposalDecision[];
};

/** kind "fix": the night run committed a fix on a local branch. */
export type FixPayload = {
  summary: string;
  branch: string;
  files: string[];
  checks: { ok: boolean; text: string }[];
  /** The agent's own account of how it checked its work (what it could and could not verify). */
  verification?: string;
  /** What the admin should click through on dev to judge the fix (optional; the night run may omit it). */
  testSteps?: string[];
  shots: { label: string; dataUrl: string }[];
};

export type TicketProposalRow = {
  id: string;
  ticket_id: string;
  kind: ProposalKind;
  version: number;
  status: ProposalStatus;
  payload: ProposalPayload | QuestionsPayload | FixPayload;
  admin_comment: string | null;
  chosen: Record<string, number> | null;
  created_at: string;
  decided_at: string | null;
};

/** "114", "TCK-114", "tck 114" and "#114" all mean ticket 114 - see AdminTicketsTable. */
export function parseTicketNumber(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

/** The admin's picks for one set of decisions: the option index per decision index, falling
 * back to the recommended option (or the first) where nothing was picked. */
export function resolveChoices(decisions: ProposalDecision[], chosen: Record<string, number> | null | undefined): number[] {
  return decisions.map((decision, index) => {
    const picked = chosen?.[String(index)];
    if (typeof picked === "number" && picked >= 0 && picked < decision.options.length) return picked;
    const rec = decision.options.findIndex((option) => option.rec);
    return rec >= 0 ? rec : 0;
  });
}

/** A ready-to-paste prompt for a Claude Code session that will work on the ticket together with the admin:
 * everything the analyst found, the decisions with the admin's current picks, the brief and what is out of scope.
 * English (it is read by Claude, not shown to users). */
export function buildPairingPrompt({
  ticketSeq,
  subject,
  payload,
  chosen,
}: {
  ticketSeq: number;
  subject: string;
  payload: ProposalPayload;
  chosen: number[];
}): string {
  const lines: string[] = [`Let's work on Daffy ticket TCK-${ticketSeq} together: "${subject}".`, "The analyst agent already studied it and wrote the notes below. Start from them, re-check anything that looks doubtful in the real code, and ask me before big decisions.", ""];
  if (payload.pairingReason) lines.push(`Why it is better done together: ${payload.pairingReason}`, "");
  if (payload.summary) lines.push("Summary:", payload.summary, "");
  if (payload.findings?.length) lines.push("Findings:", ...payload.findings.map((f) => `- ${f}`), "");
  if (payload.blastRadius?.length) lines.push("What else could be affected:", ...payload.blastRadius.map((f) => `- ${f}`), "");
  if (payload.decisions?.length) {
    lines.push("Decisions (my current pick first):");
    payload.decisions.forEach((decision, index) => {
      const pick = decision.options[chosen[index]]?.label ?? decision.options.find((option) => option.rec)?.label ?? decision.options[0]?.label ?? "(open)";
      lines.push(`${index + 1}. ${decision.q} -> ${pick}`);
      if (decision.why) lines.push(`   why: ${decision.why}`);
    });
    lines.push("");
  }
  if (payload.brief) lines.push("The analyst's brief:", payload.brief.trim(), "");
  if (payload.outOfScope?.length) lines.push("Out of scope:", ...payload.outOfScope.map((f) => `- ${f}`), "");
  if (payload.mockups?.length) lines.push(`The analyst also drew ${payload.mockups.length} mockup(s); they are on the review page of this ticket.`);
  return lines.join("\n").trim();
}

/** The text that goes into the ticket's log (as a support entry) when a proposal is approved -
 * the night agent reads decisions from there. Stored in English, like every other history entry. */
export function buildApprovedSpecEntry({
  decisions,
  chosen,
  brief,
  comment,
}: {
  decisions: ProposalDecision[];
  chosen: Record<string, number> | null | undefined;
  brief: string;
  comment?: string | null;
}): string {
  const picks = resolveChoices(decisions, chosen);
  const lines: string[] = ["Approved spec (where an admin note earlier in this ticket changes a point below, that note wins):"];
  if (decisions.length > 0) {
    lines.push("Admin choices (these win over the brief wherever they differ):");
    decisions.forEach((decision, index) => {
      lines.push(`${index + 1}. ${decision.q} -> ${decision.options[picks[index]]?.label ?? "(none)"}`);
    });
  }
  if (comment?.trim()) lines.push(`Admin comment: ${comment.trim()}`);
  lines.push("", brief.trim());
  return lines.join("\n");
}

/** Same for the answers to the night run's questions. */
export function buildAnswersEntry({
  questions,
  chosen,
  comment,
}: {
  questions: ProposalDecision[];
  chosen: Record<string, number>;
  comment?: string | null;
}): string {
  const lines: string[] = ["Admin answers to the questions the night run raised (these override the spec where they differ):"];
  questions.forEach((question, index) => {
    const picked = chosen[String(index)];
    lines.push(`${index + 1}. ${question.q} -> ${question.options[picked]?.label ?? "(no answer)"}`);
  });
  if (comment?.trim()) lines.push(`Admin comment: ${comment.trim()}`);
  return lines.join("\n");
}

export const AUTO_HANDLE_PILL_CLASS: Record<string, string> = {
  none: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  S: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  A: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  Y: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
  P: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
  D: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  M: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  R: "bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300",
};

/** States that are waiting on the admin - they get a "needs you" hint and count in the banner. */
export const AUTO_HANDLE_NEEDS_ADMIN = ["A", "P", "D", "M"] as const;
