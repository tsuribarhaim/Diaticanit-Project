# Phase 1 Sprint Board (1 Week)

## Scope Lock
Build only these capabilities:
- auth and protected access
- onboarding profile create/update
- user home page (profile summary)
- user file upload and listing
- strict row and file isolation by user_id

Do not build AI extraction, targets, meal parsing, analytics, or wearable integration.

## Team Assumption
- 1 full-stack developer
- Product owner available for quick decisions

## Day-by-Day Plan

## Day 1 (Foundation)
- Confirm Phase 1 scope and acceptance tests.
- Create Supabase project.
- Create tables: user_profile, user_documents.
- Enable RLS and add policies.
- Create private storage bucket user-documents.
- Configure project secrets mapping document.

Deliverable:
- DB schema and policies applied in dev environment.

## Day 2 (Auth + Routing)
- Integrate Supabase auth (email/password, optional Google).
- Implement auth pages (sign up, sign in, sign out).
- Add protected route guard for app pages.
- Add base app shell and mobile-first layout.

Deliverable:
- User can authenticate and reach protected app area.

## Day 3 (Onboarding Profile)
- Build onboarding form page.
- Add client and server validation.
- Implement create profile flow.
- Implement fetch profile flow for existing users.

Deliverable:
- New user can submit profile and data is stored under own user_id.

## Day 4 (Profile Home + Edit)
- Build profile landing page.
- Build profile edit page.
- Add optimistic and non-optimistic update states.
- Add error/success feedback and empty states.

Deliverable:
- User can view and update profile reliably.

## Day 5 (Upload + File Registry)
- Build upload UI and file list UI.
- Upload files to private bucket.
- Save metadata in user_documents.
- Implement delete file and metadata delete.
- Validate mime type and file size.

Deliverable:
- User can upload, list, and remove own files.

## Day 6 (Hardening + QA)
- Security test for cross-user isolation.
- End-to-end smoke test from signup to upload.
- Add logging around auth/storage/db failures.
- Fix defects found in QA pass.

Deliverable:
- Phase 1 stable candidate.

## Day 7 (Demo + Buffer)
- Final acceptance run with script.
- Prepare demo flow and known limitations.
- Document setup and handover notes.

Deliverable:
- Accepted Phase 1 release candidate.

## Priority Backlog (Ordered)
1. Database migration (tables + RLS + storage policies)
2. Authentication and protected routes
3. Onboarding create profile
4. Profile landing and edit
5. Upload and file metadata
6. Validation and error handling
7. Security and acceptance tests

## Risks and Mitigations
- Risk: delayed auth provider setup.
- Mitigation: start with email/password, add Google after baseline.

- Risk: storage policy misconfiguration.
- Mitigation: early isolation tests with two test users.

- Risk: over-scoping into AI features.
- Mitigation: strict feature flag and explicit out-of-scope list.
