import type { NextRequest } from "next/server";

import {
  openDailyReportChatReplyStream,
  type ChatMessage,
  type DailyReportChatProfile,
  type DailyReportChatTargets,
} from "@/lib/ai/daily-report-chat";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { getTodaysDailyReportTotals } from "@/lib/daily-report";
import { normalizeLocale, tr } from "@/lib/locale";
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

  let body: { message?: unknown; chatHistory?: unknown; imageBase64?: unknown; mimeType?: unknown };
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
  const imageBase64 = typeof body.imageBase64 === "string" && body.imageBase64 ? body.imageBase64 : undefined;
  const mimeType = typeof body.mimeType === "string" && body.mimeType ? body.mimeType : undefined;

  if (!userMessage && !imageBase64) {
    return new Response("Message or photo is required", { status: 400 });
  }

  const aiConfig = getAiExtractionConfig();
  if (!aiConfig) {
    return new Response("AI chat is unavailable: missing configuration.", { status: 409 });
  }

  const { data: profileRow } = await supabase
    .from("user_profile")
    .select(
      "preferred_language, dietary_preference, allergies, medical_conditions, medical_conditions_details, regular_medications_details, pregnancy_lactation_status",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const locale = normalizeLocale(profileRow?.preferred_language);
  const profile: DailyReportChatProfile = {
    dietary_preference: profileRow?.dietary_preference ?? null,
    allergies: Array.isArray(profileRow?.allergies) ? (profileRow.allergies as string[]) : null,
    medical_conditions: Array.isArray(profileRow?.medical_conditions) ? (profileRow.medical_conditions as string[]) : null,
    medical_conditions_details: profileRow?.medical_conditions_details ?? null,
    regular_medications_details: profileRow?.regular_medications_details ?? null,
    pregnancy_lactation_status: profileRow?.pregnancy_lactation_status ?? null,
  };

  const { data: targetRow } = await supabase
    .from("user_target_profiles")
    .select(
      "calories_min, calories_max, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, fats_min_g, fats_max_g, fiber_min_g, fiber_max_g, water_min_ml, water_max_ml, sodium_min_mg, sodium_max_mg, added_sugar_min_g, added_sugar_max_g, calcium_min_mg, calcium_max_mg, vit_c_min_mg, vit_c_max_mg, vit_b12_min_mcg, vit_b12_max_mcg, vit_d_min_mcg, vit_d_max_mcg, sat_fat_min_g, sat_fat_max_g, omega3_min_g, omega3_max_g",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  const targets: DailyReportChatTargets = targetRow ?? null;

  const todaysTotals = await getTodaysDailyReportTotals({ supabase, userId: user.id });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const upstream = await openDailyReportChatReplyStream({
          config: aiConfig,
          locale,
          chatHistory,
          userMessage,
          imageBase64,
          mimeType,
          profile,
          targets,
          todaysTotals,
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
        controller.enqueue(
          sseEvent({
            type: "error",
            message: tr(locale, "The chat connection failed. Please try again.", "חיבור הצ'אט נכשל. יש לנסות שוב."),
          }),
        );
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
