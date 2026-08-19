# Personal Health Companion - Phase 1 Partner Brief

## 1) Executive Summary
This document consolidates all current planning decisions for Phase 1 of the Personal Health Companion project.

Phase 1 is intentionally limited to building the secure product skeleton:
- authentication
- onboarding profile capture
- profile view and edit
- private file upload and file registry

AI features are explicitly deferred to later phases.

## 2) Phase 1 Goal
Deliver a secure, production-ready baseline where a user can:
1. register and sign in
2. complete onboarding profile
3. update profile details
4. upload and manage personal files
5. access only their own data

## 3) Scope Decision (What We Build Now)
### In Scope
1. Next.js web app skeleton (mobile-first)
2. Supabase backend and authentication
3. Database tables required for profile and documents only
4. RLS and storage access policies per user
5. Core screens and forms for onboarding/profile/upload
6. Validation, error handling, and baseline UX states
7. Phase 1 testing and demo readiness

### Out of Scope (Deferred)
1. AI extraction from free text/files
2. Dynamic targets engine (BMR/TDEE and medical logic)
3. Free-text meal parsing and meal analytics
4. Proactive recommendation engine
5. Wearables and IoT integrations

## 4) Architecture and Stack (Phase 1)
1. Frontend: Next.js (React), mobile-first
2. Hosting: Vercel
3. Backend/Data/Auth: Supabase (PostgreSQL + Supabase Auth + Storage)
4. Security: Row Level Security (RLS) and per-user storage policies

## 5) Required Data Artifacts
### Table A: user_profile (Required)
Purpose: store onboarding and profile data.

### Table B: user_documents (Required)
Purpose: store uploaded file metadata and ownership.

### Optional in Phase 1
user_lab_results only if manual lab-value entry is needed immediately.

### Not created in Phase 1
targets_daily and meal_entries are intentionally deferred.

## 6) Security Model (Mandatory)
1. RLS enabled on all Phase 1 tables
2. CRUD policies restricted to auth.uid() = user_id
3. Private storage bucket with per-user path and policy checks
4. No cross-user reads or writes

## 7) Product Surfaces (Pages)
### Public
1. Landing page
2. Sign in
3. Sign up

### Protected
1. App home (profile summary)
2. Onboarding profile form
3. Profile details
4. Profile edit
5. Documents upload and list

## 8) Core Flows
### Onboarding Flow
Sign up -> sign in -> onboarding form -> save profile -> app home

### Document Flow
Upload file -> save metadata -> list files -> delete file and metadata

## 9) Phase 1 Acceptance Criteria
1. User can sign up/sign in/sign out
2. User can create and edit profile
3. User can upload/list/delete own files
4. Data persists correctly by user_id
5. User A cannot access User B data/files
6. Protected routes block unauthenticated access

## 10) Delivery Plan (1 Week)
1. Day 1: DB schema, RLS, storage bucket/policies
2. Day 2: Auth and protected routing
3. Day 3: Onboarding profile create/read
4. Day 4: Profile home and edit
5. Day 5: Upload and metadata management
6. Day 6: QA hardening and security tests
7. Day 7: Demo and release candidate

## 11) Risks and Mitigation
1. Auth provider delays -> start with email/password first
2. Storage policy errors -> run two-user isolation tests early
3. Scope creep into AI -> enforce explicit out-of-scope list

## 12) Current Status
Phase 1 implementation is complete and currently in final acceptance and demo stage.

Status notes:
- Node.js and npm are installed and app build/lint pass.
- Remaining work is execution of final acceptance checklist and product owner sign-off.

## 13) Artifacts Produced So Far
1. Phase 1 scope definition: [docs/requirements/phase-1-scope.md](docs/requirements/phase-1-scope.md)
2. Sprint board: [docs/planning/phase-1-week1-sprint-board.md](docs/planning/phase-1-week1-sprint-board.md)
3. SQL migration (Phase 1 only): [db/migrations/001_phase1_schema_rls.sql](db/migrations/001_phase1_schema_rls.sql)
4. Acceptance checklist: [docs/planning/phase-1-acceptance-checklist.md](docs/planning/phase-1-acceptance-checklist.md)
5. Route/action map: [docs/planning/phase-1-route-map.md](docs/planning/phase-1-route-map.md)
6. Web bootstrap notes: [apps/web/README.md](apps/web/README.md)
7. Day 6 hardening and QA runbook: [docs/planning/phase-1-day6-hardening-qa.md](docs/planning/phase-1-day6-hardening-qa.md)
8. Day 7 demo script: [docs/planning/phase-1-demo-script.md](docs/planning/phase-1-demo-script.md)
9. Day 7 release handover: [docs/planning/phase-1-release-handover.md](docs/planning/phase-1-release-handover.md)

## 14) Recommended Next Step
Run final acceptance and demo:
1. execute the acceptance checklist in staging
2. run cross-user security verification with two accounts
3. execute the demo script for product owner review
4. record sign-off decision and proceed to Phase 2 planning
