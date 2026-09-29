# Targets Update — Async Background Review with Auto-Apply

Status: implemented and live-verified in dev (2026-09-29). Supersedes
`docs/design/targets-generation-latency-and-hebrew-redesign.md`'s rules-
engine/mode-switch work, which was deliberately dropped in favor of this
simpler design — see "What was dropped, and why" below.

## The ask

The user's own framing, verbatim in spirit:

1. The user gets a quick acknowledgment that their change request was
   received - Daffy says she wants to think it over and make sure the
   targets are properly tuned. They tap OK; that's it, 1-2 seconds.
2. A solid background job actually does the work, taking as long as it
   takes, tracked durably per user until it finishes.
3. A notification tells the user once it's done - either "all good" or a
   list of what changed. **No approval step** - it saves automatically.
4. If the user sends multiple requests before an earlier one finishes,
   only the latest one should ever take effect; earlier ones are ignored.
5. Small, in-range changes keep applying instantly, as today. The
   BMI-triggers-a-full-AI-call case was flagged as lower priority once
   the user saw the async model removes its UX urgency.
6. The rules-engine/shadow-mode/language-mode work from the prior design
   doc should be dropped - given this new mechanism, its value was judged
   too low relative to the complexity.

## A critical discovery before building anything

The obvious place to build this looked like `api/targets/chat/route.ts`
and `runBackgroundTargetsCheck` (`targets/actions.ts`) - an existing
SSE route with a background check, a draft table
(`user_target_profile_drafts`), and a notification system, built in an
earlier round of work (`targets-save-performance-redesign.md`).

**That entire system turned out to be dead code.** Tracing every real
caller confirmed: the live Targets page and the global chat widget both
go through a *different*, newer file, `plan-actions.ts`
(`negotiateActiveTargetsAction`/`applyActiveTargetsAction`), whose own
code comment says it was built specifically to replace "the old, more
complex SSE-based `/api/targets/chat` route." A later migration
(`055_phase24_targets_review_pending.sql`) independently confirms this:
its own comment says the popup that used to promise an automatic
background check "no longer exists in the redesigned Targets page."

Before this was found, this session had already built an entire 3-stage
rules-engine pipeline (intent extraction, deterministic rules, Hebrew
explanation) and wired it into `generateTargetsPayload` - which IS on
the live path (`plan-actions.ts` calls it), so that work wasn't wasted
motion, but the background-check/draft/notification architecture it was
initially going to be layered onto was the wrong target entirely.

**What this meant for the live experience, confirmed by reading
`plan-actions.ts` directly:** `negotiateActiveTargetsAction` was, until
this change, **fully synchronous** for anything beyond a literal single-
field edit - the user genuinely waited for the full ~50-90s AI call, then
had to tap again to actually save the result. This is exactly the
original "90-second transaction" complaint, still live and unsolved right
up until this change.

One genuinely good surprise: the *instant* tier (in-range literal edits)
already covered more than expected - not just weight/duration, but all 19
tracked nutrients plus weight/sleep/steps, via `classifyTargetsFieldEdit`
+ `applyOrCheckFieldEdit`. No widening was needed there; it already
matched what point 5 asked for.

## The new mechanism (`plan-actions.ts`)

`negotiateActiveTargetsAction`:

1. Tries quick-apply first (unchanged) - a literal, in-range single-field
   ask still writes immediately via `performTargetsLock` and returns
   `{ quickApplied: true, payload, reply }`.
2. Anything else: writes a marker row to a new table,
   `user_target_update_requests` (one row per user, upserted - a new
   request always replaces whatever was there), then schedules the full
   review via Next's `after()` and returns immediately with
   `{ quickApplied: false, queued: true, reply: <acknowledgment> }`.

`runTargetsBackgroundReview` (new, replaces the deleted
`runBackgroundTargetsCheck`):

1. Runs the full `generateTargetsPayload` call (unbounded duration - the
   user isn't waiting on it).
2. **Supersession check**: re-reads `user_target_update_requests` for
   this user. If the stored `request_id` no longer matches the one this
   job was given, a newer request has superseded it - **discard silently**
   (no lock, no notification) and return. The newer request's own job
   will report back once it finishes.
3. Safety rejection → a `concern` notification, nothing applied (same as
   before - this was never an "auto-apply candidate" to begin with).
4. No actionable change → nothing (the acknowledgment already covered
   it).
5. No real diff → an `info` notification, "still accurate, no changes
   needed."
6. A real diff → `performTargetsLock` (the same function every other
   save path already uses) applies it **automatically**, then clears
   every earlier unread targets notification (`markAllTargetsNotificationsRead`
   - a stale "still accurate" or old concern is moot once a fresh save
   lands) and sends one `info` notification with the AI's own explanation
   plus a mechanical diff summary of what changed.
7. The request marker's `status` flips to `complete` or `failed`
   regardless of outcome, so a stuck/never-finished request is at least
   visible in the data (no UI reads this yet - see Follow-ups).

## The race this fixes, concretely

The old drafts-table design (`upsert(onConflict: user_id)`) protected
against showing two drafts at once, but never guarded against **out-of-
order completion**: if an older, slower request happened to finish after
a newer, faster one, its result would silently win the final write,
regardless of which request was actually more recent. `user_target_update_requests`
closes this - the background job checks it's still the current request
right before writing anything, not just before starting.

**Live-verified**, not just reasoned about: two real messages were sent
~2s apart from two authenticated tabs (an older omega-3 request, then a
newer calcium request). Both AI calls ran to completion. Final state:
calcium was updated to the requested range; **omega-3 was untouched** -
the older request's own real, computed result was correctly discarded.
Only one notification exists (for calcium), and it correctly cleared the
earlier magnesium notification from a prior test run (`read_at` set),
confirming `markAllTargetsNotificationsRead` fires on the winning
request's own save.

## Live end-to-end verification (real account, real AI calls)

A real "set my magnesium target between 350 and 450mg" request:

- `user_target_update_requests` row: `pending` → `complete`.
- `user_target_profiles` active row: magnesium correctly updated to
  350-450, source `ai`, timestamp matching the background job's
  completion - **applied with no approval step**.
- A real notification arrived with the AI's full explanation (including
  correctly reasoning about this account's real hypertension/diabetes-
  history/celiac/vegetarian profile) plus a mechanical diff line
  (`מגנזיום: 400–420 מ"ג → 350–450 מ"ג`).

## What was dropped, and why

Per the user's own explicit decision (offered the option to keep the
rules engine as the background job's engine for its real measured
4.5-4.7x speedup and lower AI cost; the user chose to drop it anyway,
given this async redesign removes the latency problem's UX urgency
regardless of which generation path answers it):

- `lib/ai/targets-rules-engine.ts`, `targets-intent-extraction.ts`,
  `targets-explanation.ts`, `targets-fast-path.ts`, `targets-translate.ts`,
  `targets-update-mode.ts` - deleted entirely.
- The Anthropic tool-use addition to `provider-client.ts` - reverted
  (nothing left uses it).
- `TARGETS_UPDATE_MODE` / `TARGETS_FAST_PATH_SHADOW` env vars - removed.
- `generateTargetsPayload` - back to calling `generateTargetsWithAi`
  directly, exactly as before this session's rules-engine work, in the
  user's real locale every time.

Also removed as confirmed-dead legacy code (found during this
investigation, not part of the original ask, but leaving it in place
risks exactly the confusion that nearly led this work astray):

- `api/targets/chat/route.ts`, `lib/ai/targets-chat.ts`,
  `components/targets-chat-workspace.tsx` - the old SSE route and its
  only caller.
- `runBackgroundTargetsCheck`, `approveTargetsDraftAction`,
  `discardTargetsDraftAction`, `applyQuickTargetFieldAction` - dead
  functions only the deleted route called.
- `classifyTargetsQuickApply` - the narrower (weight/duration-only)
  quick-apply classifier the dead route used; `classifyTargetsFieldEdit`
  (the broader, live one) is unaffected.
- `user_target_profile_drafts` table - dropped via migration (its only
  reader, the dead route's draft-approval flow, is gone; the live app
  never reads it - confirmed via a full grep before dropping).

**Kept** from the rules-engine round despite the broader rollback: the
`targets-diff.ts` double-unit-suffix display fix (a real, independent,
general bug) and the `lib/targets.ts` refactor that extracted shared
constants (`CONDITION_TIGHTENING`, `computeStandingUserTargets`) - both
safe, harmless, zero-behavior-change cleanups still in active use by the
heuristic generator.

## Known gaps / follow-ups

- **The acknowledgment isn't quite "1-2 seconds" as originally
  envisioned** - it's bounded by `classifyTargetsFieldEdit`'s own
  classification call (needed to know whether to quick-apply or queue),
  measured at ~8-9s in live testing including real Next.js/dev-server
  overhead. Still a dramatic improvement over the ~50-90s it replaces,
  but worth naming honestly rather than claiming it hit the original
  ideal. A faster/smaller model for just this classification step is a
  plausible future optimization if this specific gap ever matters enough
  to revisit.
- **BMI-out-of-range still isn't handled deterministically** - deferred
  per the user's own explicit choice, since the async model already
  removes the perceived-latency cost of that case falling through to the
  full call; it only affects background turnaround time and AI spend now,
  not what the user experiences.
- **No UI yet reads `user_target_update_requests.status`** - the data is
  there (a genuinely durable "is a review currently in flight" signal,
  even across a crashed serverless function), but nothing surfaces it.
  Worth revisiting if "is Daffy still thinking about my last request?"
  ever comes up as a real product need.
- **Superseded (discarded) background reviews still cost real AI spend**
  - the older request's own AI call still runs to completion before being
  silently thrown away; there's no cancellation (e.g. via `AbortController`)
  of an in-flight call when it's superseded. Not fixed here - flagged as
  a real, known cost tradeoff of the "simple, no in-flight cancellation"
  design.
