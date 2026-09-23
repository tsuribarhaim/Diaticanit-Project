"use client";

import { useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";

import {
  generateOnboardingTargetsAction,
  lockOnboardingTargetsAction,
  negotiateOnboardingTargetsAction,
} from "@/app/app/onboarding/targets-actions";
import { tr, trGendered, type AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";
import { TargetsPlanView } from "@/components/targets-plan-view";

type ChatMessage = { role: "user" | "assistant"; content: string };

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function OnboardingTargetsStep({
  locale,
  firstName,
  userGender,
}: {
  locale: AppLocale;
  firstName?: string | null;
  userGender?: "male" | "female" | null;
}) {
  const [phase, setPhase] = useState<"generating" | "ready" | "error">("generating");
  const [payload, setPayload] = useState<TargetGenerationPayload | null>(null);
  const [source, setSource] = useState<"ai" | "heuristic" | null>(null);
  const [goalText, setGoalText] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    void (async () => {
      const result = await generateOnboardingTargetsAction();
      if ("error" in result) {
        setGenerateError(result.error);
        setPhase("error");
        return;
      }
      setPayload(result.payload);
      setSource(result.source);
      setGoalText(result.goalText);
      setPhase("ready");
    })();
  }, []);

  async function handleRetryGenerate() {
    setPhase("generating");
    setGenerateError(null);
    hasTriggeredRef.current = false;
    const result = await generateOnboardingTargetsAction();
    hasTriggeredRef.current = true;
    if ("error" in result) {
      setGenerateError(result.error);
      setPhase("error");
      return;
    }
    setPayload(result.payload);
    setSource(result.source);
    setGoalText(result.goalText);
    setPhase("ready");
  }

  async function handleSendMessage() {
    const trimmed = chatInput.trim();
    if (!trimmed || !payload || isSending) return;

    setMessages((previous) => [...previous, { role: "user", content: trimmed }]);
    setChatInput("");
    setIsSending(true);

    const result = await negotiateOnboardingTargetsAction({ currentPayload: payload, message: trimmed });

    setIsSending(false);

    if ("error" in result) {
      setMessages((previous) => [...previous, { role: "assistant", content: result.error }]);
      return;
    }

    setPayload(result.payload);
    setSource(result.source);
    setMessages((previous) => [...previous, { role: "assistant", content: result.reply }]);
  }

  async function handleComplete() {
    if (!payload || isLocking) return;
    setIsLocking(true);
    setLockError(null);
    try {
      const result = await lockOnboardingTargetsAction({ payload, source: source ?? "heuristic", goalText });
      if (result?.error) {
        setLockError(result.error);
      }
      // No else branch: success redirects server-side and never returns here.
    } catch (err) {
      // redirect() (called on success, inside lockOnboardingTargetsAction)
      // throws a special Next.js control-flow signal to perform the
      // navigation - a bare catch here would silently swallow it instead
      // of letting it happen, which is exactly what was happening: the
      // button stayed stuck on its loading state forever with no error
      // and no redirect. unstable_rethrow lets that signal (and notFound's)
      // continue past this catch; only a genuine error falls through to
      // the message below.
      unstable_rethrow(err);
      setLockError(
        tr(locale, "Something went wrong completing setup. Please try again.", "משהו השתבש בהשלמת ההגדרה. יש לנסות שוב."),
      );
    } finally {
      setIsLocking(false);
    }
  }

  if (phase === "generating") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-950/40">
          <Spinner className="h-6 w-6 animate-spin text-teal-700 dark:text-teal-400" />
        </div>
        <h2 className="mt-5 text-lg font-bold text-slate-900 dark:text-slate-100">
          {tr(locale, "Finalizing your plan…", "מסיים לבנות את התכנית שלך…")}
        </h2>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          {tr(
            locale,
            "This started the moment you finished the last step - almost there.",
            "זה התחיל ברגע שסיימת את השלב הקודם - כמעט שם.",
          )}
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-rose-700 dark:text-rose-400">
          {generateError ?? tr(locale, "Something went wrong. Please try again.", "משהו השתבש. יש לנסות שוב.")}
        </p>
        <button
          type="button"
          onClick={handleRetryGenerate}
          className="mt-4 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
        >
          {tr(locale, "Retry", "ניסיון חוזר")}
        </button>
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {firstName
            ? tr(locale, `${firstName}, here are your starting targets`, `${firstName}, אלה היעדים ההתחלתיים שלך`)
            : tr(locale, "Your starting targets", "היעדים ההתחלתיים שלך")}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {tr(
            locale,
            "Nothing is locked in yet - review the numbers, ask Daffy anything, and adjust before you begin.",
            "עדיין שום דבר לא ננעל - סקרו את המספרים, שאלו את Daffy כל דבר, והתאימו לפני שתתחילו.",
          )}
        </p>
      </div>

      <TargetsPlanView payload={payload} locale={locale} />

      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-white dark:bg-teal-600">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
          </span>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {tr(locale, "Chat with Daffy — your AI coach", "צ'אט עם Daffy - מאמן ה-AI שלך")}
          </p>
        </div>
        <div className="max-h-64 min-h-[6rem] space-y-2.5 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {trGendered(
                locale,
                userGender,
                "Ask a question or request a change before you lock this in - e.g. \"can we lower the carbs a bit?\"",
                "שאל שאלה או בקש שינוי לפני שתנעל את זה - לדוגמה \"אפשר להוריד קצת את הפחמימות?\"",
                "שאלי שאלה או בקשי שינוי לפני שתנעלי את זה - לדוגמה \"אפשר להוריד קצת את הפחמימות?\"",
              )}
            </p>
          ) : null}
          {messages.map((message, index) => (
            <div key={index} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-teal-700 text-white dark:bg-teal-600"
                    : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
          {isSending ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Spinner className="h-3.5 w-3.5 animate-spin" />
              {tr(locale, "Checking that for you…", "בודק/ת את זה בשבילך…")}
            </div>
          ) : null}
        </div>
        {/* A <div>, not a <form> - this whole step still renders inside the
           wizard's own outer <form> (onboarding-profile-form.tsx), and a
           <form> can't validly nest inside another one (the same class of
           hydration bug fixed for DocumentUploadForm - see that file's own
           note). Enter-to-send is wired explicitly below since there's no
           native form submission to provide it for free. */}
        <div className="flex min-w-0 items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSendMessage();
              }
            }}
            readOnly={isSending}
            placeholder={tr(locale, "Type a message…", "כתוב הודעה…")}
            // min-w-0 overrides a flex item's default content-based min-width
            // (an <input>'s intrinsic minimum can run well past 100% of a
            // narrow phone screen) - without it, this input refused to
            // shrink below that width, pushing Send past the screen edge
            // (confirmed live: "the Send button was half outside the left
            // of the screen" on mobile, worse in RTL since overflow spills
            // toward the start side there).
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={() => void handleSendMessage()}
            disabled={isSending || !chatInput.trim()}
            className="shrink-0 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            {tr(locale, "Send", "שליחה")}
          </button>
        </div>
      </div>

      {lockError ? <p className="text-sm text-rose-700 dark:text-rose-400">{lockError}</p> : null}

      <button
        type="button"
        onClick={handleComplete}
        disabled={isLocking}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 sm:w-auto"
      >
        {isLocking ? <Spinner className="h-4 w-4 animate-spin" /> : null}
        {isLocking
          ? tr(locale, "Setting up your account…", "מגדיר/ה את החשבון שלך…")
          : tr(locale, "Complete onboarding", "השלמת ההרשמה")}
      </button>
    </div>
  );
}
