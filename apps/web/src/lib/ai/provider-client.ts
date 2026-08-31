import type { AiExtractionConfig } from "@/lib/ai/env";

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
};

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
}: AiChatCompletionParams): Promise<string> {
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

  const payload = (await response.json()) as Parameters<typeof extractOpenAiContentText>[0];
  return extractOpenAiContentText(payload);
}

async function callAnthropicChatCompletion({ config, messages, signal }: AiChatCompletionParams): Promise<string> {
  const { system, messages: anthropicMessages } = toAnthropicRequestParts(messages);

  const response = await fetch(`${(config.baseUrl || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "")}/messages`, {
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
      system,
      messages: anthropicMessages,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(summarizeTransportError("anthropic", body, response.status));
  }

  const payload = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  return (payload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

/** Single entry point for every non-streaming "give me back JSON" AI call
 * in this app - branches to the right provider's request/response shape
 * internally so call sites never need to know the difference. */
export async function callAiChatCompletion(params: AiChatCompletionParams): Promise<string> {
  if (params.config.provider === "anthropic") {
    return callAnthropicChatCompletion(params);
  }
  return callOpenAiCompatibleChatCompletion(params);
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
export async function streamAiChatCompletion({
  config,
  messages,
  temperature,
}: AiChatCompletionParams): Promise<Response> {
  if (config.provider === "anthropic") {
    return streamAnthropicAsOpenAiSse({ config, messages, temperature });
  }
  return streamOpenAiCompatible({ config, messages, temperature });
}

async function streamOpenAiCompatible({ config, messages, temperature }: AiChatCompletionParams): Promise<Response> {
  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = normalizedBaseUrl.endsWith("/v1") ? `${normalizedBaseUrl}/chat/completions` : `${normalizedBaseUrl}/v1/chat/completions`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: temperature ?? 0.4,
      stream: true,
      messages,
    }),
  });
}

/** Rewrites Claude's SSE event stream (content_block_delta / message_stop
 * etc.) into OpenAI-shaped delta frames as bytes flow through, so the
 * consumer's existing parsing code is unaware anything is different. */
function anthropicToOpenAiSseTransform(): TransformStream<Uint8Array, Uint8Array> {
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
          const event = JSON.parse(jsonText) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
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
    flush(controller) {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });
}

async function streamAnthropicAsOpenAiSse({ config, messages, signal }: AiChatCompletionParams): Promise<Response> {
  const { system, messages: anthropicMessages } = toAnthropicRequestParts(messages);

  // No `temperature` - see the note in callAnthropicChatCompletion.
  const upstream = await fetch(`${(config.baseUrl || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: ANTHROPIC_CHAT_MAX_TOKENS,
      stream: true,
      system,
      messages: anthropicMessages,
    }),
    signal,
  });

  if (!upstream.ok || !upstream.body) {
    return upstream;
  }

  const transformedBody = upstream.body.pipeThrough(anthropicToOpenAiSseTransform());
  return new Response(transformedBody, {
    status: upstream.status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
