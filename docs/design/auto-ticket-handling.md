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

## Spec-first flow: analyst, review screen, night run (2026-10-06)

Added after a trial showed why night runs stopped: of five tickets the night run could not fix
alone, every stop was a **missing decision**, not a coding problem. Once each ticket carried
written decisions, four of five were fixed unattended. The analyst makes that hand-off a
first-class step instead of a manual one.

**More `auto_handle` values** (`db/migrations/064`): `'S'` spec requested, `'A'` proposal waiting
for the admin's approval. The full life cycle:

```
NULL --admin marks "spec requested"--> S
S --analyst (evening batch, or "Run analysis now")--> A      proposal stored, ticket text untouched
A --admin approves (one click, or sets Queued)--> Y          choices + brief copied into the ticket
A --"Request a change" + comment--> S                        analyst revises, new version
A --Reject + reason--> NULL, status 'deferred'
Y --night run--> D (fix on a local branch)  or  P (stopped, with questions)
P --admin answers--> Y                                       answers copied into the ticket
D --"Merge to dev"--> branch merged on the dev copy (never pushed, never production)
```

**Where things live** (`db/migrations/065`): `ticket_proposals` (admin-only, versioned; kinds
`proposal`, `questions`, `fix`; the mockup HTML and screenshots live in `payload`) and
`automation_requests` ("Run analysis now" / "Merge to dev" clicks). An unapproved proposal is
**never** in the ticket's own text, so the ticket's creator cannot see it. Approving writes a
support entry into `tickets.description`; that is the only place the night run reads decisions from.

**The analyst** (`POST /analyze` on the bridge): read-only like Phase 1, one disposable worktree per
ticket. Its prompt requires every file/line it cites to have been opened, a blast-radius list
(every other place the touched code is used - the check that would have caught the rings being on
a different screen than assumed), 2-3 option decisions with exactly one recommended, mockups (ui_ux
only, one self-contained HTML document each, shown in a sandboxed iframe), a brief for the night
agent, and a `needsPairing` flag for changes too risky to do unattended.

**Night run changes:** Phase 1 treats decisions already in the ticket (approved spec, admin notes,
answers) as settled and only checks them against the real code; it returns structured questions
when it does stop. Phase 2 can take screenshots of its own change with `bridge/tools/shot.js`
(headless Chromium, signed in as the test account) and look at them; the bridge captures the final
ones itself and stores them with the fix. Screenshots are written outside the worktree because the
bridge commits with `git add -A`.

**"Run now" and "Merge to dev" from the hosted app:** the app (Vercel) cannot call the laptop, so a
click inserts an `automation_requests` row and the n8n workflow "Daffy - Review Requests Poller"
(every 5 minutes) claims it, calls the bridge (`/analyze` or `/merge`) and reports the result back.
`/merge` only ever merges into `main` of the dev repo, aborts a failed merge so nothing is left
half-done, and never pushes.

**Scheduling:** the Windows task `Daffy Auto Ticket Handling` (02:00) and, once promoted, `Daffy
Spec Analyst` (17:45) wake the laptop and ready n8n + the bridge; n8n's own schedules (02:15 and
18:00) start the runs; the Windows script fires the webhook itself only if n8n did not, and the
bridge refuses overlapping runs. `automation/n8n/manage-auto-ticket-schedule.ps1` stops, starts and
retimes either job (`-Job analyst`).

**Open limits:** the night run's agent signs in as a non-admin test account with no data, so admin
screens and data-dependent states cannot be seen in its screenshots; the review screen is admin
only (English analyst text is shown with `dir="auto"` inside the Hebrew layout).

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

## Fixes are built on production (rule of 2026-10-08)

The night run and the analyst work in a copy of `release/1.0` (what is live), never of `main` (PRODUCTION_REF in the bridge's
env). Every fix commit records the production commit it was built on (`Built-on-production: <sha>`). The promotion applies a
fix only while `release/1.0` is still exactly that commit, and checks again just before the deploy that nothing landed on the
release branch and that the live version is the one it started from; otherwise the fix is reported as "production has changed
since this fix was built" and must be sent back to be built again. Fixes made before this rule (no trailer) are checked by file
overlap with unreleased changes instead. A fix built on production can conflict on dev (main moved on): the auto-merge leaves it on
its branch and the admin sees it in the dev test - that never reaches production.
