import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";

const aiGoalSchema = z.object({
  primary_goal_type: z.enum(["weight_loss", "weight_gain", "maintain", "general"]),
  weight_delta_kg: z.number().finite().positive().optional(),
  duration_days: z.number().int().positive().optional(),
  detected_goals: z.array(z.string().trim().min(1).max(120)).max(10),
  blood_balance_focus: z.boolean().optional(),
  sleep_focus: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const aiGoalResponseSchema = z.object({
  analysis: aiGoalSchema,
});

export type AiGoalAnalysis = {
  primaryGoalType: "weight_loss" | "weight_gain" | "maintain" | "general";
  weightDeltaKg: number | null;
  durationDays: number | null;
  detectedGoals: string[];
  bloodBalanceFocus: boolean;
  sleepFocus: boolean;
  confidence: number;
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
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    }
    throw new Error("AI goal parsing response was not valid JSON.");
  }
}

function mapAiGoalAnalysis(raw: z.infer<typeof aiGoalSchema>): AiGoalAnalysis {
  const dedupedGoals = Array.from(
    new Set(
      raw.detected_goals
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 10);

  return {
    primaryGoalType: raw.primary_goal_type,
    weightDeltaKg:
      typeof raw.weight_delta_kg === "number" && Number.isFinite(raw.weight_delta_kg)
        ? Number(raw.weight_delta_kg)
        : null,
    durationDays:
      typeof raw.duration_days === "number" && Number.isFinite(raw.duration_days)
        ? Number(raw.duration_days)
        : null,
    detectedGoals: dedupedGoals,
    bloodBalanceFocus: Boolean(raw.blood_balance_focus),
    sleepFocus: Boolean(raw.sleep_focus),
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Number(raw.confidence)
        : 0.7,
  };
}

export async function analyzeGoalTextWithAi({
  config,
  goalText,
}: {
  config: AiExtractionConfig;
  goalText: string;
}): Promise<AiGoalAnalysis> {
  if (config.provider === "github") {
    throw new Error(
      "GitHub Models endpoint is retired. Switch AI_EXTRACTION_PROVIDER to openai or custom (Azure OpenAI Foundry).",
    );
  }

  const requestBody = {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract structured user health goals from free text. Return strict JSON only. No markdown.",
      },
      {
        role: "user",
        content: [
          "Parse this goal text into strict JSON with this shape:",
          '{"analysis":{"primary_goal_type":"weight_loss|weight_gain|maintain|general","weight_delta_kg":number,"duration_days":number,"detected_goals":["string"],"blood_balance_focus":boolean,"sleep_focus":boolean,"confidence":number}}',
          "Rules:",
          "- If text contains multiple distinct goals, keep detected_goals with each concise goal.",
          "- Map blood test balancing intent to blood_balance_focus=true.",
          "- Map sleep improvement intent to sleep_focus=true.",
          "- weight_delta_kg and duration_days are optional if absent.",
          "- confidence must be 0..1.",
          "goal_text:",
          goalText.slice(0, 1200),
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
      throw new Error(`AI goal analysis request failed (${response.status}): ${lastBody}`);
    }
  }

  if (!response?.ok) {
    throw new Error(`AI goal analysis request failed (${lastStatus || 404}): ${lastBody}`);
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

  const parsed = aiGoalResponseSchema.parse(parseJsonPayload(contentText));
  return mapAiGoalAnalysis(parsed.analysis);
}
