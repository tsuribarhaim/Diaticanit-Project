# Targets Generation — Latency, Rules Engine & Hebrew Redesign

Status: gathering ideas, design not yet agreed, no implementation started.

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
