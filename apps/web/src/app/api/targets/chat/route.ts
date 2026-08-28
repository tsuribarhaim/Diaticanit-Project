import type { NextRequest } from "next/server";

import { generateTargetsPayload, hasAiTargetsConsent } from "@/app/app/targets/actions";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { openChatReplyStream, type ChatMessage } from "@/lib/ai/targets-chat";
import { normalizeLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import { mapTargetProfileRowToPayload, TARGET_PROFILE_COLUMNS, type ProfileForTargets } from "@/lib/targets";

export const runtime = "nodejs";

function sseEvent(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function toProfileForTargets(profile: Record<string, unknown>): ProfileForTargets {
  return {
    age: Number(profile.age ?? 0),
    gender: (profile.gender as string) ?? null,
    biological_sex: (profile.biological_sex as string) ?? null,
    height_cm: Number(profile.height_cm ?? 0),
    weight_kg: Number(profile.weight_kg ?? 0),
    activity_level: (profile.activity_level as ProfileForTargets["activity_level"]) ?? "sedentary",
    allergies: Array.isArray(profile.allergies) ? (profile.allergies as string[]) : [],
    medical_conditions: Array.isArray(profile.medical_conditions) ? (profile.medical_conditions as string[]) : [],
    medical_conditions_details: (profile.medical_conditions_details as string) ?? null,
    regular_medications_details: (profile.regular_medications_details as string) ?? null,
    dietary_preference: (profile.dietary_preference as string) ?? null,
    exercise_modalities: Array.isArray(profile.exercise_modalities) ? (profile.exercise_modalities as string[]) : [],
    exercise_schedule_by_modality:
      (profile.exercise_schedule_by_modality as ProfileForTargets["exercise_schedule_by_modality"]) ?? null,
    habits: Array.isArray(profile.habits) ? (profile.habits as string[]) : [],
    pregnancy_lactation_status: (profile.pregnancy_lactation_status as string) ?? null,
    hot_climate_or_heavy_sweating: Boolean(profile.hot_climate_or_heavy_sweating),
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { message?: unknown; chatHistory?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const action = body.action === "update_targets" ? "update_targets" : "chat";
  const userMessage = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  const chatHistory: ChatMessage[] = Array.isArray(body.chatHistory)
    ? body.chatHistory
        .filter(
          (entry): entry is ChatMessage =>
            Boolean(entry) && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string",
        )
        .slice(-20)
    : [];

  if (action === "chat" && !userMessage) {
    return new Response("Message is required", { status: 400 });
  }

  if (action === "update_targets" && chatHistory.length === 0) {
    return new Response("Chat history is required to update targets", { status: 400 });
  }

  const aiConfig = getAiExtractionConfig();
  const hasConsent = aiConfig ? await hasAiTargetsConsent({ supabase, userId: user.id }) : false;

  if (!aiConfig || !hasConsent) {
    return new Response("AI chat is unavailable: missing configuration or consent.", { status: 409 });
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("user_profile")
    .select(
      "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating, preferred_language",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profileRow) {
    return new Response("Profile not found", { status: 404 });
  }

  const { data: activeRow, error: activeRowError } = await supabase
    .from("user_target_profiles")
    .select(TARGET_PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (activeRowError || !activeRow) {
    return new Response("No active target profile to negotiate against", { status: 404 });
  }

  const locale = normalizeLocale(profileRow.preferred_language);
  const profile = toProfileForTargets(profileRow);
  const currentTargets = mapTargetProfileRowToPayload(activeRow);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (action === "update_targets") {
          const conversationText = chatHistory
            .map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`)
            .join("\n");
          const goalText = `Based on the following conversation with the user, update their daily targets accordingly:\n\n${conversationText}`;

          controller.enqueue(sseEvent({ type: "status", status: "generating_targets" }));

          let targetsPayload;
          let source: "ai" | "heuristic" = "heuristic";
          let warning: string | undefined;

          try {
            const result = await generateTargetsPayload({
              goalText,
              profile,
              locale,
              aiConfig,
              hasConsent,
              currentTargets,
              supabase,
              userId: user.id,
            });

            if (result.safetyRejectionMessage || result.notActionableMessage) {
              controller.enqueue(
                sseEvent({ type: "error", message: result.safetyRejectionMessage ?? result.notActionableMessage }),
              );
              controller.enqueue(sseEvent({ type: "done" }));
              controller.close();
              return;
            }

            targetsPayload = result.payload;
            source = result.source;
            warning = result.heuristicReason ?? undefined;
          } catch (error) {
            logServerError("targets.chat", "targets_generation_failed", {
              userId: user.id,
              error: error instanceof Error ? error.message : "Unknown error",
            });
            controller.enqueue(
              sseEvent({ type: "error", message: "Could not update your targets. Please try again." }),
            );
            controller.enqueue(sseEvent({ type: "done" }));
            controller.close();
            return;
          }

          controller.enqueue(sseEvent({ type: "targets", payload: targetsPayload, source, warning }));
          controller.enqueue(sseEvent({ type: "done" }));
          controller.close();
          return;
        }

        const upstream = await openChatReplyStream({
          config: aiConfig,
          locale,
          profile,
          currentTargets,
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

        // The model is instructed to prefix its reply with a machine-parsed
        // "ACTIONABLE " / "INFO " marker (stripped before the user sees it),
        // so the client can offer "Update Targets" only when this specific
        // reply actually called for one - without a second AI round-trip.
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
            // The model didn't follow the marker format - fail safe (no
            // "Update Targets" offered) and surface whatever it said.
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
        logServerError("targets.chat", "stream_failed", {
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
