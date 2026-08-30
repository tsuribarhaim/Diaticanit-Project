import { z } from "zod";

import type {
  DailyReportMetrics,
  DailyReportParseResult,
  ParsedExerciseItem,
  ParsedFoodItem,
} from "@/lib/daily-report";
import type { AiExtractionConfig } from "@/lib/ai/env";
import type { AppLocale } from "@/lib/locale";

const numberFromUnknown = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}, z.number());

const aiFoodItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: numberFromUnknown,
  unit: z.string().trim().min(1).max(30),
  caloriesKcal: numberFromUnknown,
  proteinG: numberFromUnknown,
  carbsG: numberFromUnknown,
  fatG: numberFromUnknown,
  fiberG: numberFromUnknown,
  waterMl: numberFromUnknown,
  magnesiumMg: numberFromUnknown,
  potassiumMg: numberFromUnknown,
  ironMg: numberFromUnknown,
  zincMg: numberFromUnknown,
});

const aiExerciseItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  minutes: numberFromUnknown,
  estimatedBurnKcal: numberFromUnknown,
});

const aiMetricsSchema = z.object({
  caloriesKcal: numberFromUnknown,
  proteinG: numberFromUnknown,
  carbsG: numberFromUnknown,
  fatG: numberFromUnknown,
  fiberG: numberFromUnknown,
  waterMl: numberFromUnknown,
  magnesiumMg: numberFromUnknown,
  potassiumMg: numberFromUnknown,
  ironMg: numberFromUnknown,
  zincMg: numberFromUnknown,
  exerciseMinutes: numberFromUnknown,
  estimatedBurnKcal: numberFromUnknown,
});

const aiDailyReportSchema = z.object({
  confidence: numberFromUnknown.optional(),
  requiresConfirmation: z.boolean().optional(),
  foodItems: z.array(aiFoodItemSchema).optional(),
  exerciseItems: z.array(aiExerciseItemSchema).optional(),
  metrics: aiMetricsSchema.optional(),
  isDangerous: z.boolean().optional(),
  dangerReason: z.string().trim().max(300).optional(),
});

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseJsonPayload(contentText: string): unknown {
  const trimmed = contentText.trim();

  if (!trimmed.length) {
    throw new Error("AI returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }

    throw new Error("AI returned invalid JSON.");
  }
}

function toFoodItems(items: z.infer<typeof aiFoodItemSchema>[]): ParsedFoodItem[] {
  return items.map((item) => ({
    name: item.name,
    quantity: round(clamp(item.quantity, 0, 1000), 2),
    unit: item.unit,
    caloriesKcal: round(clamp(item.caloriesKcal, 0, 20000), 2),
    proteinG: round(clamp(item.proteinG, 0, 2000), 2),
    carbsG: round(clamp(item.carbsG, 0, 2000), 2),
    fatG: round(clamp(item.fatG, 0, 2000), 2),
    fiberG: round(clamp(item.fiberG, 0, 200), 2),
    waterMl: round(clamp(item.waterMl, 0, 20000), 2),
    magnesiumMg: round(clamp(item.magnesiumMg, 0, 5000), 2),
    potassiumMg: round(clamp(item.potassiumMg, 0, 10000), 2),
    ironMg: round(clamp(item.ironMg, 0, 500), 2),
    zincMg: round(clamp(item.zincMg, 0, 500), 2),
  }));
}

function toExerciseItems(items: z.infer<typeof aiExerciseItemSchema>[]): ParsedExerciseItem[] {
  return items.map((item) => ({
    name: item.name,
    minutes: Math.round(clamp(item.minutes, 0, 720)),
    estimatedBurnKcal: round(clamp(item.estimatedBurnKcal, 0, 12000), 2),
  }));
}

function computeMetrics({
  foodItems,
  exerciseItems,
}: {
  foodItems: ParsedFoodItem[];
  exerciseItems: ParsedExerciseItem[];
}): DailyReportMetrics {
  const totals: DailyReportMetrics = {
    caloriesKcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    waterMl: 0,
    magnesiumMg: 0,
    potassiumMg: 0,
    ironMg: 0,
    zincMg: 0,
    exerciseMinutes: 0,
    estimatedBurnKcal: 0,
  };

  for (const item of foodItems) {
    totals.caloriesKcal += item.caloriesKcal;
    totals.proteinG += item.proteinG;
    totals.carbsG += item.carbsG;
    totals.fatG += item.fatG;
    totals.fiberG += item.fiberG;
    totals.waterMl += item.waterMl;
    totals.magnesiumMg += item.magnesiumMg;
    totals.potassiumMg += item.potassiumMg;
    totals.ironMg += item.ironMg;
    totals.zincMg += item.zincMg;
  }

  for (const item of exerciseItems) {
    totals.exerciseMinutes += item.minutes;
    totals.estimatedBurnKcal += item.estimatedBurnKcal;
  }

  return {
    caloriesKcal: round(totals.caloriesKcal),
    proteinG: round(totals.proteinG),
    carbsG: round(totals.carbsG),
    fatG: round(totals.fatG),
    fiberG: round(totals.fiberG),
    waterMl: round(totals.waterMl),
    magnesiumMg: round(totals.magnesiumMg),
    potassiumMg: round(totals.potassiumMg),
    ironMg: round(totals.ironMg),
    zincMg: round(totals.zincMg),
    exerciseMinutes: Math.round(totals.exerciseMinutes),
    estimatedBurnKcal: round(totals.estimatedBurnKcal),
  };
}

function summarizeAiError(errorBody: string, status: number): string {
  return `AI daily report request failed (${status}): ${errorBody.slice(0, 240)}`;
}

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<Record<string, unknown>>;
};

async function callDailyReportChatCompletion({
  config,
  messages,
}: {
  config: AiExtractionConfig;
  messages: ChatMessage[];
}): Promise<DailyReportParseResult> {
  if (config.provider === "github") {
    throw new Error(
      "GitHub Models endpoint is retired. Switch AI_EXTRACTION_PROVIDER to openai or custom (Azure OpenAI Foundry).",
    );
  }

  const requestBody = {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
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
    });

    if (response.ok) {
      break;
    }

    const body = await response.text();
    lastStatus = response.status;
    lastBody = body;

    if (response.status !== 404) {
      throw new Error(summarizeAiError(body, response.status));
    }
  }

  if (!response?.ok) {
    throw new Error(summarizeAiError(lastBody, lastStatus || 404));
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

  const parsed = aiDailyReportSchema.parse(parseJsonPayload(contentText));

  const foodItems = toFoodItems(parsed.foodItems ?? []);
  const exerciseItems = toExerciseItems(parsed.exerciseItems ?? []);
  const computedMetrics = computeMetrics({ foodItems, exerciseItems });

  const metricsFromAi = parsed.metrics;
  const metrics: DailyReportMetrics = metricsFromAi
    ? {
        caloriesKcal: round(clamp(metricsFromAi.caloriesKcal, 0, 20000), 2),
        proteinG: round(clamp(metricsFromAi.proteinG, 0, 2000), 2),
        carbsG: round(clamp(metricsFromAi.carbsG, 0, 2000), 2),
        fatG: round(clamp(metricsFromAi.fatG, 0, 2000), 2),
        fiberG: round(clamp(metricsFromAi.fiberG, 0, 200), 2),
        waterMl: round(clamp(metricsFromAi.waterMl, 0, 20000), 2),
        magnesiumMg: round(clamp(metricsFromAi.magnesiumMg, 0, 5000), 2),
        potassiumMg: round(clamp(metricsFromAi.potassiumMg, 0, 10000), 2),
        ironMg: round(clamp(metricsFromAi.ironMg, 0, 500), 2),
        zincMg: round(clamp(metricsFromAi.zincMg, 0, 500), 2),
        exerciseMinutes: Math.round(clamp(metricsFromAi.exerciseMinutes, 0, 720)),
        estimatedBurnKcal: round(clamp(metricsFromAi.estimatedBurnKcal, 0, 12000), 2),
      }
    : computedMetrics;

  const confidence = round(clamp(parsed.confidence ?? 0.72, 0.25, 0.99), 4);
  const requiresConfirmation =
    typeof parsed.requiresConfirmation === "boolean"
      ? parsed.requiresConfirmation
      : confidence < 0.72;

  return {
    confidence,
    requiresConfirmation,
    metrics,
    foodItems,
    exerciseItems,
    isDangerous: parsed.isDangerous ?? false,
    dangerReason: parsed.dangerReason ?? "",
  };
}

export async function parseDailyReportWithAi({
  config,
  reportText,
  weightKg,
  locale = "en",
}: {
  config: AiExtractionConfig;
  reportText: string;
  weightKg: number;
  locale?: AppLocale;
}): Promise<DailyReportParseResult> {
  const clippedText = reportText.slice(0, 8000);
  const languageName = locale === "he" ? "Hebrew" : "English";

  return callDailyReportChatCompletion({
    config,
    messages: [
      {
        role: "system",
        content:
          "You convert nutrition and exercise daily logs into structured JSON only. Never include markdown.",
      },
      {
        role: "user",
        content: [
          "Return strict JSON with this shape:",
          '{"confidence":number,"requiresConfirmation":boolean,"foodItems":[{"name":"string","quantity":number,"unit":"string","caloriesKcal":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number,"waterMl":number,"magnesiumMg":number,"potassiumMg":number,"ironMg":number,"zincMg":number}],"exerciseItems":[{"name":"string","minutes":number,"estimatedBurnKcal":number}],"metrics":{"caloriesKcal":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number,"waterMl":number,"magnesiumMg":number,"potassiumMg":number,"ironMg":number,"zincMg":number,"exerciseMinutes":number,"estimatedBurnKcal":number},"isDangerous":boolean,"dangerReason":"string"}',
          "Rules:",
          "- Use only non-negative numbers.",
          "- Include reasonable estimates when exact values are unclear.",
          "- confidence must be between 0 and 1.",
          "- requiresConfirmation should be true when extraction is uncertain.",
          "- SAFETY CHECK: set isDangerous to true only when daily_report_text describes consuming something that is not actually food/drink and would be dangerous or harmful (e.g. fuel, gasoline, cleaning products, poison, batteries, or other inedible/hazardous items). If so, set dangerReason to a short plain-language explanation telling the user to seek medical attention if they actually consumed it. Do NOT set isDangerous for an implausible-but-harmless amount of real food (e.g. \"I ate 50 eggs\") - estimate those literally instead; isDangerous is only for genuinely non-food/hazardous substances.",
          `- Write dangerReason and every foodItems[].name / exerciseItems[].name entirely in ${languageName}, regardless of what language daily_report_text is written in. Do not mix languages within a single name.`,
          `weightKg: ${Number.isFinite(weightKg) ? weightKg : 0}`,
          "daily_report_text:",
          clippedText,
        ].join("\n"),
      },
    ],
  });
}

export async function parseDailyReportPhotoWithAi({
  config,
  imageBase64,
  mimeType,
  weightKg,
  noteText,
  locale = "en",
}: {
  config: AiExtractionConfig;
  imageBase64: string;
  mimeType: string;
  weightKg: number;
  /** Optional free-text note the user typed alongside the photo (e.g. "no
   * dressing", "diet soda not regular") - treated as a correction/clarifying
   * hint on top of the visual estimate, not a separate report. */
  noteText?: string;
  locale?: AppLocale;
}): Promise<DailyReportParseResult> {
  const trimmedNote = noteText?.trim().slice(0, 500) || "";
  const languageName = locale === "he" ? "Hebrew" : "English";

  return callDailyReportChatCompletion({
    config,
    messages: [
      {
        role: "system",
        content:
          "You estimate nutrition from a photo of food. Return strict JSON only. Never include markdown.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Look at the attached photo and identify each distinct food or drink item visible.",
              "Return strict JSON with this shape:",
              '{"confidence":number,"requiresConfirmation":boolean,"foodItems":[{"name":"string","quantity":number,"unit":"string","caloriesKcal":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number,"waterMl":number,"magnesiumMg":number,"potassiumMg":number,"ironMg":number,"zincMg":number}],"exerciseItems":[],"metrics":{"caloriesKcal":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number,"waterMl":number,"magnesiumMg":number,"potassiumMg":number,"ironMg":number,"zincMg":number,"exerciseMinutes":number,"estimatedBurnKcal":number},"isDangerous":boolean,"dangerReason":"string"}',
              "Rules:",
              "- Estimate realistic portion sizes from visual cues (plate size, utensils, packaging).",
              "- Use only non-negative numbers.",
              "- exerciseItems must always be an empty array; this is a food photo only.",
              "- Photo-based estimates are inherently uncertain: keep confidence at 0.6 or below unless the meal is very simple and fully visible.",
              "- requiresConfirmation must always be true.",
              "- SAFETY CHECK: set isDangerous to true only if the photo shows something that is not actually food/drink and would be dangerous or harmful to consume (e.g. a container of fuel, cleaning products, poison, batteries, or other inedible/hazardous items) - not merely an unappetizing or unusual but genuinely edible item. If so, set dangerReason to a short plain-language explanation telling the user to seek medical attention if they actually consumed it.",
              `- Write dangerReason and every foodItems[].name entirely in ${languageName}. Do not mix languages within a single name.`,
              ...(trimmedNote
                ? [
                    `- The user also added this note alongside the photo: "${trimmedNote}". Treat it as a correction or clarifying hint (e.g. an ingredient to add/remove, a substitution, a quantity) on top of what you see, not as a separate report to parse independently.`,
                  ]
                : []),
              `weightKg: ${Number.isFinite(weightKg) ? weightKg : 0}`,
            ].join("\n"),
          },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      },
    ],
  });
}
