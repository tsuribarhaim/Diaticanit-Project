# Auto Ticket Handling bridge

See `docs/design/auto-ticket-handling.md` for the full design. This is the
local service n8n calls on its daily schedule - it pulls whatever tickets
an admin has opted in (`auto_handle = 'Y'`), investigates each one with
Claude Code running headlessly (read-only tools only, no file edits, a
fresh disposable git worktree per ticket), and reports the result back to
Daffy.

## Running it

```
cd automation/n8n/bridge
node server.js
```

Run `npm install` once in this folder: the server itself uses only Node (18+)
built-ins, but `tools/shot.js` (screenshots) needs `playwright-core`, and
points at the Chromium that Playwright already downloaded
(`CHROMIUM_PATH` in the env file; defaults to the local ms-playwright copy).
Config lives in `.env.local` (git-ignored, not in this repo's history). Leave
it running in a terminal/background process, or let the Windows task
(`../run-auto-ticket-handling.ps1`) start it - n8n calls
`http://host.docker.internal:7891` on its own schedule, so the bridge needs to
already be up when that fires.

Endpoints (all `POST`, header `x-bridge-secret`):

- `/run` - the night run: every ticket flagged `Y` (Phase 1 read-only check, Phase 2 fix on a local branch).
- `/analyze` - the analyst: every ticket flagged `S` becomes a proposal for the admin to approve.
- `/merge` with `{"ticketSeq": N}` - merge branch `auto-fix/tck-N` into `main` of the dev repo
  (never pushed; a failed merge is aborted). Called by the poller when the admin clicks "Merge to dev".

`/run` and `/analyze` each refuse to overlap with themselves (they answer `{"skipped": true}`).

`node tools/shot.js app/profile out.jpg [--mobile] [--full] [--locale he]` takes a screenshot of a page
on the dev server on `DEV_SERVER_PORT`, signed in as the Auto-Fix Bot. Write the page WITHOUT a leading
slash - Git Bash rewrites `/app/...` into a Windows path.

`.env.local.devtest` is a second config pointed at `localhost:3000` instead
of production, for safely testing changes against the dev environment:
`node server.js .env.local.devtest`.

## Current status (2026-10-04)

- Bridge logic fully tested end-to-end against both dev and production
  (real ticket investigation, structured output, DB write-back, worktree
  cleanup, and the retry-safe failure path all verified working).
- The n8n workflow ("Daffy - Auto Ticket Handling") is built correctly -
  verified via direct API inspection of its nodes/connections - but its
  schedule trigger would not reliably register when activated through
  n8n's API alone (logs showed "Deregistered crons" but never "Registered
  crons" across several attempts, even after a full container restart).
  **Needs a manual step**: open n8n (http://localhost:5678), open "Daffy -
  Auto Ticket Handling", and toggle Active off then on from the UI itself -
  that uses n8n's own activation code path rather than the API one, which
  is the one piece this session couldn't get to stick.
- Scheduled for daily 09:00 local time once properly activated.
