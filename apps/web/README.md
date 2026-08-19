Personal Health Companion web app (Next.js + Supabase).

## Local setup

1) Install dependencies:

```bash
npm install
```

2) Create .env.local with:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- AI_EXTRACTION_ENABLED=true (optional; required only for AI-assisted extraction)
- AI_EXTRACTION_PROVIDER=github (github | openai | custom)
- AI_EXTRACTION_API_KEY (optional; required only for AI-assisted extraction)
- AI_EXTRACTION_MODEL (example for GitHub Models: openai/gpt-4.1-mini)
- AI_EXTRACTION_BASE_URL (optional)

Provider defaults:

- github: base URL defaults to https://models.inference.ai.azure.com
- openai: base URL defaults to https://api.openai.com/v1
- custom: set AI_EXTRACTION_BASE_URL explicitly

3) Apply SQL migrations in order from db/migrations, including:

- 001_phase1_schema_rls.sql
- 002_phase2_extraction_schema.sql
- 003_phase2_ai_extraction_consent.sql
- 004_phase3_goals.sql
- 005_phase3_goals_analysis_columns.sql
- 006_phase4_daily_reports.sql
- 007_phase4_default_items.sql
- 008_phase4_default_items_cleanup.sql
- 009_phase4_daily_reports_parse_mode.sql
- 010_phase4_profile_preferred_language.sql

4) Start the app:

```bash
npm run dev
```

Open http://localhost:3000.

## AI extraction consent flow

When AI extraction is enabled and configured, users must acknowledge provider usage on the extraction review page before AI calls are used. If acknowledgement is missing or AI is unavailable, extraction automatically falls back to the deterministic parser.

## Validation

```bash
npm run lint
```
