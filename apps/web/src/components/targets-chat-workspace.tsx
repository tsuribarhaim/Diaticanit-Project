"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { lockTargetsAction, type TargetsActionState } from "@/app/app/targets/actions";
import { LockSubmitButton } from "@/components/targets-workspace";
import { TargetProfileView } from "@/components/target-profile-view";
import { TargetsDiffTable } from "@/components/targets-diff-table";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import { tr, type AppLocale } from "@/lib/locale";
import { computeTargetsDiff } from "@/lib/targets-diff";
import type { ProfileDiffRow, TargetGenerationPayload } from "@/lib/targets";

type ChatMessage = { role: "user" | "assistant"; content: string };
type SseEvent =
  | { type: "token"; text: string }
  | { type: "status"; status: "generating_targets" }
  | { type: "targets"; payload: TargetGenerationPayload; source: "ai" | "heuristic"; warning?: string }
  | { type: "error"; message: string }
  | { type: "done" };

const STREAM_INACTIVITY_TIMEOUT_MS = 20000;

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function ChatSendButton({ locale, disabled }: { locale: AppLocale; disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {tr(locale, "Send", "שליחה")}
    </button>
  );
}

export function TargetsChatWorkspace({
  locale,
  maintenanceCalories,
  currentPayload,
  profileChanges,
}: {
  locale: AppLocale;
  maintenanceCalories: number;
  currentPayload: TargetGenerationPayload;
  profileChanges?: ProfileDiffRow[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [isGeneratingTargets, setIsGeneratingTargets] = useState(false);
  const [awaitingDecisionAt, setAwaitingDecisionAt] = useState<number | null>(null);
  const [decidedAt, setDecidedAt] = useState<Record<number, "updated" | "ignored">>({});
  const [pendingPreview, setPendingPreview] = useState<{ source: "ai" | "heuristic"; payload: TargetGenerationPayload } | null>(null);
  const [lockState, lockFormAction] = useActionState(lockTargetsAction, {} as TargetsActionState);
  const { setHasUnsavedPreview } = useUnsavedPreview();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (lockState.success) {
      router.refresh();
    }
  }, [lockState.success, router]);

  useEffect(() => {
    setHasUnsavedPreview(Boolean(pendingPreview) && !lockState.success);
  }, [pendingPreview, lockState.success, setHasUnsavedPreview]);

  useEffect(() => {
    return () => {
      setHasUnsavedPreview(false);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, awaitingDecisionAt]);

  async function runStream(
    requestBody: Record<string, unknown>,
    handlers: {
      onToken?: (text: string) => void;
      onStatus?: (status: string) => void;
      onTargets?: (payload: TargetGenerationPayload, source: "ai" | "heuristic", warning?: string) => void;
      onErrorEvent?: (message: string) => void;
    },
  ): Promise<{ ok: boolean; receivedAnything: boolean; errorMessage: string | null }> {
    const controller = new AbortController();
    abortRef.current = controller;

    let timeoutId: ReturnType<typeof setTimeout>;
    const armTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort("timeout"), STREAM_INACTIVITY_TIMEOUT_MS);
    };

    let receivedAnything = false;

    try {
      armTimeout();
      const response = await fetch("/api/targets/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(
          response.status === 409
            ? tr(locale, "AI chat is unavailable. Approve AI consent in your profile to enable it.", "צ'אט ה-AI אינו זמין. יש לאשר הסכמת AI בפרופיל שלך כדי להפעיל אותו.")
            : tr(locale, "The chat request failed. Please try again.", "בקשת הצ'אט נכשלה. יש לנסות שוב."),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armTimeout();
        receivedAnything = true;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const jsonText = line.slice("data:".length).trim();
          if (!jsonText) continue;

          const event = JSON.parse(jsonText) as SseEvent;

          if (event.type === "token") {
            handlers.onToken?.(event.text);
          } else if (event.type === "status" && event.status === "generating_targets") {
            handlers.onStatus?.(event.status);
          } else if (event.type === "targets") {
            handlers.onTargets?.(event.payload, event.source, event.warning);
          } else if (event.type === "error") {
            handlers.onErrorEvent?.(event.message);
          }
        }
      }

      clearTimeout(timeoutId!);
      abortRef.current = null;
      return { ok: true, receivedAnything, errorMessage: null };
    } catch (error) {
      clearTimeout(timeoutId!);
      abortRef.current = null;

      const isTimeout = (error as Error).name === "AbortError" && controller.signal.reason === "timeout";
      const isUserAbort = (error as Error).name === "AbortError" && !isTimeout;
      if (isUserAbort) {
        return { ok: false, receivedAnything, errorMessage: null };
      }

      const isNetworkError = error instanceof TypeError;
      const errorMessage = isTimeout
        ? tr(
            locale,
            "This is taking longer than expected. If you're on a phone, make sure it's on the same Wi-Fi network as this computer — tap retry to try again.",
            "זה לוקח יותר זמן מהצפוי. אם אתם משתמשים בטלפון, ודאו שהוא מחובר לאותה רשת Wi-Fi כמו המחשב הזה - יש ללחוץ על ניסיון חוזר.",
          )
        : isNetworkError
          ? tr(
              locale,
              "Couldn't reach the server. If you're on a phone, make sure it's on the same Wi-Fi network as this computer, then retry.",
              "לא ניתן להתחבר לשרת. אם אתם משתמשים בטלפון, ודאו שהוא מחובר לאותה רשת Wi-Fi כמו המחשב הזה, ולאחר מכן נסו שוב.",
            )
          : error instanceof Error
            ? error.message
            : tr(locale, "The chat request failed. Please try again.", "בקשת הצ'אט נכשלה. יש לנסות שוב.");

      return { ok: false, receivedAnything, errorMessage };
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setStreamError(null);
    setRetryAction(null);
    setAwaitingDecisionAt(null);
    const historyForRequest = messages;
    const assistantIndex = messages.length + 1;
    setMessages((previous) => [...previous, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    setInputValue("");
    setIsStreaming(true);

    let assistantText = "";
    const result = await runStream(
      { action: "chat", message: trimmed, chatHistory: historyForRequest },
      {
        onToken: (text) => {
          assistantText += text;
          setMessages((previous) => {
            const next = [...previous];
            next[next.length - 1] = { role: "assistant", content: assistantText };
            return next;
          });
        },
      },
    );

    if (!result.ok) {
      if (result.errorMessage) {
        setStreamError(result.errorMessage);
      }
      if (!assistantText && !result.receivedAnything) {
        setMessages((previous) => previous.slice(0, -1));
        if (result.errorMessage) {
          setRetryAction(() => () => sendMessage(trimmed));
        }
      }
    } else if (assistantText) {
      setAwaitingDecisionAt(assistantIndex);
    }

    setIsStreaming(false);
  }

  async function requestTargetsUpdate(history: ChatMessage[], decisionIndex?: number) {
    if (isStreaming || history.length === 0) return;

    setStreamError(null);
    setRetryAction(null);
    setIsStreaming(true);
    setIsGeneratingTargets(true);

    const result = await runStream(
      { action: "update_targets", chatHistory: history },
      {
        onTargets: (payload, source, warning) => {
          setPendingPreview({ source, payload });
          if (warning) setStreamError(warning);
        },
        onErrorEvent: (message) => setStreamError(message),
      },
    );

    if (result.ok) {
      if (decisionIndex !== undefined) {
        setDecidedAt((previous) => ({ ...previous, [decisionIndex]: "updated" }));
        setAwaitingDecisionAt(null);
      }
    } else if (result.errorMessage) {
      setStreamError(result.errorMessage);
      setRetryAction(() => () => requestTargetsUpdate(history, decisionIndex));
    }

    setIsGeneratingTargets(false);
    setIsStreaming(false);
  }

  function handleRecalculateFromProfileChange() {
    if (isStreaming) return;
    const noteText = tr(
      locale,
      "My profile changed - please recalculate my targets.",
      "הפרופיל שלי השתנה - יש לחשב מחדש את היעדים שלי.",
    );
    const updatedHistory: ChatMessage[] = [...messages, { role: "user", content: noteText }];
    setMessages(updatedHistory);
    setAwaitingDecisionAt(null);
    void requestTargetsUpdate(updatedHistory);
  }

  const displayedPayload = pendingPreview?.payload ?? currentPayload;
  const diffRows = pendingPreview ? computeTargetsDiff(currentPayload, pendingPreview.payload, locale) : [];
  const isNoChanges = Boolean(pendingPreview) && diffRows.length === 0;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
      <div className={isInputFocused ? "hidden space-y-4 md:block" : "space-y-4"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">
            {pendingPreview ? tr(locale, "Preview", "תצוגה מקדימה") : tr(locale, "Current targets", "היעדים הנוכחיים")}
          </p>
          {pendingPreview ? (
            <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
              {pendingPreview.source === "ai" ? "AI" : tr(locale, "Heuristic fallback", "גיבוי יוריסטי")}
            </span>
          ) : null}
        </div>

        {isGeneratingTargets ? (
          <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            <Spinner className="h-4 w-4 shrink-0 animate-spin text-teal-700" />
            <span>{tr(locale, "Updating your targets based on the conversation...", "מעדכן את היעדים שלך בהתאם לשיחה...")}</span>
          </div>
        ) : null}

        {pendingPreview ? (
          diffRows.length ? (
            <TargetsDiffTable rows={diffRows} locale={locale} />
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {tr(
                locale,
                "This recalculation didn't change anything measurable in your targets — nothing new to lock in.",
                "החישוב מחדש לא שינה דבר מדיד ביעדים שלך — אין מה לנעול מחדש.",
              )}
            </p>
          )
        ) : null}

        <TargetProfileView payload={displayedPayload} locale={locale} maintenanceCalories={maintenanceCalories} />

        {pendingPreview ? (
          <form action={lockFormAction} className="space-y-2">
            <input type="hidden" name="goal_text" value={messages.filter((m) => m.role === "user").at(-1)?.content ?? ""} />
            <input type="hidden" name="source" value={pendingPreview.source} />
            <input type="hidden" name="payload_json" value={JSON.stringify(pendingPreview.payload)} />

            {lockState.error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{lockState.error}</p>
            ) : null}

            <LockSubmitButton locale={locale} disabled={isNoChanges} />
          </form>
        ) : null}
      </div>

      {isInputFocused ? (
        <div className="sticky top-0 z-10 -mx-1 mb-1 flex items-center justify-between rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm backdrop-blur md:hidden">
          <span>{tr(locale, "Calories", "קלוריות")}: {displayedPayload.caloriesMin}–{displayedPayload.caloriesMax} kcal</span>
          {isGeneratingTargets ? (
            <span className="flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-teal-700">
              <Spinner className="h-3 w-3 animate-spin" />
              {tr(locale, "Updating...", "מעדכן...")}
            </span>
          ) : pendingPreview ? (
            <span className="rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-teal-700">{tr(locale, "Preview ready", "תצוגה מקדימה מוכנה")}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col md:sticky md:top-6">
        {profileChanges?.length ? (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              {tr(locale, "Your profile has changed since these targets were set", "הפרופיל שלך השתנה מאז נקבעו היעדים הללו")}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-amber-800">
              {profileChanges.map((row) => (
                <li key={row.labelEn}>
                  <span className="font-medium">{tr(locale, row.labelEn, row.labelHe)}:</span> {row.before} → {row.after}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={handleRecalculateFromProfileChange}
              disabled={isStreaming}
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-amber-800"
            >
              {tr(locale, "Recalculate now", "לחישוב מחדש")}
            </button>
          </div>
        ) : null}

        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tr(locale, "Chat", "צ'אט")}</h3>
        <div className="mt-2 flex h-[420px] flex-col rounded-xl border border-slate-200 bg-white">
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">
                {tr(
                  locale,
                  "Ask a question or describe a change, e.g. \"reduce my workout days to 2 times a week\". Chatting won't change anything by itself - you'll always get to choose.",
                  "שאלו שאלה או תארו שינוי, לדוגמה \"להפחית את ימי האימון שלי לפעמיים בשבוע\". שיחה בלבד לא תשנה דבר - תמיד תוכלו לבחור בעצמכם.",
                )}
              </p>
            ) : null}
            {messages.map((message, index) => (
              <div key={index} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    message.role === "user" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-800"
                  }`}
                >
                  {message.content || (isStreaming && index === messages.length - 1 ? "…" : "")}
                </div>

                {message.role === "assistant" && index === awaitingDecisionAt ? (
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => requestTargetsUpdate(messages, index)}
                      disabled={isStreaming}
                      className="rounded-lg bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {tr(locale, "Update Targets", "עדכון היעדים")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecidedAt((previous) => ({ ...previous, [index]: "ignored" }));
                        setAwaitingDecisionAt(null);
                      }}
                      disabled={isStreaming}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {tr(locale, "Ignore", "התעלמות")}
                    </button>
                  </div>
                ) : null}

                {message.role === "assistant" && decidedAt[index] ? (
                  <p className="mt-1 text-xs text-slate-400">
                    {decidedAt[index] === "updated"
                      ? tr(locale, "Targets updated", "היעדים עודכנו")
                      : tr(locale, "Suggestion ignored", "ההצעה נדחתה")}
                  </p>
                ) : null}
              </div>
            ))}
            {isGeneratingTargets ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                  {tr(locale, "Updating your targets...", "מעדכן את היעדים שלך...")}
                </div>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          {streamError ? (
            <div className="flex items-center justify-between gap-2 border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <span>{streamError}</span>
              {retryAction ? (
                <button
                  type="button"
                  onClick={() => retryAction()}
                  className="shrink-0 rounded-lg border border-rose-300 bg-white px-2 py-1 font-semibold text-rose-700 hover:bg-rose-100"
                >
                  {tr(locale, "Retry", "ניסיון חוזר")}
                </button>
              ) : null}
            </div>
          ) : null}

          <form
            className="flex items-end gap-2 border-t border-slate-200 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(inputValue);
            }}
          >
            <textarea
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage(inputValue);
                }
              }}
              rows={2}
              maxLength={500}
              disabled={isStreaming}
              placeholder={tr(locale, "Type a message...", "כתבו הודעה...")}
              className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 disabled:opacity-70"
            />
            <ChatSendButton locale={locale} disabled={isStreaming || !inputValue.trim()} />
          </form>
        </div>
      </div>
    </div>
  );
}
