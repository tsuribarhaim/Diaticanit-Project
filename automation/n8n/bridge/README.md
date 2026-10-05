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

No `npm install` needed - plain Node (18+) built-ins only. Config lives in
`.env.local` (git-ignored, not in this repo's history). Leave it running
in a terminal/background process - n8n calls `http://host.docker.internal:7891/run`
on its own schedule, so the bridge needs to already be up when that fires.

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
