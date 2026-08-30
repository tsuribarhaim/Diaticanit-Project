"use client";

import { useEffect, useRef, useState } from "react";

import { tr, type AppLocale } from "@/lib/locale";

type ChatMessage = { role: "user" | "assistant"; content: string };
type SseEvent =
  | { type: "token"; text: string }
  | { type: "actionable"; value: boolean }
  | { type: "error"; message: string }
  | { type: "done" };

type Decision = { messageIndex: number; actionable: boolean; status: "pending" | "logged" | "dismissed" };

const STREAM_INACTIVITY_TIMEOUT_MS = 20000;

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/**
 * A conversational alternative to the plain free-text box: the user
 * describes their day back and forth with the AI (which asks brief
 * clarifying questions when a quantity/detail is missing), and once the
 * model judges there's enough detail, "Add to daily report" hands the
 * accumulated description (the user's own messages, concatenated) back to
 * the parent so it can populate the normal report_text textarea and reuse
 * the exact same safety-gate/parse/save pipeline - this panel never saves
 * anything by itself.
 */
export function DailyReportChatPanel({
  locale,
  onLogEntry,
}: {
  locale: AppLocale;
  onLogEntry: (composedText: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setStreamError(null);
    setRetryAction(null);
    setDecision(null);
    const historyForRequest = messages;
    const assistantIndex = messages.length + 1;
    setMessages((previous) => [...previous, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    setInputValue("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let timeoutId: ReturnType<typeof setTimeout>;
    const armTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort("timeout"), STREAM_INACTIVITY_TIMEOUT_MS);
    };

    let assistantText = "";
    let actionable = false;
    let receivedAnything = false;
    let errorMessage: string | null = null;

    try {
      armTimeout();
      const response = await fetch("/api/daily-report/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, chatHistory: historyForRequest }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(
          response.status === 409
            ? tr(locale, "AI chat is currently unavailable.", "צ'אט ה-AI אינו זמין כרגע.")
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
            assistantText += event.text;
            setMessages((previous) => {
              const next = [...previous];
              next[next.length - 1] = { role: "assistant", content: assistantText };
              return next;
            });
          } else if (event.type === "actionable") {
            actionable = event.value;
          } else if (event.type === "error") {
            errorMessage = event.message;
          }
        }
      }

      clearTimeout(timeoutId!);
      abortRef.current = null;
    } catch (error) {
      clearTimeout(timeoutId!);
      abortRef.current = null;

      const isTimeout = (error as Error).name === "AbortError" && controller.signal.reason === "timeout";
      const isUserAbort = (error as Error).name === "AbortError" && !isTimeout;

      if (!isUserAbort) {
        const isNetworkError = error instanceof TypeError;
        errorMessage = isTimeout
          ? tr(locale, "This is taking longer than expected. Please retry.", "זה לוקח יותר זמן מהצפוי. יש לנסות שוב.")
          : isNetworkError
            ? tr(locale, "Couldn't reach the server. Please retry.", "לא ניתן להתחבר לשרת. יש לנסות שוב.")
            : error instanceof Error
              ? error.message
              : tr(locale, "The chat request failed. Please try again.", "בקשת הצ'אט נכשלה. יש לנסות שוב.");
      }
    }

    if (errorMessage) {
      setStreamError(errorMessage);
      if (!assistantText && !receivedAnything) {
        setMessages((previous) => previous.slice(0, -1));
        setRetryAction(() => () => sendMessage(trimmed));
      }
    } else if (assistantText) {
      setDecision({ messageIndex: assistantIndex, actionable, status: "pending" });
    }

    setIsStreaming(false);
  }

  function handleLogEntry() {
    if (!decision || decision.status !== "pending" || !decision.actionable) return;
    const composedText = messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join(". ");
    onLogEntry(composedText);
    setDecision((previous) => (previous ? { ...previous, status: "logged" } : previous));
  }

  function handleKeepChatting() {
    setDecision((previous) => (previous ? { ...previous, status: "dismissed" } : previous));
  }

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex h-[320px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">
              {tr(
                locale,
                "Tell me what you ate, drank, or did for exercise today, and I'll help fill in the details.",
                "ספרו לי מה אכלתם, שתיתם או עשיתם מבחינת פעילות גופנית היום, ואעזור להשלים את הפרטים.",
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
            </div>
          ))}
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

        {/* A plain div, not a <form>: this panel is always mounted inside the
            page's own report <form>, and a nested <form> is invalid HTML
            that Next.js silently repairs by moving/dropping it, breaking
            this input after the first re-render. Enter-to-send and the
            button's onClick cover submission without needing form
            semantics. */}
        <div className="flex items-end gap-2 border-t border-slate-200 p-3">
          <textarea
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
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
          <button
            type="button"
            disabled={isStreaming || !inputValue.trim()}
            onClick={() => void sendMessage(inputValue)}
            onMouseDown={(event) => event.preventDefault()}
            className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
          >
            {isStreaming ? <Spinner className="h-4 w-4 animate-spin" /> : tr(locale, "Send", "שליחה")}
          </button>
        </div>
      </div>

      {decision && decision.status === "pending" && decision.actionable ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-teal-200 bg-teal-50 p-3">
          <p className="text-sm text-teal-900">{tr(locale, "Add this to your daily report?", "להוסיף זאת לדיווח היומי?")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleLogEntry}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
            >
              {tr(locale, "Add to daily report", "הוספה לדיווח היומי")}
            </button>
            <button
              type="button"
              onClick={handleKeepChatting}
              className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-50"
            >
              {tr(locale, "Keep chatting", "המשך שיחה")}
            </button>
          </div>
        </div>
      ) : decision && decision.status === "logged" ? (
        <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400">
          {tr(
            locale,
            "Added to the report below - review it and tap \"Save daily report\" when ready.",
            "נוסף לדיווח שלמטה - יש לבדוק ולאשר בלחיצה על \"שמירת דיווח יומי\" בעת הצורך.",
          )}
        </p>
      ) : null}
    </div>
  );
}
