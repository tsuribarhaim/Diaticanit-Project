# Phase 1 Day 6 Hardening and QA

## Purpose
Complete Day 6 goals:
- security test for cross-user isolation
- end-to-end smoke test from sign-up to upload
- operational logging for auth/storage/db failures

## Hardening Implemented
- Added structured server-side error logging utility in apps/web/src/lib/server-log.ts.
- Added logging around auth failures in sign-in/sign-up/sign-out flows.
- Added logging around middleware auth refresh failures.
- Added logging around onboarding/profile DB failures.
- Added logging around document storage upload failure, metadata insert failure, rollback failure, and delete failure paths.

## Smoke Test Script (UI)
1. Create User A account.
2. Sign in as User A.
3. Complete onboarding profile.
4. Verify /app profile summary renders.
5. Edit profile and save.
6. Upload one supported file under 10 MB in /app/documents.
7. Delete that file.
8. Sign out.

Expected:
- No uncaught app errors.
- Validation messages are shown for invalid inputs.
- Document list updates after upload and delete.

## Cross-User Isolation Script
1. Create User B account and sign in.
2. Verify User B does not see User A profile data in app pages.
3. Verify User B does not see User A files in /app/documents.
4. Run SQL checks in tests/phase1/day6-security-rls-checks.sql using per-user sessions.

Expected:
- Each user can access only their own user_profile and user_documents rows.
- Negative update/delete checks against another user rows affect 0 rows.

## Runtime Checks
- Command: npm run lint
- Command: npm run build

## Notes
- Next.js 16 prints a deprecation warning: middleware convention is moving to proxy.
- This is non-blocking for current sprint behavior.
