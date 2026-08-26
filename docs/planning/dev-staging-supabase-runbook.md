# Dev/Staging Split Runbook (1.0 vs 1.1)

## Goals
- Keep testers on stable 1.0 code and staging DB.
- Continue development on 1.1 code and dev DB.
- Apply schema changes through migration files, not manual dashboard SQL.

## Code Layout On This Laptop
- 1.1 development workspace: Project
- 1.0 staging workspace: Project-staging-1.0

## Ports
- Staging 1.0 server: 3000
- Dev 1.1 server: 3001

## One-Time Supabase Setup (Dashboard)
1. Create two Supabase projects (if not already split): one for dev, one for staging.
2. In each project, set Auth URLs:
   - Site URL
   - Redirect URLs
3. Keep separate API keys/secrets per environment.
4. Do not share service role keys with testers.

## One-Time Local Setup
1. Install Supabase CLI and login:
   - supabase login
2. Set local user environment variables using scripts/supabase-env-example.ps1.
3. Create environment files in each workspace:
   - Project/apps/web/.env.local -> dev Supabase values
   - Project-staging-1.0/apps/web/.env.local -> staging Supabase values

## Daily Start Commands
### Start staging for testers (1.0)
From Project root:
- .\run-staging-1.0.ps1

### Start development (1.1)
From Project root:
- .\run-dev-1.1.ps1

## Migration Workflow
1. Add a new timestamped SQL file directly under supabase/migrations (e.g. `supabase migration new <name>`), so the Supabase CLI can track it. This folder is the only location the CLI reads for `db push` / `migration list` / `migration repair`.
2. Also add a matching, human-readable copy in db/migrations (same SQL, legacy phase-numbered naming) purely for project history/readability. db/migrations is NOT read by the CLI.
3. Test migration in dev first:
   - .\scripts\supabase-db-push.ps1 -Environment dev
4. Validate app behavior in dev.
5. Promote same migration to staging:
   - .\scripts\supabase-db-push.ps1 -Environment staging

## Rules
- No manual schema edits in Supabase dashboard for normal changes.
- If emergency manual SQL is run in staging, create a matching migration file in supabase/migrations immediately and run `supabase migration repair <version> --status applied --linked` so history stays accurate.
- Promote changes in order: dev first, then staging.
- 2026-08-25: discovered supabase/migrations never existed (only db/migrations, which the CLI ignores), so `db push` had been a silent no-op in both dev and staging since inception. Backfilled supabase/migrations with timestamped copies of migrations 001-018 and ran `supabase migration repair --status applied` against both dev and staging after verifying (via `supabase db query --linked` against information_schema) that all 18 migrations' schema changes were already live in both databases. `db push` is now functional going forward.

## Versioning
- Tag stable tester release as v1.0.0.
- Continue feature work on 1.1 from main.
