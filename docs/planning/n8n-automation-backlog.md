# n8n / Workflow Automation - Backlog

Status: **Not started - deliberately blocked.** Tsuri wants to hold off starting
this project until all open Alpha-tester tickets with `priority in ('high',
'urgent')` or `ticket_type = 'bug'` (see `public.tickets`, migration
`044_phase22_user_tickets.sql`) are cleared to `resolved`/`closed`/`cancelled`.
Once that's true, remind him and start with Phase A below.

Captured from a design discussion (Sept 2026) exploring where n8n - a
self-hostable, node-based workflow/automation tool (the same category as
Zapier/Make) - could provide real benefit across Daffy, beyond the original
motivating example (a daily digest of total users / tickets opened / AI token
usage).

## Why n8n, and how it fits

n8n runs as its own long-running service (not part of the Daffy app itself)
and chains **trigger -> action -> destination** nodes - e.g. a schedule
trigger firing every day at 6am, calling an HTTP endpoint, then emailing the
result. For Daffy specifically, the safe integration pattern is: n8n never
holds direct Supabase credentials; instead it calls small, purpose-built
endpoints in the Daffy app itself (protected by their own secret, reusing the
existing `is_admin` flag on `user_profile` for anything also exposed as an
in-app admin page), keeping "what counts as a user / an open ticket / etc."
defined in one place in the codebase.

Planned to start hands-on with **Docker Desktop**, locally, for learning
purposes and to avoid hosting cost up front - understood tradeoff: a local
n8n instance only fires scheduled triggers while the machine/Docker is
running, so it's fine for prototyping the workflow logic but not yet a
"production" always-on scheduler. The workflow itself is portable to a hosted
instance later without rework.

## Phased plan for the original motivating example (daily metrics digest)

1. **Phase A (learn n8n, quick win):** Run n8n in Docker Desktop. Build the
   simplest real workflow: schedule trigger -> call a stub metrics endpoint
   (just total users + tickets opened, both trivial queries against existing
   tables) -> email the result. Goal is experiencing a real end-to-end
   workflow fire, not the data itself yet.
2. **Phase B (real dev work - the biggest chunk):** Instrument AI token usage.
   Confirmed while scoping this: **Daffy does not currently log token counts
   anywhere** - every AI provider call goes out and comes back with nothing
   about its usage persisted. Needs: capturing `input_tokens`/`output_tokens`
   from the response at every AI call site (targets generation, targets
   quick-apply + its safety-check verify call, the daily-report chat, the
   chat router, etc.), into a new table (e.g. `ai_usage_log`: `user_id`,
   `feature`, `provider`, `model`, `input_tokens`, `output_tokens`,
   `created_at`) - logged **per user and per feature**, per Tsuri's explicit
   ask, so the data can answer "which calls/users consume the most tokens"
   for efficiency tuning, not just a single aggregate number.
3. **Phase C:** Build an admin-only dashboard page inside Daffy itself (gated
   by `is_admin`, same pattern as the metrics endpoint) to slice/dice the
   token-usage data by date range, user, and feature - "as management," per
   Tsuri's own framing.
4. **Phase D:** Extend the n8n workflow to pull real token stats and push a
   link to that dashboard, delivered via **email first** (n8n has a built-in
   node, trivial to wire up) - WhatsApp deliberately deferred: it requires
   either Twilio's WhatsApp API or Meta's Cloud API, both needing business
   setup/approval and per-message cost with Twilio, so it shouldn't be what
   blocks seeing the pipeline work end-to-end. Add WhatsApp later as its own
   deliberate step if still wanted (there's already a separate, older,
   broader "WhatsApp integration" idea logged in
   `docs/planning/pilot-follow-up-todo.md`'s "Future features to explore"
   section - worth reconciling the two if WhatsApp delivery is picked up).

## Other places n8n could plug in (logged for later prioritization, not yet scheduled)

**Reliability / ops alerting**
- The async targets-review design (`runTargetsBackgroundReview`, see
  `docs/design/targets-background-auto-apply.md`) relies entirely on a
  server-side background task (`after()`) completing. If it ever crashes
  mid-flight, a `user_target_update_requests` row is left stuck in `pending`
  with no one noticing until a user asks why their change didn't apply. A
  periodic n8n check for rows stuck in `pending` past a reasonable age would
  catch that failure mode proactively.
- `logServerError` is already used app-wide for caught server errors, but
  nothing currently surfaces what lands there. A periodic digest (or an
  immediate alert on a spike) would turn silent server-side errors into
  something actually seen.
- A basic scheduled uptime check against `/api/version`, alerting if it stops
  responding or the returned version doesn't match the last known deploy.

**Support operations**
- New tickets in `public.tickets` currently require someone to go check the
  table/admin view. A near-real-time n8n notification (Slack/WhatsApp/email)
  on ticket creation turns it into a push instead of a pull. Separately, an
  SLA-style check for tickets open too long without a status change.

**Product/user engagement** (logging consistency is the core product value)
- Detect users with no `user_daily_reports` row in N days and trigger a
  re-engagement nudge.
- Detect signups stuck mid-onboarding (`needs_onboarding_refresh` true, or no
  target plan ever generated) and follow up.

**Founder/business visibility**
- A weekly pilot-funnel digest - invited -> signed up -> completed onboarding
  -> logged at least once -> still active - computed and pushed without
  building a bespoke analytics UI for it. `PILOT_ALLOWLIST_ENABLED` and
  `pilot_allowlist` are the relevant existing pieces.

**Cost control**
- A direct extension of the Phase B/D token-usage pipeline: a threshold alert
  ("today's AI spend crossed $X") so a bug like a silent retry loop is caught
  same-day rather than at the end of a billing cycle.

**Data hygiene**
- Scheduled purge of old superseded `user_target_update_requests` rows and
  stale dismissed notifications.
- Nightly backup export of core tables to cloud storage, as insurance beyond
  Supabase's own backups.

**Release notifications**
- The existing promotion pipeline (merge -> migrate -> deploy -> git tag) ends
  in a tag push. A webhook-triggered (not cron) n8n workflow off that could
  post an automatic "Daffy vX.Y.Z is live" message - also a good way to learn
  n8n's webhook-trigger side specifically, as distinct from its schedule
  side.

**Safety-review rollup**
- The quick-apply safety net (`verifyQuickAppliedFieldSafety`, see the same
  targets-background-auto-apply design doc) already flags "this change might
  be worth reconsidering" per user, per event, but it's buried in that user's
  own in-app notifications. A digest of all flagged concerns across all users
  in one place would give Tsuri, as the human in the loop, real visibility
  into what the AI is catching - especially relevant given these are
  medical/health targets.

## Ticket Automation - improvements logged for later (not scheduled)

Logged 2026-10-08 while building the Ticket Automation dashboard (docs/design/ticket-automation-dashboard.md).

- **Rebuild stale fixes automatically.** Fixes are built on the production code and the promotion refuses one when production has
  changed since (docs/design/auto-ticket-handling.md, "Fixes are built on production"). Today the admin sends such a fix back by
  hand. Instead, when a release lands, every approved-but-unpromoted fix (and every fix waiting on dev) should be re-queued for the
  night run automatically, with a note saying it is being rebuilt on the new production, and the admin told in the digest.
- **Cloud fallback / "laptop offline" alert** (candidate #5 of the life-cycle document): the dashboard already shows "Bridge
  offline"; an e-mail when a scheduled run did not start would close the gap.
- **Behavioural dependencies** the file-overlap and production-base checks cannot see (a fix that relies on another change in a
  different file) still depend on the type check, the smoke test and the rollback.

## Lessons from the 2026-10-09 run (TCK-117 / 118 / 119) - what is done and what is still open

Done (bridge and dashboard, built 2026-10-09):

- A leftover `auto-fix/tck-N` branch no longer makes a rebuild fail at the end of a run: it is renamed to `-stale-<time>` before
  any agent work starts (a branch a working copy is using is never touched).
- Any error in a ticket now leaves a "stopped" card with the reason (and a "Put back in the queue" button), not an invisible flag.
  It is not retried automatically every night.
- Dev (main) is merged with production (release/1.0) after every promotion and before every merge to dev. Production reaches
  dev as history only: nothing on dev is undone.
- The dashboard shows a ticket the night run is building ("building now") and a failed merge or revert with its reason.
- The analyst is told the next free migration number and that a new `user_profile` column needs `user_profile_enriched`
  recreated in the same migration (029, 073).

Built later the same day (see docs/design/auto-ticket-handling.md, "Keeping fixes from colliding"): the overlap guard, the
automatic rebuild of stale fixes after a promotion, and the alert when an automation step fails.

Built the same day: **fix bundles** (docs/design/auto-ticket-handling.md, "Fix bundles"): tickets that change the same files are built,
tested and promoted as one fix; suggested by the code, approved as a bundle or separately, split when needed.
Not in the first version: adding a ticket to an existing bundle by hand ("Edit bundle"; today a bundle is created from the
analyst's suggestion and a member can only leave before the bundle is built or by splitting it), and a bundle across tickets
that were analysed on different days.

Still open:

- **Overlap guard (design first).** Tickets that touch the same files must not be built in parallel on the same base (117, 118
  and 119 all rewrote the onboarding form). The analyst lists the files each ticket will touch; the night run holds a ticket
  whose files overlap with one that is queued, merged on dev or approved but not promoted, and the dashboard says "waiting for
  TCK-n". Combine with "Rebuild stale fixes automatically" above.
- **Additive migrations without pairing.** The agent drafts the SQL, a checker allows only safe statements (add column if not
  exists, create table if not exists, create index, view refresh), the admin approves in the dashboard, the automation applies
  it to dev with the merge and to production before the deploy, and records it in the migration history.
- Add an n8n alert when an e-mail send fails (done 2026-10-09 for the cause: the e-mails now go out over SMTP with a Google App
  Password, credential "Daffy SMTP", instead of Gmail OAuth, whose token expires every 7 days while the app is in "Testing" and
  cannot be published without a domain of our own. An App Password does not expire, but if it is ever revoked the sends fail
  silently, so an alert is still worth having. The two old Gmail OAuth credentials in n8n are unused and can be deleted.)
- Standing rule for Claude's own changes: nothing is merged or released while an agent run is active or approved fixes await
  promotion (memory: hold-changes-while-agents-running).
