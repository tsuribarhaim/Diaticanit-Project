# Phase 2 Implementation Tickets (Sprint 2.0 and Sprint 2.1)

## Goal
Convert the approved Phase 2 sprint plan into actionable build tickets with route scope, DB scope, component scope, and acceptance tests.

## Sprint 2.0 (1 week): Foundations and Guardrails

### P2-001: Apply Phase 2 schema and RLS migration
- Type: Backend / Database
- Depends on: Phase 1 migration already applied
- Scope:
  - Apply migration file db/migrations/002_phase2_extraction_schema.sql
  - Verify table creation and policies
  - Verify indexes and triggers
- Acceptance:
  - Tables exist: extracted_reports, extracted_components, component_reference_ranges, user_confirmed_components
  - New columns exist on user_documents for extraction pipeline state
  - RLS active on user-owned Phase 2 tables
  - Owner-scoped CRUD verified with two users
- Test steps:
  - Run table introspection in Supabase SQL editor
  - Run two-user select and update checks

### P2-002: Add typed domain models and validation schemas
- Type: App Backend
- Scope:
  - Add shared types for extraction status, component status, and report summaries
  - Add Zod schemas for extracted component payloads and confirmation payloads
  - Add parser contract type for ingestion adapter
- Acceptance:
  - Invalid extraction payloads are rejected server-side
  - Type-safe status values are enforced

### P2-003: Document extraction pipeline state model
- Type: App Backend
- Scope:
  - Add status lifecycle to user_documents usage:
    - not_started, queued, processing, extracted, needs_review, failed
  - Add service methods to transition state safely
  - Add failure reason capture
- Acceptance:
  - Valid transitions update extraction_status and timestamps
  - Failed state includes error context

### P2-004: Feature flags for Phase 2 routes
- Type: App Frontend/Backend
- Scope:
  - Add feature flag checks for:
    - /app/documents/[id]/extraction
  - Hide links when disabled
- Acceptance:
  - Routes are inaccessible when flags disabled
  - Routes are accessible when flags enabled

### P2-005: Baseline observability for extraction flow
- Type: Reliability
- Scope:
  - Add structured logs for extraction request start, success, fail, and confirm events
  - Include document_id, report_id, user_id, parser_version where available
- Acceptance:
  - Logs emitted on all core extraction transitions

## Sprint 2.1 (2 weeks): Extraction Review Experience

### P2-101: Extraction result page route and data loader
- Type: Frontend + Backend
- Route: /app/documents/[id]/extraction
- Scope:
  - Secure loader for extraction report and components by document_id
  - Owner-only data access
  - Empty and processing states
- Acceptance:
  - User can open extraction page for own document
  - User cannot access another user document extraction page
  - Processing/failed states render correctly

### P2-102: Header summary panel
- Type: Frontend
- Component: ExtractionSummaryCard
- Scope:
  - Show file name, extraction time, parser version, confidence
  - Show component count by status color
- Acceptance:
  - Header reflects report metadata accurately
  - Status counts match table rows

### P2-103: Organized component table and status badges
- Type: Frontend
- Components:
  - ComponentStatusTable
  - StatusBadge
- Scope:
  - Group rows by category (CBC, iron, glucose, lipids, thyroid, liver, kidney)
  - Row fields:
    - component name
    - measured value and unit
    - reference range
    - status badge (red/yellow/green/unknown)
    - trend indicator when prior value exists
- Acceptance:
  - Grouping and sorting are correct
  - Badge mapping is consistent with stored status

### P2-104: Status classification engine (deterministic V1)
- Type: Backend Rules
- Scope:
  - Implement first-pass deterministic status logic
  - Map component value vs reference range to red/yellow/green
  - Allow unknown when data is incomplete
- Acceptance:
  - Unit tests pass for nominal, boundary, and missing-data cases

### P2-105: Observation bullets (deterministic V1)
- Type: Backend Rules + UI
- Component: ObservationBullets
- Scope:
  - Generate 3 to 5 clear summary bullets
  - Include informational disclaimer language
  - Prefer concise phrasing and top-priority issues first
- Acceptance:
  - Bullets are generated for complete reports
  - Empty state handled when insufficient data
  - Text avoids diagnostic claims

### P2-106: Confirm and edit flow
- Type: Full Stack
- Components:
  - ConfirmedValueToggle
  - ExtractionEditDrawer
- Scope:
  - User edits extracted values
  - User marks component confirmed
  - Save to user_confirmed_components
  - Track confirmed timestamp
- Acceptance:
  - Confirmed value persists and reloads correctly
  - Only owner can confirm/edit
  - Validation blocks invalid numeric payloads

### P2-108: Sprint 2.1 UX and accessibility pass
- Type: Frontend UX
- Scope:
  - Color plus icon redundancy for status states
  - Keyboard navigation in table and drawer
  - Readable mobile layout
- Acceptance:
  - Red/yellow/green states remain understandable without color alone
  - Core interactions pass keyboard-only smoke test

## Route Scope (Phase 2.0 and 2.1)
- /app/documents/[id]/extraction

## Component Scope (Phase 2.0 and 2.1)
- ExtractionSummaryCard
- ComponentStatusTable
- StatusBadge
- ObservationBullets
- ConfirmedValueToggle
- ExtractionEditDrawer
- LabsReportHistoryList

## Definition of Done for Sprint 2.1
- Extraction detail page is production-usable for owner-scoped review
- Deterministic status and bullets are working
- Confirm/edit flow persists safely
- Two-user isolation passes for all new entities
- Lint/build pass

## Supabase Update Requirement
Yes. You must apply a new migration for Phase 2 before implementation can work:
- db/migrations/002_phase2_extraction_schema.sql

If this migration is not applied in the same Supabase project used by apps/web/.env.local, Phase 2 routes will fail with missing table errors.
