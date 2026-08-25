import { z } from "zod";

import type { AiExtractionConfig } from "@/lib/ai/env";

export type ProfileTextField = "medical_condition" | "medication";

export type ProfileTextEvaluation = {
  isRelevant: boolean;
  confidence: number;
  suggestedRewrite: string;
  options: string[];
  clarificationQuestion: string;
  rationale: string;
  fromCache: boolean;
};

const profileTextResponseSchema = z.object({
  is_relevant: z.boolean(),
  confidence: z.number().min(0).max(1).default(0.5),
  suggested_rewrite: z.string().trim().max(300).optional().default(""),
  options: z.array(z.string().trim().min(1).max(120)).max(5).optional().default([]),
  clarification_question: z.string().trim().max(220).optional().default(""),
  rationale: z.string().trim().max(220).optional().default(""),
});

type CacheValue = {
  expiresAt: number;
  result: Omit<ProfileTextEvaluation, "fromCache">;
};

const profileTextValidationCache = new Map<string, CacheValue>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const AI_REQUEST_TIMEOUT_MS = 12000;

function normalizeValidationInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+/g, "")
    .trim();
}

function parseJsonPayload(payload: string): unknown {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new Error("AI profile text validator returned empty payload.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new Error("AI profile text validator returned invalid JSON.");
  }
}

function hasMedicalUncertaintyCue(normalizedText: string): boolean {
  const englishCue = /\b(?:unknown|unsure|not sure|forgot|forget|cannot remember|can't remember|dont remember|don't remember)\b/i;
  const hebrewCue = /(?:לא\s*זוכר(?:ת)?|לא\s*יודע(?:ת)?|לא\s*בטוח(?:ה)?|שכ\S*\s*חתי|שכחתי)/;
  const diagnosisNameCue = /(?:שם\s*של(?:ה|ו)?|name\s+of\s+it)/i;

  if (englishCue.test(normalizedText) || hebrewCue.test(normalizedText)) {
    return true;
  }

  if (diagnosisNameCue.test(normalizedText) && /(forgot|remember|שכ|זוכר|יודע)/i.test(normalizedText)) {
    return true;
  }

  return false;
}

function sanitizeMedicalNameOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const option of options) {
    const normalizedOption = option
      .trim()
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ");

    if (!normalizedOption) {
      continue;
    }

    // Drop long sentence-like options; keep short label-like names.
    const tokenCount = normalizedOption.split(" ").filter(Boolean).length;
    if (tokenCount > 6 || /[,.!?]/.test(normalizedOption)) {
      continue;
    }

    const dedupeKey = normalizedOption.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    cleaned.push(normalizedOption);
  }

  return cleaned.slice(0, 3);
}

function fallbackMedicalNameOptions(normalizedText: string, locale: "en" | "he"): string[] {
  if (/(?:כלי(?:ה|ות)|kidney|renal)/i.test(normalizedText)) {
    return locale === "he"
      ? ["מחלת כליות כרונית", "אי ספיקת כליות כרונית", "נפרופתיה כרונית"]
      : ["Chronic kidney disease", "Chronic renal failure", "Chronic nephropathy"];
  }

  if (/(?:לחץ\s*דם|blood\s*pressure|hypertension)/i.test(normalizedText)) {
    return locale === "he"
      ? ["יתר לחץ דם", "יתר לחץ דם ראשוני", "יתר לחץ דם שניוני"]
      : ["Hypertension", "Primary hypertension", "Secondary hypertension"];
  }

  if (/(?:סוכר(?:ת)?|diabet)/i.test(normalizedText)) {
    return locale === "he"
      ? ["סוכרת סוג 2", "סוכרת סוג 1", "טרום סוכרת"]
      : ["Type 2 diabetes", "Type 1 diabetes", "Prediabetes"];
  }

  return [];
}

function fallbackGeneralMedicalNameOptions(locale: "en" | "he"): string[] {
  return locale === "he" ? ["יתר לחץ דם", "סוכרת", "אסתמה"] : ["Hypertension", "Diabetes", "Asthma"];
}

function fallbackMedicationOptions(locale: "en" | "he"): string[] {
  return locale === "he"
    ? ["מטפורמין 500 מ\"ג פעמיים ביום", "ליזינופריל 10 מ\"ג פעם ביום", "לבותירוקסין 50 מק\"ג פעם ביום"]
    : ["Metformin 500mg twice daily", "Lisinopril 10mg once daily", "Levothyroxine 50mcg once daily"];
}

function buildUserPrompt({
  field,
  text,
  locale,
}: {
  field: ProfileTextField;
  text: string;
  locale: "en" | "he";
}): string {
  const fieldInstruction = field === "medical_condition"
    ? "Field type: medical condition description (diagnosis/symptom)."
    : "Field type: medication details (medication name, dosage, or frequency).";
  const languageName = locale === "he" ? "Hebrew" : "English";

  return [
    fieldInstruction,
    "Task:",
    "1) Decide if input is relevant to this field.",
    "2) Be typo tolerant.",
    "3) Reject unrelated text even if grammatically correct.",
    "4) Reject input that contains obvious gibberish or keyboard-mash fragments, even if part of the sentence is medically relevant.",
    "5) If relevant but unclear, suggest improved wording and up to 3 options.",
    "6) For medical_condition uncertainty, options must be short possible condition names only (2-6 words), not full sentences.",
    `7) Write suggested_rewrite, options, clarification_question, and rationale entirely in ${languageName}. Do not mix languages within a single field.`,
    "Return strict JSON only with this shape:",
    '{"is_relevant":boolean,"confidence":number,"suggested_rewrite":"string","options":["string"],"clarification_question":"string","rationale":"string"}',
    "input_text:",
    text.slice(0, 1000),
  ].join("\n");
}

function toEvaluationResult(raw: z.infer<typeof profileTextResponseSchema>): Omit<ProfileTextEvaluation, "fromCache"> {
  return {
    isRelevant: raw.is_relevant,
    confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0.5,
    suggestedRewrite: raw.suggested_rewrite,
    options: raw.options,
    clarificationQuestion: raw.clarification_question,
    rationale: raw.rationale,
  };
}

export async function evaluateProfileTextWithAi({
  config,
  userId,
  field,
  text,
  locale,
}: {
  config: AiExtractionConfig;
  userId: string;
  field: ProfileTextField;
  text: string;
  locale: "en" | "he";
}): Promise<ProfileTextEvaluation> {
  if (config.provider === "github") {
    throw new Error(
      "GitHub Models endpoint is retired. Switch AI_EXTRACTION_PROVIDER to openai or custom (Azure OpenAI Foundry).",
    );
  }

  const normalizedInput = normalizeValidationInput(text);
  const cacheKey = [userId, field, config.model, locale, normalizedInput].join("::");
  const now = Date.now();
  const cached = profileTextValidationCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      ...cached.result,
      fromCache: true,
    };
  }

  const requestBody = {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a healthcare intake text relevance validator. Do not diagnose. Return strict JSON only.",
      },
      {
        role: "user",
        content: buildUserPrompt({ field, text, locale }),
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(candidateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`AI profile text validation timed out after ${AI_REQUEST_TIMEOUT_MS}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      break;
    }

    const body = await response.text();
    lastStatus = response.status;
    lastBody = body.slice(0, 320);

    if (response.status !== 404) {
      throw new Error(`AI profile text validation request failed (${response.status}): ${lastBody}`);
    }
  }

  if (!response?.ok) {
    throw new Error(`AI profile text validation request failed (${lastStatus || 404}): ${lastBody}`);
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

  const parsed = profileTextResponseSchema.parse(parseJsonPayload(contentText));
  const result = toEvaluationResult(parsed);

  // If the user explicitly says they do not know/remember the condition name,
  // require clarification instead of accepting incomplete text.
  if (field === "medical_condition" && hasMedicalUncertaintyCue(normalizedInput)) {
    result.isRelevant = false;
    result.options = sanitizeMedicalNameOptions(result.options);
    if (result.options.length === 0) {
      result.options = fallbackMedicalNameOptions(normalizedInput, locale);
    }
    if (!result.clarificationQuestion) {
      result.clarificationQuestion = locale === "he"
        ? "אנא בחר/י את שם המצב הקרוב ביותר, או תאר/י את התסמין המאובחן והטיפול הנוכחי."
        : "Please choose the closest condition name, or describe the diagnosed symptom and current treatment.";
    }
    if (!result.suggestedRewrite) {
      result.suggestedRewrite = locale === "he"
        ? "מחלת כליות כרונית (השם המדויק יאושר על ידי הרופא)."
        : "Chronic kidney disease (exact name to be confirmed by physician).";
    }
  }

  if (field === "medical_condition" && !result.isRelevant) {
    result.options = sanitizeMedicalNameOptions(result.options);
    if (result.options.length === 0) {
      result.options = fallbackMedicalNameOptions(normalizedInput, locale);
    }
    if (result.options.length === 0) {
      result.options = fallbackGeneralMedicalNameOptions(locale);
    }
    if (!result.clarificationQuestion) {
      result.clarificationQuestion = locale === "he"
        ? "אנא תאר/י מצב רפואי מאובחן או תסמין כדי שאוכל לעזור לך לדייק את הניסוח."
        : "Please describe a diagnosed condition or symptom so I can help you refine the wording.";
    }
  }

  if (field === "medication" && !result.isRelevant) {
    if (result.options.length === 0) {
      result.options = fallbackMedicationOptions(locale);
    }
    if (!result.clarificationQuestion) {
      result.clarificationQuestion = locale === "he"
        ? "אנא כלול/י שם תרופה ומינון/תדירות כדי שאוכל לעזור בניסוח נכון."
        : "Please include medication name and dosage/frequency so I can help format it correctly.";
    }
  }

  profileTextValidationCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    result,
  });

  return {
    ...result,
    fromCache: false,
  };
}
