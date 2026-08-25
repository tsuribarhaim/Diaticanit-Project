"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
  sanitizeFileName,
} from "@/lib/documents";
import {
  type DocumentExtractionStatus,
  documentExtractionStatuses,
} from "@/lib/extraction";
import { classifyComponentStatus } from "@/lib/extraction-insights";
import { transitionDocumentExtractionStatus } from "@/lib/extraction-status";
import { isPhase2DemoEnabled } from "@/lib/feature-flags";
import { extractComponentsWithAi } from "@/lib/ai/extraction";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

const uploadSchema = z.object({
  category: z
    .string()
    .trim()
    .min(1, "Category is required.")
    .max(50, "Category must be 50 characters or less."),
});

export type DocumentsActionState = {
  error?: string;
  success?: string;
};

const initialUploadError = "Upload failed. Please try again.";

type SeedComponent = {
  category: string;
  component_name: string;
  measured_value: number;
  unit: string;
  reference_min: number;
  reference_max: number;
  confidence: number;
  source_line: string;
};

type ComponentRule = {
  category: string;
  aliases: string[];
  componentName: string;
  defaultUnit: string;
  referenceMin: number;
  referenceMax: number;
};

type ExtractionStrategy = "auto" | "heuristic-only" | "ai-only";
type ExtractionMode = "auto" | "heuristic" | "ai";

function modeUsedMarker(mode: Exclude<ExtractionMode, "auto">): string {
  return mode === "ai" ? "mode-ai-used" : "mode-heuristic-used";
}

function parserIndicatesAiRun(parserVersion: string): boolean {
  return (
    parserVersion.startsWith("ai-") ||
    parserVersion.includes("|ai-") ||
    parserVersion.includes("ai-attempted") ||
    parserVersion.includes("ai-skipped") ||
    parserVersion.includes("ai-configured")
  );
}

function parserIndicatesHeuristicRun(parserVersion: string): boolean {
  return (
    parserVersion.includes("heuristic") ||
    parserVersion.includes("fallback") ||
    parserVersion.startsWith("pdf-") ||
    parserVersion.startsWith("text-") ||
    parserVersion.startsWith("image-")
  );
}

function hasModeBeenRun(
  parserVersion: string | null | undefined,
  mode: Exclude<ExtractionMode, "auto">,
): boolean {
  const value = parserVersion ?? "";
  if (!value) return false;

  if (value.includes(modeUsedMarker(mode))) {
    return true;
  }

  if (mode === "ai") {
    return parserIndicatesAiRun(value);
  }

  return parserIndicatesHeuristicRun(value);
}

function appendModeMarker(
  parserVersion: string,
  mode: Exclude<ExtractionMode, "auto">,
): string {
  const marker = modeUsedMarker(mode);
  if (parserVersion.includes(marker)) {
    return parserVersion;
  }
  return `${parserVersion}|${marker}`;
}

function mergeModeHistory(
  parserVersion: string,
  previousParserVersion: string | null,
  currentMode: Exclude<ExtractionMode, "auto">,
): string {
  let merged = appendModeMarker(parserVersion, currentMode);

  if (previousParserVersion) {
    if (hasModeBeenRun(previousParserVersion, "ai")) {
      merged = appendModeMarker(merged, "ai");
    }
    if (hasModeBeenRun(previousParserVersion, "heuristic")) {
      merged = appendModeMarker(merged, "heuristic");
    }
  }

  return merged;
}

const componentRules: ComponentRule[] = [
  {
    category: "Anemia",
    aliases: ["vitamin b12", "b12"],
    componentName: "Vitamin B12",
    defaultUnit: "pg/ml",
    referenceMin: 180,
    referenceMax: 914,
  },
  {
    category: "Anemia",
    aliases: ["ferritin"],
    componentName: "Ferritin",
    defaultUnit: "ng/ml",
    referenceMin: 24,
    referenceMax: 300,
  },
  {
    category: "Anemia",
    aliases: ["folic acid", "folate"],
    componentName: "Folic Acid",
    defaultUnit: "ng/ml",
    referenceMin: 5.9,
    referenceMax: 24,
  },
  {
    category: "Anemia",
    aliases: ["iron -blood", "iron blood", "iron"],
    componentName: "Iron",
    defaultUnit: "micgr/dl",
    referenceMin: 60,
    referenceMax: 170,
  },
  {
    category: "Thyroid",
    aliases: ["tsh"],
    componentName: "TSH",
    defaultUnit: "mIU/l",
    referenceMin: 0.4,
    referenceMax: 4,
  },
  {
    category: "CBC",
    aliases: ["hemoglobin", "hgb"],
    componentName: "Hemoglobin",
    defaultUnit: "g/dL",
    referenceMin: 12.0,
    referenceMax: 15.5,
  },
  {
    category: "CBC",
    aliases: ["wbc", "white blood cells"],
    componentName: "WBC",
    defaultUnit: "x10^3/uL",
    referenceMin: 4.0,
    referenceMax: 10.5,
  },
  {
    category: "CBC",
    aliases: ["rbc", "red blood cells"],
    componentName: "RBC",
    defaultUnit: "M/uL",
    referenceMin: 3.8,
    referenceMax: 5.2,
  },
  {
    category: "CBC",
    aliases: ["hematocrit", "hct"],
    componentName: "Hematocrit",
    defaultUnit: "%",
    referenceMin: 36,
    referenceMax: 46,
  },
  {
    category: "CBC",
    aliases: ["platelet", "platelets", "plt"],
    componentName: "Platelets",
    defaultUnit: "x10^3/uL",
    referenceMin: 150,
    referenceMax: 450,
  },
  {
    category: "CBC",
    aliases: ["mcv"],
    componentName: "MCV",
    defaultUnit: "fL",
    referenceMin: 80,
    referenceMax: 100,
  },
  {
    category: "CBC",
    aliases: ["mch"],
    componentName: "MCH",
    defaultUnit: "pg",
    referenceMin: 27,
    referenceMax: 34,
  },
  {
    category: "CBC",
    aliases: ["mchc"],
    componentName: "MCHC",
    defaultUnit: "g/dL",
    referenceMin: 32,
    referenceMax: 36,
  },
  {
    category: "CBC",
    aliases: ["rdw"],
    componentName: "RDW",
    defaultUnit: "%",
    referenceMin: 11,
    referenceMax: 15,
  },
  {
    category: "CBC",
    aliases: ["neutrophils", "neut"],
    componentName: "Neutrophils",
    defaultUnit: "%",
    referenceMin: 40,
    referenceMax: 75,
  },
  {
    category: "CBC",
    aliases: ["lymphocytes", "lymph"],
    componentName: "Lymphocytes",
    defaultUnit: "%",
    referenceMin: 20,
    referenceMax: 45,
  },
  {
    category: "CBC",
    aliases: ["monocytes", "mono"],
    componentName: "Monocytes",
    defaultUnit: "%",
    referenceMin: 2,
    referenceMax: 10,
  },
  {
    category: "CBC",
    aliases: ["eosinophils", "eos"],
    componentName: "Eosinophils",
    defaultUnit: "%",
    referenceMin: 0,
    referenceMax: 6,
  },
  {
    category: "CBC",
    aliases: ["basophils", "baso"],
    componentName: "Basophils",
    defaultUnit: "%",
    referenceMin: 0,
    referenceMax: 2,
  },
  {
    category: "CBC",
    aliases: ["mpv"],
    componentName: "MPV",
    defaultUnit: "fL",
    referenceMin: 6.5,
    referenceMax: 11.1,
  },
  {
    category: "CBC",
    aliases: ["neutro%", "neutrophils %"],
    componentName: "Neutrophils %",
    defaultUnit: "%",
    referenceMin: 40,
    referenceMax: 74,
  },
  {
    category: "CBC",
    aliases: ["lympho%", "lymphocytes %"],
    componentName: "Lymphocytes %",
    defaultUnit: "%",
    referenceMin: 20,
    referenceMax: 40,
  },
  {
    category: "CBC",
    aliases: ["mono%", "monocytes %"],
    componentName: "Monocytes %",
    defaultUnit: "%",
    referenceMin: 4.7,
    referenceMax: 12.5,
  },
  {
    category: "CBC",
    aliases: ["eos%", "eosinophils %"],
    componentName: "Eosinophils %",
    defaultUnit: "%",
    referenceMin: 0,
    referenceMax: 7,
  },
  {
    category: "CBC",
    aliases: ["baso%", "basophils %"],
    componentName: "Basophils %",
    defaultUnit: "%",
    referenceMin: 0,
    referenceMax: 1.5,
  },
  {
    category: "CBC",
    aliases: ["neutro abs", "neutrophils abs"],
    componentName: "Neutrophils abs",
    defaultUnit: "K/microL",
    referenceMin: 1.8,
    referenceMax: 7.7,
  },
  {
    category: "CBC",
    aliases: ["lympho abs", "lymphocytes abs"],
    componentName: "Lymphocytes abs",
    defaultUnit: "K/microL",
    referenceMin: 1,
    referenceMax: 4.8,
  },
  {
    category: "CBC",
    aliases: ["mono abs", "monocytes abs"],
    componentName: "Monocytes abs",
    defaultUnit: "K/microL",
    referenceMin: 0.2,
    referenceMax: 1,
  },
  {
    category: "CBC",
    aliases: ["eos abs", "eosinophils abs"],
    componentName: "Eosinophils abs",
    defaultUnit: "K/microL",
    referenceMin: 0,
    referenceMax: 0.5,
  },
  {
    category: "CBC",
    aliases: ["baso abs", "basophils abs"],
    componentName: "Basophils abs",
    defaultUnit: "K/microL",
    referenceMin: 0,
    referenceMax: 0.2,
  },
  {
    category: "Metabolic",
    aliases: ["glucose", "fasting glucose"],
    componentName: "Glucose (fasting)",
    defaultUnit: "mg/dL",
    referenceMin: 70,
    referenceMax: 99,
  },
  {
    category: "Metabolic",
    aliases: ["urea -blood", "urea blood", "urea"],
    componentName: "Urea",
    defaultUnit: "mg/dl",
    referenceMin: 15,
    referenceMax: 45,
  },
  {
    category: "Metabolic",
    aliases: ["creatinine -blood", "creatinine blood", "creatinine"],
    componentName: "Creatinine",
    defaultUnit: "mg/dl",
    referenceMin: 0.67,
    referenceMax: 1.17,
  },
  {
    category: "Metabolic",
    aliases: ["potassium -blood", "potassium blood", "potassium"],
    componentName: "Potassium",
    defaultUnit: "meq/l",
    referenceMin: 3.5,
    referenceMax: 5.2,
  },
  {
    category: "Metabolic",
    aliases: ["sodium -blood", "sodium blood", "sodium"],
    componentName: "Sodium",
    defaultUnit: "meq/l",
    referenceMin: 136,
    referenceMax: 148,
  },
  {
    category: "Metabolic",
    aliases: ["chloride -blood", "chloride blood", "chloride"],
    componentName: "Chloride",
    defaultUnit: "meq/l",
    referenceMin: 98,
    referenceMax: 110,
  },
  {
    category: "Metabolic",
    aliases: ["calcium -blood", "calcium blood", "calcium"],
    componentName: "Calcium",
    defaultUnit: "mg/dl",
    referenceMin: 8.1,
    referenceMax: 10.4,
  },
  {
    category: "Metabolic",
    aliases: ["phosphorus -blood", "phosphorus blood", "phosphorus"],
    componentName: "Phosphorus",
    defaultUnit: "mg/dl",
    referenceMin: 2,
    referenceMax: 4,
  },
  {
    category: "Metabolic",
    aliases: ["uric acid -blood", "uric acid blood", "uric acid"],
    componentName: "Uric Acid",
    defaultUnit: "mg/dl",
    referenceMin: 3.5,
    referenceMax: 7.2,
  },
  {
    category: "Inflammatory",
    aliases: ["crp", "crp-inflammatory"],
    componentName: "CRP",
    defaultUnit: "mg/l",
    referenceMin: 0,
    referenceMax: 5,
  },
  {
    category: "Lipid",
    aliases: ["ldl", "ldl cholesterol"],
    componentName: "LDL Cholesterol",
    defaultUnit: "mg/dL",
    referenceMin: 0,
    referenceMax: 99,
  },
  {
    category: "Lipid",
    aliases: ["hdl", "hdl cholesterol"],
    componentName: "HDL Cholesterol",
    defaultUnit: "mg/dL",
    referenceMin: 40,
    referenceMax: 90,
  },
  {
    category: "Lipid",
    aliases: ["triglycerides", "triglyceride"],
    componentName: "Triglycerides",
    defaultUnit: "mg/dL",
    referenceMin: 0,
    referenceMax: 150,
  },
  {
    category: "Lipid",
    aliases: ["total cholesterol", "cholesterol total"],
    componentName: "Total Cholesterol",
    defaultUnit: "mg/dL",
    referenceMin: 120,
    referenceMax: 200,
  },
  {
    category: "Lipid",
    aliases: ["non-hdl cholesterol", "non hdl cholesterol"],
    componentName: "Non-HDL Cholesterol",
    defaultUnit: "mg/dl",
    referenceMin: 0,
    referenceMax: 160,
  },
  {
    category: "Liver",
    aliases: ["sgot", "ast"],
    componentName: "AST (SGOT)",
    defaultUnit: "U/L",
    referenceMin: 7,
    referenceMax: 40,
  },
  {
    category: "Liver",
    aliases: ["sgpt", "alt"],
    componentName: "ALT (SGPT)",
    defaultUnit: "U/L",
    referenceMin: 7,
    referenceMax: 45,
  },
  {
    category: "Liver",
    aliases: ["ldh -blood", "ldh"],
    componentName: "LDH",
    defaultUnit: "U/L",
    referenceMin: 100,
    referenceMax: 260,
  },
  {
    category: "Liver",
    aliases: ["alkaline phosphatase", "alp"],
    componentName: "Alkaline Phosphatase",
    defaultUnit: "U/L",
    referenceMin: 45,
    referenceMax: 115,
  },
  {
    category: "Liver",
    aliases: ["bilirubin -blood, total", "bilirubin total"],
    componentName: "Bilirubin Total",
    defaultUnit: "mg/dl",
    referenceMin: 0.1,
    referenceMax: 1.1,
  },
  {
    category: "Liver",
    aliases: ["bilirubin -blood, direct", "bilirubin direct"],
    componentName: "Bilirubin Direct",
    defaultUnit: "mg/dl",
    referenceMin: 0.02,
    referenceMax: 0.3,
  },
  {
    category: "Metabolic",
    aliases: ["protein -blood, total", "protein total"],
    componentName: "Protein Total",
    defaultUnit: "g/dl",
    referenceMin: 6.5,
    referenceMax: 8.2,
  },
  {
    category: "Metabolic",
    aliases: ["albumin -blood", "albumin"],
    componentName: "Albumin",
    defaultUnit: "g/dl",
    referenceMin: 3.6,
    referenceMax: 5.5,
  },
  {
    category: "Metabolic",
    aliases: ["estimated globulin", "globulin"],
    componentName: "Globulin",
    defaultUnit: "g/dl",
    referenceMin: 2.3,
    referenceMax: 3.5,
  },
];

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseComponentsFromText(
  text: string,
  options?: { confidence?: number; sourceLine?: string },
): SeedComponent[] {
  const resultsByComponent = new Map<string, SeedComponent>();
  const confidence = options?.confidence ?? 0.88;
  const sourceLine = options?.sourceLine ?? "text-heuristic";
  const normalizedText = text
    .replace(/\r/g, "\n")
    .replace(/\|/g, " ")
    .replace(/,/g, ".");

  function cleanLineForParsing(line: string): string {
    return line
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s+\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}\/\d{2}\/\d{4})?\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const lines = normalizedText
    .split("\n")
    .map((line) => cleanLineForParsing(line))
    .filter((line) => line.length > 0);

  function normalizeLoose(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function findUnitFromText(input: string): string | null {
    const unitMatch = input.match(
      /(mg\/dL|g\/dL|x10\^3\/uL|10\^3\/uL|10\*3\/uL|K\/microL|M\/microL|meq\/l|mIU\/l|mOsm\/KgH2O|mmol\/L|IU\/L|U\/L|fL|pg|ng\/ml|pg\/ml|%)/i,
    );
    return unitMatch ? unitMatch[1] : null;
  }
  function parseReferenceFromLine(input: string): { min: number | null; max: number | null } {
    const hyphenRange = input.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
    if (hyphenRange) {
      return { min: Number(hyphenRange[1]), max: Number(hyphenRange[2]) };
    }

    const ltRange = input.match(/<\s*(-?\d+(?:\.\d+)?)/);
    if (ltRange) {
      return { min: 0, max: Number(ltRange[1]) };
    }

    const gtRange = input.match(/(-?\d+(?:\.\d+)?)\s*</);
    if (gtRange) {
      return { min: Number(gtRange[1]), max: null };
    }

    return { min: null, max: null };
  }

  function isDateNumberToken(source: string, start: number, end: number): boolean {
    const left = source.slice(Math.max(0, start - 3), start);
    const right = source.slice(end, Math.min(source.length, end + 3));
    return left.includes("/") || right.includes("/") || left.includes("-") || right.includes("-");
  }


  function isLikelyYear(value: number): boolean {
    return value >= 1900 && value <= 2100;
  }

  function isPlausibleRuleValue(value: number, rule: ComponentRule): boolean {
    if (!Number.isFinite(value)) return false;
    if (value < 0) return false;
    if (isLikelyYear(value)) return false;

    // Keep broad enough not to reject real outliers while filtering obvious OCR noise.
    if (rule.referenceMax <= 0) {
      return value <= 2000;
    }
    return value <= Math.max(rule.referenceMax * 8, 200);
  }

  function findValueFromText(input: string): number | null {
    const numericMatches = input.match(/-?\d+(?:\.\d+)?/g);
    if (!numericMatches?.length) {
      return null;
    }

    for (const candidate of numericMatches) {
      const parsed = Number(candidate);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  function inferCategoryFromName(name: string): string {
    const lower = name.toLowerCase();
    if (/(hemoglobin|wbc|rbc|platelet|hematocrit|mcv|mch|mchc|rdw)/.test(lower)) {
      return "CBC";
    }
    if (/(glucose|creatinine|urea|bun|sodium|potassium|chloride|calcium)/.test(lower)) {
      return "Metabolic";
    }
    if (/(cholesterol|hdl|ldl|triglyceride)/.test(lower)) {
      return "Lipid";
    }
    if (/(alt|ast|bilirubin|alkaline phosphatase)/.test(lower)) {
      return "Liver";
    }
    if (/(tsh|t3|t4|thyroid)/.test(lower)) {
      return "Thyroid";
    }
    return "General";
  }

  for (const rule of componentRules) {
    const aliasPattern = rule.aliases.map((alias) => escapeRegex(alias)).join("|");
    const aliasRegex = new RegExp(`(?:${aliasPattern})`, "i");
    const aliasBeforeValuePattern = new RegExp(
      `(?:${aliasPattern})[\\s:=_-]{0,20}(-?\\d+(?:\\.\\d+)?)\\s*([a-zA-Z%/^0-9._-]+)?`,
      "i",
    );
    const valueBeforeAliasPattern = new RegExp(
      `(-?\\d+(?:\\.\\d+)?)\\s*([a-zA-Z%/^0-9._-]+)?[\\s:=_-]{0,20}(?:${aliasPattern})`,
      "i",
    );

    let bestValue: number | null = null;
    let bestUnit: string | null = null;

    const normalizedAliases = rule.aliases.map((alias) => normalizeLoose(alias));

    for (const line of lines) {
      const normalizedLine = normalizeLoose(line);
      const hasLooseAlias = normalizedAliases.some((alias) =>
        normalizedLine.includes(alias),
      );

      if (!hasLooseAlias && !aliasRegex.test(line)) {
        continue;
      }

      const aliasBeforeLineMatch = line.match(aliasBeforeValuePattern);
      if (aliasBeforeLineMatch) {
        const parsed = Number(aliasBeforeLineMatch[1]);
        if (isPlausibleRuleValue(parsed, rule)) {
          bestValue = parsed;
          bestUnit = aliasBeforeLineMatch[2] ?? findUnitFromText(line);
        }
      }

      if (bestValue == null) {
        const valueBeforeLineMatch = line.match(valueBeforeAliasPattern);
        if (valueBeforeLineMatch) {
          const parsed = Number(valueBeforeLineMatch[1]);
          if (isPlausibleRuleValue(parsed, rule)) {
            bestValue = parsed;
            bestUnit = valueBeforeLineMatch[2] ?? findUnitFromText(line);
          }
        }
      }

      if (bestValue == null) {
        const lineValue = findValueFromText(line);
        if (lineValue == null || !isPlausibleRuleValue(lineValue, rule)) {
          continue;
        }
        bestValue = lineValue;
        bestUnit = findUnitFromText(line);
      }

      if (bestValue != null) {
        const range = parseReferenceFromLine(line);
        const resolvedMin =
          range.min != null && Number.isFinite(range.min) ? range.min : rule.referenceMin;
        const resolvedMax =
          range.max != null && Number.isFinite(range.max) ? range.max : rule.referenceMax;

        resultsByComponent.set(rule.componentName, {
          category: rule.category,
          component_name: rule.componentName,
          measured_value: bestValue,
          unit: (bestUnit || rule.defaultUnit).trim(),
          reference_min: resolvedMin,
          reference_max: resolvedMax,
          confidence,
          source_line: sourceLine,
        });
        break;
      }
    }

    // Second pass: flattened-window parsing for PDF text that loses row boundaries.
    if (bestValue == null) {
      const lowerText = normalizedText.toLowerCase();

      for (const alias of rule.aliases) {
        const aliasLower = alias.toLowerCase();
        let aliasIndex = lowerText.indexOf(aliasLower);

        while (aliasIndex !== -1) {
          const windowStart = Math.max(0, aliasIndex - 40);
          const windowEnd = Math.min(normalizedText.length, aliasIndex + 180);
          const windowText = normalizedText.slice(windowStart, windowEnd);
          const numberRegex = /-?\d+(?:\.\d+)?/g;
          let numericMatch: RegExpExecArray | null;

          while ((numericMatch = numberRegex.exec(windowText)) !== null) {
            const token = numericMatch[0];
            const tokenStart = numericMatch.index;
            const tokenEnd = tokenStart + token.length;

            if (isDateNumberToken(windowText, tokenStart, tokenEnd)) {
              continue;
            }

            const parsed = Number(token);
            if (!isPlausibleRuleValue(parsed, rule)) {
              continue;
            }

            bestValue = parsed;
            bestUnit = findUnitFromText(windowText);
            const range = parseReferenceFromLine(windowText);
            const resolvedMin =
              range.min != null && Number.isFinite(range.min) ? range.min : rule.referenceMin;
            const resolvedMax =
              range.max != null && Number.isFinite(range.max) ? range.max : rule.referenceMax;

            resultsByComponent.set(rule.componentName, {
              category: rule.category,
              component_name: rule.componentName,
              measured_value: bestValue,
              unit: (bestUnit || rule.defaultUnit).trim(),
              reference_min: resolvedMin,
              reference_max: resolvedMax,
              confidence,
              source_line: `${sourceLine}-window`,
            });
            break;
          }

          if (bestValue != null) {
            break;
          }

          aliasIndex = lowerText.indexOf(aliasLower, aliasIndex + aliasLower.length);
        }

        if (bestValue != null) {
          break;
        }
      }
    }

    if (bestValue == null || Number.isNaN(bestValue)) {
      continue;
    }
  }

  const genericRowPattern =
    /^([A-Za-z][A-Za-z0-9()/%+\- .]{2,80})\s+(-?\d+(?:\.\d+)?)\s*([A-Za-z%/^0-9._-]{0,20})\s*(?:(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?))?/i;

  for (const line of lines) {
    const rowMatch = line.match(genericRowPattern);
    if (!rowMatch) {
      continue;
    }

    const componentName = rowMatch[1].trim();
    const measuredValue = Number(rowMatch[2]);
    if (!componentName || Number.isNaN(measuredValue) || measuredValue < 0 || isLikelyYear(measuredValue)) {
      continue;
    }

    if (/(^|\s)(page|result|results|range|reference|comment|specimen|sample)(\s|$)/i.test(componentName)) {
      continue;
    }

    const normalizedKey = componentName.toLowerCase();
    if (resultsByComponent.has(normalizedKey)) {
      continue;
    }

    const unitCandidate = rowMatch[3]?.trim() || "";
    if (/\d/.test(unitCandidate) && !/(10\^3|10\*3)/i.test(unitCandidate)) {
      continue;
    }

    const refMinCandidate = rowMatch[4] ? Number(rowMatch[4]) : null;
    const refMaxCandidate = rowMatch[5] ? Number(rowMatch[5]) : null;
    const referenceMin =
      refMinCandidate != null && Number.isFinite(refMinCandidate) ? refMinCandidate : 0;
    const referenceMax =
      refMaxCandidate != null && Number.isFinite(refMaxCandidate) ? refMaxCandidate : 0;

    // Generic capture must have either a clear unit or a reference range.
    if (!unitCandidate && referenceMin === 0 && referenceMax === 0) {
      continue;
    }

    resultsByComponent.set(normalizedKey, {
      category: inferCategoryFromName(componentName),
      component_name: componentName,
      measured_value: measuredValue,
      unit: unitCandidate,
      reference_min: referenceMin,
      reference_max: referenceMax,
      confidence: Math.max(0.55, confidence - 0.15),
      source_line: `${sourceLine}-generic-row`,
    });

    if (resultsByComponent.size >= 40) {
      break;
    }
  }

  return Array.from(resultsByComponent.values());
}

function buildFallbackComponents(category: string): SeedComponent[] {
  const selectedCategory = category.trim() || "General";

  return [
    {
      category: selectedCategory,
      component_name: "Hemoglobin",
      measured_value: 12.8,
      unit: "g/dL",
      reference_min: 12.0,
      reference_max: 15.5,
      confidence: 0.72,
      source_line: "fallback-seed",
    },
    {
      category: selectedCategory,
      component_name: "WBC",
      measured_value: 7.4,
      unit: "x10^3/uL",
      reference_min: 4.0,
      reference_max: 10.5,
      confidence: 0.72,
      source_line: "fallback-seed",
    },
    {
      category: selectedCategory,
      component_name: "Glucose (fasting)",
      measured_value: 104,
      unit: "mg/dL",
      reference_min: 70,
      reference_max: 99,
      confidence: 0.72,
      source_line: "fallback-seed",
    },
  ];
}

function summarizeAiError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown AI extraction error";
  return message.replace(/\s+/g, " ").trim().slice(0, 220);
}

function computeComponentStatusForStorage(component: SeedComponent): "red" | "yellow" | "green" | "unknown" {
  return classifyComponentStatus({
    measuredValue: component.measured_value,
    referenceMin: component.reference_min,
    referenceMax: component.reference_max,
  });
}

async function hasAiExtractionConsent({
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_extraction_consents")
    .select("accepted_at, revoked_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return false;
  }

  return Boolean(data?.accepted_at) && !data?.revoked_at;
}

async function extractTextFromDocument({
  supabase,
  storagePath,
  mimeType,
  userId,
  documentId,
  reportId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  storagePath: string;
  mimeType: string | null;
  userId: string;
  documentId: string;
  reportId: string;
}): Promise<{
  text: string;
  parserVersion: string;
  defaultConfidence: number;
  sourceLine: string;
}> {
  if (!mimeType) {
    return {
      text: "",
      parserVersion: "unknown-mime-v1",
      defaultConfidence: 0.7,
      sourceLine: "unknown-mime",
    };
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("user-documents")
    .download(storagePath);

  if (downloadError) {
    logServerError("documents.requestExtraction", "storage_download_failed", {
      userId,
      documentId,
      reportId,
      storagePath,
      error: downloadError.message,
    });
    return {
      text: "",
      parserVersion: "storage-download-failed-v1",
      defaultConfidence: 0.7,
      sourceLine: "storage-download-failed",
    };
  }

  if (mimeType === "text/plain") {
    return {
      text: await fileBlob.text(),
      parserVersion: "text-heuristic-v1",
      defaultConfidence: 0.88,
      sourceLine: "text-heuristic",
    };
  }

  const arrayBuffer = await fileBlob.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  async function runOcrOnImageBuffer(imageBuffer: Buffer): Promise<string> {
    try {
      const { recognize } = await import("tesseract.js");
      const result = await recognize(imageBuffer, "eng");
      return result.data?.text ?? "";
    } catch (error) {
      logServerError("documents.requestExtraction", "ocr_image_failed", {
        userId,
        documentId,
        reportId,
        storagePath,
        error: error instanceof Error ? error.message : "Unknown OCR image error",
      });
      return "";
    }
  }

  async function runOcrOnPdfBuffer(pdfBuffer: Buffer): Promise<string> {
    try {
      const dynamicImport = new Function(
        "modulePath",
        "return import(modulePath)",
      ) as (modulePath: string) => Promise<unknown>;

      const pdfjs = (await dynamicImport(
        "pdfjs-dist/legacy/build/pdf.mjs",
      )) as {
        getDocument: (input: { data: Uint8Array }) => {
          promise: Promise<{
            numPages: number;
            getPage: (pageNumber: number) => Promise<{
              getViewport: (input: { scale: number }) => {
                width: number;
                height: number;
              };
              render: (input: {
                canvasContext: unknown;
                viewport: unknown;
              }) => { promise: Promise<void> };
            }>;
          }>;
        };
      };

      const canvasModule = (await dynamicImport("@napi-rs/canvas")) as {
        createCanvas: (width: number, height: number) => {
          getContext: (kind: "2d") => unknown;
          toBuffer: (format: "image/png") => Buffer;
        };
      };
      const { createCanvas } = canvasModule;

      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) });
      const pdfDocument = await loadingTask.promise;
      const pageCount = Math.min(pdfDocument.numPages, 5);

      let combinedText = "";

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 3 });

        const canvas = createCanvas(
          Math.max(1, Math.ceil(viewport.width)),
          Math.max(1, Math.ceil(viewport.height)),
        );
        const context = canvas.getContext("2d");

        await page.render({
          canvasContext: context,
          viewport,
        }).promise;

        const imageBuffer = canvas.toBuffer("image/png");
        const pageText = await runOcrOnImageBuffer(imageBuffer);
        combinedText += `\n${pageText}`;
      }

      return combinedText;
    } catch (error) {
      logServerError("documents.requestExtraction", "ocr_pdf_failed", {
        userId,
        documentId,
        reportId,
        storagePath,
        error: error instanceof Error ? error.message : "Unknown OCR PDF error",
      });
      return "";
    }
  }

  async function runPdfTextWithPdfJs(pdfBuffer: Buffer): Promise<string> {
    try {
      const dynamicImport = new Function(
        "modulePath",
        "return import(modulePath)",
      ) as (modulePath: string) => Promise<unknown>;

      const pdfjs = (await dynamicImport(
        "pdfjs-dist/legacy/build/pdf.mjs",
      )) as {
        getDocument: (input: { data: Uint8Array }) => {
          promise: Promise<{
            numPages: number;
            getPage: (pageNumber: number) => Promise<{
              getTextContent: () => Promise<{
                items: Array<{ str?: string }>;
              }>;
            }>;
          }>;
        };
      };

      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) });
      const pdfDocument = await loadingTask.promise;
      const pageCount = Math.min(pdfDocument.numPages, 8);

      let combinedText = "";
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();

        const rows: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];
        for (const item of textContent.items as Array<{
          str?: string;
          transform?: number[];
        }>) {
          const token = typeof item.str === "string" ? item.str.trim() : "";
          if (!token) continue;

          const x = Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0;
          const y = Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0;

          let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
          if (!row) {
            row = { y, parts: [] };
            rows.push(row);
          }

          row.parts.push({ x, text: token });
        }

        const pageText = rows
          .sort((a, b) => b.y - a.y)
          .map((row) =>
            row.parts
              .sort((a, b) => a.x - b.x)
              .map((part) => part.text)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim(),
          )
          .filter((line) => line.length > 0)
          .join("\n")
          .trim();

        if (pageText.length) {
          combinedText += `\n${pageText}`;
        }
      }

      return combinedText;
    } catch (error) {
      logServerError("documents.requestExtraction", "pdfjs_text_extract_failed", {
        userId,
        documentId,
        reportId,
        storagePath,
        error: error instanceof Error ? error.message : "Unknown PDF.js text extraction error",
      });
      return "";
    }
  }

  if (mimeType === "application/pdf") {
    const pdfJsText = await runPdfTextWithPdfJs(fileBuffer);
    if (pdfJsText.trim().length > 0) {
      return {
        text: pdfJsText,
        parserVersion: "pdf-text-heuristic-v1",
        defaultConfidence: 0.84,
        sourceLine: "pdfjs-text-heuristic",
      };
    }

    const ocrText = await runOcrOnPdfBuffer(fileBuffer);
    return {
      text: ocrText,
      parserVersion: "pdf-ocr-heuristic-v1",
      defaultConfidence: 0.78,
      sourceLine: "pdf-ocr-heuristic",
    };
  }

  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") {
    const ocrText = await runOcrOnImageBuffer(fileBuffer);
    return {
      text: ocrText,
      parserVersion: "image-ocr-heuristic-v1",
      defaultConfidence: 0.78,
      sourceLine: "image-ocr-heuristic",
    };
  }

  return {
    text: "",
    parserVersion: "unsupported-mime-v1",
    defaultConfidence: 0.7,
    sourceLine: "unsupported-mime",
  };
}

async function processQueuedExtraction({
  supabase,
  userId,
  documentId,
  reportId,
  fromStatus,
  strategy,
  previousParserVersion,
  extractionMode,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  documentId: string;
  reportId: string;
  fromStatus: DocumentExtractionStatus;
  strategy: ExtractionStrategy;
  previousParserVersion: string | null;
  extractionMode: Exclude<ExtractionMode, "auto">;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (fromStatus !== "processing") {
    const startedProcessing = await transitionDocumentExtractionStatus({
      supabase,
      userId,
      documentId,
      fromStatus,
      nextStatus: "processing",
    });

    if (!startedProcessing.ok) {
      return { ok: false, error: startedProcessing.error };
    }
  }

  const now = new Date().toISOString();
  await supabase
    .from("extracted_reports")
    .update({
      status: "processing",
      parser_version: "phc-heuristic-v1",
      extracted_at: now,
    })
    .eq("id", reportId)
    .eq("user_id", userId);

  const { data: documentRow, error: documentError } = await supabase
    .from("user_documents")
    .select("id, storage_path, mime_type, category, file_name")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (documentError || !documentRow) {
    await transitionDocumentExtractionStatus({
      supabase,
      userId,
      documentId,
      fromStatus: "processing",
      nextStatus: "failed",
      extractionError: documentError?.message ?? "Document metadata not found.",
    });

    await supabase
      .from("extracted_reports")
      .update({ status: "failed" })
      .eq("id", reportId)
      .eq("user_id", userId);

    return {
      ok: false,
      error: documentError?.message ?? "Document metadata not found.",
    };
  }

  // Clear previously extracted rows first so stale demo data is not shown on reruns.
  const { error: clearComponentsError } = await supabase
    .from("extracted_components")
    .delete()
    .eq("report_id", reportId)
    .eq("user_id", userId);

  if (clearComponentsError) {
    return { ok: false, error: clearComponentsError.message };
  }

  let extractedComponents: SeedComponent[] = [];
  let usedDemoFallback = false;

  const extractedTextResult = await extractTextFromDocument({
    supabase,
    storagePath: documentRow.storage_path,
    mimeType: documentRow.mime_type,
    userId,
    documentId,
    reportId,
  });

  let selectedParserVersion =
    strategy === "heuristic-only"
      ? `${extractedTextResult.parserVersion}|heuristic-only-v1`
      : `${extractedTextResult.parserVersion}|ai-not-configured`;
  let aiAttemptErrorMessage: string | null = null;

  if (extractedTextResult.text.trim()) {
    const aiConfig = strategy === "heuristic-only" ? null : getAiExtractionConfig();
    let aiAttempted = false;
    let aiUsedOutput = false;

    if (aiConfig) {
      const hasConsent = await hasAiExtractionConsent({
        supabase,
        userId,
      });

      selectedParserVersion = hasConsent
        ? `${extractedTextResult.parserVersion}|ai-configured`
        : `${extractedTextResult.parserVersion}|ai-skipped-no-consent`;

      if (hasConsent) {
        aiAttempted = true;
        try {
          const aiComponents = await extractComponentsWithAi({
            config: aiConfig,
            documentText: extractedTextResult.text,
            defaultCategory: documentRow.category,
          });

          if (aiComponents.length) {
            extractedComponents = aiComponents;
            aiUsedOutput = true;
            selectedParserVersion = `ai-${aiConfig.provider}-v1`;
          } else {
            selectedParserVersion = `${extractedTextResult.parserVersion}|ai-attempted-empty`;
          }
        } catch (error) {
          selectedParserVersion = `${extractedTextResult.parserVersion}|ai-attempted-error`;
          aiAttemptErrorMessage = summarizeAiError(error);
          logServerError("documents.requestExtraction", "ai_extract_failed", {
            userId,
            documentId,
            reportId,
            error: error instanceof Error ? error.message : "Unknown AI extraction error",
          });
        }
      }
    }

    if (!extractedComponents.length && strategy !== "ai-only") {
      extractedComponents = parseComponentsFromText(extractedTextResult.text, {
        confidence: extractedTextResult.defaultConfidence,
        sourceLine: extractedTextResult.sourceLine,
      });

      if (aiAttempted && !aiUsedOutput) {
        selectedParserVersion = `${selectedParserVersion}|heuristic-fallback-v1`;
      } else if (strategy === "heuristic-only") {
        selectedParserVersion = `${extractedTextResult.parserVersion}|heuristic-only-v1`;
      }
    }

    if (strategy === "ai-only" && !extractedComponents.length && !selectedParserVersion.includes("ai-attempted")) {
      selectedParserVersion = `${extractedTextResult.parserVersion}|ai-skipped-unavailable`;
    }
  }

  if (!extractedComponents.length) {
    if (isPhase2DemoEnabled()) {
      extractedComponents = buildFallbackComponents(documentRow.category);
      usedDemoFallback = true;
    } else {
      await supabase
        .from("extracted_reports")
        .update({
          status: "failed",
          parser_version: selectedParserVersion,
          extraction_confidence: null,
          summary_overall_status: "unknown",
          summary_bullets: [],
          extracted_at: new Date().toISOString(),
        })
        .eq("id", reportId)
        .eq("user_id", userId);

      return {
        ok: false,
        error: `No parsable lab values were found. Parser=${selectedParserVersion}; extractedTextLength=${extractedTextResult.text.length}.`,
      };
    }
  }

  const { error: insertComponentsError } = await supabase
    .from("extracted_components")
    .insert(
      extractedComponents.map((component) => ({
        report_id: reportId,
        user_id: userId,
        category: component.category,
        component_name: component.component_name,
        measured_value: component.measured_value,
        unit: component.unit,
        reference_min: component.reference_min,
        reference_max: component.reference_max,
        status: computeComponentStatusForStorage(component),
        confidence: component.confidence,
        source_line: component.source_line,
      })),
    );

  if (insertComponentsError) {
    await transitionDocumentExtractionStatus({
      supabase,
      userId,
      documentId,
      fromStatus: "processing",
      nextStatus: "failed",
      extractionError: insertComponentsError.message,
    });
    await supabase
      .from("extracted_reports")
      .update({ status: "failed" })
      .eq("id", reportId)
      .eq("user_id", userId);
    return { ok: false, error: insertComponentsError.message };
  }

  const avgConfidence =
    extractedComponents.reduce((sum, item) => sum + item.confidence, 0) /
    extractedComponents.length;

  const { error: reportFinalizeError } = await supabase
    .from("extracted_reports")
    .update({
      status: "extracted",
      extraction_confidence: Number(avgConfidence.toFixed(4)),
      parser_version: mergeModeHistory(
        usedDemoFallback ? "demo-fallback-v1" : selectedParserVersion,
        previousParserVersion,
        extractionMode,
      ),
      source_file_name: documentRow.file_name,
      extracted_at: new Date().toISOString(),
    })
    .eq("id", reportId)
    .eq("user_id", userId);

  if (reportFinalizeError) {
    return { ok: false, error: reportFinalizeError.message };
  }

  const finishedProcessing = await transitionDocumentExtractionStatus({
    supabase,
    userId,
    documentId,
    fromStatus: "processing",
    nextStatus: "extracted",
  });

  if (!finishedProcessing.ok) {
    return { ok: false, error: finishedProcessing.error };
  }

  if (aiAttemptErrorMessage) {
    await supabase
      .from("user_documents")
      .update({
        extraction_error: `AI attempt failed; heuristic fallback used. ${aiAttemptErrorMessage}`,
      })
      .eq("id", documentId)
      .eq("user_id", userId);
  }

  return { ok: true };
}

export async function uploadDocumentAction(
  _prevState: DocumentsActionState,
  formData: FormData,
): Promise<DocumentsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const parsed = uploadSchema.safeParse({
    category: formData.get("category"),
  });

  if (!parsed.success) {
    logServerError("documents.upload", "validation_failed", {
      userId: user.id,
      issues: parsed.error.issues,
    });
    return { error: parsed.error.issues[0]?.message ?? initialUploadError };
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    return { error: "Select a file to upload." };
  }

  if (fileValue.size === 0) {
    return { error: "Selected file is empty." };
  }

  if (fileValue.size > MAX_DOCUMENT_SIZE_BYTES) {
    return { error: "File exceeds 10 MB limit." };
  }

  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(fileValue.type as never)) {
    return {
      error:
        "Unsupported file type. Allowed: PDF, PNG, JPG, WEBP, and text files.",
    };
  }

  const safeName = sanitizeFileName(fileValue.name || "document");
  const storagePath = `${user.id}/${Date.now()}-${safeName}`;

  const { error: storageError } = await supabase.storage
    .from("user-documents")
    .upload(storagePath, fileValue, {
      contentType: fileValue.type,
      upsert: false,
    });

  if (storageError) {
    logServerError("documents.upload", "storage_upload_failed", {
      userId: user.id,
      fileName: fileValue.name,
      error: storageError.message,
    });
    return { error: storageError.message };
  }

  const { error: insertError } = await supabase.from("user_documents").insert({
    user_id: user.id,
    category: parsed.data.category,
    file_name: fileValue.name,
    mime_type: fileValue.type,
    file_size_bytes: fileValue.size,
    storage_path: storagePath,
    status: "uploaded",
    extraction_status: "not_started",
  });

  if (insertError) {
    logServerError("documents.upload", "metadata_insert_failed", {
      userId: user.id,
      storagePath,
      error: insertError.message,
    });

    const { error: rollbackError } = await supabase.storage
      .from("user-documents")
      .remove([storagePath]);

    if (rollbackError) {
      logServerError("documents.upload", "storage_rollback_failed", {
        userId: user.id,
        storagePath,
        error: rollbackError.message,
      });
    }

    return { error: insertError.message };
  }

  revalidatePath("/app/documents");
  revalidatePath("/app/profile");
  return { success: "Document uploaded successfully." };
}

export async function requestExtractionAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const documentId = formData.get("document_id")?.toString();
  const extractionModeRaw = formData.get("extraction_mode")?.toString() ?? "ai";
  const extractionMode: ExtractionMode =
    extractionModeRaw === "heuristic" || extractionModeRaw === "ai" || extractionModeRaw === "auto"
      ? extractionModeRaw
      : "ai";
  if (!documentId) {
    return;
  }

  const { data: doc, error: docError } = await supabase
    .from("user_documents")
    .select("id, extraction_status")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (docError || !doc) {
    logServerError("documents.requestExtraction", "document_fetch_failed", {
      userId: user.id,
      documentId,
      error: docError?.message,
    });
    return;
  }

  const isValidStatus = documentExtractionStatuses.includes(
    doc.extraction_status as DocumentExtractionStatus,
  );
  const fromStatus: DocumentExtractionStatus = isValidStatus
    ? (doc.extraction_status as DocumentExtractionStatus)
    : "not_started";

  let processingStartStatus: DocumentExtractionStatus = fromStatus;

  if (fromStatus === "not_started" || fromStatus === "failed") {
    const queueResult = await transitionDocumentExtractionStatus({
      supabase,
      userId: user.id,
      documentId,
      fromStatus,
      nextStatus: "queued",
    });

    if (!queueResult.ok) {
      logServerError("documents.requestExtraction", "status_transition_failed", {
        userId: user.id,
        documentId,
        fromStatus,
        nextStatus: "queued",
        error: queueResult.error,
      });
      return;
    }

    processingStartStatus = "queued";
  } else if (fromStatus === "queued" || fromStatus === "processing") {
    processingStartStatus = fromStatus;
  } else if (fromStatus === "extracted" || fromStatus === "needs_review") {
    processingStartStatus = fromStatus;
  } else {
    logServerError("documents.requestExtraction", "unsupported_start_status", {
      userId: user.id,
      documentId,
      fromStatus,
    });
    return;
  }

  const runExtraction = async ({
    strategy,
    startStatus,
    markDocumentFailedOnError,
    mode,
  }: {
    strategy: ExtractionStrategy;
    startStatus: DocumentExtractionStatus;
    markDocumentFailedOnError: boolean;
    mode: Exclude<ExtractionMode, "auto">;
  }): Promise<{ ok: boolean; reportId: string | null; error?: string }> => {
    const { data: existingReports, error: existingReportsError } = await supabase
      .from("extracted_reports")
      .select("id, parser_version")
      .eq("user_id", user.id)
      .eq("document_id", documentId)
      .order("created_at", { ascending: false });

    if (existingReportsError) {
      logServerError("documents.requestExtraction", "load_existing_reports_failed", {
        userId: user.id,
        documentId,
        strategy,
        error: existingReportsError.message,
      });
      return { ok: false, reportId: null, error: existingReportsError.message };
    }

    const latestExistingReport = existingReports?.[0] ?? null;
    const previousParserVersion = latestExistingReport?.parser_version ?? null;

    if (hasModeBeenRun(previousParserVersion, mode)) {
      return { ok: true, reportId: latestExistingReport?.id ?? null };
    }

    let reportId = latestExistingReport?.id ?? null;
    const staleReportIds = (existingReports ?? []).slice(1).map((report) => report.id);

    if (staleReportIds.length) {
      await supabase
        .from("extracted_reports")
        .delete()
        .in("id", staleReportIds)
        .eq("user_id", user.id);
    }

    if (!reportId) {
      const { data: insertedReport, error: insertReportError } = await supabase
        .from("extracted_reports")
        .insert({
          user_id: user.id,
          document_id: documentId,
          status: "queued",
        })
        .select("id")
        .single();

      if (insertReportError || !insertedReport?.id) {
        logServerError("documents.requestExtraction", "seed_report_insert_failed", {
          userId: user.id,
          documentId,
          strategy,
          error: insertReportError?.message ?? "Missing report id after insert",
        });
        return {
          ok: false,
          reportId: null,
          error: insertReportError?.message ?? "Failed to create report row.",
        };
      }

      reportId = insertedReport.id;
    }

    await supabase
      .from("extracted_reports")
      .update({
        status: "queued",
        extraction_confidence: null,
        parser_version: null,
        summary_overall_status: "unknown",
        summary_bullets: [],
        extracted_at: null,
      })
      .eq("id", reportId)
      .eq("user_id", user.id);

    const processingResult = await processQueuedExtraction({
      supabase,
      userId: user.id,
      documentId,
      reportId,
      fromStatus: startStatus,
      strategy,
      previousParserVersion,
      extractionMode: mode,
    });

    if (processingResult.ok) {
      return { ok: true, reportId };
    }

    logServerError("documents.requestExtraction", "process_queued_failed", {
      userId: user.id,
      documentId,
      reportId,
      strategy,
      error: processingResult.error,
    });

    if (markDocumentFailedOnError) {
      await transitionDocumentExtractionStatus({
        supabase,
        userId: user.id,
        documentId,
        fromStatus: "processing",
        nextStatus: "failed",
        extractionError: processingResult.error,
      });
    }

    await supabase
      .from("extracted_reports")
      .update({
        status: "failed",
        extraction_confidence: null,
        summary_overall_status: "unknown",
        summary_bullets: [],
      })
      .eq("id", reportId)
      .eq("user_id", user.id);

    return { ok: false, reportId, error: processingResult.error };
  };

  if (extractionMode === "heuristic") {
    await runExtraction({
      strategy: "heuristic-only",
      startStatus: processingStartStatus,
      markDocumentFailedOnError: true,
      mode: "heuristic",
    });
  } else if (extractionMode === "ai") {
    await runExtraction({
      strategy: "ai-only",
      startStatus: processingStartStatus,
      markDocumentFailedOnError: true,
      mode: "ai",
    });
  } else {
    await runExtraction({
      strategy: "auto",
      startStatus: processingStartStatus,
      markDocumentFailedOnError: true,
      mode: "ai",
    });
  }

  revalidatePath("/app/documents");
  revalidatePath("/app/profile");
  revalidatePath(`/app/documents/${documentId}/extraction`);
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const documentId = formData.get("document_id")?.toString();
  if (!documentId) {
    return;
  }

  const { data: row } = await supabase
    .from("user_documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    logServerError("documents.delete", "document_not_found_or_not_owned", {
      userId: user.id,
      documentId,
    });
    return;
  }

  const { error: removeStorageError } = await supabase.storage
    .from("user-documents")
    .remove([row.storage_path]);

  if (removeStorageError) {
    logServerError("documents.delete", "storage_delete_failed", {
      userId: user.id,
      documentId,
      storagePath: row.storage_path,
      error: removeStorageError.message,
    });
    return;
  }

  const { error: deleteMetadataError } = await supabase
    .from("user_documents")
    .delete()
    .eq("id", row.id)
    .eq("user_id", user.id);

  if (deleteMetadataError) {
    logServerError("documents.delete", "metadata_delete_failed", {
      userId: user.id,
      documentId,
      error: deleteMetadataError.message,
    });
    return;
  }

  revalidatePath("/app/documents");
  revalidatePath("/app/profile");
}

export async function openOriginalDocumentAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const documentId = formData.get("document_id")?.toString();
  if (!documentId) {
    return;
  }

  const { data: row, error: rowError } = await supabase
    .from("user_documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (rowError || !row?.storage_path) {
    logServerError("documents.openOriginal", "document_not_found_or_not_owned", {
      userId: user.id,
      documentId,
      error: rowError?.message,
    });
    return;
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from("user-documents")
    .createSignedUrl(row.storage_path, 60);

  if (signedError || !signedData?.signedUrl) {
    logServerError("documents.openOriginal", "signed_url_failed", {
      userId: user.id,
      documentId,
      storagePath: row.storage_path,
      error: signedError?.message,
    });
    return;
  }

  redirect(signedData.signedUrl);
}
