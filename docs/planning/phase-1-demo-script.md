# Phase 1 Demo Script

## Goal
Demonstrate all in-scope Phase 1 capabilities end-to-end in under 10 minutes.

## Preconditions
- Supabase project is configured.
- Migration from db/migrations/001_phase1_schema_rls.sql is applied.
- Environment variables are set in apps/web/.env.local.
- App is running from apps/web via npm run dev.

## Demo Accounts
- User A: primary demo account.
- User B: isolation proof account.

## Live Demo Flow
1. Open landing page /.
2. Create User A account via /auth/sign-up.
3. Sign in as User A via /auth/sign-in.
4. Show automatic redirect to /app/onboarding for first-time user.
5. Complete onboarding form and save.
6. Show redirect to /app with profile summary.
7. Navigate to /app/profile and verify details.
8. Navigate to /app/profile/edit and update at least 2 fields.
9. Save and show success feedback.
10. Return to /app/profile and confirm updated values are persisted.
11. Navigate to /app/documents.
12. Upload one valid file (PDF/PNG/JPG/WEBP/TXT under 10 MB).
13. Confirm file appears in list with category, size, and timestamp.
14. Delete the file and confirm it is removed from the list.
15. Sign out and show protected route guard by opening /app (redirect to /auth/sign-in).
16. Sign in as User B and show User B does not see User A data/files.

## Security Proof Points During Demo
- Route protection: /app/* redirects when unauthenticated.
- User-bound profile and document operations enforce auth user_id.
- RLS and storage policies prevent cross-user data access.

## Demo Talking Points
- Scope discipline: only Phase 1 skeleton, no AI features yet.
- Reliability: lint/build pass and server-side validation on critical forms.
- Hardening: failure-path structured logging for auth/storage/db actions.

## Known Limitations (Expected)
- Middleware naming is deprecated in Next.js 16 and should be migrated to proxy in a future maintenance task.
- No automated E2E test suite yet; current QA is documented and manual.
- Optional Google sign-in is deferred; email/password is implemented.
