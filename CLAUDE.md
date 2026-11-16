# Daffy (Personal Health Companion) - project rules for Claude

Daffy ("דפי" in Hebrew, feminine grammar) is a bilingual (English/Hebrew) personal health app: a Next.js web app in `apps/web` (see `apps/web/CLAUDE.md`), Supabase for the database (`supabase/`), and n8n plus a local "bridge" server (`automation/n8n/`) that run the ticket-automation agents.

These are the standing rules the previous owner agreed with Claude. Follow them unless the current owner changes them.

## Branches and environments
- `main` = dev (dev Supabase project). `release/1.0` = production (the staging worktree `../Project-staging-1.0`, the production Supabase project, and the Vercel pilot `daffy-pilot`).
- **Dev only by default.** Never merge into `release/1.0`, deploy, push migrations to production or redeploy Vercel without an explicit go-ahead for that specific change. A general "go ahead and run commands" does not count, and neither does an earlier one-time approval or an urgent live bug. Say a fix is ready and let the owner decide when to ship it.
- **Ticket fixes are built on production.** Branch a ticket fix from `release/1.0`, commit it with a `Built-on-production: <sha>` trailer, merge it into `main` for dev testing, and ship it by cherry-pick. Before deploying, check that production hasn't changed since the fix was built, and rebuild the fix if it has. Bigger feature work can stay on `main`. The bridge builds on `PRODUCTION_REF` (default `release/1.0`), and `promote.js` refuses fixes built on an older production commit.
- **Don't change things while the agents are busy.** Before any commit to main, merge, release, deploy or production migration, check the bridge: `POST http://localhost:7891/health` with header `x-bridge-secret: $BRIDGE_LOCAL_SECRET` (from `automation/n8n/bridge/.env.local`). If `runInProgress`, `analysisInProgress`, `promoteInProgress` or `triageInProgress` is true, or approved fixes are waiting to be promoted, stop and tell the owner. Read-only work is fine, and so is preparing a change in a separate worktree based on `release/1.0`.

## Automation agents
- An ordinary night-run ticket may **not** include a database migration. A ticket the admin approved into a **daily batch** may include an *add-only* migration (the same `nonAdditive()` check that `promote.js` uses). It is applied to the dev DB first and reaches production only through Promote.
- Daily batch design (`docs/design/`): triage at 16:00 Israel time picks up to 8 small tickets → the admin approves them → the analyst runs → the night run builds the fixes → a "ready to promote" email → the admin presses Promote → the tickets are resolved. All agents (analyst, night run, triage, promote) share **one lock**. A scheduled run that finds the lock taken waits, then runs only what is still queued and records why it waited.
- On Windows the agents run as Scheduled Tasks ("Daffy Auto Ticket Handling" and "Daffy Spec Analyst", via `automation/n8n/run-auto-ticket-handling.ps1`). Run them on only one machine at a time.

## Product and UI rules
- **Mockup first.** For a new page or a significant UI flow, first build an interactive HTML mockup that matches the app's look, iterate on it with the owner, and write real code only after a clear go-ahead.
- **Localize everything.** Every user-facing string needs English and Hebrew: use `tr(locale, en, he)` from `@/lib/locale`, with the locale from `user_profile.preferred_language` via `normalizeLocale`. Server-action errors and notices count too. For text a model generates, pass the locale in and tell the model in the prompt to write in that language. A feature isn't finished until it is translated.
- **AI chats use the user's data.** Every chat feature (Targets, Daily Report, unified chat) gets the user's profile, active targets and today's logged data, and answers from them instead of asking the user to repeat what the app already knows.
- **A clarifying question must never be a dead end.** If the assistant asks for a missing detail, the same reply also says the user can continue now with a reasonable default.
- **Check input before routing it.** The chat classifier returns `understood: boolean`. Gibberish gets a short "please rephrase" answer and never triggers a domain action. Every classification entry point needs a "none of these" way out.

## Testing
- Live-test against **dev only**, signed in with the dev admin test account (ask the owner for the login; it is not stored in the repo).
- Secrets live in `.env.local` files (`apps/web`, `automation/n8n`, `automation/n8n/bridge`). Git ignores them and they must never be committed. The `.env.local.example` files show which keys each one needs.
