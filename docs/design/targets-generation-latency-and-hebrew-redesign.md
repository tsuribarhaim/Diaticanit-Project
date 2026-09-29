# Targets Generation — Latency, Rules Engine & Hebrew Redesign

Status: implementation started (2026-09-28). The rules engine, stage (a)
intent-extraction, and stage (c) explanation modules exist and are
live-verified end to end against real Sonnet 5 calls, but are NOT wired
into `generateTargetsWithAi`'s live call path yet - see "Implementation
progress" near the end of this document for exactly what's built, what
was deliberately narrowed from the original plan, and what's still ahead.

Related: `docs/design/targets-save-performance-redesign.md` (the earlier
redesign — quick-apply for literal asks, background full regeneration via
`after()`, notifications). That redesign addressed *when* the heavy call
runs (moved off the critical path) and *how much of the schema* it
regenerates for narrow asks (§2, scoped fields). This document addresses a
different, complementary question: **why the heavy call itself is slow**,
and what to do about it — whether it runs in the foreground or the
background, a slow full-regeneration call is still real AI cost, still
something a background-check notification is waiting on, and still the
thing a support/debugging session has to reason about.

## Problem recap

`generateTargetsWithAi` (`lib/ai/targets.ts`) makes one large AI call that
regenerates the *entire* ~40-field target schema (macros, micros,
exercise plan, habits, custom targets, rationale text) as structured JSON,
with an 8,192-token output budget and a 90s timeout because it has been
observed taking up to ~48–56s.

## New measurements this round

Using the app's real API key/model/payload, called directly against
`api.anthropic.com` (bypassing the app) for a clean reference measurement,
cross-checked against an in-app `Date.now()` measurement on the same code
path:

| Variant | Wall time | Output tokens | Input tokens | Output chars |
|---|---|---|---|---|
| Hebrew (real payload) | 50.17s (one run), 56.38s (second run) | 3,027 | 10,908 | 4,964 |
| English (same payload, translated) | 24.50s | 2,489 | 9,803 | 6,142 |

**Finding:** Hebrew needs ~22% more output tokens to produce *less* actual
content (4,964 vs 6,142 chars) than English does, and the wall-time ratio
(~2.05x) is larger than the token-count ratio (~1.22x) alone would
predict — there appears to be an additional per-token throughput penalty
for Hebrew generation on top of the raw token-count effect.

*Correction noted during the follow-up empirical test below: the saved
Hebrew response used for this row's char/token counts was later found to
be from a different real request than the English row (matching token
counts, mismatched content — a data-hygiene slip, not a re-run). The wall
time and token-count *order of magnitude* are corroborated by a fresh,
same-payload, apples-to-apples baseline run in
`targets-pipeline-empirical-test-results.md` (55.10s, 3,191 output tokens
for the true matching Hebrew request), so the core finding stands; treat
the exact 4,964/6,142 char figures above as indicative rather than a
verified same-request pair.*

**User's own real-world comparisons**, same payload, different tools:
Gemini 2.5 Flash ≈15s (cellular network); Claude Opus 5.5 (medium
reasoning effort) ≈44s — consistent with our own measured Sonnet timing,
confirming the ~90s transaction is dominated by one big, mostly-Hebrew,
mostly-model-reasoned call, not by multiple sequential calls or by
account-specific network conditions.

**Gemini 2.5 Flash quality check**, output reviewed against the actual
prompt/schema on the same real payload: missed the required
`profile_discrepancy_message` (left empty despite an explicit
vegetarian-vs-profile mismatch); made a genuine factual error, confusing
the current (Sept 2026) medical document context with an unrelated old
2022 reference embedded elsewhere in the prompt, and as a result did not
lower `added_sugar_max_g` the way Claude correctly did; did not raise
iron/zinc minimums for the new vegetarian diet the way Claude did. Gemini
*did* correctly keep `unit` tokens in English/ASCII on `user_targets`,
where Claude Opus drifted into Hebrew text there — a real, separate,
smaller quality gap on Claude's side. Net: meaningfully faster, but not
presently a safe drop-in replacement for a task with real medical-safety
implications.

## Proposed direction (four complementary changes)

### A. Deterministic rules engine for numeric/rule-based logic

Move everything that is arithmetic-with-lookup-tables, not judgment, out
of the LLM and into code:

- DRI baselines by age/sex.
- BMI-based adjustments.
- Condition tightening (hypertension → sodium; diabetes → sugar; etc.).
- Vegetarian iron ×1.8, zinc ×1.5.
- The three standing `user_targets` (`target_weight`, `sleep_hours`,
  `daily_steps`) — their exact default formulas are *already* spelled out
  as literal arithmetic in the current prompt text (weight ±5%, sleep
  7–9h, steps 7–10k by activity level). The model is today just executing
  known arithmetic by hand; this is the lowest-risk, highest-confidence
  first cut.
- Unit reconciliation of logged values against a stored unit — mostly
  pattern-matchable (magnitude comparison), a small residual of genuine
  ambiguity likely remains.
- min ≤ max sanity checks.

**Benefit beyond speed:** determinism and auditability for medical-facing
numbers, and it structurally retires the prompt's "NUMERIC CONSISTENCY"
rule — there's nothing to keep in sync once there's a single source of
numbers.

**Real dependency:** the rules engine's determinism depends on clean,
structured *inputs*. `medical_conditions_details` is currently free text;
"does this count as hypertension for the tightening rule" still needs a
classification step before a table lookup applies. That classification is
exactly what stage (a) of the pipeline below can produce as one of its
diff fields — this isn't a blocker, but the rules engine is not
standalone without the pipeline that feeds it clean inputs.

**Scope/maintenance note:** the current prompt has an open-ended "any
other stated condition with an established dietary implication" fallback.
Porting that to a rules engine means an ongoing, growing
condition→tightening table, not a one-time port — a real maintenance
investment, best framed as a versioned, reviewable data artifact (so a
non-engineer, e.g. a nutrition consultant, can audit/adjust the numbers)
rather than opaque code.

### B. Three-stage pipeline

1. **Intent extraction** (originally proposed as Haiku 4.5 or similar
   small/fast model; confirmed as Sonnet 5 per decision #5 below, based on
   the empirical test's quality/latency tradeoff):
   `goal_text` + profile in, a tiny structured diff out — e.g.
   `{sodium: "decrease_slightly", diet_pref: "vegetarian", discrepancy:
   "diet_pref"}`. ~1–1.5s.
2. **Rules engine** applies the diff, runs the safety/BMI reviews (see
   §A), produces the full plan. <50ms.
3. **Explanation**: one short LLM call turning the computed diff into
   3–5 Hebrew sentences (~1.5–2s) — or, per the user's own suggestion,
   templates per change type with the LLM only writing a connecting
   sentence (cheaper and more predictable still; worth including as an
   explicit option, not just a fallback).

Total ≈3–4s versus today's ~50s, with the user only seeing the plan once
it's complete and validated.

This is assessed as the single highest-leverage idea in this document,
because it directly shrinks the AI's *output* — the same lever the
Hebrew/English measurement just proved dominates wall time — from a full
40+-field JSON blob (2,500–3,000+ output tokens) down to a tiny diff (tens
to ~150 tokens) plus a short explanation (a few hundred tokens).

It's also not a novel pattern for this codebase: `classifyTargetsQuickApply`
(`lib/ai/targets-quick-apply.ts`) already does a small, fast
classification call ahead of the heavy pass, today only to pick
fast-vs-slow path. This pipeline deepens that same idea into actually
driving the computation, rather than introducing a new architectural
shape.

**Main open risk — coverage.** The diff schema needs to be expressive
enough for the real range of user requests. Needs a hybrid: fast path
when the diff schema covers the intent; fall back to the existing
heavier freeform path when it doesn't (an ambiguous ask, a new medical
condition, anything that would trigger one of the existing "mandatory
review" rules per the earlier redesign's §2 caveat) — never force a
narrow/fast path when in doubt, same principle the earlier redesign
already established for scoped regeneration.

**Model-sizing principle, stated generally, not just for stage (a):**
match model size/cost to each stage's actual complexity. Stage (c)
(explanation) is also a plausible candidate for a smaller/faster model
than the main plan-generation call — Hebrew-quality style rules (e.g.
gender-neutral phrasing) still need to carry over, but the task itself
("turn this small structured diff into a few sentences") is much narrower
than full plan generation.

### C. Structured medical-document findings at upload time

Today, document extraction summaries just say a marker is "out of range,"
with no direction (high/low) or severity — forcing every targets call to
hedge and reason about it fresh. Upgrading extraction to produce
structured findings (`{marker, value, unit, reference_range, direction,
severity, date}`) moves that reasoning from "every targets-update call"
to "once, asynchronously, at upload time" (already off the user-facing
critical path). The rules engine can then judge date-based staleness
deterministically instead of the model reasoning about it per-request,
and stage (a)/(c) above get an easier, more reliable job since they're no
longer interpreting ambiguous prose.

### D. Cut input latency and trim the payload

- **Structured outputs / tool use** — removes JSON-parse-failure retries
  (reliability + minor latency win).
- **Cached system prompt** — the static-rules portion of the prompt is a
  good caching candidate, and gets smaller once §A absorbs most of the
  deterministic content, making it an even better one.
- **Field-trimming audit, concrete opportunities found:**
  - Once document staleness is judged in code (§C), stale/irrelevant
    document summaries can be filtered out of the prompt entirely
    instead of sent and reasoned about every call.
  - The full `current_active_targets` JSON — all 40+ fields *plus* the
    entire previous free-text explanation (`aiRationaleExplanation`) — is
    resent every call. A rules-engine-driven "carry forward anything the
    diff doesn't touch" design (§A/§B) lets the model's own context
    shrink to just what's relevant to the current request. The prior
    `aiRationaleExplanation` in particular looks like a display-only field
    that likely doesn't need to be replayed back to the model at all —
    worth confirming during implementation, not assumed here.

## Hebrew rendering architecture (response to the translate-and-back suggestion)

Responding directly to the suggestion of translating the request to
English internally and translating the response back to Hebrew:

Agreed in spirit that English-side processing should be authoritative and
cheap, but recommend **not** framing it as a translate/back-translate
round trip on every call. Concretely:

- **English as the canonical stored representation** for
  `current_active_targets`, not a per-call translation. Hebrew free text
  currently compounds across turns by being fed back as context on every
  future adjustment (see §D) — storing English canonically avoids that
  compounding and avoids re-translating the same content repeatedly.
- **Cache English versions of medical-document summaries** at the
  upload/extraction step (§C), rather than translating them inside every
  targets call.
- **Skip AI-driven localization entirely for strictly-enumerable fields**
  (`unit`, `modality`, `goal_type`) — a static app-side lookup table is
  zero-latency, zero-cost, perfectly consistent, and incidentally fixes
  the separately-observed bug where Claude Opus drifts into Hebrew text
  for `unit` values that are supposed to stay ASCII.
- **A separate, smaller/faster model for the actual Hebrew-rendering
  step** (Haiku-tier, not a generic translation API and not the same
  heavy Sonnet call), carrying forward the app's existing tuned Hebrew
  style rules (gender-neutral second-person phrasing, etc.). This is
  effectively stage (c) of §B — one pipeline covers both the
  "shrink the output" goal and the "make Hebrew cheap" goal, rather than
  needing two separate mechanisms.

Estimated combined latency with this direction: roughly 25–35s if done as
a single still-large call in English then rendered, or roughly 3–4s under
the full §B pipeline (which subsumes this). The pipeline in §B is the
better target to build toward; this section exists to answer the
Hebrew-specific question on its own in case the fuller pipeline is staged
in later.

**Real risks, flagged rather than glossed over:**

- Two-call orchestration adds failure-handling surface (what happens if
  stage (c) fails after stage (a)/(b) already succeeded — likely: show
  the plan with a generic/templated explanation rather than blocking the
  whole save on a cosmetic-text failure).
- Needs a programmatic numeric-fidelity guard so a rendering/translation
  pass can never silently alter a number, id, or enum — the rendering
  step should only ever be allowed to touch free-text fields.
- **Migration question, not yet answered:** existing users' already-saved
  plans have Hebrew-only free text in stored fields like
  `aiRationaleExplanation`. Backfilling an English canonical version of
  those, or accepting mixed old/new records, is an open decision.
- **Open product question, not yet decided:** `search_keywords` are
  literal YouTube search phrases, not explanatory prose — whether those
  should stay Hebrew or move to English is a separate product call from
  the canonical-storage-language question, and hasn't been made either
  way yet.

## A non-technical consideration, stated plainly

This redesign touches core medical/safety decision logic (BMI safety
review, condition-based tightening, medical/allergy/dietary safety
review) currently handled by flexible LLM judgment. Moving that logic
into a fixed rules table is a real responsibility shift, not just an
engineering optimization, and deserves real scrutiny before being trusted
as sole source of truth — e.g. a regression-test suite comparing
old AI-driven outputs against new rules-engine outputs across many
synthetic profiles/conditions before this replaces the model's judgment
in production for real users.

## Sequencing

Per the user's explicit instruction, this document is a **gathering**
pass — no implementation should start until this is reviewed and a final
direction is agreed, at which point the pieces above (rules engine,
pipeline stages, document-extraction upgrade, Hebrew rendering, prompt
trimming/caching) should be implemented together as one pass, not
piecemeal.

## Decisions (confirmed by the user, 2026-09-28)

1. **Overall direction confirmed.** Additionally: any Hebrew text that
   originates from the *user* (not just AI-generated text) and ends up
   stored in a structured table should also be translated and stored in
   English — the canonical-English-storage principle applies to
   user-provided free text as well as AI output, not only to
   `aiRationaleExplanation`-style AI text.
2. **`search_keywords` moves to English**, regardless of the rest of this
   redesign's sequencing.
3. **Rules-engine table does not need non-engineer auditability** —
   "not too much if at all." Build it as reviewable code (clear naming,
   comments, tests), not as a separate exported/editable data format —
   that extra structure isn't worth the investment right now.
4. **Backfill all existing users' Hebrew-only stored plan text to
   English** rather than leaving mixed old/new records.
5. **Use Sonnet 5, not Haiku 4.5, for pipeline stages (a) and (c).**
   Per the empirical test (`targets-pipeline-empirical-test-results.md`),
   Sonnet fixed both minor defects found in Haiku's output (a misspelled
   JSON key, one stray non-Hebrew character) for only ~1.9s more total
   latency, while still running ~4.4x faster than the single-call
   baseline. Haiku may be worth revisiting later once structured outputs
   and a Hebrew-fluency validation pass are in place.
6. **Keep the existing single-call path available as a fallback,
   potentially run in the background even when the fast path serves the
   user** — not just as the "rules engine doesn't have coverage" escape
   hatch already described in the rollout plan, but as an ongoing option
   to get a full, independently-generated response for comparison/audit
   purposes after the fact. Exact mechanism (always-on shadow run vs.
   sampled vs. only during the initial rollout window) is not decided
   yet — to be settled when rollout is actually implemented, not before.

## Empirical validation (done, before any implementation code)

Before writing any real code, the 3-stage pipeline's core latency claim
was tested for real: stage (a) and stage (c) prompts were hand-built from
this design and sent directly to the Anthropic API (bypassing the app
entirely) against the same real user payload already used for the
Hebrew/English baseline, and timed the same way. Full writeup, raw
outputs, and caveats: `docs/design/targets-pipeline-empirical-test-results.md`.

**Result: (a) 4.58s + (c) 6.05s ≈ 10.6s total, versus the measured 50.17–
56.38s single-call Hebrew baseline (≈4.7–5.3x faster), using an
intentionally un-tuned first attempt** (no caching, no structured outputs,
no few-shot examples, rules engine not yet built). Two minor defects were
also found (a misspelled JSON key, one stray non-Hebrew character in an
otherwise-Hebrew sentence) — both are exactly the class of problem §D's
structured-outputs recommendation exists to close, not a reason to doubt
the direction.

This confirms the direction is worth implementing.

## Implementation plan

**Guiding constraint: zero change to business logic or to the existing
data contract for anything the new path handles.** Concretely:

- Every existing consumer of a target plan (`TargetsPlanEditor`, Daily
  Report's custom-target logging, notifications, the diff table) keeps
  reading the exact same shape it reads today, in the exact same
  (localized) language it reads today. Nothing downstream needs to change.
- The rules engine (§A) is a **literal port** of the deterministic
  formulas already written into today's prompt (DRI baselines, BMI
  adjustment, condition tightening, vegetarian ×1.8/×1.5, the three
  standing `user_targets` defaults) — not a reinterpretation. Where the
  current prompt's wording is ambiguous, the port keeps today's actual
  observed behavior, not a "more correct" guess.
- The new path is only *ever taken* when the rules engine has full,
  confident coverage of the request; anything it doesn't recognize falls
  back to the existing single-call full-schema path, unchanged. The new
  path can only make things faster, never different, for the cases it
  declines.

### 1. New modules (all additive, nothing existing modified until step 5)

- `lib/ai/targets-rules-engine.ts` — pure, synchronous functions: DRI
  baseline lookup, BMI-based calorie/protein adjustment, condition
  tightening table, vegetarian/vegan multiplier, standing-target defaults,
  min≤max guard, unit reconciliation. Fully unit-testable with no network
  calls.
- `lib/ai/targets-intent-extraction.ts` — stage (a): builds the trimmed
  prompt (profile + goal_text + the specific current-target fields the
  request could plausibly touch, not the full blob), calls **Sonnet 5**
  (per decision #5 above) with **structured outputs / tool use** (closing
  empirical defect #1 above by construction), returns the typed
  intent-diff.
- `lib/ai/targets-explanation.ts` — stage (c): given the rules engine's
  computed facts, calls **Sonnet 5** for the localized free-text fields
  (`global_coaching_explanation`, `profile_discrepancy_message`, and — for
  habit/exercise entries touched by the diff — either a template-plus-
  connector sentence per the user's own suggestion, or a short LLM pass;
  template-first is the recommended default since it's both cheaper and
  immune to defect #2 above).
- `lib/ai/targets-static-lookups.ts` — hand-authored EN/HE tables for
  `unit`, `modality`, `goal_type`, and any other closed-enum field. Zero
  latency, zero AI cost, and removes Claude's observed Hebrew-unit-string
  drift entirely for these fields.

### 2. Orchestration change (`generateTargetsWithAi`, `lib/ai/targets.ts`)

1. Run stage (a).
2. If `no_actionable_change`, or if any intent/medical_flag isn't one the
   rules engine declares support for, or confidence is below a threshold
   (start conservative, e.g. 0.85) → **fall back to today's existing
   single full-schema call, byte-for-byte unchanged.** This is the safety
   valve: the new path only ever activates on cases it's confident about.
3. Otherwise: run the rules engine (§A) synchronously to get every numeric
   field. Run stage (c) for the free-text fields the diff actually
   touched; carry forward everything else from `current_active_targets`
   unchanged (this is also where the §D field-trimming — not resending
   the full prior plan and its old rationale text as context — actually
   pays off).
4. Assemble the same `TargetsAiResult` shape the full call produces today.
   From this point on, save/validation/display code paths are identical
   to today's — this is the seam that guarantees "no impact on business
   logic."

### 3. Canonical-English storage (additive, not a replacement)

To avoid changing the existing stored/display data at all, canonical
English facts are stored **alongside** today's localized fields, not
instead of them:

- New nullable JSONB column on the active `user_target_profiles` row (and
  its historical rows), e.g. `canonical_facts_en`, holding the
  machine-oriented English facts (the rules engine's computed numbers +
  a short English gloss of the reasoning) that future adjustment calls
  read as context — instead of re-parsing a prior Hebrew paragraph.
- Existing localized columns (`ai_rationale_explanation`, habit text,
  `user_targets` label/value, etc.) keep being written exactly as today,
  in the user's language — no consumer, migration, or display code needs
  to change.
- This directly implements the "translate and store user-provided Hebrew
  too" decision above: any free-text user input that ends up in a
  structured field (e.g. a typed habit note) gets an English counterpart
  written to the same canonical column, not a special case.

### 4. Backfill (per the "backfill all" decision)

One-off, off-critical-path batch script (mirrors the pattern already used
for the Targets-page standing-card backfill): for every
`user_target_profile` row (active and historical, since old rows may
still be read as context on some paths), populate `canonical_facts_en`:

- Numeric fields copy directly — no AI needed, they're already numbers.
- Free-text fields (the old `aiRationaleExplanation`, habit rationale,
  etc.) get a one-time Haiku translation pass to produce the English
  gloss. Cheap, asynchronous, batched, and never blocks a real user
  request — purely populates context for *future* calls.
- Idempotent (skips rows that already have it), dry-run first against
  staging with output reviewed before running for real, same discipline
  used for every prior backfill in this project.

### 5. Rollout — shadow mode before it ever serves a real user

1. **Shadow mode**: for every real targets-update request, run *both*
   paths — serve the existing single-call result as today, but also run
   the new pipeline in the background (via the same `after()` mechanism
   already used for the background full check) and log a structured diff
   between the two outputs (not just text — a real field-by-field
   comparison) without showing anything to the user. Run this for a
   real, meaningful sample of live traffic.
2. **Regression corpus**: build a fixed set of synthetic profiles/requests
   spanning the safety-relevant cases (hypertension, diabetes, vegetarian/
   vegan, underweight/overweight BMI, multiple stacked conditions) and
   assert the rules engine's output matches today's AI judgment on each —
   this is the "real scrutiny" the non-technical-consideration section
   above calls for, made concrete.
3. Only after shadow-mode data and the regression corpus both look right:
   flip the new path on for a small percentage of real traffic (feature
   flag, easy rollback), then ramp up.
4. Old single-call path stays in the codebase indefinitely as the
   fallback for anything outside rules-engine coverage — it never gets
   deleted, only used less.

### Explicit non-goals for this implementation

- No change to what fields exist, what ranges are considered safe, or how
  the app displays a plan — this is a latency/architecture project, not a
  product-behavior project.
- No change to the standalone quick-apply / background-check / diff-table
  flow from `targets-save-performance-redesign.md` — this plan operates
  *inside* whichever call that flow was already going to make (foreground
  or background), it doesn't change when that flow decides to call it.
- `search_keywords` moving to English (decision #2 above) is a small,
  independent change to the output-language rule for that one field —
  worth landing early, standalone, since it needs none of the pipeline
  work above.

## Implementation progress (2026-09-28)

Built so far, all additive and none of it wired into any live request path
yet (see "Not done yet" below):

- `lib/ai/targets-rules-engine.ts` — the deterministic engine (§A/step 2).
- `lib/ai/targets-intent-extraction.ts` — stage (a), using Sonnet 5 with
  Anthropic tool-use for a schema-conformant structured diff.
- `lib/ai/targets-explanation.ts` — stage (c), same model/mechanism.
- `lib/ai/targets-fast-path.ts` — ties the three together
  (`tryFastPathTargetsAdjustment`).
- `lib/ai/provider-client.ts` — gained Anthropic tool-use support (a
  `tool` param forcing a single required tool call instead of free-form
  JSON-in-text), closing the misspelled-JSON-key defect found during the
  empirical test.
- `lib/targets.ts` — refactored (no behavior change) to export
  `CONDITION_TIGHTENING`, `DEFAULT_SODIUM_RANGE`,
  `DEFAULT_ADDED_SUGAR_MAX_G`, and `computeStandingUserTargets`, so the
  existing heuristic generator and the new rules engine share one source
  of truth for these numbers instead of duplicating them.

### A real scope correction found while building

While extracting the deterministic pieces, a discrepancy turned up between
this document's earlier framing and what the app actually does: **there is
no vegetarian iron ×1.8 / zinc ×1.5 rule anywhere in this codebase** —
not in the AI prompt (checked directly), not in the existing heuristic
generator (`lib/targets.ts`, which does have DRI-style iron/zinc logic,
but only adjusts for sex/pregnancy, never diet). That multiplier was
introduced by this document's own earlier empirical test as a hand-picked,
plausible-sounding stand-in fact fed to stage (c) to validate the
*pipeline's* latency and numeric-fidelity properties — it was never a
verified existing rule, and the test's writeup didn't flag that
distinction clearly enough at the time.

Given the "zero impact on business logic" constraint decision-makers
agreed to, **v1's rules engine does not add this or any other new medical/
nutrition rule.** It only claims coverage for requests that already have a
real, existing, verifiable deterministic rule:

1. Hypertension → sodium 1,200–1,500mg, diabetes → added sugar ≤15g (both
   already existed in the heuristic generator, now shared code).
2. The three standing `user_targets` defaults (weight/sleep/steps).
3. A literal, explicit numeric ask (an exact min/max, or a stated
   weight-loss/gain amount with a duration) — reusing the app's own
   existing `evaluateTargetWeightSafety` check.

Everything else — vague/qualitative asks ("lower it a bit"), a bare
"profile changed, please recalculate" note, a new stated medical
condition/allergy/dietary-preference change, the AI prompt's MANDATORY BMI
SAFETY REVIEW (raising/lowering calories for an out-of-healthy-range
current BMI — no deterministic version of this exists yet anywhere), or
low intent-extraction confidence — **declines coverage and falls back to
the existing full-call path**, unchanged from today's behavior. This is a
real, deliberate narrowing of what the fast path covers in v1 versus the
document's earlier framing, not a reduction in ambition — a wrong
"covered: true" on medical-adjacent data would be a real regression, not
just a missed optimization, so the boundary defaults to caution.

A found-and-fixed bug during this same smoke-testing pass, worth recording
since it's the kind of thing the later regression corpus should guard
against: the first version of stage (a)'s prompt set `no_actionable_change
= true` for both a bare "recalculate" note and a vague qualitative ask —
conflating "no literal number for the fast path" with "genuinely nothing
to act on." Fixed by narrowing `no_actionable_change` to true off-topic/
small-talk cases only, and routing every other under-specified case
through a low confidence score instead, which correctly falls back to the
full path via the existing confidence gate.

### Live verification (real Sonnet 5 calls, via a temporary diagnostic
route, deleted immediately after)

| Scenario | Outcome | Time |
|---|---|---|
| "Set my sodium max target to 1800mg" | applied, sodium 1500→1800 (min carried forward), explanation numerically exact | ~5–8s |
| "I want to lose 4kg over the next 60 days" | applied, target weight 63.5→59.5kg, calories 2200-2500→1737-1937 (exact deficit-formula match) | ~5–7s |
| "profile changed, please recalculate" (bare) | correctly declined (low confidence) → falls back to full path | ~2s to decline |
| "אני רוצה להוריד קצת את יעד הנתרן שלי" (vague) | correctly declined (low confidence) → falls back to full path | ~2s to decline |

All four match the intended v1 scope exactly. `tsc --noEmit` and `eslint`
are clean across the whole app.

### Shadow mode wired in (2026-09-28, follow-up)

Per the rollout plan's step 1, `generateTargetsPayload` (`targets/actions.ts`
— the one chokepoint every real caller, both the explicit generate/
regenerate action and the background profile-change check, already goes
through) now optionally runs the fast path in the background purely for
comparison after a real full-call request completes:

- Gated behind `TARGETS_FAST_PATH_SHADOW=true`, unset (off) in every
  environment today — this is genuinely inert until a developer
  deliberately turns it on for local data collection.
- Runs via Next's `after()`, so it adds zero latency to the real request
  and can never affect the response — the real, full-call result is
  already decided and sent before the shadow run even starts.
- Every outcome (a match, a divergence, a decline, a no-op, or an error)
  is logged via `logServerError` under the `targets.fast_path_shadow`
  scope, with a full field-by-field diff (reusing the existing
  `computeTargetsDiff` util) when the fast path applied something.
- Live-verified end to end: the real response was confirmed unaffected
  (same source/value/timing) with the flag on, and a correctly-shaped
  comparison log appeared afterward. The one divergence surfaced in that
  test was traced to unrealistic synthetic test data (empty exercise/
  habits arrays), not a real fast-path defect — worth remembering when
  reading early shadow-mode data: don't trust a single run, and sanity-
  check any surprising divergence against how realistic the compared
  plan actually is.

To start collecting real shadow-mode data locally: set
`TARGETS_FAST_PATH_SHADOW=true` in `.env.local` and use the app normally
(any Targets adjustment) — comparisons will accumulate in the dev server's
console output under the `targets.fast_path_shadow` scope. Nothing about
this requires code changes or redeploying; it's a pure env-var flip.

### Real testing round + a real safety fix (2026-09-28, follow-up)

Two real bugs surfaced from the user's own live phone testing against
shadow mode (both fixed, both verified):

1. `computeTargetsDiff`'s user-target display doubled the unit suffix
   (e.g. "62 ק״ג ק״ג") whenever `value` already included it - which both
   the AI prompt's own convention and `computeStandingUserTargets`'s
   output do by design. Pre-existing bug (not introduced by this work),
   only surfaced once a fast-path-generated standing target flowed
   through this shared diff util. Fixed: only append the unit when it
   isn't already present in `value`.
2. A literal calorie-only ask ("set my calories to 2000") was silently
   applied as a zero-width min=max range with no cascading adjustment to
   carbs/fats, diverging from the full AI path (which proactively
   rebalances dependent macros). Fixed by excluding "calories" from the
   fast path's covered fields entirely - it now correctly declines and
   falls back to the full path.

Added a second flag, `TARGETS_FAST_PATH_SERVE` (separate from
`TARGETS_FAST_PATH_SHADOW`), so the fast path can actually be *served*
(not just logged) for dev-only end-to-end testing - see
`isTargetsFastPathServeEnabled`/the new block at the top of
`generateTargetsPayload`'s AI branch in `targets/actions.ts`. Falls
straight through to the exact same full-call code, unchanged, for
anything not covered or that errors.

With both flags on, ran a 13-scenario battery directly against the real
dev-testing account's real profile and real active target plan (read-only
- `tryFastPathTargetsAdjustment` called directly, nothing persisted),
covering literal asks across 6 different nutrients in both English and
Hebrew, weight-loss/gain asks, and the vague/bare-recalculate/off-topic/
multi-ask decline cases. All 13 behaved correctly (7 applied with
independently-verified-correct math, 5 declined appropriately, 1 correctly
flagged no_actionable_change) - **except one, a real, important safety
gap**: this account has diabetes on file, and "set my added sugar max to
20g" was silently applied, overriding the diabetes safety tightening
(15g cap) with zero review - condition tightening ran first in the
engine, then the explicit-intent loop unconditionally overwrote it.

**Fix:** there's a genuine, unresolved tension between "respect the
user's literal ask" (the rule `target_weight_kg` explicitly gets) and
"the safety review applies even when it isn't the explicit subject of the
request." The rules engine has no principled way to arbitrate that
itself, so it now **declines coverage** (falls back to the full AI path's
judgment) whenever an explicit sodium or added-sugar ask would loosen the
value past the hypertension/diabetes safety cap, rather than silently
picking a side. Applies symmetrically to both conditions. Re-verified:
the exact scenario now declines with a clear reason, and a full re-run of
all 13 scenarios shows no regressions.

This is exactly the category of finding the shadow-mode/serve-mode
testing infrastructure exists to catch before any real user could be
affected - worth remembering as a concrete argument for not skipping the
regression-corpus step before wider exposure, even in dev.

### 3-way production rollback switch (2026-09-29, follow-up)

Per the user's request, added `TARGETS_UPDATE_MODE` (defaults to
`full_ai` for any unset/unrecognized value) so production can be dialed
back a step at a time instead of an all-or-nothing switch:

- `full_ai` — today's exact behavior, unchanged. The safety net.
- `lang_only` — the same full call/schema/safety-review as `full_ai`,
  forced to generate in English, then a second call
  (`targets-translate.ts`) renders the free-text fields into the user's
  real locale. Intended to isolate just the Hebrew-generation-latency fix
  from the rules-engine changes.
- `full_change` — the complete pipeline already built and tested
  (`targets-fast-path.ts`), falling back to `full_ai` for anything it
  doesn't cover.

This replaces the earlier boolean `TARGETS_FAST_PATH_SERVE` flag
entirely (`full_change` mode supersedes it). `TARGETS_FAST_PATH_SHADOW`
stays as a separate, still-useful dev-testing tool, orthogonal to which
mode is actually serving.

**A real, somewhat disappointing finding from live-testing all three
modes against the same real request on the real dev-testing account:**
`lang_only` was NOT faster than `full_ai` for this real, content-rich
payload — **65.8s vs 25.1s**, the opposite of its intended purpose.
`full_change` stayed clearly fast (9.7s). All three produced the
identical, correct result (a literal potassium range change), so this is
purely a speed finding, not a correctness one.

**Why:** translating a full payload's worth of free text (multiple
exercise notes, up to 8 habits with instruction+rationale each, the
global explanation, user-target labels/values) turns out to require
producing nearly as much Hebrew output as the original generation would
have — the translation step pays close to the same Hebrew-output-
throughput cost the design's own earlier measurement found, *in addition
to* paying the English generation's own cost up front. The original
Hebrew-vs-English measurement this mode was built on measured a single
call's total output; it didn't account for translation-of-verbose-content
turning out to cost nearly as much as generation-of-that-same-content in
the target language.

**Open product question, not yet decided:** what to do with `lang_only`
given this. Options, not yet chosen between:
1. Keep it anyway as a middle rollback rung, accepting it isn't actually
   faster - it would still isolate "is the rules engine specifically the
   problem" from "is something about the language handling the problem,"
   which has diagnostic value independent of speed.
2. Shrink what `lang_only` translates - e.g. only translate fields that
   actually differ from `current_active_targets` (mirroring how the
   `full_change` pipeline's own stage (c) only explains a small decided
   diff) rather than the full payload's every free-text field regardless
   of whether it changed. This would meaningfully change the mode's
   design, moving it closer to `full_change`'s approach.
3. Drop `lang_only` and keep only the two proven rungs (`full_ai` safety
   net, `full_change` the real win) - simpler, but loses the "isolate the
   language fix from the rules-engine change" diagnostic value entirely.

### Option 2 measured (2026-09-29, follow-up)

Built `translateTargetsPayloadScoped` (`targets-translate.ts`) - same idea
as the full translation, but only translates entries that actually
changed vs. the prior plan (matched by modality for exercise, id for
habits/user_targets), reusing the prior plan's own already-localized text
for everything unchanged, instead of translating the full payload
regardless. Measured against the identical real request used for the
`full_ai`/`lang_only`/`full_change` comparison above:

| Approach | Time | Notes |
|---|---|---|
| `full_ai` (baseline) | 25.1s | Today's exact behavior |
| `lang_only`, naive full translation | 65.8s | Translates every free-text field regardless of change |
| `lang_only`, scoped translation | **33.3s** (18.6s English generation + 14.6s translation) | Only 1 of 14 translatable entries had actually changed (the explanation); the other 13 were correctly detected as unchanged and reused verbatim from the prior plan |
| `full_change` (for reference) | 9.7–10.0s | |

**Scoped translation roughly halves the naive approach's time (65.8s →
33.3s)**, confirming option 2's core idea works as intended - most of a
real adjustment genuinely only touches a small part of the plan, and not
re-translating the untouched 13/14 entries is real, measured savings.

**But it's still slower than just doing `full_ai` in Hebrew directly**
(33.3s vs 25.1s), because the English generation call itself (18.6s) is
now the dominant remaining cost, and that call is not meaningfully faster
than generating the same request directly in Hebrew was in this same test
(25.1s) - the earlier ~2x Hebrew/English penalty measurement doesn't
reproduce as reliably on every real request as the original controlled
test suggested; real-world run-to-run variance is substantial. Scoped
translation removes the *translation* overhead almost entirely, but
`lang_only`'s ceiling is fundamentally bounded by the cost of the
English-language full-schema call itself, which this option does nothing
to reduce - only `full_change`'s fundamentally smaller calls (a tiny
intent diff in, a short explanation out) address that.

**Implication for the three options above:** option 2 is real and roughly
doubles `lang_only`'s speed, but does not make `lang_only` reliably faster
than `full_ai` on real requests - so it improves `lang_only` without
fully solving the original problem it was meant to solve. This is
useful, real data for deciding between the three options, but doesn't
obviously settle the question on its own.

### `lang_only` dropped; full_ai-vs-full_change re-measured directly (2026-09-29, follow-up)

Given the above, the user decided to drop `lang_only` and asked what the
real timing impact looks like keeping only `full_ai` (direct Hebrew, as
today) and `full_change` (the rules-engine pipeline, which was already
generating its explanation directly in Hebrew all along - no English
round-trip in that pipeline to begin with, unlike `lang_only`). Measured
fresh, on four new real Hebrew/mixed-language requests against the same
real account, both modes back to back per request:

| Request | `full_ai` | `full_change` | Speedup |
|---|---|---|---|
| "At least 32g of fiber a day" (he) | 54.8s | 11.7s | **4.7x** |
| "Set my sodium max to 1650mg" (he) | 52.1s | 53.9s | **1.0x - declined, fell back** |
| "Set my calcium target 900-1100mg" (en) | 49.2s | 11.0s | **4.5x** |
| "Lose 2kg over the next 30 days" (he) | 53.8s | 57.7s | **1.0x - declined, fell back** |

Two of the four show a large, real 4.5-4.7x speedup. The other two show
**no improvement, not a bug** - both are the rules engine's safety guard
correctly engaging: the sodium ask (1650mg) exceeds this account's active
hypertension cap (1500mg, from `CONDITION_TIGHTENING`) so it declines per
the safety-conflict fix from earlier testing; the weight-loss ask
apparently pushes projected BMI into an unsafe zone, tripping
`evaluateTargetWeightSafety` the same way the full path's own independent
check would. In both cases `full_change` correctly falls back to the
exact same full call `full_ai` would have run - **never slower than
today's behavior, only ever faster when it's safely confident.**

**Practical implication:** real-world average speedup depends on how much
of actual traffic falls into safely-deterministic territory vs. genuinely
needing full review - not a single fixed multiplier. This is exactly what
the still-pending regression corpus and continued shadow-mode data
collection are for: getting a real sense of that mix before deciding how
much of production traffic could realistically benefit.

Also notable: `full_ai` itself ran 49-55s on these four requests, well
above the 24-25s seen on the earlier potassium request on this same
account - confirming (again) that the full call's own latency has real,
substantial request-to-request variance, not a fixed baseline.

**Decision:** `TARGETS_UPDATE_MODE` stays a 2-way effective choice in
practice (`full_ai`, `full_change`) - `lang_only` remains implemented in
code (harmless, unused) but is not a live rollout option going forward
unless revisited later.

### Not done yet

- **A real regression corpus** — the design's own bar for moving beyond
  shadow-mode data collection toward actually serving real users (per the
  rollout plan's step 2). Not started.
- Canonical-English storage, the backfill script, and the DB schema
  change (`canonical_facts_en`) — not started.
- `search_keywords` → English — not started (independent, could land
  separately at any time).
- BMI safety review coverage in the rules engine — explicitly out of
  scope for v1 (see the scope-correction section above); would need its
  own dedicated design/verification pass before being added.
- Actually flipping the fast path on for any real traffic (even a small
  percentage) — deliberately not done; per the rollout plan this needs
  real shadow-mode data plus the regression corpus reviewed first.
