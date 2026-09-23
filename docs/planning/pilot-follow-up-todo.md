# PWA Pilot - Follow-up To-Do

Deferred items from the PWA pilot rollout (Sept 2026), to revisit once the
current pilot round has surfaced enough real bugs to be worth prioritizing
against. Not urgent - the pilot itself runs as-is in the meantime.

## Top priority

- **System-wide, chat-driven editing.** Give the chat box the capability to
  edit most things in the app via conversation, not just Targets - profile
  attributes, daily report entries, saved items, and targets. Surfaced
  while designing the Targets profile-change draft/approval flow above
  (see `docs/design/targets-save-performance-redesign.md`'s own
  follow-up section): that flow is itself a narrow, Targets-specific
  instance of a pattern ("chat proposes a change, user reviews a concrete
  diff, then approves or discards it") that could generalize across the
  app instead of being rebuilt separately per feature. Explicitly **not**
  to be implemented yet - logged here for a dedicated discussion once the
  Targets flow itself has been used for real. Connects to an open question
  already flagged there and deliberately deferred: what the experience
  should do when a background check comes back with a genuine *concern*
  about a change (today only a plain "ready to review" outcome exists; a
  concern-flavored variant of the same draft/notification pattern is a
  natural next step, worth designing together with this broader
  capability rather than bolted on separately).

## Open items

- **Investigate perceived load speed.** Installing as a PWA didn't make the
  app feel faster (expected - see below), but a proper profiling pass could
  still find real wins: every page under `/app` is server-rendered fresh on
  each visit (live Supabase queries, and some pages call the AI for things
  like the coach narrative), so page-load time is bounded by that server
  round-trip, not by asset loading. Worth checking for anything genuinely
  slow in there - a heavy/N+1 Supabase query, an AI call blocking the
  initial render that could be streamed in instead, etc. Deliberately not
  something the service worker can help with: caching personalized
  Supabase/AI data client-side would mean sometimes showing stale numbers,
  which is a worse tradeoff than the current load time.
  - **Update (Sept 2026):** measured real per-query latency against the dev
    Supabase project directly - each round-trip costs ~350-400ms regardless
    of query complexity, and most pages were paying that cost multiple times
    over by awaiting independent queries one at a time instead of together.
    Parallelized the shared layout's nav-chrome queries, and the Targets,
    Profile, and Targets-overview pages' own independent queries, via
    `Promise.all` - measured 2x-5x faster for those batches with no change
    in behavior (same data, just fetched concurrently). Still outstanding:
    **investigate and implement caching** as the next lever - every page is
    still `force-dynamic`, so even the now-parallelized cost is paid again
    on every single navigation, including switching back to a page visited
    seconds earlier. Needs care around the stale-data tradeoff noted above
    (this is live personal health data) - likely candidates are a short-lived
    server-side cache (e.g. `unstable_cache` with a several-second TTL) for
    data that's expensive but doesn't need to be instantly fresh (the shared
    layout's nav chrome - name/avatar/theme/notification count - is the
    obvious first candidate), rather than caching anything client-side or
    anything the user just edited.
- **Grow the pilot allow-list as more testers are added.** Currently 4 rows
  in `pilot_allowlist` (staging DB only) out of the ~25-tester cap discussed
  when this was set up. Adding more is just an insert - no redeploy needed.
  Recommended cap of 25 was about AI provider rate limits/cost, not
  Vercel/Supabase infra, which have plenty of headroom beyond that.
- **Finish the real-device install pass.** Only confirmed working on one
  device (Android, install prompt appeared, app runs standalone) so far.
  Still need: at least one iPhone (Safari's manual Share -> Add to Home
  Screen flow, since iOS doesn't offer an automatic install prompt like
  Android/Chrome does), and the other three testers actually getting
  through sign-up + install on their own phones.
- **Decide when to lift the invite-only gate.** `PILOT_ALLOWLIST_ENABLED`
  defaults to enabled (unset) in production; can be turned off later via a
  Vercel env var (no code change) once ready for open sign-up.
- **Wire up Git-based auto-deploy, or decide against it.** The Vercel
  project (`daffy2/daffy-pilot`) isn't connected to the GitHub repo yet -
  connecting it failed during setup ("You need to add a Login Connection to
  your GitHub account first" on vercel.com). Every deploy so far has been a
  manual `vercel deploy --prod` from the `Project-staging-1.0` worktree
  after merging `main` -> `release/1.0`. Fine for a small pilot with
  infrequent promotions, but worth revisiting if promotions become more
  frequent - either fix the GitHub connection for auto-deploy-on-push, or
  keep it manual deliberately (avoids an accidental prod deploy from a
  branch that hasn't been through the usual dev -> staging promotion step).

## Future features to explore

- **Sync with Apple Health / Google Health Connect.** Auto-update steps,
  other exercise, and sleep duration from the phone's own health data
  instead of relying on the user to log them manually. Needs research into
  both platforms' consent/authorization flows and read-scopes (HealthKit on
  iOS, Health Connect on Android - Google's older Google Fit API is being
  retired in favor of Health Connect), and how a synced value should
  reconcile with a manually-logged one for the same day if both exist.
- **WhatsApp integration**, opt-in per user, for a Daffy chat thread over
  WhatsApp: notifications, and the ability to send a daily report from
  there instead of (or alongside) the in-app chat. Needs research into the
  WhatsApp Business Platform/Cloud API (opt-in and messaging-window rules,
  approval process, cost per conversation) and how an inbound WhatsApp
  message maps onto this app's existing daily-report chat/save flow.
- **Admin-configurable nutrient display order.** Surfaced while designing
  the new onboarding Targets step (see `docs/design/onboarding-redesign.md`
  §7.6): the 19-nutrient list's display order is being set once, by hand,
  for the initial build. Longer-term, let an admin reorder it from a
  settings screen backed by a real reference table, instead of the order
  living in code - same reasoning as any other editorial/reference data an
  admin should be able to tune without a deploy.

## Bugs found during pilot testing

- **[Fixed on dev, not yet promoted] Targets page stuck loading forever on
  iPhone for a tester without a locked-in plan.** Reported Sept 2026: a
  tester on iPhone (app v1.1.16) could load Profile but Targets and Daily
  Report both "kept rendering and never came up." Root cause found for
  Targets: `targets/page.tsx` called `generateTargetsPayload` (AI baseline
  generation) synchronously during server render whenever the user has no
  active target plan yet - that call routinely takes 30-90s (see its own
  `timeoutMs` comment), blocking the entire page from rendering anything
  until it finished. Confirmed this tester hadn't locked in a plan yet,
  matching the theory. Fixed by moving that generation off the server
  render entirely - the page now renders immediately, and
  `TargetsWorkspace` triggers the same generation client-side on mount via
  the existing `generateTargetsAction` form, with its own visible pending
  state instead of a blank stuck page. Daily Report's cause for the same
  tester is still open - its own server render has no equivalent blocking
  AI call (already just fast, already-batched Supabase queries), so it's
  likely a separate, client-side issue specific to that tester's own data;
  needs their account data checked directly, or another report, to narrow
  down further.
