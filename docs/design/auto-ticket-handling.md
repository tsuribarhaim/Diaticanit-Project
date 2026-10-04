# Auto Ticket Handling via n8n

Status: design agreed (2026-10-04). DB/Daffy-side implementation in progress;
the n8n workflow and the local "bridge" that invokes Claude Code headlessly
are deliberately **not built yet** - Tsuri reviews the DB/app changes first
and gives the go-ahead before either of those exist.

Builds on `docs/planning/n8n-automation-backlog.md`'s Phase A (daily digest,
already live as of v1.1.42) - this is a separate, second n8n workflow, not a
continuation of that one.

## The ask

Tsuri wants urgent-priority, open tickets to get a first automated pass
before he ever looks at them: n8n wakes something up once a day, it reads
the ticket, investigates the actual code, and either hands back a plan (for
now) or - once Phase 2 exists - an actual tested fix, entirely unattended.
Nothing about this design is allowed to touch production on its own; the
automation's job ends at "ready for your review," and every commit/promote
still happens through Tsuri explicitly asking for it, exactly like every
other change this whole project has gone through.

## Why an admin opt-in flag, not just "any urgent+open ticket"

The first version of this design picked up every `open`/`urgent` ticket
automatically. Tsuri changed it deliberately: a new admin-only column,
`auto_handle`, must be set to `'Y'` by a human (him or Orit) before a ticket
is eligible at all - on any ticket, not only urgent ones, at the admin's own
discretion. This turns "the robot might touch this" from an ambient property
of a priority label into an explicit, reviewable decision per ticket.

## Why n8n stays the scheduler, not Claude's own cron

Claude Code has a native scheduler, but those jobs are session-only (gone
when the session ends) and auto-expire after 7 days even recurring - not
durable enough for a standing daily automation. n8n, running persistently in
Docker Desktop, is the only piece here that can reliably still be alive
tomorrow. (Same "only fires while the laptop/Docker is running" caveat the
backlog doc already noted for Phase A applies here too - this is still local
prototyping, not a hosted, always-on scheduler.)

## Why n8n's own AI Agent node isn't used for the analysis step

n8n's AI Agent node is a real LLM agent loop, but out of the box it has no
access to the actual repository - no file read, no grep, no git. Giving it
that would mean rebuilding Claude Code's own tool belt as custom n8n tools,
with less polish. Instead, the actual investigation happens in real Claude
Code, launched headlessly by a small local bridge service (not yet built) in
a fresh, isolated git worktree per ticket - n8n's role stays "trigger on
schedule, call the bridge, send the resulting email."

## The `auto_handle` state machine

Stored as nullable text (`'Y' | 'P' | 'D'`, or `NULL` for "not opted in" -
collapsing Tsuri's own "N or NULL, same meaning" into just `NULL`, so there's
never two different ways to represent the same off state):

- **`NULL`** (default) - not eligible for automation at all.
- **`'Y'`** - an admin has opted this ticket in; eligible for the next daily
  pickup.
- **`'P'`** - Claude has looked at it (Phase 1: produced a plan, or decided
  it genuinely needs a human's judgment) - no code touched yet. Ticket
  `status` also moves to `in_progress` at this point (an existing status,
  not a new one - it already means "someone/something is actively on this").
- **`'D'`** - Phase 2 (not built yet): Claude actually implemented and
  tested the fix on dev. Automation's work is done here - `auto_handle`
  stops advancing. Ticket `status` moves to the new `'fixed'` value (see
  below), **not** `'resolved'` - matching this whole project's standing
  rule of never marking a ticket resolved without live verification.
  `'resolved'` still only happens after Tsuri reviews/tests the fix in dev
  and it's actually promoted and confirmed live in production, same manual
  process as every other ticket.

A genuine processing failure (bridge crash, API timeout - not a real "needs
judgment" classification) leaves `auto_handle` at `'Y'` rather than
advancing it, so the ticket is automatically retried on the next attempt
rather than silently falling out of the queue.

## The new `status = 'fixed'`

Sits between `in_progress` and `resolved` in the existing status enum.
Means: Claude has implemented and tested a fix on dev; it's waiting for
Tsuri to test it himself and decide whether to promote. Only reachable via
the admin-update RLS path (same as every other status transition an admin
can already make freely) - no self-service user transition into or out of
it.

## Daily flow (once Phase 2 exists)

```
n8n (daily, 9am local)
  │
  ▼
HTTP Request → local bridge service (not yet built)
  │
  ▼
Bridge calls GET /api/admin/tickets/auto-handle-queue (new, secret-
protected) → tickets where status in (open, reopened) AND auto_handle = 'Y'
  │
  ▼
For each ticket, bridge launches Claude Code headlessly in a fresh,
isolated git worktree. Claude investigates the real code and either:
  (a) writes a plan + fix description, classifying it as a safe pure
      code fix, OR
  (b) decides it needs Tsuri's judgment (functionality/UX decision,
      or genuinely unclear) and says so, OR
  (c) [Phase 2 only] actually implements + tests the fix (tsc/eslint/
      build - the only automated checks trusted unattended; anything
      needing live interactive verification is explicitly left for
      Tsuri to "compliment" by testing himself, not claimed as done)
  │
  ▼
Bridge calls POST /api/admin/tickets/auto-handle-result (new, secret-
protected) per ticket: writes the plan/notes into a NEW dedicated field
(auto_handle_notes - deliberately not technical_response, which already
holds manually-written audit notes from elsewhere and shouldn't get
silently overwritten by automation output), advances auto_handle, and
moves status to in_progress (Phase 1) or fixed (Phase 2)
  │
  ▼
Once every ticket in the run is done, n8n sends ONE email - a summary
table: ticket #, one-line description of what was done or why it's
pending, and its new auto_handle value. Not one email per ticket.
  │
  ▼
On a genuine failure (not a classification outcome), n8n retries at
10am, 11am, and 12pm (3 retries, hour-spaced - needs explicit Wait
nodes in n8n, since its built-in per-node retry is seconds-scale, not
hour-scale). If still failing after the last retry, one alert email to
the admins listing exactly which ticket IDs never got processed.
```

## How Tsuri picks a ticket back up

Deliberately **not** session-resume (`claude --resume <id>`) - that would
mean tracking which ephemeral worktree/session belongs to which ticket, and
hoping nothing's been cleaned up since. Instead, the plan/notes live in the
ticket record itself (`auto_handle_notes`). Picking it back up is just:
Tsuri reads the summary email, opens Claude Code - this session, a new one,
doesn't matter - and says "handle ticket #123." Whoever's on the other end
reads the ticket's stored notes and continues from there. Nothing about
"logging back in" is special; it works identically whether it's been an
hour or a month, and survives a laptop restart.

## Security

The bridge never holds a raw Supabase service-role key. It only knows one
shared secret (a new `N8N_TICKET_AUTOMATION_SECRET`, separate from the
daily-digest's own `N8N_DIGEST_SECRET` - scoped blast radius if one ever
leaks), which the two new API routes check before doing anything. The
routes themselves use the app's own already-configured service-role access
server-side, same pattern as `/api/admin/daily-digest`. `auto_handle` itself
needs no new RLS policy - the existing `tickets_update_admin` policy (any
column, admin only) already covers it, and no self-service policy grants a
plain user general field access, so it's already as protected as
`technical_response`/`fix_description`/every other admin-only field on this
table.

## What's explicitly deferred

- The local bridge service itself (the thing that actually shells out to
  `claude -p`).
- The n8n workflow (trigger, HTTP nodes, retry/wait nodes, email node).
- Phase 2 (actual code implementation + testing) - Phase 1 ships first as
  plan-only, to build trust in the classification quality before letting it
  touch real files.
- The admin-only toggle UI control's exact placement/interaction beyond
  "a dropdown near the existing status control" (being built now).

## Open items for Phase 2, not yet decided

- Exact automated test boundary once real code changes are involved (static
  checks are a given; how much live/Playwright verification, if any, is
  safe to trust unattended is still an open question).
- How/when `auto_handle='P'` with a plan actually transitions into Phase 2
  implementation - automatically on a later daily run, or only when Tsuri
  explicitly asks for it per ticket.
