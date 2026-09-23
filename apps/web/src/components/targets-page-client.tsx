"use client";

import { useState } from "react";

import { applyActiveTargetsAction, negotiateActiveTargetsAction } from "@/app/app/targets/plan-actions";
import { TargetsPlanEditor } from "@/components/targets-plan-editor";
import { tr, trGendered, type AppLocale } from "@/lib/locale";
import type { TargetGenerationPayload } from "@/lib/targets";

type PendingChange = {
  payload: TargetGenerationPayload;
  source: "ai" | "heuristic";
  goalText: string;
  status: "pending" | "applied" | "discarded";
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  pendingChange?: PendingChange;
};

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/**
 * The standalone /app/targets page's client half - TargetsPlanEditor (the
 * editable counterpart to the read-only TargetsPlanView onboarding uses)
 * plus a chat that negotiates changes against the LIVE active plan.
 * Deliberately never auto-applies a negotiated chat change (unlike
 * onboarding, where nothing is locked in yet and applying to client state
 * is harmless): every value here is already real, so a chat message
 * always previews - text + a diff - and only becomes real once the user
 * taps Apply. Direct edits in TargetsPlanEditor follow the same
 * preview-then-apply shape when they land outside their safe range (see
 * that component's own comment), so the two ways of changing a target
 * behave consistently.
 */
export function TargetsPageClient({
  initialPayload,
  initialSource,
  locale,
  firstName,
  userGender,
}: {
  initialPayload: TargetGenerationPayload;
  initialSource: "ai" | "heuristic";
  locale: AppLocale;
  firstName?: string | null;
  userGender?: "male" | "female" | null;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [source, setSource] = useState(initialSource);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  function updateMessagePendingChange(index: number, status: PendingChange["status"]) {
    setMessages((previous) =>
      previous.map((message, i) =>
        i === index && message.pendingChange ? { ...message, pendingChange: { ...message.pendingChange, status } } : message,
      ),
    );
  }

  async function handleApply(index: number) {
    const target = messages[index];
    if (!target?.pendingChange || target.pendingChange.status !== "pending") return;
    const { payload: candidatePayload, source: candidateSource, goalText } = target.pendingChange;

    const result = await applyActiveTargetsAction({ payload: candidatePayload, source: candidateSource, goalText });
    if (result.error) {
      setMessages((previous) => [...previous, { role: "assistant", content: result.error as string }]);
      return;
    }

    setPayload(candidatePayload);
    setSource(candidateSource);
    updateMessagePendingChange(index, "applied");
  }

  function handleDiscard(index: number) {
    updateMessagePendingChange(index, "discarded");
  }

  /** Called by TargetsPlanEditor once a direct edit (in-range, or an
   * out-of-range one the user approved after Daffy's check) has actually
   * been written - keeps this component's own payload/source state (what
   * the chat negotiates against next) in sync regardless of which of the
   * two ways of changing a target just happened. */
  function handleDirectEditApplied(newPayload: TargetGenerationPayload) {
    setPayload(newPayload);
  }

  /** Called by TargetsPlanEditor when an out-of-range edit's Daffy check
   * comes back, so that explanation also shows up in the main chat log,
   * not just the inline per-field banner - matches the mockup, which did
   * the same (surface the explanation in chat even before Apply/Discard). */
  function handleDaffyMessageFromEditor(content: string) {
    setMessages((previous) => [...previous, { role: "assistant", content }]);
  }

  async function handleSendMessage() {
    const trimmed = chatInput.trim();
    if (!trimmed || isSending) return;

    setMessages((previous) => [...previous, { role: "user", content: trimmed }]);
    setChatInput("");
    setIsSending(true);

    const result = await negotiateActiveTargetsAction({ message: trimmed });

    setIsSending(false);

    if ("error" in result) {
      setMessages((previous) => [...previous, { role: "assistant", content: result.error }]);
      return;
    }

    if (result.quickApplied) {
      // A literal, in-range single-field ask (e.g. "reduce my weight
      // target by 1kg") - already written server-side, so just adopt it
      // and confirm; no Apply/Discard step, same as a direct in-range
      // tap-to-edit doesn't need one either.
      setPayload(result.payload);
      setSource(result.source);
      setMessages((previous) => [...previous, { role: "assistant", content: result.reply }]);
      return;
    }

    setMessages((previous) => [
      ...previous,
      {
        role: "assistant",
        content: result.reply,
        pendingChange: result.changed
          ? { payload: result.payload, source: result.source, goalText: trimmed, status: "pending" }
          : undefined,
      },
    ]);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {firstName ? tr(locale, `${firstName}'s targets`, `היעדים של ${firstName}`) : tr(locale, "Your targets", "היעדים שלך")}
        </h2>
        {source === "heuristic" ? (
          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            {tr(
              locale,
              "Baseline estimate - AI review wasn't available when this was generated.",
              "הערכה בסיסית - סקירת AI לא הייתה זמינה בעת יצירת התכנית.",
            )}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {tr(
            locale,
            "These are locked in and in effect. Ask Daffy for a change below to preview it before it's applied.",
            "אלה נעולים ובתוקף. בקשו שינוי מ-Daffy למטה כדי לצפות בו לפני שהוא מוחל.",
          )}
        </p>
      </div>

      <TargetsPlanEditor
        payload={payload}
        locale={locale}
        onPayloadUpdated={handleDirectEditApplied}
        onDaffyMessage={handleDaffyMessageFromEditor}
      />

      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-white dark:bg-teal-600">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
          </span>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {tr(locale, "Chat with Daffy — your AI coach", "צ'אט עם Daffy - מאמן ה-AI שלך")}
          </p>
        </div>
        <div className="max-h-96 min-h-[6rem] space-y-2.5 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {trGendered(
                locale,
                userGender,
                "Ask a question or request a change - e.g. \"can we lower the carbs a bit?\"",
                "שאל שאלה או בקש שינוי - לדוגמה \"אפשר להוריד קצת את הפחמימות?\"",
                "שאלי שאלה או בקשי שינוי - לדוגמה \"אפשר להוריד קצת את הפחמימות?\"",
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
              {message.pendingChange ? (
                <div className="mt-1.5 max-w-[85%]">
                  {message.pendingChange.status === "pending" ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleApply(index)}
                        className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                      >
                        {tr(locale, "Apply this change", "החל שינוי זה")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDiscard(index)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        {tr(locale, "Discard", "בטל")}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {message.pendingChange.status === "applied"
                        ? tr(locale, "✓ Applied", "✓ הוחל")
                        : tr(locale, "Discarded", "בוטל")}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ))}
          {isSending ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Spinner className="h-3.5 w-3.5 animate-spin" />
              {tr(locale, "Checking that for you…", "בודק/ת את זה בשבילך…")}
            </div>
          ) : null}
        </div>
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
    </div>
  );
}
