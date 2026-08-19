import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";

const aiComponentSchema = z.object({
  category: z.string().trim().min(1).max(60).optional(),
  component_name: z.string().trim().min(1).max(120),
  measured_value: z.number().finite(),
  unit: z.string().trim().max(30).optional(),
  reference_min: z.number().finite().optional(),
  reference_max: z.number().finite().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const aiResponseSchema = z.object({
  components: z.array(aiComponentSchema).max(120),
});

export type AiExtractedComponent = {
  category: string;
  component_name: string;
  measured_value: number;
  unit: string;
  reference_min: number;
  reference_max: number;
  confidence: number;
  source_line: string;
};

function parseJsonPayload(payload: string): unknown {
  const trimmed = payload.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      const objectText = trimmed.slice(objectStart, objectEnd + 1);
      return JSON.parse(objectText);
    }
    throw new Error("AI response was not valid JSON.");
  }
}

function mapAiComponents(rawComponents: z.infer<typeof aiComponentSchema>[]): AiExtractedComponent[] {
  const deduped = new Map<string, AiExtractedComponent>();

  for (const raw of rawComponents) {
    if (!Number.isFinite(raw.measured_value)) {
      continue;
    }

    const normalizedName = raw.component_name.trim().toLowerCase();
    if (!normalizedName || deduped.has(normalizedName)) {
      continue;
    }

    deduped.set(normalizedName, {
      category: raw.category?.trim() || "General",
      component_name: raw.component_name.trim(),
      measured_value: raw.measured_value,
      unit: raw.unit?.trim() || "",
      reference_min: Number.isFinite(raw.reference_min) ? Number(raw.reference_min) : 0,
      reference_max: Number.isFinite(raw.reference_max) ? Number(raw.reference_max) : 0,
      confidence: Number.isFinite(raw.confidence) ? Number(raw.confidence) : 0.9,
      source_line: "ai-structured",
    });
  }

  return Array.from(deduped.values());
}

export async function extractComponentsWithAi({
  config,
  documentText,
  defaultCategory,
}: {
  config: AiExtractionConfig;
  documentText: string;
  defaultCategory: string;
}): Promise<AiExtractedComponent[]> {
  if (config.provider === "github") {
    throw new Error(
      "GitHub Models endpoint is retired. Switch AI_EXTRACTION_PROVIDER to openai or custom (Azure OpenAI Foundry).",
    );
  }

  const clippedText = documentText.slice(0, 24000);

  const requestBody = {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract structured lab results from medical text. Return strict JSON with key components only. Never include markdown.",
      },
      {
        role: "user",
        content: [
          "Return JSON with this shape:",
          '{"components":[{"category":"string","component_name":"string","measured_value":number,"unit":"string","reference_min":number,"reference_max":number,"confidence":number}]}',
          "Rules:",
          "- Use numeric measured_value only.",
          "- If category is unclear, use the default category provided.",
          "- reference_min/reference_max can be omitted when unknown.",
          "- confidence is between 0 and 1.",
          `default_category: ${defaultCategory || "General"}`,
          "document_text:",
          clippedText,
        ].join("\n"),
      },
    ],
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
    });

    if (response.ok) {
      break;
    }

    const body = await response.text();
    lastStatus = response.status;
    lastBody = body.slice(0, 280);

    if (response.status !== 404) {
      throw new Error(`AI extraction request failed (${response.status}): ${lastBody}`);
    }
  }

  if (!response?.ok) {
    throw new Error(`AI extraction request failed (${lastStatus || 404}): ${lastBody}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };

  const messageContent = payload.choices?.[0]?.message?.content;
  const contentText = Array.isArray(messageContent)
    ? messageContent
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .join("\n")
    : typeof messageContent === "string"
      ? messageContent
      : "";

  const parsed = aiResponseSchema.parse(parseJsonPayload(contentText));
  return mapAiComponents(parsed.components);
}
