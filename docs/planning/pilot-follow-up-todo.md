# PWA Pilot - Follow-up To-Do

Deferred items from the PWA pilot rollout (Sept 2026), to revisit once the
current pilot round has surfaced enough real bugs to be worth prioritizing
against. Not urgent - the pilot itself runs as-is in the meantime.

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

## Bugs found during pilot testing

(Nothing logged yet - append here as testers report issues.)
