import { after, type NextRequest } from "next/server";

import { applyQuickTargetFieldAction, hasAiTargetsConsent, runBackgroundTargetsCheck } from "@/app/app/targets/actions";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { openChatReplyStream, type ChatMessage } from "@/lib/ai/targets-chat";
import { classifyTargetsQuickApply } from "@/lib/ai/targets-quick-apply";
import { normalizeLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";
import { evaluateTargetWeightSafety, mapTargetProfileRowToPayload, TARGET_PROFILE_COLUMNS, toProfileForTargets } from "@/lib/targets";

export const runtime = "nodejs";

function sseEvent(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

/** The client aborts its fetch after ~20s of no new bytes (see
 * STREAM_INACTIVITY_TIMEOUT_MS in targets-chat-workspace.tsx), and the
 * structured-JSON AI calls this route makes routinely take longer than that.
 * Once the client has given up, Next.js marks this stream's controller
 * closed, and any further controller.enqueue()/close() call throws - which,
 * uncaught, cascades into the error handler trying to enqueue again and
 * throwing a second time. These wrappers make "the client already left" a
 * silent no-op instead of an unhandled-error cascade. */
function safeEnqueue(controller: ReadableStreamDefaultController<Uint8Array>, data: Record<string, unknown>) {
  try {
    controller.enqueue(sseEvent(data));
  } catch {
    // Client already disconnected - nothing left to deliver to.
  }
}

function safeClose(controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    controller.close();
  } catch {
    // Already closed.
  }
}

/**
 * The classification call below has no intermediate progress to report -
 * it's a single AI round trip that either resolves or doesn't - so without
 * this, a slow-but-not-actually-stuck call (AI provider latency, not a
 * real hang) looks identical to a dead connection from the client's own
 * 20s-of-silence timeout (see STREAM_INACTIVITY_TIMEOUT_MS in
 * targets-chat-workspace.tsx). A `heartbeat` frame every 5s resets that
 * client-side timer the same way any other chunk would, so only a call
 * that's actually stalled for the full window still times out.
 */
async function withHeartbeat<T>(controller: ReadableStreamDefaultController<Uint8Array>, fn: () => Promise<T>): Promise<T> {
  const interval = setInterval(() => safeEnqueue(controller, { type: "heartbeat" }), 5000);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}

/** Budget (characters) for the conversation text embedded in the
 * update_targets goal_text prompt - see buildConversationText below for why
 * this is applied newest-message-first rather than as a flat slice. */
const GOAL_TEXT_CONVERSATION_BUDGET = 4000;

/**
 * Joins chatHistory into the "User: ...\nAssistant: ...\n" block sent to the
 * AI, keeping as many of the MOST RECENT messages as fit in the budget
 * rather than the earliest ones. The actual ask (a typed message, or the
 * profile-change note the client appends) is always the newest entry - a
 * flat head-truncation would silently drop exactly that and leave the model
 * looking at stale earlier chat with nothing concrete to act on. Whole
 * messages are dropped from the oldest end (never cut mid-sentence), except
 * the single newest message is always kept in full even if it alone exceeds
 * the budget, since losing it entirely would be worse.
 */
function buildConversationText(chatHistory: ChatMessage[]): string {
  const lines: string[] = [];
  let usedLength = 0;

  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const entry = chatHistory[index];
    const line = `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`;

    if (lines.length > 0 && usedLength + line.length + 1 > GOAL_TEXT_CONVERSATION_BUDGET) {
      break;
    }

    lines.unshift(line);
    usedLength += line.length + 1;
  }

  return lines.join("\n");
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
      "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_other_activities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating, preferred_language, first_name",
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
          const conversationText = buildConversationText(chatHistory);
          const goalText = `Based on the following conversation with the user, update their daily targets accordingly:\n\n${conversationText}`;
          // A separate, presentable value for anything shown back to the
          // user (the draft-review card's "here's what you asked", and
          // raw_goal_text once locked in - see targets-section-tabs.tsx's
          // own history display) - goalText above is deliberately the full
          // wrapped prompt so the AI call has complete context, which makes
          // it unreadable as UI copy. Falls back to the full prompt only in
          // the pathological case of an empty chatHistory, which shouldn't
          // happen given route.ts's own validation earlier in this handler.
          const displayGoalText =
            [...chatHistory].reverse().find((message) => message.role === "user")?.content.trim() || goalText;

          safeEnqueue(controller, { type: "status", status: "generating_targets" });

          // Save-flow redesign (docs/design/targets-save-performance-
          // redesign.md): a tiny, fast classification call replaces the
          // old synchronous full-schema generation here. When it identifies
          // a literal, single-value ask, that field is patched immediately
          // and the user sees it applied in a couple of seconds; the full,
          // careful regeneration (including medical-document context,
          // deliberately NOT run inline here - see decision #3) always
          // still runs, via after(), once this response has gone out.
          const quickAppliedFieldKeys: string[] = [];

          try {
            const classification = await withHeartbeat(controller, () =>
              classifyTargetsQuickApply({
                config: aiConfig,
                goalText,
                profile,
                currentTargets,
                locale,
              }),
            );

            const hasQuickApplyCandidate =
              !classification.needsFullReview &&
              (classification.quickApplyWeightKg !== null || classification.quickApplyDurationDays !== null);

            if (hasQuickApplyCandidate) {
              const candidatePayload = {
                ...currentTargets,
                targetWeightKg: classification.quickApplyWeightKg ?? currentTargets.targetWeightKg,
              };
              const safetyMessage = evaluateTargetWeightSafety(candidatePayload, profile, locale);

              if (safetyMessage) {
                safeEnqueue(controller, { type: "error", message: safetyMessage });
                safeEnqueue(controller, { type: "done" });
                safeClose(controller);
                return;
              }

              const applyResult = await applyQuickTargetFieldAction({
                weightKg: classification.quickApplyWeightKg,
                durationDays: classification.quickApplyDurationDays,
              });

              if (applyResult.error) {
                logServerError("targets.chat", "quick_apply_failed", { userId: user.id, error: applyResult.error });
                safeEnqueue(controller, { type: "error", message: "Could not update your targets. Please try again." });
                safeEnqueue(controller, { type: "done" });
                safeClose(controller);
                return;
              }

              if (classification.quickApplyWeightKg !== null) quickAppliedFieldKeys.push("target_weight_kg");
              if (classification.quickApplyDurationDays !== null) quickAppliedFieldKeys.push("duration_days");

              safeEnqueue(controller, {
                type: "quick_apply",
                weightKg: classification.quickApplyWeightKg,
                durationDays: classification.quickApplyDurationDays,
              });
            } else {
              safeEnqueue(controller, { type: "queued" });
            }
          } catch (error) {
            // Fail safe rather than fail closed: a broken classification
            // call shouldn't block the request - just skip straight to the
            // full background review, same as an explicit needsFullReview.
            logServerError("targets.chat", "quick_apply_classification_failed", {
              userId: user.id,
              error: error instanceof Error ? error.message : "Unknown error",
            });
            safeEnqueue(controller, { type: "queued" });
          }

          after(() =>
            runBackgroundTargetsCheck({
              supabase,
              userId: user.id,
              goalText,
              displayGoalText,
              profile,
              locale,
              aiConfig,
              quickAppliedFieldKeys,
            }),
          );

          safeEnqueue(controller, { type: "done" });
          safeClose(controller);
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
          if (text) safeEnqueue(controller, { type: "token", text });
        }

        function handleToken(token: string) {
          if (markerResolved) {
            emitToken(token);
            return;
          }

          markerPending += token;

          if (markerPending.startsWith(MARKER_ACTIONABLE)) {
            safeEnqueue(controller, { type: "actionable", value: true });
            markerResolved = true;
            emitToken(markerPending.slice(MARKER_ACTIONABLE.length));
            markerPending = "";
            return;
          }

          if (markerPending.startsWith(MARKER_INFO)) {
            safeEnqueue(controller, { type: "actionable", value: false });
            markerResolved = true;
            emitToken(markerPending.slice(MARKER_INFO.length));
            markerPending = "";
            return;
          }

          const stillPossible = MARKER_ACTIONABLE.startsWith(markerPending) || MARKER_INFO.startsWith(markerPending);
          if (!stillPossible || markerPending.length >= MAX_MARKER_BUFFER) {
            // The model didn't follow the marker format - fail safe (no
            // "Update Targets" offered) and surface whatever it said.
            safeEnqueue(controller, { type: "actionable", value: false });
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
          safeEnqueue(controller, { type: "actionable", value: false });
          emitToken(markerPending);
        }

        safeEnqueue(controller, { type: "done" });
        safeClose(controller);
      } catch (error) {
        logServerError("targets.chat", "stream_failed", {
          userId: user.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        safeEnqueue(controller, { type: "error", message: "The chat connection failed. Please try again." });
        safeEnqueue(controller, { type: "done" });
        safeClose(controller);
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
