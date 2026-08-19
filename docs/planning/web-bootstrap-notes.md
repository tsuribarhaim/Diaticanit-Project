# Web App Bootstrap Notes (Phase 1)

Node.js is required to scaffold and run the Next.js app.

## Prerequisites
- Node.js 20 LTS or newer
- npm 10+ (or pnpm)

## Scaffold Commands (run from Project root)

PowerShell:

npm create next-app@latest apps/web -- --typescript --eslint --app --src-dir --tailwind --use-npm --import-alias "@/*"

## Core Packages to Add
- @supabase/supabase-js
- @supabase/ssr
- zod
- react-hook-form

## Suggested Folder Layout
- apps/web/src/app/(public)
- apps/web/src/app/(auth)
- apps/web/src/app/(protected)
- apps/web/src/components
- apps/web/src/lib
- apps/web/src/actions

## Environment Variables
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY (server only)

## First Build Targets
1. Auth pages and middleware route protection.
2. Onboarding profile create + edit flow.
3. Documents upload/list/delete flow.
