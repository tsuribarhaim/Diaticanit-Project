# Phase 4 Preview Deployment Runbook

This runbook sets up a shareable Preview and Production deployment for the web app so teammates can test without your local machine.

## Scope
- Host: Vercel
- App root: apps/web
- Backend/Auth/DB: Supabase
- Goal: Reliable URL for coworker testing with working auth callbacks

## Prerequisites
- GitHub repository with current project code
- Access to Vercel account/team
- Access to Supabase project (Auth and SQL editor)
- Project builds and lints locally

## 1. Preflight (Local)
Run from project root to confirm the app is healthy before deploying.

```powershell
Set-Location "c:\Private\AI Projects\Personal Health Companion\Project\apps\web"
npm install
npm run lint
npm run build
```

Expected outcome:
- Lint passes
- Build succeeds

If either fails, fix before continuing.

## 2. Connect Repository to Vercel
1. Push the latest branch to GitHub.
2. In Vercel, click Add New Project.
3. Import the repository.
4. Set Root Directory to apps/web.
5. Keep Framework Preset as Next.js.
6. Keep install/build defaults unless your team uses custom commands.

Recommended project settings:
- Install Command: npm install
- Build Command: npm run build
- Output Directory: .next (default)

## 3. Configure Environment Variables in Vercel
Add variables for both Preview and Production environments.

Required:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Optional AI extraction variables (only if using AI extraction features):
- AI_EXTRACTION_ENABLED
- AI_EXTRACTION_PROVIDER
- AI_EXTRACTION_API_KEY
- AI_EXTRACTION_MODEL
- AI_EXTRACTION_BASE_URL

Notes:
- Do not put service role keys into client-exposed NEXT_PUBLIC_* variables.
- After changing env vars, redeploy.

## 4. Configure Supabase Auth Redirects
In Supabase Auth settings:
1. Set Site URL to production app URL (when production domain is ready).
2. Add Allowed Redirect URLs for:
- Local dev URL (optional but useful): http://localhost:3000
- Vercel Preview URLs (team pattern or explicit URLs)
- Production URL

Why this matters:
- If callback URLs are not allowlisted, sign-in/sign-up flows fail after redirect.

## 5. Apply Database Migrations
Run migrations in order on the Supabase project used by Vercel.

1. db/migrations/001_phase1_schema_rls.sql
2. db/migrations/002_phase2_extraction_schema.sql
3. db/migrations/003_phase2_ai_extraction_consent.sql
4. db/migrations/004_phase3_goals.sql
5. db/migrations/005_phase3_goals_analysis_columns.sql
6. db/migrations/006_phase4_daily_reports.sql
7. db/migrations/007_phase4_default_items.sql
8. db/migrations/008_phase4_default_items_cleanup.sql
9. db/migrations/009_phase4_daily_reports_parse_mode.sql
10. db/migrations/010_phase4_profile_preferred_language.sql

Recommended process:
- Use Supabase SQL Editor or migration tooling.
- Verify each migration completes before running the next.
- Keep execution logs for rollback/troubleshooting history.

## 6. First Preview Deployment Verification
Use a new Preview deployment URL and run this checklist:

1. Landing page loads.
2. Sign-up and sign-in both complete successfully.
3. Protected routes redirect correctly based on auth state.
4. Onboarding/profile flow works.
5. Documents page loads and basic actions work.
6. Daily report page loads.
7. Defaults management page allows add/edit/delete.

If all pass, share Preview URL with coworker for testing.

## 7. Coworker Access Procedure
For each test cycle:
1. Deploy branch/PR to generate preview URL.
2. Send URL and scope of what to test.
3. Include known limits (for example, optional AI features disabled in preview).
4. Ask coworker to test auth first, then feature flow.

Template message:

```text
Preview build is ready:
<preview-url>

Please test:
1) Sign-in/sign-up
2) Daily report create + defaults selection
3) Documents upload/list

Known constraints:
- AI extraction is currently disabled in preview.
```

## 8. Promote to Production
When preview checks pass:
1. Merge to main (or release branch per team process).
2. Confirm production deployment completes.
3. Re-run smoke checks on production URL.
4. Confirm Supabase Site URL and redirects still match production domain.

## 9. Troubleshooting
Auth redirects fail:
- Check Supabase Allowed Redirect URLs include exact callback origin.
- Confirm Vercel env vars are present in the same deployment environment.

Build fails in Vercel but local works:
- Confirm Root Directory is apps/web.
- Confirm lockfile and Node version compatibility.
- Recheck required env vars exist in Preview/Production scopes.

Feature pages load but operations fail:
- Confirm all migrations were applied in order to the same Supabase project.
- Verify RLS policies were created successfully.

## 10. Day-1 Done Criteria
Deployment setup is complete when all are true:
- Preview URL is accessible to teammates
- Auth flow works on preview URL
- Daily report + defaults flow works end-to-end
- Production deployment path is confirmed
- Runbook is saved and shared with team
