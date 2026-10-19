import { anthropicFetch } from "@/lib/ai/anthropic-fetch";
import type { AiExtractionConfig } from "@/lib/ai/env";
import { anthropicTokens, beginAiUsage, failureOutcome, NO_TOKENS, openAiTokens, type AiCallOutcome, type AiTokens, type AiUsageTag } from "@/lib/ai/usage";

/**
 * The common message shape every call site in lib/ai already builds today
 * (OpenAI's Chat Completions request format - a system message, then
 * user/assistant turns, with content either a plain string or an array of
 * text/image parts for vision). Kept exactly as-is rather than introducing
 * a new provider-neutral shape, so none of the existing, carefully-tuned
 * prompt-building code has to change - only the transport layer (this
 * file) needs to know how to translate it into Claude's shape when needed.
 */
export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

export type AiChatCompletionParams = {
  config: AiExtractionConfig;
  messages: AiChatMessage[];
  temperature?: number;
  /** Maps to response_format:{type:"json_object"} for OpenAI-compatible
   * providers. Claude has no exact equivalent in this API version - the
   * existing prompts already ask for "strict JSON only" in plain text,
   * which is sufficient, so this is a no-op for the anthropic provider. */
  jsonMode?: boolean;
  /** Forwarded to the underlying fetch() for callers that need a
   * request-level timeout (via AbortController). */
  signal?: AbortSignal;
  /** Overrides DEFAULT_AI_REQUEST_TIMEOUT_MS for this call only - see
   * callAiChatCompletion's targets-generation caller for why this exists. */
  timeoutMs?: number;
  /** Which feature this call serves - every call is recorded per person, page and feature (lib/ai/usage.ts). */
  usage: AiUsageTag;
};

/** What a provider call returns inside this file: the text callers get, plus what to record about the call. */
type ProviderResult = { text: string; outcome: AiCallOutcome };

const ANTHROPIC_API_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_JSON_MAX_TOKENS = 8192;
const ANTHROPIC_CHAT_MAX_TOKENS = 2048;

function summarizeTransportError(provider: string, body: string, status: number): string {
  return `AI request failed (${provider}, ${status}): ${body.slice(0, 280)}`;
}

/** Parses a "data:<mime>;base64,<data>" URL into its parts - the only image
 * format any call site in this app produces (camera/gallery captures, all
 * converted client-side into a data URL before reaching these prompts). */
function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function toAnthropicContent(
  content: AiChatMessage["content"],
): string | Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }> {
  if (typeof content === "string") return content;

  return content
    .map((part) => {
      if (part.type === "text") {
        return { type: "text" as const, text: part.text ?? "" };
      }
      if (part.type === "image_url" && part.image_url?.url) {
        const parsed = parseDataUrl(part.image_url.url);
        if (!parsed) return null;
        return {
          type: "image" as const,
          source: { type: "base64" as const, media_type: parsed.mediaType, data: parsed.data },
        };
      }
      return null;
    })
    .filter((part): part is NonNullable<typeof part> => part !== null);
}

/** Splits the system message (always first, by convention in every call
 * site) out into Claude's top-level `system` field, and converts the
 * remaining user/assistant turns' content into Claude's block format. */
function toAnthropicRequestParts(messages: AiChatMessage[]) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const system = systemMessages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");

  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: toAnthropicContent(message.content),
    }));

  return { system, messages: conversation };
}

function extractOpenAiContentText(payload: {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
}): string {
  const messageContent = payload.choices?.[0]?.message?.content;
  if (Array.isArray(messageContent)) {
    return messageContent.map((item) => (typeof item?.text === "string" ? item.text : "")).join("\n");
  }
  return typeof messageContent === "string" ? messageContent : "";
}

async function callOpenAiCompatibleChatCompletion({
  config,
  messages,
  temperature,
  jsonMode,
  signal,
}: AiChatCompletionParams): Promise<ProviderResult> {
  const requestBody = {
    model: config.model,
    temperature: temperature ?? 0,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    messages,
  };

  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, "");
  const candidateUrls = normalizedBaseUrl.endsWith("/v1")
    ? [`${normalizedBaseUrl}/chat/completions`]
    : [`${normalizedBaseUrl}/chat/completions`, `${normalizedBaseUrl}/v1/chat/completions`];

  let response: Response | null = null;
  let lastStatus = 0;
  let lastBody = "";

  for (const candidateUrl of candidateUrls) {
    response = await fetch(candidateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (response.ok) break;

    const body = await response.text();
    lastStatus = response.status;
    lastBody = body;

    if (response.status !== 404) {
      throw new Error(summarizeTransportError("openai", body, response.status));
    }
  }

  if (!response?.ok) {
    throw new Error(summarizeTransportError("openai", lastBody, lastStatus || 404));
  }

  const payload = (await response.json()) as Parameters<typeof extractOpenAiContentText>[0] & {
    id?: string;
    model?: string;
    usage?: Parameters<typeof openAiTokens>[0];
  };
  return {
    text: extractOpenAiContentText(payload),
    outcome: { provider: config.provider, model: payload.model ?? config.model, tokens: openAiTokens(payload.usage), status: "ok", requestId: payload.id ?? null, streamed: false },
  };
}

async function callAnthropicChatCompletion({ config, messages, signal }: AiChatCompletionParams): Promise<ProviderResult> {
  const { system, messages: anthropicMessages } = toAnthropicRequestParts(messages);

  const response = await anthropicFetch(`${(config.baseUrl || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    // No `temperature` - newer Claude models reject it outright
    // ("temperature is deprecated for this model"), unlike OpenAI where
    // it's always accepted.
    body: JSON.stringify({
      model: config.model,
      max_tokens: ANTHROPIC_JSON_MAX_TOKENS,
      // Confirmed via direct testing against this account's model: without
      // this, Claude spends a large, variable chunk of the max_tokens
      // budget on invisible extended-thinking tokens before writing any of
      // the actual JSON (1235 of 8192 in one measured call) - none of that
      // reasoning is needed for a deterministic "convert this into JSON"
      // task, and when thinking runs long it leaves too little budget for
      // the JSON itself, truncating it mid-structure (the repeated
      // "Expected ',' or ']'" parse failures). Disabling it also cut a
      // representative call's latency from 47.5s to 31.9s.
      thinking: { type: "disabled" },
      system,
      messages: anthropicMessages,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(summarizeTransportError("anthropic", body, response.status));
  }

  const payload = (await response.json()) as {
    id?: string;
    model?: string;
    content?: Array<{ type?: string; text?: string }>;
    usage?: Parameters<typeof anthropicTokens>[0];
  };
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
  return {
    text,
    outcome: { provider: "anthropic", model: payload.model ?? config.model, tokens: anthropicTokens(payload.usage), status: "ok", requestId: payload.id ?? null, streamed: false },
  };
}

/** No caller of callAiChatCompletion currently passes its own `signal`, so
 * without a default a slow or stalled provider response has nothing to
 * bound it - it was observed taking 105s+ on a single structured-JSON
 * request before finally failing anyway (the model ran up to its max_tokens
 * ceiling and got cut off mid-JSON). Aborting well before that turns an
 * open-ended, silent wait into a bounded one that reaches the app's
 * existing failure handling (which already falls back gracefully) in a
 * reasonable time instead of well over a minute. */
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 45000;

function withDefaultTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

/** Runs one provider call and records it (lib/ai/usage.ts) - success or failure - then hands back exactly what the
 * call returned or threw, so recording never changes what a caller sees. */
async function recorded(params: AiChatCompletionParams, streamed: boolean, run: () => Promise<ProviderResult>): Promise<string> {
  const finish = beginAiUsage(params.usage);
  try {
    const result = await run();
    void finish(result.outcome);
    return result.text;
  } catch (err) {
    void finish(failureOutcome(err, params.config.provider, params.config.model, streamed));
    throw err;
  }
}

/** Single entry point for every non-streaming "give me back JSON" AI call
 * in this app - branches to the right provider's request/response shape
 * internally so call sites never need to know the difference. */
export async function callAiChatCompletion(params: AiChatCompletionParams): Promise<string> {
  const boundedParams = { ...params, signal: withDefaultTimeout(params.signal, params.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS) };
  return recorded(params, false, () =>
    params.config.provider === "anthropic" ? callAnthropicChatCompletion(boundedParams) : callOpenAiCompatibleChatCompletion(boundedParams),
  );
}

export type AiChatCompletionProgressParams = AiChatCompletionParams & {
  /** Called as text actually arrives from the provider (throttled to at
   * most once per PROGRESS_CALLBACK_MIN_INTERVAL_MS), so a caller can drive
   * real UI progress - e.g. rotating a "still working" status message -
   * instead of a fixed timer that fires regardless of whether the request
   * is making progress. Only meaningful for the anthropic provider (see
   * callAiChatCompletionWithProgress below); for any other provider this
   * falls back to the plain non-streaming call and onProgress never fires,
   * since none of this app's other configured providers are exercised
   * against a real account in this environment today. */
  onProgress?: () => void;
};

const PROGRESS_CALLBACK_MIN_INTERVAL_MS = 1500;

/** Same request/response contract as callAnthropicChatCompletion (full
 * accumulated text, JSON parsed by the caller) but issued with stream:true
 * so onProgress can fire as real tokens arrive - used by generateTargetsWithAi
 * so the ~30-50s full-payload generation call can drive a live "still
 * working" indicator instead of leaving the UI showing nothing until the
 * whole response lands. Deliberately NOT built on top of
 * streamAnthropicAsOpenAiSse/anthropicToOpenAiSseTransform below: those
 * return a Response for direct pass-through to the browser, whereas this
 * needs to run entirely server-side and hand back one accumulated string
 * for the existing JSON-parsing/validation logic downstream to consume
 * unchanged. */
async function callAnthropicChatCompletionStreaming({
  config,
  messages,
  signal,
  onProgress,
}: AiChatCompletionProgressParams): Promise<ProviderResult> {
  const startedAt = Date.now();
  const { system, messages: anthropicMessages } = toAnthropicRequestParts(messages);

  const response = await anthropicFetch(`${(config.baseUrl || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    // No `temperature` - see the note in callAnthropicChatCompletion.
    body: JSON.stringify({
      model: config.model,
      max_tokens: ANTHROPIC_JSON_MAX_TOKENS,
      // See the note in callAnthropicChatCompletion.
      thinking: { type: "disabled" },
      stream: true,
      system,
      messages: anthropicMessages,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(summarizeTransportError("anthropic", body, response.status));
  }
  if (!response.body) {
    throw new Error(summarizeTransportError("anthropic", "empty response body", response.status));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let lastProgressAt = 0;
  const usage = new AnthropicStreamUsage(startedAt);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const jsonText = trimmed.slice("data:".length).trim();
      if (!jsonText) continue;

      try {
        const event = JSON.parse(jsonText) as AnthropicStreamEvent;
        usage.read(event);
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          fullText += event.delta.text;
          const now = Date.now();
          if (onProgress && now - lastProgressAt >= PROGRESS_CALLBACK_MIN_INTERVAL_MS) {
            lastProgressAt = now;
            onProgress();
          }
        }
      } catch {
        // Ignore malformed/partial SSE frames - matches how the non-progress
        // streaming transform below tolerates these.
      }
    }
  }

  return { text: fullText, outcome: usage.outcome(config.model) };
}

/** Progress-reporting counterpart to callAiChatCompletion - same contract
 * (bounded by the same default/override timeout, returns the full
 * accumulated response text) but streams from the provider when possible so
 * onProgress can fire as real output arrives. */
export async function callAiChatCompletionWithProgress(params: AiChatCompletionProgressParams): Promise<string> {
  const boundedParams = { ...params, signal: withDefaultTimeout(params.signal, params.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS) };
  return recorded(params, params.config.provider === "anthropic", () =>
    params.config.provider === "anthropic" ? callAnthropicChatCompletionStreaming(boundedParams) : callOpenAiCompatibleChatCompletion(boundedParams),
  );
}

type AnthropicStreamEvent = {
  type?: string;
  delta?: { type?: string; text?: string };
  message?: { id?: string; model?: string; usage?: Parameters<typeof anthropicTokens>[0] };
  usage?: Parameters<typeof anthropicTokens>[0];
};

/** Collects a streamed reply's usage: message_start carries the input side (and the request id), message_delta the
 * running output count - the last one seen is the total. */
class AnthropicStreamUsage {
  private tokens: AiTokens = { ...NO_TOKENS };
  private requestId: string | null = null;
  private model: string | null = null;
  private firstTokenMs: number | null = null;
  constructor(private readonly startedAt: number) {}
  read(event: AnthropicStreamEvent) {
    if (event.type === "message_start" && event.message) {
      this.requestId = event.message.id ?? null;
      this.model = event.message.model ?? null;
      this.tokens = anthropicTokens(event.message.usage);
    } else if (event.type === "message_delta" && event.usage?.output_tokens !== undefined) {
      this.tokens = { ...this.tokens, output: event.usage.output_tokens };
    } else if (event.type === "content_block_delta" && this.firstTokenMs === null) {
      this.firstTokenMs = Date.now() - this.startedAt;
    }
  }
  outcome(configModel: string, status: AiCallOutcome["status"] = "ok", errorCode: string | null = null): AiCallOutcome {
    return { provider: "anthropic", model: this.model ?? configModel, tokens: this.tokens, status, errorCode, requestId: this.requestId, streamed: true, firstTokenMs: this.firstTokenMs };
  }
}

/**
 * Streaming entry point for the two conversational chat endpoints. Returns
 * a Response whose body is always an OpenAI-shaped SSE stream
 * (`data: {"choices":[{"delta":{"content":"..."}}]}` frames, terminated by
 * `data: [DONE]`) regardless of which provider actually produced it - when
 * the provider is Claude, its own SSE event stream is transformed into
 * that same shape in flight. This means the calling route's token/marker
 * parsing logic (which already expects exactly this OpenAI shape) never
 * needs to know which provider is active.
 */
export async function streamAiChatCompletion(params: AiChatCompletionParams): Promise<Response> {
  const finish = beginAiUsage(params.usage);
  try {
    return params.config.provider === "anthropic" ? await streamAnthropicAsOpenAiSse(params, finish) : await streamOpenAiCompatible(params, finish);
  } catch (err) {
    void finish(failureOutcome(err, params.config.provider, params.config.model, true));
    throw err;
  }
}

type FinishUsage = ReturnType<typeof beginAiUsage>;

/** Hands the stream on unchanged; onCancel runs when the reader stops early (the person closed the chat mid-reply). */
function withCancelHook(stream: ReadableStream<Uint8Array>, onCancel: () => Promise<void>): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      await onCancel();
      await reader.cancel(reason);
    },
  });
}

/** A stream that did not start (bad status) is recorded as an error and handed back unchanged for the route to report. */
function recordFailedStream(response: Response, provider: string, model: string, finish: FinishUsage): Response {
  void finish({ provider, model, tokens: NO_TOKENS, status: "error", errorCode: `http_${response.status}`, streamed: true });
  return response;
}

async function streamOpenAiCompatible({ config, messages, temperature }: AiChatCompletionParams, finish: FinishUsage): Promise<Response> {
  const startedAt = Date.now();
  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = normalizedBaseUrl.endsWith("/v1") ? `${normalizedBaseUrl}/chat/completions` : `${normalizedBaseUrl}/v1/chat/completions`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: temperature ?? 0.4,
      stream: true,
      // The last chunk then carries the token counts (choices: []) - the route's parser skips chunks without content.
      stream_options: { include_usage: true },
      messages,
    }),
  });
  if (!upstream.ok || !upstream.body) return recordFailedStream(upstream, config.provider, config.model, finish);

  // Passes every byte through untouched; only reads the usage chunk on the way.
  const decoder = new TextDecoder();
  let buffer = "";
  let tokens: AiTokens = { ...NO_TOKENS };
  let model = config.model;
  let requestId: string | null = null;
  let firstTokenMs: number | null = null;
  const record = (status: AiCallOutcome["status"], errorCode: string | null) =>
    finish({ provider: config.provider, model, tokens, status, errorCode, requestId, streamed: true, firstTokenMs }, { wait: true });
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const jsonText = line.trim().startsWith("data:") ? line.trim().slice(5).trim() : "";
        if (!jsonText || jsonText === "[DONE]") continue;
        try {
          const event = JSON.parse(jsonText) as { id?: string; model?: string; usage?: Parameters<typeof openAiTokens>[0]; choices?: unknown[] };
          requestId = event.id ?? requestId;
          model = event.model ?? model;
          if (firstTokenMs === null && (event.choices?.length ?? 0) > 0) firstTokenMs = Date.now() - startedAt;
          if (event.usage) tokens = openAiTokens(event.usage);
        } catch {
          // A partial frame - the route's own parser tolerates these too.
        }
      }
    },
    flush: () => record("ok", null),
  });
  const body = withCancelHook(upstream.body.pipeThrough(tap), () => record("error", "client_disconnected"));
  return new Response(body, { status: upstream.status, headers: upstream.headers });
}

/** Rewrites Claude's SSE event stream (content_block_delta / message_stop
 * etc.) into OpenAI-shaped delta frames as bytes flow through, so the
 * consumer's existing parsing code is unaware anything is different. */
function anthropicToOpenAiSseTransform(onEvent: (event: AnthropicStreamEvent) => void, onEnd: (completed: true) => Promise<void>): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonText = trimmed.slice("data:".length).trim();
        if (!jsonText) continue;

        try {
          const event = JSON.parse(jsonText) as AnthropicStreamEvent;
          onEvent(event);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            const shaped = { choices: [{ delta: { content: event.delta.text } }] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(shaped)}\n\n`));
          }
        } catch {
          // Ignore malformed/partial SSE frames - matches how the OpenAI
          // path's own consumer already tolerates these.
        }
      }
    },
    async flush(controller) {
      // Recorded before the final frame, so the row is written while the request is still open.
      await onEnd(true);
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });
}

async function streamAnthropicAsOpenAiSse({ config, messages, signal }: AiChatCompletionParams, finish: FinishUsage): Promise<Response> {
  const { system, messages: anthropicMessages } = toAnthropicRequestParts(messages);
  const usage = new AnthropicStreamUsage(Date.now());

  // No `temperature` - see the note in callAnthropicChatCompletion.
  const upstream = await anthropicFetch(`${(config.baseUrl || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: ANTHROPIC_CHAT_MAX_TOKENS,
      // See the note in callAnthropicChatCompletion - extended thinking adds
      // latency before the reply even starts streaming, for no benefit on a
      // short conversational reply.
      thinking: { type: "disabled" },
      stream: true,
      system,
      messages: anthropicMessages,
    }),
    signal,
  });

  if (!upstream.ok || !upstream.body) {
    return recordFailedStream(upstream, "anthropic", config.model, finish);
  }

  const recordEnd = (completed: boolean) =>
    finish(completed ? usage.outcome(config.model) : usage.outcome(config.model, "error", "client_disconnected"), { wait: true });
  // A reader that stops early (closed the chat) still cost the tokens produced so far: recorded as a disconnect.
  const transformedBody = withCancelHook(
    upstream.body.pipeThrough(anthropicToOpenAiSseTransform((event) => usage.read(event), recordEnd)),
    () => recordEnd(false),
  );
  return new Response(transformedBody, {
    status: upstream.status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
