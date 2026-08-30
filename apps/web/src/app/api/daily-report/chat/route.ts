import type { NextRequest } from "next/server";

import { openDailyReportChatReplyStream, type ChatMessage } from "@/lib/ai/daily-report-chat";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { normalizeLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function sseEvent(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { message?: unknown; chatHistory?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const userMessage = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  const chatHistory: ChatMessage[] = Array.isArray(body.chatHistory)
    ? body.chatHistory
        .filter(
          (entry): entry is ChatMessage =>
            Boolean(entry) && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string",
        )
        .slice(-20)
    : [];

  if (!userMessage) {
    return new Response("Message is required", { status: 400 });
  }

  const aiConfig = getAiExtractionConfig();
  if (!aiConfig) {
    return new Response("AI chat is unavailable: missing configuration.", { status: 409 });
  }

  const { data: profileRow } = await supabase
    .from("user_profile")
    .select("preferred_language")
    .eq("user_id", user.id)
    .maybeSingle();

  const locale = normalizeLocale(profileRow?.preferred_language);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const upstream = await openDailyReportChatReplyStream({
          config: aiConfig,
          locale,
          chatHistory,
          userMessage,
        });

        if (!upstream.ok || !upstream.body) {
          const errorText = await upstream.text().catch(() => "");
          throw new Error(`Chat reply request failed (${upstream.status}): ${errorText.slice(0, 200)}`);
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const MARKER_ACTIONABLE = "ACTIONABLE ";
        const MARKER_INFO = "INFO ";
        const MAX_MARKER_BUFFER = 12;
        let markerResolved = false;
        let markerPending = "";

        function emitToken(text: string) {
          if (text) controller.enqueue(sseEvent({ type: "token", text }));
        }

        function handleToken(token: string) {
          if (markerResolved) {
            emitToken(token);
            return;
          }

          markerPending += token;

          if (markerPending.startsWith(MARKER_ACTIONABLE)) {
            controller.enqueue(sseEvent({ type: "actionable", value: true }));
            markerResolved = true;
            emitToken(markerPending.slice(MARKER_ACTIONABLE.length));
            markerPending = "";
            return;
          }

          if (markerPending.startsWith(MARKER_INFO)) {
            controller.enqueue(sseEvent({ type: "actionable", value: false }));
            markerResolved = true;
            emitToken(markerPending.slice(MARKER_INFO.length));
            markerPending = "";
            return;
          }

          const stillPossible = MARKER_ACTIONABLE.startsWith(markerPending) || MARKER_INFO.startsWith(markerPending);
          if (!stillPossible || markerPending.length >= MAX_MARKER_BUFFER) {
            controller.enqueue(sseEvent({ type: "actionable", value: false }));
            markerResolved = true;
            emitToken(markerPending);
            markerPending = "";
          }
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice("data:".length).trim();
            if (payload === "[DONE]") continue;

            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
                handleToken(token);
              }
            } catch {
              // Ignore malformed/partial SSE frames from the upstream provider.
            }
          }
        }

        if (!markerResolved) {
          controller.enqueue(sseEvent({ type: "actionable", value: false }));
          emitToken(markerPending);
        }

        controller.enqueue(sseEvent({ type: "done" }));
        controller.close();
      } catch (error) {
        logServerError("dailyReport.chat", "stream_failed", {
          userId: user.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        controller.enqueue(sseEvent({ type: "error", message: "The chat connection failed. Please try again." }));
        controller.enqueue(sseEvent({ type: "done" }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
