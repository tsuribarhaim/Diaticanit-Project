export type AiExtractionProvider = "github" | "openai" | "custom" | "anthropic";

export type AiExtractionConfig = {
  provider: AiExtractionProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * Anthropic's key/model live in their own AI_EXTRACTION_ANTHROPIC_* vars
 * rather than sharing AI_EXTRACTION_API_KEY/AI_EXTRACTION_MODEL with
 * OpenAI - so both providers' credentials can sit in .env.local at the
 * same time, and switching between them for comparison is just flipping
 * AI_EXTRACTION_PROVIDER back and forth (plus a restart) instead of
 * re-entering a key every time.
 */
function getAnthropicConfig(): AiExtractionConfig | null {
  const apiKey = process.env.AI_EXTRACTION_ANTHROPIC_API_KEY?.trim();
  const model = process.env.AI_EXTRACTION_ANTHROPIC_MODEL?.trim();
  if (!apiKey || !model) {
    return null;
  }

  const baseUrlFromEnv = process.env.AI_EXTRACTION_ANTHROPIC_BASE_URL?.trim();
  return {
    provider: "anthropic",
    baseUrl: baseUrlFromEnv ? normalizeBaseUrl(baseUrlFromEnv) : "https://api.anthropic.com/v1",
    apiKey,
    model,
  };
}

export function getAiExtractionConfig(): AiExtractionConfig | null {
  const enabled = process.env.AI_EXTRACTION_ENABLED?.toLowerCase() === "true";
  if (!enabled) {
    return null;
  }

  const providerValue = process.env.AI_EXTRACTION_PROVIDER?.toLowerCase();
  const provider: AiExtractionProvider =
    providerValue === "openai" || providerValue === "custom" || providerValue === "github" || providerValue === "anthropic"
      ? providerValue
      : "github";

  if (provider === "anthropic") {
    return getAnthropicConfig();
  }

  const apiKey = process.env.AI_EXTRACTION_API_KEY?.trim();
  const model =
    process.env.AI_EXTRACTION_MODEL?.trim() ||
    (provider === "github" ? "openai/gpt-4.1-mini" : "gpt-4.1-mini");

  if (!apiKey) {
    return null;
  }

  const baseUrlFromEnv = process.env.AI_EXTRACTION_BASE_URL?.trim();
  const baseUrl = baseUrlFromEnv
    ? normalizeBaseUrl(baseUrlFromEnv)
    : provider === "openai"
      ? "https://api.openai.com/v1"
      : "https://models.inference.ai.azure.com";

  return {
    provider,
    baseUrl,
    apiKey,
    model,
  };
}
