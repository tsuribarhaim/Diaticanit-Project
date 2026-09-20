# Targets Save — Performance Redesign

Status: design agreed, pending implementation.

## Problem

Clicking "Update Targets" in the AI-driven Targets chat took 60+ seconds in
real pilot use — unacceptable for launch, including to friendly early
testers.

## Investigation

Traced the full code path (`targets-chat-workspace.tsx` →
`api/targets/chat/route.ts` → `app/app/targets/actions.ts` →
`lib/ai/targets.ts` / `lib/ai/targets-chat.ts` → `lib/targets.ts` /
`lib/bmi.ts`), then built a temporary diagnostic API route that called the
real AI functions directly (bypassing the browser/auth layers) against
production models and real profile data, timed it, ran it twice to sanity
check variance, then deleted the route.

**Measured** (two runs, real Anthropic Claude Sonnet 5 calls):

| Step | What happens | Measured time | Share of total |
|---|---|---|---|
| 1 | User sends a chat message → AI generates a conversational reply, decides ACTIONABLE vs not | ~2.3–2.6s | ~10% |
| 2 | User clicks "Update Targets" → AI regenerates the **entire** target profile (every macro/micro range, exercise plan, habits, custom targets, rationale) as one structured JSON call, up to an 8,192-token output budget | ~21.8–22.1s | ~90% |
| 3 | Save to DB (deactivate old row, insert new row) | <0.5s (not separately measured; two simple Supabase writes) | ~1–2% |
| | **Total measured** | **~24.4s** | |

Step 2 is the dominant cost, and the code's own existing comments already
documented worse-case runs (~48s) for that step alone, which is why it
carries a 90s timeout. Two things the isolated measurement didn't include,
both real in production:

- **LLM latency variance** — the ~48s worst case is already documented in
  the code.
- **Silent document (re-)extraction.** `prepareMedicalContextForTargets`
  treats any document not yet `extracted`/`needs_review` as pending and
  re-runs a full AI document-extraction pass for it, synchronously, one at
  a time, *before* step 2 even starts. A document was found genuinely stuck
  in `extraction_status: "processing"` in the dev database while
  investigating — under the old code, every future targets-save for that
  user would silently re-attempt extracting it, forever, adding an
  unbounded extra AI call on top of everything else.

**Target:** perceived save time under 4 seconds.

## Agreed redesign

### 1. Quick-apply the literal, single-value case; run the full plan in the background

When the fast chat-reply confirms a literal, unambiguous single-value ask
(a target weight, a duration, a sleep/step/hydration goal), clicking Save:

1. Immediately patches just that field on the *currently active* target row
   (a single fast UPDATE, not the full deactivate+insert lock cycle).
2. Shows a 2–3s "updating your full plan in the background" banner.
3. Kicks off the full, comprehensive regeneration in the background (see
   §3), which performs the authoritative full save when it completes.

**Validation, cheapest check first:**

1. **Deterministic range check (instant, no AI).** Target weight already
   has one today — `evaluateTargetWeightSafety` in `lib/targets.ts` rejects
   a target that would push BMI into the unsafe *underweight* zone. **Gap
   found and agreed to close:** it only guards the low-weight direction —
   an extreme weight-*gain* target passes through unchecked today. Fix: add
   the symmetric high-BMI check. Sleep/steps/hydration have **no**
   deterministic check at all today, only AI judgment during the full pass
   — agreed to add simple hard-coded sane ranges for these too.
2. **Tiny AI scope-check (a few seconds), only when no clean range
   applies.** "Given this ask and the user's profile: safe to apply as-is
   (yes/no + one-line reason)? Does it affect any other field?" Small
   output, not the full schema.
3. **Full background regeneration** — always runs regardless, and is the
   authoritative save.

Applies equally to Home and Targets since both share the same `RingMetric`
display component.

### 2. Scope the background regeneration for narrow requests

The scope-check's answer ("which fields does this affect") is reused: when
a request is narrow, the background regeneration asks the AI for only the
affected fields instead of the full ~40-field schema. Output size (and
thus generation time) scales down accordingly — estimated to bring a
narrow-request background pass from ~20s+ down to single digits, though
this specific number is an estimate, not separately measured.

**Caveat, by design:** the existing prompt has standing "mandatory review"
rules (BMI safety review, medical/allergy/dietary safety review,
exercise↔calorie coupling) that intentionally re-check everything on every
request, on purpose. The scope-check step must inherit those same coupling
rules so it doesn't under-scope and miss a second-order safety implication.
When the scope-check is broad or uncertain (a new medical condition, a
profile-change note, anything that would trigger an existing mandatory
review), it says so and the flow falls back to the full, untargeted
regeneration — never force a narrow patch when in doubt.

### 3. Decouple document (re-)extraction from Save entirely; fold it into the background check

Drop `prepareMedicalContextForTargets`'s synchronous extraction-triggering
from the Save path. Document context is instead evaluated as part of the
background full check (§1/§2), which is already off the user-facing
critical path, so there's no latency cost to letting it run there.

**Mechanism for genuinely running work after the response is sent:** this
app runs on Vercel serverless functions, which can freeze the moment a
response is returned — a real job queue doesn't exist in this project and
isn't justified for a pilot this size. Use Next.js's `after()` primitive
instead: send the fast response, then keep executing (the full
regeneration, including documents) within the same invocation.

**Logged separately, not solved as part of this redesign:** *why* a
document got stuck in `processing` and never resolved is a Documents
extraction-pipeline bug worth its own investigation.

### New system this requires: notifications

- `user_notifications` table: message/summary, severity, read/unread,
  created_at, and a **structured reference to which specific target
  field(s)** the concern is about (not just free text) — needed so the UI
  can look up "is this value currently flagged?"
- A small badge/signal in the nav.
- A new `/app/notifications` view.
- Clicking a notification returns the user to the Targets chat with the
  concern already seeded as context, so it's resolved collaboratively with
  the AI rather than dead-ending on a static alert.
- **Decision on conflicts:** if the background full check (now
  document-aware) finds a problem with something already quick-applied and
  shown to the user, we do **not** silently revert it. We leave it applied
  and flag it — silently undoing something the user explicitly asked for
  and saw confirmed is worse than surfacing a clear concern and working
  through it with them.
- **Visual reinforcement:** a small ⚠ warning icon next to the specific
  flagged value in the rings/metrics display (shared by Home and Targets),
  clickable through to Notifications. Deliberately **not** red — red
  already means "over your limit" in the existing ring color system, and
  reusing it for "flagged concern" would create two conflicting meanings
  for the same color. The flag persists until a *later* background check
  (triggered by the user actually working it through with the AI, not just
  opening the notification) confirms it's resolved — reading and resolving
  are different things, and the goal is to force a real decision.

### 4. Considered and rejected: a faster/smaller AI model

Would have applied to the new tiny scope-check call specifically (Claude
Haiku vs. the currently-used Claude Sonnet 5; GPT-4.1-mini is configured
but unused while the provider is set to Anthropic). Rejected based on the
user's own prior testing:

- **Quality degradation risk.** A weaker model's judgment errors would
  directly undermine the new notification system's trustworthiness — more
  false-positive concerns teach users to ignore warnings, defeating the
  purpose of §3's safety net.
- **Negligible measured speed difference** in the user's own prior testing
  of faster models against this kind of task — plausibly because latency
  here is driven mainly by output token volume (already addressed by §2),
  not by which model is writing it.
- Given §1–§3 already solve the perceived-latency problem, the marginal
  benefit here is low and the quality risk is real.

### 5. Considered and resolved as already-solved: merging the two AI calls / starting generation earlier

The original framing — eliminate the "second slow call after Save" — is
already eliminated by §1+§3: Save no longer triggers a synchronous heavy
call at all, so there's nothing left to merge away.

A further refinement was discussed and explicitly **not adopted**: start
the full background generation at Send time (instead of waiting for the
Save click), so it has a head start and might already be complete by the
time the user clicks Save, occasionally skipping the notification step
entirely. Not adopted because:

- It would spend real AI cost on every actionable-looking reply, not just
  confirmed saves — works against the AI-cost/rate-limit constraint already
  identified as the real scaling limiter for this pilot.
- It needs real job-cancellation/staleness handling ("which attempt is
  still current") that doesn't exist given this project's fire-and-forget
  `after()` approach rather than a real job queue — genuine, non-trivial
  engineering surface area.
- It only optimizes a problem (perceived latency) that §1–§3 already fully
  solve; the sole payoff is occasionally skipping the notification step.
- **Logged as a future idea**, worth revisiting once the app has real
  background-job infrastructure and the cost/scale picture is different.

## Follow-up items surfaced, not part of this redesign

- Stuck `processing` document-extraction status — separate Documents
  extraction-pipeline investigation needed (also noted in
  `docs/planning/pilot-follow-up-todo.md`).
- Early-background-trigger idea from §5 — revisit once real background-job
  infrastructure exists.

## Open implementation decisions

- Exact sane ranges for the sleep/step/hydration deterministic checks.
- Exact `user_notifications` schema (structured field-reference shape).
- Exact scope-check and quick-apply prompt wording, including how it
  inherits the mandatory-review coupling rules.
- Nav placement and exact visual treatment for the notification badge and
  the ⚠ warning icon.
