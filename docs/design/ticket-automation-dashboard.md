# Ticket Automation dashboard - design and implementation plan

Status: approved by the product owner on 2026-10-08; implementation in phases (see "Phases"). Mockup: version B of the
"Ticket Automation Cycle" artifact. Builds on docs/design/auto-ticket-handling.md (the spec-first flow, night run and
promote flow); read that first for the flags, the bridge and the n8n workflows.

## Goal

One admin page that shows every ticket marked for automation, where it stands in the cycle, what is waiting for the
admin, and lets the admin act right there. The page must make visible that a person authorises every step the AI
produces: four sign-off gates are drawn on the cycle and recorded in an audit log.

## The cycle (seven stations, clockwise)

Marked -> Analysis -> Approve spec -> Fix -> Test on dev -> Promote -> Release -> (resolved, back to Marked)

| Station | Actor | A ticket is here when |
|---|---|---|
| Marked | You | auto_handle `S` and no analysis run in progress |
| Analysis | AI analyst | auto_handle `S` and an analysis run is in progress |
| Approve spec | You | `A` with a pending proposal (chip "Better done together" when the analyst flagged `needsPairing`) |
| Fix | AI night run | `Y`, or `P` with pending questions (questions need the admin) |
| Test on dev | You | `D` with a fix awaiting merge, or `M` (merged on dev) |
| Promote | You | `R` with an approved fix, not part of an open promote request |
| Release | Automation | the ticket is in an open promote request |

Tickets with a final status (resolved, closed, cancelled, duplicate) or no flag are not in the cycle. The mapping is ONE
pure function (`stationOf` in `lib/automation-overview.ts`) used by the counts, the panels and the search.

Sign-off gates (shield on the arrow): 1 mark, 2 approve the proposal, 3 approve for production, 4 press Promote.

## Encoding of "who acts" (never colour alone)

| Actor | Shape | Tint | Corner badge | Label |
|---|---|---|---|---|
| Admin | circle | blue | person | "You" |
| AI agent (analyst, night run) | rounded square | teal | robot | "AI analyst", "AI night run" |
| Automation (release) | dashed circle | grey | gear | "Automation" |

## Data changes (migration 069)

- `automation_events` - who did what and when per ticket (marked, spec_approved, change_requested, rejected,
  taken_out, merge_requested, approved_for_production, sent_back, promote_requested). Kept indefinitely. Feeds the
  "You approved the spec - 5 Oct" chips, the ages and the audit trail.
- `automation_runs` - one row per analyst / night run (start, end, ticket count, cost, result). Feeds the status strip.
- `automation_settings` - single row: `paused`, who, when. Pause stops ONLY the two AI agents (scheduled and manual
  starts); the admin's own actions (merge, approve, promote) are never blocked.
- `automation_requests.kind` gains `night` and `digest` (start buttons).

## Bridge / n8n changes (phase 4-5)

- `GET /health` on the bridge (online, run/analysis in progress, auto-merge on); the minute poller reports it to the app.
- The bridge records an `automation_runs` row when an analysis or night run ends and refuses to start while paused.
- The poller starts the analyst / night run / digest from `analyze` / `night` / `digest` requests through the existing
  manual webhooks (fire-and-forget; running state comes from the heartbeat).

## App structure

- `/app/tickets/automation` - the dashboard (server component loads one overview; client component draws the cycle and
  the station panel). Link from the Tickets page (already exists) and back / close on the page.
- `/app/tickets/automation/releases` and `/automation/lessons` - sub-pages (release history, what the agents learned),
  reached from link cards under the cycle.
- Inline actions reuse the existing server steps in `lib/ticket-review.ts` (approve with recommended picks, request
  change, reject, merge, approve for production, send back, take out, promote with tick boxes). Nothing is re-invented.
- Search: admin-only server action returning station, timeline and actions; the matching station pulses.
- Every new string is localised EN/HE; keyboard accessible; reduced-motion respected; phone layout (ring shrinks, panel
  moves below).

## Phases

1. The cycle, read-only: migration 069, `stationOf`, overview query, ring with counts, shields, station panels with
   "Open" links, link cards, sub-pages.
2. Actions in the panels and the sign-off trail (events log, inline approvals, merge, approve for production, send back,
   take out, Promote with tick boxes and Release). Release to production after this phase.
3. Search and highlight.
4. Run buttons in the Marked and Fix panels, heartbeat, run records, status strip, running states.
5. Pause switch, recently released strip, ages, Hebrew and phone checks, polish. Release again.

Each phase is committed on main, tested on dev with seeded tickets in every station, and only promoted on the admin's
explicit go-ahead.

## Decisions taken

- Pause covers only the analyst and the night run.
- The event log is kept indefinitely.
- Release history and lessons are sub-pages.
