# Phase 1 Release Candidate Handover

## Release Status
Phase 1 implementation is complete for planned in-scope features and ready for acceptance testing.

## Included Scope
- Authentication: sign-up, sign-in, sign-out.
- Protected route access for /app/*.
- Onboarding profile create/read flow.
- Profile details and profile edit/update flow.
- Private document upload/list/delete flow.
- RLS-backed user isolation and owner-scoped storage paths.
- Day 6 hardening logs and QA/security runbooks.

## Out of Scope (Deferred)
- AI extraction and insights.
- Targets engine and analytics.
- Meal parsing features.
- Wearable/device integrations.

## Technical Validation Snapshot
- Command: npm run lint (pass)
- Command: npm run build (pass)
- Protected pages are dynamic server-rendered to avoid static prerender auth/env issues.

## Environment Requirements
- Node.js 20+ and npm.
- Supabase project with auth enabled.
- Applied SQL migration: db/migrations/001_phase1_schema_rls.sql.
- Required env vars in apps/web/.env.local:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY

## Acceptance Run Inputs
- Main checklist: docs/planning/phase-1-acceptance-checklist.md.
- Sprint implementation detail: docs/planning/phase-1-implementation-log.md.
- Day 6 hardening + QA runbook: docs/planning/phase-1-day6-hardening-qa.md.
- Cross-user RLS SQL checks: tests/phase1/day6-security-rls-checks.sql.
- Demo walkthrough: docs/planning/phase-1-demo-script.md.

## Operational Notes
- Structured server-side error logs are emitted as JSON for auth/profile/document and middleware failure paths.
- If a document metadata insert fails after storage upload, storage rollback is attempted and rollback failures are logged.

## Exit Decision Gate
Release candidate is accepted when:
1. All checklist items in docs/planning/phase-1-acceptance-checklist.md pass.
2. No high-severity security issues remain from two-user isolation checks.
3. Product owner approves the live demo flow.

## Immediate Post-Acceptance Follow-ups
1. Migrate middleware naming to proxy (Next.js maintenance).
2. Add automated E2E smoke tests for signup->onboarding->upload.
3. Begin Phase 2 planning for deferred AI features.
