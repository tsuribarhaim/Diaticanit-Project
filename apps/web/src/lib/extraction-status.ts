import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type DocumentExtractionStatus,
  extractionUpdateSchema,
} from "@/lib/extraction";

const allowedTransitions: Record<
  DocumentExtractionStatus,
  DocumentExtractionStatus[]
> = {
  not_started: ["queued", "failed"],
  queued: ["processing", "failed"],
  processing: ["extracted", "needs_review", "failed"],
  extracted: ["processing", "needs_review", "failed"],
  needs_review: ["processing", "extracted", "failed"],
  failed: ["queued", "processing"],
};

export async function transitionDocumentExtractionStatus({
  supabase,
  userId,
  documentId,
  fromStatus,
  nextStatus,
  extractionError,
}: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
  fromStatus: DocumentExtractionStatus;
  nextStatus: DocumentExtractionStatus;
  extractionError?: string;
}) {
  const parsed = extractionUpdateSchema.safeParse({
    documentId,
    nextStatus,
    extractionError,
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Invalid extraction status payload.",
    };
  }

  if (!allowedTransitions[fromStatus].includes(nextStatus)) {
    return {
      ok: false as const,
      error: `Invalid extraction status transition: ${fromStatus} -> ${nextStatus}.`,
    };
  }

  const { error } = await supabase
    .from("user_documents")
    .update({
      extraction_status: nextStatus,
      extraction_error: extractionError ?? null,
      extraction_last_run_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("user_id", userId)
    .eq("extraction_status", fromStatus);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}
