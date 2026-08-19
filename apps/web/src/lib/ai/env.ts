export type AiExtractionProvider = "github" | "openai" | "custom";

export type AiExtractionConfig = {
  provider: AiExtractionProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function getAiExtractionConfig(): AiExtractionConfig | null {
  const enabled = process.env.AI_EXTRACTION_ENABLED?.toLowerCase() === "true";
  if (!enabled) {
    return null;
  }

  const providerValue = process.env.AI_EXTRACTION_PROVIDER?.toLowerCase();
  const provider: AiExtractionProvider =
    providerValue === "openai" || providerValue === "custom" || providerValue === "github"
      ? providerValue
      : "github";

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
