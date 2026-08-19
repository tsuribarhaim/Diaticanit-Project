import { z } from "zod";

export const documentExtractionStatuses = [
  "not_started",
  "queued",
  "processing",
  "extracted",
  "needs_review",
  "failed",
] as const;

export const extractedReportStatuses = [
  "queued",
  "processing",
  "extracted",
  "needs_review",
  "failed",
  "confirmed",
] as const;

export const componentStatuses = ["red", "yellow", "green", "unknown"] as const;

export const overallStatuses = ["stable", "attention", "critical", "unknown"] as const;

export type DocumentExtractionStatus = (typeof documentExtractionStatuses)[number];
export type ExtractedReportStatus = (typeof extractedReportStatuses)[number];
export type ComponentStatus = (typeof componentStatuses)[number];
export type OverallStatus = (typeof overallStatuses)[number];

export const extractionUpdateSchema = z.object({
  documentId: z.uuid(),
  nextStatus: z.enum(documentExtractionStatuses),
  extractionError: z.string().trim().max(1000).optional(),
});

export const extractedComponentSchema = z.object({
  reportId: z.uuid(),
  category: z.string().trim().min(1).max(80),
  componentName: z.string().trim().min(1).max(120),
  measuredValue: z.number().optional(),
  measuredValueText: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(40).optional(),
  referenceMin: z.number().optional(),
  referenceMax: z.number().optional(),
  referenceText: z.string().trim().max(120).optional(),
  status: z.enum(componentStatuses),
  confidence: z.number().min(0).max(1).optional(),
});

export const confirmComponentSchema = z.object({
  reportId: z.uuid(),
  componentId: z.uuid(),
  confirmedValueNumeric: z.number().optional(),
  confirmedValueText: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(40).optional(),
  confirmedStatus: z.enum(componentStatuses),
  note: z.string().trim().max(400).optional(),
});
