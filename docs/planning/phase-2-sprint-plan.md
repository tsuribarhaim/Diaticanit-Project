# Phase 2 Sprint Plan

## 1) Phase 2 Purpose
Phase 2 transforms Phase 1 from secure data capture into practical health intelligence. The objective is to help users understand uploaded health files, confirm extracted data, view simple quality signals, and get actionable but cautious observations.

This phase keeps the same security model from Phase 1:
- per-user isolation
- strict ownership checks
- auditable server actions

## 2) What We Want to Achieve
1. A user uploads a blood report and can immediately see a clear, organized extraction result.
2. Every extracted component is shown in a readable card/table with a value status signal:
- below range or high risk: red
- borderline or needs attention: yellow
- within expected range: green
3. The user can review and correct extracted values before they are used downstream.
4. The user sees short summary bullets, for example:
- overall status appears stable
- iron needs improvement
- follow-up check recommended for one component
5. The app can compute early daily targets using trusted profile plus confirmed extraction data.
6. The app starts nutrition logging and lightweight insights.

## 3) Proposed Sprint Cadence
- Sprint 2.0: readiness and foundations (1 week)
- Sprint 2.1: extraction review experience (2 weeks)
- Sprint 2.2: targets and guidance layer (2 weeks)
- Sprint 2.3: nutrition logging and insight snapshots (2 weeks)

Total: 7 weeks

## 4) Sprint 2.0 - Foundations and Guardrails
### Goal
Create the technical base for extraction and interpretation without exposing incomplete UX.

### Scope
- Add new phase tables and RLS policies for extracted records.
- Add document-processing status model: queued, processing, extracted, needs_review, failed.
- Add feature flags for Phase 2 routes.
- Add audit metadata fields: source file, extraction confidence, parser version, extracted_at.
- Add typed domain models and validation schemas for lab components.

### Acceptance Criteria
- New tables are created with RLS and owner policies.
- A document can transition through processing states safely.
- No cross-user access to extracted data.
- Build and lint remain green.

## 5) Sprint 2.1 - Extraction Review Experience
### Goal
Deliver the clear extraction screen you requested with status colors and concise observations.

### Core User Experience
After document upload, user opens a result view with:
1. Header Summary Panel
- file name and extraction time
- extraction confidence indicator
- count of components by status color

2. Organized Results View
- group by category: CBC, iron panel, glucose, lipids, thyroid, liver, kidney
- each component row shows:
  - component name
  - measured value
  - unit
  - reference range
  - status badge: red, yellow, green
  - trend arrow if prior value exists

3. Status Logic (first release)
- red: clearly outside reference range
- yellow: near threshold or mild variance
- green: comfortably within range

4. Initial Observations Bullets
- 3 to 5 bullets generated from deterministic rules first
- example output style:
  - overall results are mostly stable
  - iron marker appears below expected range
  - consider rechecking lipid marker in follow-up
- include clear note: informational support, not a diagnosis

5. Review and Confirm Flow
- user can edit extracted values
- user can mark a component as confirmed
- only confirmed values feed later targets

### Routes
- /app/documents/[id]/extraction

### Components
- ExtractionSummaryCard
- ComponentStatusTable
- StatusBadge
- ObservationBullets
- ConfirmedValueToggle
- ExtractionEditDrawer

### Data Additions
- extracted_reports
- extracted_components
- component_reference_ranges
- user_confirmed_components

### Acceptance Criteria
- User can view extracted components in a clear grouped layout.
- Color status appears for each component.
- User can edit and confirm extracted values.
- Observation bullets are shown and are understandable.
- All read/write paths remain owner-scoped.

## 6) Sprint 2.2 - Targets and Guidance
### Goal
Use confirmed profile and lab values to generate transparent daily targets and practical guidance.

### Scope
- Add rules engine for baseline targets (calories, protein, hydration, optional micronutrient focus).
- Add explanation panel for every target with input sources.
- Add missing-data and low-confidence guardrails.
- Add target history snapshots.

### Routes
- /app/targets
- /app/targets/history

### Components
- TargetCardGrid
- TargetExplanationPanel
- DataQualityBanner
- MissingDataPrompt

### Acceptance Criteria
- Targets are computed from confirmed data only.
- Users can see why each target value was generated.
- If data is incomplete, user sees explicit fallback and next-step prompts.
- No silent assumptions are applied.

## 7) Sprint 2.3 - Nutrition Logging and Insight Snapshots
### Goal
Introduce practical daily logging and lightweight insight summaries.

### Scope
- Meal logging (structured first, optional guided free-text parsing).
- Daily adherence score against key targets.
- Trend cards for 7-day and 30-day summaries.
- Early insights only, no complex predictive analytics.

### Routes
- /app/meals
- /app/insights

### Components
- MealEntryForm
- DailyAdherenceMeter
- TrendMiniCharts
- InsightBulletList

### Acceptance Criteria
- User can log meals and view daily totals.
- Insight cards reflect recent target adherence.
- Insights are understandable and traceable to recorded data.

## 8) UX Design Notes for Your Requested Lab Results View
### Recommended Visual Pattern
- Use a two-panel layout:
  - left: grouped component list/table
  - right: summary and observations
- Keep color and shape redundant for accessibility:
  - green plus check icon
  - yellow plus warning icon
  - red plus alert icon
- Add sort/filter controls:
  - all
  - attention needed (red/yellow)
  - confirmed only

### Suggested Status Badge Text
- green: in range
- yellow: watch
- red: action needed

### Suggested Summary Block
- overall status: mostly stable or needs attention
- key focus areas: list top 2 or 3 components
- confidence and completeness indicators

## 9) Testing Strategy by Sprint
### Automated
- Unit tests for status classification rules.
- Unit tests for observation bullet generation.
- Integration tests for extraction review save and confirm flow.
- E2E smoke path:
  - upload file
  - view extraction
  - confirm values
  - view targets

### Manual
- Two-user isolation checks for all new tables.
- UX clarity pass for status colors and text labels.
- Edge case pass: missing units, malformed values, unknown components.

## 10) Risks and Mitigation
1. Extraction quality variance
- Mitigation: confidence score, manual correction, confirmed-only downstream usage.

2. Over-interpretation risk
- Mitigation: informational wording, no diagnosis language, explicit uncertainty notes.

3. Scope creep into advanced AI
- Mitigation: enforce sprint boundaries and acceptance gates.

## 11) Phase 2 Exit Criteria
- Extraction results screen is usable, clear, and trusted by users.
- Confirmed data pipeline feeds target generation reliably.
- Meal logging and snapshot insights work end-to-end.
- Security and RLS checks pass for all new Phase 2 tables.
- Product owner approves Phase 2 demo flow.

## 12) Immediate Next Steps
1. Approve this sprint sequence and scope boundaries.
2. Use implementation ticket board: docs/planning/phase-2-implementation-tickets.md.
3. Apply Phase 2 migration draft in Supabase: db/migrations/002_phase2_extraction_schema.sql.
4. Start Sprint 2.0 implementation tasks.
5. Prepare UI wireframe for extraction review screen before coding Sprint 2.1 UI.
