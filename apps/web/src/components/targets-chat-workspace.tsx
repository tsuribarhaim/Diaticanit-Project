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

function ChatSendButton({ locale, disabled }: { locale: AppLocale; disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
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
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setStreamError(null);
    const historyForRequest = messages;
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setMessages((previous) => [...previous, userMessage, { role: "assistant", content: "" }]);
    setInputValue("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/targets/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, chatHistory: historyForRequest }),
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
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const jsonText = line.slice("data:".length).trim();
          if (!jsonText) continue;

          const event = JSON.parse(jsonText) as
            | { type: "token"; text: string }
            | { type: "targets"; payload: TargetGenerationPayload; source: "ai" | "heuristic"; warning?: string }
            | { type: "error"; message: string }
            | { type: "done" };

          if (event.type === "token") {
            assistantText += event.text;
            setMessages((previous) => {
              const next = [...previous];
              next[next.length - 1] = { role: "assistant", content: assistantText };
              return next;
            });
          } else if (event.type === "targets") {
            setPendingPreview({ source: event.source, payload: event.payload });
            if (event.warning) {
              setStreamError(event.warning);
            }
          } else if (event.type === "error") {
            setStreamError(event.message);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setStreamError(error instanceof Error ? error.message : tr(locale, "The chat request failed. Please try again.", "בקשת הצ'אט נכשלה. יש לנסות שוב."));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
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
          {pendingPreview ? (
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
              onClick={() => sendMessage(tr(locale, "My profile changed - please recalculate my targets.", "הפרופיל שלי השתנה - יש לחשב מחדש את היעדים שלי."))}
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
                  "Ask for a change, e.g. \"reduce my workout days to 2 times a week\".",
                  "בקשו שינוי, לדוגמה \"להפחית את ימי האימון שלי לפעמיים בשבוע\".",
                )}
              </p>
            ) : null}
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
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
            <p className="border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{streamError}</p>
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
