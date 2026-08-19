# Phase 2 Implementation Log

## Date
2026-08-10

## Sprint 2.0 Progress

### Completed
- Added Phase 2 feature flag helper:
  - `apps/web/src/lib/feature-flags.ts`
- Added extraction domain constants, types, and validation schemas:
  - `apps/web/src/lib/extraction.ts`
- Added extraction status transition service with allowed transition guardrails:
  - `apps/web/src/lib/extraction-status.ts`
- Updated document upload flow to initialize `extraction_status`.
- Added action to queue extraction status:
  - `requestExtractionAction` in `apps/web/src/app/app/documents/actions.ts`
- Updated documents page to show extraction status and new actions:
  - queue extraction
  - open extraction details page
- Added Extraction review route:
  - `apps/web/src/app/app/documents/[id]/extraction/page.tsx`

### Validation
- `npm run lint`: PASS
- `npm run build`: PASS

## Sprint 2.1 Progress (OCR Enablement)

### Completed
- Added OCR-enabled extraction flow in queue processing:
  - image OCR for PNG/JPEG/WEBP
  - PDF text extraction first, then OCR fallback for scanned PDFs
- Added parser metadata per extraction path:
  - `text-heuristic-v1`
  - `pdf-text-heuristic-v1`
  - `pdf-ocr-heuristic-v1`
  - `image-ocr-heuristic-v1`
- Kept demo fallback strictly gated by `FEATURE_PHASE2_DEMO=true`.

### Validation
- `npm run lint`: PASS
- `npm run build`: PASS

## Sprint 2.1 Progress (Parser Behavior Correction)

### Completed
- Added PDF text extraction support using `pdf-parse` in queue processing.
- Updated extraction processing behavior:
  - Demo fallback components are now used only when `FEATURE_PHASE2_DEMO=true`.
  - In normal mode, unparsable files are marked failed with a clear extraction error instead of showing fallback/demo-like values.

### Validation
- `npm run lint`: PASS
- `npm run build`: PASS

## Sprint 2.1 Progress (Queue Processing Upgrade)

### Completed
- Implemented automatic processing in `requestExtractionAction`:
  - queued -> processing -> extracted status path
  - report status sync (`queued`, `processing`, `extracted`)
- Added heuristic extraction processor for uploaded files:
  - text parsing for common lab markers from text/plain uploads
  - deterministic fallback component seeding when no parsable values are found
- Added report component refresh behavior on re-run by deleting prior extracted components for the same report before inserting fresh results.
- Added robust failure handling that marks document/report as failed on processing errors.

### Validation
- `npm run lint`: PASS
- `npm run build`: PASS

## Supabase Status
- Phase 2 migration was applied successfully:
  - `db/migrations/002_phase2_extraction_schema.sql`
- No additional mandatory schema changes are required for Sprint 2.0 baseline.

## Next Implementation Step
- Start Sprint 2.1 UI refinement and deterministic rules:
  - status classification engine
  - observation bullets generator
  - confirm/edit extracted component flow

## Sprint 2.1 Progress (Initial)

### Completed
- Added deterministic classification and summary generator:
  - `apps/web/src/lib/extraction-insights.ts`
- Added extraction review actions:
  - `applyDeterministicInsightsAction`
  - `confirmExtractedComponentAction`
  - file: `apps/web/src/app/app/documents/[id]/extraction/actions.ts`
- Upgraded extraction review page:
  - status badges with red/yellow/green styling
  - deterministic insights apply button
  - per-component confirm/edit form persisted to `user_confirmed_components`
- Enhanced extraction queue action to seed `extracted_reports` if absent.

### Validation
- `npm run lint`: PASS
- `npm run build`: PASS

## Sprint 2.2 Progress (AI-Assisted Extraction)

### Completed
- Added AI extraction provider configuration helpers:
  - `apps/web/src/lib/ai/env.ts`
- Added OpenAI-compatible structured extraction client with strict JSON validation:
  - `apps/web/src/lib/ai/extraction.ts`
- Updated queue processing pipeline to AI-first with deterministic parser fallback:
  - `apps/web/src/app/app/documents/actions.ts`
- Added user acknowledgement action and extraction page UI block for AI provider usage:
  - `apps/web/src/app/app/documents/[id]/extraction/actions.ts`
  - `apps/web/src/app/app/documents/[id]/extraction/page.tsx`
- Added SQL migration for per-user AI extraction consent tracking:
  - `db/migrations/003_phase2_ai_extraction_consent.sql`
- Updated app README with AI extraction environment configuration and migration checklist:
  - `apps/web/README.md`
