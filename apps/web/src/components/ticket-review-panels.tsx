"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import {
  answerQuestionsAction,
  approveForProductionAction,
  approveProposalAction,
  rejectProposalAction,
  requestAnalysisAction,
  requestChangeAction,
  requestMergeAction,
  requestPromoteAction,
  returnFixAction,
  sendBackFixAction,
  setLessonActiveAction,
  takeOutOfAutomationAction,
  withdrawApprovalAction,
} from "@/app/app/tickets/review-actions";
import { Spinner } from "@/components/spinner";
import { tr, type AppLocale } from "@/lib/locale";
import { buildPairingPrompt, resolveChoices, type FixPayload, type ProposalDecision, type ProposalPayload, type QuestionsPayload } from "@/lib/ticket-proposals";

const REVIEW_HREF = "/app/tickets/review";
const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";
const headingClass = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

/** A button that shows a spinner and disables itself while its own action is running. */
export function ActionButton({
  onClick,
  pending,
  disabled,
  variant = "secondary",
  children,
}: {
  onClick: () => void;
  pending: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  children: ReactNode;
}) {
  const style =
    variant === "primary"
      ? "bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
      : variant === "danger"
        ? "border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
        : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      aria-busy={pending}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${style}`}
    >
      {pending ? <Spinner className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Close (x) and back, both returning to wherever the admin came from. */
export function ReviewNav({ locale, backLabel }: { locale: AppLocale; backLabel: string }) {
  const router = useRouter();
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(REVIEW_HREF);
  }
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={goBack} className="text-sm font-semibold text-teal-700 dark:text-teal-400">
          {tr(locale, "← ", "→ ")}
          {backLabel}
        </button>
        <button
          type="button"
          onClick={goBack}
          aria-label={tr(locale, "Close", "סגירה")}
          title={tr(locale, "Close", "סגירה")}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </>
  );
}

/** Mockup HTML written by the analyst, shown in a sandbox: no scripts, no navigation. */
function MockupFrame({ title, html }: { title: string; html: string }) {
  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">{title}</figcaption>
      <iframe
        title={title}
        sandbox=""
        srcDoc={html}
        loading="lazy"
        className="h-96 w-full rounded-xl border border-slate-200 bg-white dark:border-slate-700"
      />
    </figure>
  );
}

function DecisionList({
  locale,
  decisions,
  chosen,
  onPick,
  namePrefix,
}: {
  locale: AppLocale;
  decisions: ProposalDecision[];
  chosen: number[];
  onPick: (decisionIndex: number, optionIndex: number) => void;
  namePrefix: string;
}) {
  return (
    <div className="space-y-3">
      {decisions.map((decision, di) => (
        <fieldset key={di} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <legend dir="auto" className="px-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{decision.q}</legend>
          {decision.options.map((option, oi) => (
            <label key={oi} className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <input
                type="radio"
                name={`${namePrefix}-${di}`}
                checked={chosen[di] === oi}
                onChange={() => onPick(di, oi)}
                className="mt-1 accent-teal-700"
              />
              <span dir="auto" className="text-sm text-slate-800 dark:text-slate-200">
                {option.label}
                {option.rec ? (
                  <span className="ms-2 text-[10px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400">
                    {tr(locale, "recommended", "מומלץ")}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          {decision.why ? <p dir="auto" className="mt-1 text-xs text-slate-500 dark:text-slate-400">{decision.why}</p> : null}
        </fieldset>
      ))}
    </div>
  );
}

/** While something is waiting on the laptop (a requested merge or analysis), re-read the page on its own so
 * the spinner turns into the result without the admin reloading. */
function useAutoRefresh(active: boolean, everyMs = 8000) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
}

function useReviewAction(locale: AppLocale) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [which, setWhich] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function run(name: string, action: () => Promise<{ error?: string; success?: string }>, after: "list" | "stay" = "list") {
    setError(null);
    setWhich(name);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        setWhich(null);
        return;
      }
      if (after === "list") router.push(`${REVIEW_HREF}?notice=${encodeURIComponent(result.success ?? "")}`);
      else router.refresh();
      setWhich(null);
    });
  }
  return { pending, which, error, run, locale };
}

/** Copies the analyst's notes as a ready prompt for a Claude Code session. Instant feedback, no waiting. */
function CopyBriefButton({ locale, text }: { locale: AppLocale; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      pending={false}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        });
      }}
    >
      {copied ? tr(locale, "Copied - paste it into Claude Code", "הועתק - להדביק ב-Claude Code") : tr(locale, "Copy brief for Claude Code", "העתקת התקציר ל-Claude Code")}
    </ActionButton>
  );
}

export function ProposalPanel({ locale, proposalId, payload, ticketSeq, subject }: { locale: AppLocale; proposalId: string; payload: ProposalPayload; ticketSeq: number; subject: string }) {
  const [chosen, setChosen] = useState<number[]>(() => resolveChoices(payload.decisions ?? [], null));
  const [comment, setComment] = useState("");
  const { pending, which, error, run } = useReviewAction(locale);
  const chosenMap = Object.fromEntries(chosen.map((value, index) => [String(index), value]));
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {payload.summary ? (
          <div className={cardClass}>
            <p dir="auto" className="text-sm text-slate-800 dark:text-slate-200">{payload.summary}</p>
          </div>
        ) : null}
        {payload.needsPairing ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-semibold">{tr(locale, "The analyst suggests building this one together with you.", "האנליסט ממליץ לבנות את זה יחד איתך.")}</p>
            {payload.pairingReason ? <p dir="auto" className="mt-1">{payload.pairingReason}</p> : null}
            <div className="mt-3">
              <CopyBriefButton locale={locale} text={buildPairingPrompt({ ticketSeq, subject, payload, chosen })} />
            </div>
          </div>
        ) : null}
        <div className={cardClass}>
          <h3 className={headingClass}>{tr(locale, "What I found in the code", "מה מצאתי בקוד")}</h3>
          <ul className="list-disc space-y-1 ps-5 text-sm text-slate-800 dark:text-slate-200">
            {(payload.findings ?? []).map((finding, i) => (
              <li key={i} dir="auto">{finding}</li>
            ))}
          </ul>
          {(payload.blastRadius ?? []).length > 0 ? (
            <>
              <h3 className={`${headingClass} mt-4`}>{tr(locale, "Everywhere this reaches", "כל מה שזה נוגע בו")}</h3>
              <ul className="list-disc space-y-1 ps-5 text-sm text-slate-800 dark:text-slate-200">
                {payload.blastRadius.map((item, i) => (
                  <li key={i} dir="auto">{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        {(payload.decisions ?? []).length > 0 ? (
          <div className={cardClass}>
            <h3 className={headingClass}>{tr(locale, "Decisions - my recommendation is selected", "החלטות - ההמלצה שלי מסומנת")}</h3>
            <DecisionList
              locale={locale}
              decisions={payload.decisions ?? []}
              chosen={chosen}
              namePrefix={`d-${proposalId}`}
              onPick={(di, oi) => setChosen((current) => current.map((value, index) => (index === di ? oi : value)))}
            />
          </div>
        ) : (
          <div className={cardClass}>
            <h3 className={headingClass}>{tr(locale, "Decisions", "החלטות")}</h3>
            <p className="text-sm text-slate-800 dark:text-slate-200">
              {tr(locale, "Nothing left to decide: the ticket already settles what to do. Approve to queue it as written.", "אין מה להחליט: הפנייה כבר קובעת מה לעשות. אישור מכניס אותה לתור כפי שהיא.")}
            </p>
          </div>
        )}
        <details className="rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
            {tr(locale, "The brief the night agent will receive", "התקציר שסוכן הלילה יקבל")}
          </summary>
          <pre dir="auto" className="max-h-72 overflow-auto whitespace-pre-wrap rounded-b-2xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
            {payload.brief}
          </pre>
        </details>
      </div>
      <div className="space-y-4">
        {(payload.mockups ?? []).length > 0 ? (
          <div className={cardClass}>
            <h3 className={headingClass}>{tr(locale, "Mockup", "הדמיה")}</h3>
            <div className="space-y-3">
              {payload.mockups.map((mockup, i) => (
                <MockupFrame key={i} title={mockup.title} html={mockup.html} />
              ))}
            </div>
          </div>
        ) : null}
        <div className={cardClass}>
          <h3 className={headingClass}>{tr(locale, "Your answer", "התשובה שלך")}</h3>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            maxLength={2000}
            aria-label={tr(locale, "Comment", "הערה")}
            placeholder={tr(locale, "Optional for Approve. Required for Request a change or Reject.", "אופציונלי באישור. חובה בבקשת שינוי או בדחייה.")}
            className={inputClass}
          />
          {error ? <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton variant="primary" pending={pending && which === "approve"} disabled={pending} onClick={() => run("approve", () => approveProposalAction(proposalId, chosenMap, comment))}>
              {tr(locale, "Approve and queue", "אישור והכנסה לתור")}
            </ActionButton>
            <ActionButton pending={pending && which === "change"} disabled={pending} onClick={() => run("change", () => requestChangeAction(proposalId, chosenMap, comment))}>
              {tr(locale, "Request a change", "בקשת שינוי")}
            </ActionButton>
            <ActionButton variant="danger" pending={pending && which === "reject"} disabled={pending} onClick={() => run("reject", () => rejectProposalAction(proposalId, comment))}>
              {tr(locale, "Reject", "דחייה")}
            </ActionButton>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {tr(
              locale,
              "Approve copies the brief and your choices into the ticket and queues it for the night run. A change goes back to the analyst with your comment. Reject defers the ticket with your reason.",
              "אישור מעתיק את התקציר ואת הבחירות שלך לפנייה ומכניס אותה לתור של ריצת הלילה. בקשת שינוי חוזרת לאנליסט עם ההערה שלך. דחייה דוחה את הפנייה עם הסיבה שלך.",
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export function QuestionsPanel({ locale, proposalId, payload }: { locale: AppLocale; proposalId: string; payload: QuestionsPayload }) {
  const questions = payload.questions ?? [];
  const [answers, setAnswers] = useState<(number | undefined)[]>(() => questions.map(() => undefined));
  const [comment, setComment] = useState("");
  const { pending, which, error, run } = useReviewAction(locale);
  const allDone = answers.every((answer) => answer !== undefined);
  const chosenMap = Object.fromEntries(answers.map((value, index) => [String(index), value ?? -1]));
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className={cardClass}>
          <h3 className={headingClass}>{tr(locale, "Why the night run stopped", "למה ריצת הלילה נעצרה")}</h3>
          <p dir="auto" className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{payload.why}</p>
        </div>
        <div className={cardClass}>
          <h3 className={headingClass}>{tr(locale, "Its questions", "השאלות שלו")}</h3>
          <DecisionList
            locale={locale}
            decisions={questions}
            chosen={answers.map((answer) => answer ?? -1)}
            namePrefix={`q-${proposalId}`}
            onPick={(qi, oi) => setAnswers((current) => current.map((value, index) => (index === qi ? oi : value)))}
          />
        </div>
      </div>
      <div className={`${cardClass} self-start`}>
        <h3 className={headingClass}>{tr(locale, "Your answer", "התשובה שלך")}</h3>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          maxLength={2000}
          aria-label={tr(locale, "Comment", "הערה")}
          placeholder={tr(locale, "Anything else the agent should know", "עוד משהו שהסוכן צריך לדעת")}
          className={inputClass}
        />
        {error ? <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton variant="primary" pending={pending && which === "answer"} disabled={pending || !allDone} onClick={() => run("answer", () => answerQuestionsAction(proposalId, chosenMap, comment))}>
            {tr(locale, "Send answers and re-queue", "שליחת תשובות והכנסה לתור")}
          </ActionButton>
          <ActionButton pending={pending && which === "out"} disabled={pending} onClick={() => run("out", () => takeOutOfAutomationAction(proposalId))}>
            {tr(locale, "Take it out of automation", "הוצאה מהאוטומציה")}
          </ActionButton>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {allDone
            ? tr(locale, "Your answers go into the ticket and it runs again tonight.", "התשובות שלך נכנסות לפנייה והיא תרוץ שוב הלילה.")
            : tr(locale, "Answer every question to re-queue.", "יש לענות על כל השאלות כדי להכניס לתור.")}
        </p>
      </div>
    </div>
  );
}

export function FixPanel({
  locale,
  proposalId,
  payload,
  stage,
  mergeRequested,
  mergeResult,
  revertRequested = false,
  revertResult = null,
}: {
  locale: AppLocale;
  proposalId: string;
  payload: FixPayload;
  /** branch: built on a local branch (flag D); dev: merged on dev, waiting for the admin's test (M); approved: ready for the next promote (R). */
  stage: "branch" | "dev" | "approved";
  mergeRequested: boolean;
  mergeResult: string | null;
  revertRequested?: boolean;
  revertResult?: string | null;
}) {
  const [comment, setComment] = useState("");
  const { pending, which, error, run } = useReviewAction(locale);
  useAutoRefresh(mergeRequested || revertRequested);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className={cardClass}>
          <h3 className={headingClass}>{tr(locale, "What the night run changed", "מה ריצת הלילה שינתה")}</h3>
          <p dir="auto" className="text-sm text-slate-800 dark:text-slate-200">{payload.summary}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {tr(locale, "Branch", "ענף")} <span className="font-mono">{payload.branch}</span> {"·"} {payload.files.length} {tr(locale, "files", "קבצים")}
          </p>
          <ul dir="ltr" className="mt-2 list-disc space-y-0.5 ps-5 font-mono text-xs text-slate-700 dark:text-slate-300">
            {payload.files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>
        {stage !== "branch" && (payload.testSteps?.length ?? 0) > 0 ? (
          <div className={cardClass}>
            <h3 className={headingClass}>{tr(locale, "Try this on dev (localhost:3000)", "לנסות בפיתוח (localhost:3000)")}</h3>
            <ul className="space-y-1.5 text-sm text-slate-800 dark:text-slate-200">
              {payload.testSteps!.map((step, i) => (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" className="mt-1 accent-teal-700" />
                    <span dir="auto">{step}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className={cardClass}>
          <h3 className={headingClass}>{tr(locale, "Verification", "אימות")}</h3>
          <ul className="space-y-1.5 text-sm">
            {payload.checks.map((check, i) => (
              <li key={i} className="flex gap-2 text-slate-800 dark:text-slate-200">
                <span aria-hidden="true" className={check.ok ? "font-bold text-emerald-600" : "font-bold text-amber-600"}>
                  {check.ok ? "✓" : "!"}
                </span>
                <span>
                  <span className="sr-only">{check.ok ? tr(locale, "Passed: ", "עבר: ") : tr(locale, "Not verified: ", "לא אומת: ")}</span>
                  {check.text}
                </span>
              </li>
            ))}
          </ul>
          {payload.verification ? (
            <>
              <h3 className={`${headingClass} mt-4`}>{tr(locale, "The agent's own notes on how it checked", "הערות הסוכן על האופן שבו בדק")}</h3>
              <p dir="auto" className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{payload.verification}</p>
            </>
          ) : null}
        </div>
      </div>
      <div className="space-y-4">
        {payload.shots.length > 0 ? (
          <div className={cardClass}>
            <h3 className={headingClass}>{tr(locale, "Screenshots from the night run", "צילומי מסך מריצת הלילה")}</h3>
            <div className="space-y-3">
              {payload.shots.map((shot, i) => (
                <figure key={i} className="m-0">
                  <figcaption className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">{shot.label}</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a stored data URL, nothing for next/image to optimize */}
                  <img src={shot.dataUrl} alt={shot.label} className="w-full rounded-xl border border-slate-200 dark:border-slate-700" />
                </figure>
              ))}
            </div>
          </div>
        ) : null}
        <div className={cardClass}>
          <h3 className={headingClass}>{tr(locale, "Your answer", "התשובה שלך")}</h3>
          {revertRequested ? (
            <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <Spinner className="h-4 w-4 animate-spin" />
              {tr(locale, "Revert requested - waiting for your laptop to undo the merge (about a minute). This page updates by itself.", "ביטול המיזוג התבקש - ממתין שהמחשב הנייד יבטל אותו (בערך דקה). הדף מתעדכן מעצמו.")}
            </p>
          ) : stage === "dev" || stage === "approved" ? (
            <>
              <p className="mb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {stage === "dev"
                  ? tr(locale, "Merged on dev. Test it, then decide.", "מוזג בפיתוח. יש לבדוק ואז להחליט.")
                  : tr(locale, "Approved for production. It ships with the next promote.", "אושר לייצור. הוא יעלה עם ההעלאה הבאה.")}
              </p>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                maxLength={2000}
                aria-label={tr(locale, "Comment", "הערה")}
                placeholder={tr(locale, "What is wrong? Required to send it back", "מה לא תקין? חובה כדי להחזיר")}
                className={inputClass}
              />
              {error ? <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {stage === "dev" ? (
                  <ActionButton variant="primary" pending={pending && which === "approve"} disabled={pending} onClick={() => run("approve", () => approveForProductionAction(proposalId))}>
                    {tr(locale, "Approve for production", "אישור לייצור")}
                  </ActionButton>
                ) : (
                  <ActionButton pending={pending && which === "withdraw"} disabled={pending} onClick={() => run("withdraw", () => withdrawApprovalAction(proposalId))}>
                    {tr(locale, "Withdraw approval", "ביטול האישור")}
                  </ActionButton>
                )}
                <ActionButton variant="danger" pending={pending && which === "sendback"} disabled={pending} onClick={() => run("sendback", () => sendBackFixAction(proposalId, comment), "stay")}>
                  {tr(locale, "Send back", "החזרה")}
                </ActionButton>
              </div>
            </>
          ) : mergeRequested ? (
            <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <Spinner className="h-4 w-4 animate-spin" />
              {tr(locale, "Merge requested - waiting for your laptop to do it (about a minute). This page updates by itself.", "המיזוג התבקש - ממתין שהמחשב הנייד יבצע אותו (בערך דקה). הדף מתעדכן מעצמו.")}
            </p>
          ) : (
            <>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                maxLength={2000}
                aria-label={tr(locale, "Comment", "הערה")}
                placeholder={tr(locale, "Required if you return it", "חובה אם מחזירים")}
                className={inputClass}
              />
              {error ? <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton variant="primary" pending={pending && which === "merge"} disabled={pending} onClick={() => run("merge", () => requestMergeAction(proposalId))}>
                  {tr(locale, "Merge to dev", "מיזוג לפיתוח")}
                </ActionButton>
                <ActionButton pending={pending && which === "return"} disabled={pending} onClick={() => run("return", () => returnFixAction(proposalId, comment))}>
                  {tr(locale, "Return with a comment", "החזרה עם הערה")}
                </ActionButton>
              </div>
            </>
          )}
          {mergeResult ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{mergeResult}</p> : null}
          {revertResult ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{revertResult}</p> : null}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {tr(
              locale,
              "Nothing reaches production until you press Promote to production on the review page.",
              "שום דבר לא מגיע לייצור עד שתלחץ על 'העלאה לייצור' בדף הסקירה.",
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/** "Run analysis now" - leaves a request the laptop picks up; shows a spinner while it is sent. */
export function RunAnalysisButton({ locale, disabled, requested }: { locale: AppLocale; disabled: boolean; requested: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  useAutoRefresh(requested);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <ActionButton
        variant="primary"
        pending={pending}
        disabled={disabled || requested}
        onClick={() =>
          startTransition(async () => {
            const result = await requestAnalysisAction();
            setMessage(result.error ?? result.success ?? null);
            router.refresh();
          })
        }
      >
        {requested ? tr(locale, "Analysis requested", "ניתוח התבקש") : tr(locale, "Run analysis now", "הרצת ניתוח עכשיו")}
      </ActionButton>
      {message ? <span role="status" className="text-xs text-slate-600 dark:text-slate-400">{message}</span> : null}
    </span>
  );
}

/** The "Promote to production" bar: only rendered when at least one fix is approved. It fires the
 * request and returns - the laptop does the work and a confirmation email reports the outcome. */
export function PromoteBar({
  locale,
  approved,
  running,
  tickets,
}: {
  locale: AppLocale;
  approved: number;
  running: boolean;
  tickets: { seq: number; subject: string; proposalId: string; migration: boolean }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Everything approved is ticked when the dialog opens; unticking leaves a fix for the next promote.
  const [selected, setSelected] = useState<string[]>([]);
  const chosenTickets = tickets.filter((ticket) => selected.includes(ticket.proposalId));
  const hasMigration = chosenTickets.some((ticket) => ticket.migration);
  useAutoRefresh(running);
  if (running) {
    return (
      <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
        <span>
          <span className="font-semibold">{tr(locale, "Promotion requested or running.", "העלאה לייצור התבקשה או רצה.")}</span>{" "}
          {tr(locale, "A confirmation email follows when it ends. You can leave this page.", "מייל אישור יישלח בסיומה. אפשר לעזוב את הדף.")}
        </span>
      </div>
    );
  }
  if (approved === 0) return null;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-teal-700 px-4 py-3 text-white dark:bg-teal-600">
        <span className="text-sm font-semibold">
          {tr(locale, `${approved} fix${approved === 1 ? "" : "es"} approved for production`, approved === 1 ? "תיקון אחד אושר לייצור" : `${approved} תיקונים אושרו לייצור`)}
        </span>
        <button
          type="button"
          onClick={() => {
            setSelected(tickets.map((ticket) => ticket.proposalId));
            setOpen(true);
          }}
          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
        >
          {tr(locale, "Promote to production", "העלאה לייצור")}
        </button>
      </div>
      {message ? <p role="status" className="mb-4 text-sm text-slate-700 dark:text-slate-300">{message}</p> : null}
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={tr(locale, "Promote to production", "העלאה לייצור")} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Promote to production?", "להעלות לייצור?")}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={tr(locale, "Close", "סגירה")}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
              {tr(locale, "Tick the fixes that ship in this release. Untick one to keep it for the next.", "יש לסמן את התיקונים שיעלו בגרסה הזו. אפשר להסיר סימון כדי להשאיר תיקון לגרסה הבאה.")}
            </p>
            <ul className="mt-1 space-y-1 text-sm text-slate-800 dark:text-slate-200">
              {tickets.map((ticket) => (
                <li key={ticket.proposalId}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(ticket.proposalId)}
                      onChange={(event) =>
                        setSelected((current) => (event.target.checked ? [...current, ticket.proposalId] : current.filter((id) => id !== ticket.proposalId)))
                      }
                      className="mt-1 accent-teal-700"
                    />
                    <span dir="auto">
                      TCK-{ticket.seq} - {ticket.subject}
                      {ticket.migration ? <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">{tr(locale, "Migration", "מיגרציה")}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {hasMigration ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {tr(locale, "A database migration is applied to production first.", "מיגרציית מסד נתונים מוחלת קודם על הייצור.")}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {tr(locale, "The request is sent and you can leave. A confirmation email goes to you and Orit when it ends.", "הבקשה נשלחת ואפשר לעזוב. מייל אישור יישלח אליך ולאורית בסיומה.")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionButton
                variant="primary"
                pending={pending}
                disabled={chosenTickets.length === 0}
                onClick={() =>
                  startTransition(async () => {
                    const result = await requestPromoteAction(selected);
                    setMessage(result.error ?? result.success ?? null);
                    setOpen(false);
                    router.refresh();
                  })
                }
              >
                {chosenTickets.length === 0 ? tr(locale, "Tick at least one fix", "יש לסמן לפחות תיקון אחד") : tr(locale, `Send request (${chosenTickets.length})`, `שליחת הבקשה (${chosenTickets.length})`)}
              </ActionButton>
              <ActionButton onClick={() => setOpen(false)} pending={false} disabled={pending}>
                {tr(locale, "Cancel", "ביטול")}
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Switches one learned lesson on or off (Ticket Automation page). */
export function LessonToggle({ locale, lessonId, active }: { locale: AppLocale; lessonId: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <ActionButton
      pending={pending}
      onClick={() =>
        startTransition(async () => {
          await setLessonActiveAction(lessonId, !active);
          router.refresh();
        })
      }
    >
      {active ? tr(locale, "Switch off", "כיבוי") : tr(locale, "Switch on again", "הפעלה מחדש")}
    </ActionButton>
  );
}
