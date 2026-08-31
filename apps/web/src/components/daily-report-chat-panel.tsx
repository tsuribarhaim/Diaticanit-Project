"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { DailyReportDefaultsPicker, type DailyReportDefaultItem, type SelectedSavedListItem } from "@/components/daily-report-defaults-picker";
import { SubmitButton } from "@/components/daily-report-submit-button";
import { formatDefaultUnit, tr, type AppLocale } from "@/lib/locale";

export type { DailyReportDefaultItem };

type ChatMessage = { role: "user" | "assistant"; content: string; imagePreviewUrl?: string };
type SseEvent =
  | { type: "token"; text: string }
  | { type: "actionable"; value: boolean }
  | { type: "error"; message: string }
  | { type: "done" };

const STREAM_INACTIVITY_TIMEOUT_MS = 20000;
const ALLOWED_MEAL_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Describing a day's food/drink/exercise, either as a back-and-forth
 * conversation with the AI (which can also see an attached photo and
 * reflect on it immediately), or as a quick one-shot save for something
 * simple that needs no discussion (e.g. "a cup of water") - a compact
 * picker for quick-adding saved-list items is also available either way.
 * This panel never saves anything itself for the "Send" path - it
 * continuously reports the full transcript up to the parent via
 * onTranscriptChange, which keeps a hidden report_text field (and whatever
 * photo/defaults are attached here) in sync so "Conclude & Report" - and
 * everything it already does (safety gate, AI parsing) - handles it exactly
 * as if this had been typed/attached directly into that field. The
 * "Conclude & Report" button itself is rendered here too (right under the
 * compose row) so the fast path never requires a Send round-trip first: its
 * click handler folds in whatever's currently typed but not yet sent before
 * the form submits, so typing something and immediately saving just works.
 */
export function DailyReportChatPanel({
  locale,
  defaultItems,
  onTranscriptChange,
  saveError,
  saveSuccess,
}: {
  locale: AppLocale;
  defaultItems: DailyReportDefaultItem[];
  onTranscriptChange: (text: string) => void;
  saveError?: string;
  saveSuccess?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [selectedSavedListItems, setSelectedSavedListItems] = useState<SelectedSavedListItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasSentOnceRef = useRef(false);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /** Once the assistant's reply finishes streaming, the textarea re-enables
   * (it's disabled while streaming) - focus needs to wait for that same
   * render to commit, so this can't just call .focus() inline after
   * setIsStreaming(false). Skipped on mount (hasSentOnceRef starts false)
   * so opening the page doesn't unexpectedly steal focus. */
  useEffect(() => {
    if (!isStreaming && hasSentOnceRef.current) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, selectedSavedListItems]);

  useEffect(() => {
    const transcript = messages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n");
    onTranscriptChange(transcript);
    // onTranscriptChange is a fresh closure each render (it wraps setState in the parent) -
    // depending only on messages keeps this from re-firing on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  async function sendMessage(text: string, image?: { base64: string; mimeType: string; previewUrl: string }) {
    const trimmed = text.trim();
    if ((!trimmed && !image) || isStreaming) return;

    setStreamError(null);
    setRetryAction(null);
    hasSentOnceRef.current = true;
    const historyForRequest = messages;
    const userContent = trimmed || tr(locale, "(attached a photo)", "(תמונה מצורפת)");
    setMessages((previous) => [
      ...previous,
      { role: "user", content: userContent, imagePreviewUrl: image?.previewUrl },
      { role: "assistant", content: "" },
    ]);
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
    let receivedAnything = false;
    let errorMessage: string | null = null;

    try {
      armTimeout();
      const response = await fetch("/api/daily-report/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          chatHistory: historyForRequest.map((message) => ({ role: message.role, content: message.content })),
          imageBase64: image?.base64,
          mimeType: image?.mimeType,
        }),
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
        setRetryAction(() => () => sendMessage(text, image));
      }
    }

    setIsStreaming(false);
  }

  /**
   * "Conclude & Report" reads report_text from the parent's `reportText`
   * state, which is only ever updated (via onTranscriptChange) when
   * `messages` changes - i.e. after a real Send round-trip. Typing
   * something and clicking Save without ever hitting Send would otherwise
   * submit whatever was typed in *previous* messages while silently
   * dropping the not-yet-sent text sitting in the box. This folds that
   * pending text in as one final line right before the native form
   * submission fires, so a plain type-then-save works without needing a
   * conversational reply first. flushSync is required here (not just
   * setState) because the button is a native type="submit" - the browser
   * reads the form's current field values immediately after this onClick
   * returns, so the hidden report_text textarea's DOM value must already
   * reflect the merged text by then, not on React's next scheduled render.
   */
  function handleQuickSave() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    const finalMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    const transcript = finalMessages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n");

    flushSync(() => {
      setMessages(finalMessages);
      onTranscriptChange(transcript);
    });
    setInputValue("");
  }

  async function handlePhotoSelected(file: File | null) {
    setPhotoError(null);
    if (!file) return;

    if (!ALLOWED_MEAL_PHOTO_TYPES.includes(file.type)) {
      setPhotoError(tr(locale, "Photo must be a JPEG, PNG, or WEBP image.", "התמונה חייבת להיות מסוג JPEG, PNG או WEBP."));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError(tr(locale, "Photo must be 10 MB or smaller.", "התמונה חייבת להיות עד 10MB."));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPhotoPreviewUrl(previewUrl);
    const base64 = await readFileAsBase64(file);
    const textToSend = inputValue;
    setInputValue("");
    void sendMessage(textToSend, { base64, mimeType: file.type, previewUrl });
  }

  /**
   * The "choose from gallery/files" input intentionally has no `name` of its
   * own, since a second same-named file input would add a second, empty
   * FormData entry that could shadow the real one. Instead, its selection is
   * copied into the canonical meal_photo input via DataTransfer so form
   * submission always reads the right file regardless of which picker the
   * user used.
   */
  function handleGalleryPhotoSelected(file: File | null) {
    if (file && photoInputRef.current) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      photoInputRef.current.files = transfer.files;
    }
    void handlePhotoSelected(file);
  }

  function clearAttachedPhoto() {
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (photoGalleryInputRef.current) photoGalleryInputRef.current.value = "";
    setPhotoPreviewUrl(null);
  }

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white">
      <input
        ref={photoGalleryInputRef}
        type="file"
        accept="image/*"
        onChange={(event) => handleGalleryPhotoSelected(event.target.files?.[0] ?? null)}
        className="sr-only"
      />
      <input
        ref={photoInputRef}
        id="daily-report-chat-photo-input"
        name="meal_photo"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void handlePhotoSelected(event.target.files?.[0] ?? null)}
        className="sr-only"
      />

      <div className="flex h-[380px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">
              {tr(
                locale,
                "Tell me what you ate, drank, or did for exercise today (or attach a photo), and I'll help fill in the details. When you're ready, tap \"Conclude & Report\" below.",
                "ספרו לי מה אכלתם, שתיתם או עשיתם מבחינת פעילות גופנית היום (או צרפו תמונה), ואעזור להשלים את הפרטים. כשתהיו מוכנים, לחצו על \"סיום ודיווח\" שלמטה.",
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
                {message.imagePreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={message.imagePreviewUrl} alt="" className="mb-1.5 h-28 w-28 rounded-lg object-cover" />
                ) : null}
                {message.content || (isStreaming && index === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
          {selectedSavedListItems.length ? (
            <div className="flex flex-col items-end">
              <div className="max-w-[85%] rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-700">
                  {tr(locale, "From your saved list", "מהרשימה השמורה")}
                </p>
                {selectedSavedListItems
                  .map((item) => `${item.name} (${item.quantity} ${formatDefaultUnit(item.unit, locale)})`)
                  .join(", ")}
              </div>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>

        {photoError ? (
          <div className="border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{photoError}</div>
        ) : null}

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
        {/* On a narrow portrait phone, three 36px icon buttons plus the Send
            button leave almost no width for the textarea itself. Below the
            `sm` breakpoint (roughly: narrower than a phone turned
            sideways), the icons wrap onto their own row via `sm:contents`
            un-wrapping them back into this same flex row once there's
            enough width - so landscape/tablet/desktop keep the original
            single-row layout unchanged. */}
        <div className="flex flex-col gap-2 border-t border-slate-200 p-3 sm:flex-row sm:items-end">
          <div className="flex items-center gap-2 sm:contents">
            <label
              htmlFor="daily-report-chat-photo-input"
              aria-label={tr(locale, "Take a photo of your plate", "צילום תמונה של הצלחת")}
              title={tr(locale, "Take a photo of your plate", "צילום תמונה של הצלחת")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-teal-300 text-teal-700 hover:bg-teal-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <path d="M9 3h6l1.5 3H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5L9 3Z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </label>
            <label
              aria-label={tr(locale, "Choose an existing photo or file", "בחירת תמונה או קובץ קיים")}
              title={tr(locale, "Choose an existing photo or file", "בחירת תמונה או קובץ קיים")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-teal-300 text-teal-700 hover:bg-teal-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-600"
              onClick={() => photoGalleryInputRef.current?.click()}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </label>

            <DailyReportDefaultsPicker
              locale={locale}
              defaultItems={defaultItems}
              onSelectionChange={setSelectedSavedListItems}
              dropDirection="up"
            />
          </div>

          <div className="flex items-end gap-2 sm:contents">
            <textarea
              ref={textareaRef}
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
      </div>

      {photoPreviewUrl ? (
        <div className="flex items-center justify-between gap-2 border-t border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          <span>
            {tr(
              locale,
              "A photo is attached and will be analyzed by AI when you save.",
              "תמונה מצורפת ותנותח על ידי AI בעת השמירה.",
            )}
          </span>
          <button
            type="button"
            onClick={clearAttachedPhoto}
            className="shrink-0 rounded-full border border-teal-300 bg-white px-2 py-1 font-semibold text-teal-700 hover:bg-teal-100"
          >
            {tr(locale, "Remove", "הסרה")}
          </button>
        </div>
      ) : null}

      <div className="border-t border-slate-200 p-3">
        <p className="mb-2 text-xs text-slate-500">
          {tr(
            locale,
            "Chatting is optional - type something simple and tap Conclude & Report directly to save it right away.",
            "השיחה אופציונלית - אפשר להקליד משהו פשוט וללחוץ ישירות על סיום ודיווח כדי לשמור מיד.",
          )}
        </p>
        {saveError ? (
          <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</p>
        ) : null}
        {saveSuccess ? (
          <p className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{saveSuccess}</p>
        ) : null}
        <SubmitButton locale={locale} onClick={handleQuickSave} />
      </div>
    </div>
  );
}
