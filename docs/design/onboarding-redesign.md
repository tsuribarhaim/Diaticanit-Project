# Onboarding Redesign — Design Document

Status: draft, for review — not yet approved for implementation.
Companion prototype: [Daffy Onboarding mockup](https://claude.ai/artifact/Dncz4ot6fSQUHKTnVCgwsv) (steps 1–2 layout/copy reference only — see §3 for where its field values diverge from the real schema, corrected below).

## 1. Why this exists

A new user today finishes signup, is force-redirected through profile
onboarding, and lands back on `/app` with no active target profile and
nothing pointing them toward Targets except a passive text hint —
"Lock in your daily targets first to see today's progress here," no
button, no link. Reaching Targets and actually setting them is entirely
self-directed. This is the real gap: **onboarding collects a full profile
and then abandons the user right before the one thing that makes the app
useful.**

## 2. Correction: most of this already exists

Before designing anything new, this session traced the actual current
onboarding implementation (`src/components/onboarding-profile-form.tsx`,
`src/app/app/onboarding/actions.ts`, `src/lib/profile.ts`) and found it is
**already a 4-step wizard** — not the single long form this redesign
initially assumed. It already has a "Step X of 4" label, a progress bar,
Back/Next navigation, per-step headings, a BMI graph, and real
server-side validation (including AI validation of free-text "other"
fields on submit). Earlier in this design conversation, last name and
date of birth were incorrectly described as new fields to add — they
already exist and are already required. "Physical target" turned out to
already exist too, as `nutritional_goal` — a 5-option field, not the
4-option `goalType` used elsewhere in targets generation (see §6.4, a
real open reconciliation question).

**The actual gap is narrower than originally scoped:**
- Onboarding stops at step 4 and redirects to `/app` with no targets set — no step 5+ exists.
- No step has a short description paragraph under its heading.
- No step besides step 1 has any "curiosity" visual.
- No medical document attachment exists anywhere in onboarding.
- Allergies is optional free text today, not mandatory-with-an-explicit-answer.
- A few of the mockup's option lists (exercise types, dietary preference) don't match the real enums — corrected in §3.

This document is written against the **real** field set. Treat it as the
source of truth over the mockup where the two disagree.

## 3. Steps 1–4: what exists today, and what changes

Each step below: current fields (exact, from `profile.ts`/the form), then
what this redesign changes about that step. Field names are the real
`user_profile` column names.

### Step 1 — "Identity & Vital Statistics" (keep title, add description)

| Field | Type / valid values | Required | Notes |
|---|---|---|---|
| `first_name` | text, 1–80 chars | Yes | |
| `last_name` | text, 1–80 chars | Yes | |
| `date_of_birth` | date (ISO `YYYY-MM-DD`) | Yes | Age computed server-side (`calculateAgeYears`), rejected if outside 0–120 |
| `biological_sex` | `male` \| `female` | Yes | Also mirrored into the legacy `gender` column automatically — no separate gender-identity field exists or is needed |
| `weight_kg` | number, 20–400 | Yes | Form offers a kg/lbs unit toggle |
| `height_cm` | number, 80–250 | Yes | Form offers a cm/ft-in unit toggle |
| BMI display | — | — | Already built: computed age + BMI value + gauge (bar with healthy-range band, marker, status message) |

**Changes for this redesign:** add a one-line description under the
heading (e.g. "A few basics so we can calculate your daily needs
accurately"). No field changes needed here at all — this step is done.

### Step 2 — "Lifestyle & Physical Activity" (keep title, add description)

| Field | Type / valid values | Required | Notes |
|---|---|---|---|
| `activity_level` | `sedentary` \| `moderate` \| `active` | Yes | Only 3 values — the mockup's 5-option list (sedentary/light/moderate/active/very_active) doesn't match; use these 3 |
| `exercise_modalities` | multi-select: `resistance_hypertrophy`, `endurance_cardio`, `martial_arts`, `other`, `none` | Yes, min 1 | **Not** the mockup's Walking/Running/Cycling/Swimming/Yoga chips — those don't exist as modality values. Broad categories, each with its own schedule. |
| `exercise_other_activities` | list of `{name (3–80 chars), days_per_week, minutes_per_session}`, max 10 | Only if `other` selected | This is the real mechanism for "type your own activity" — already built, already AI/format-validated |
| `exercise_schedule_by_modality` | `{days_per_week: 1–14, minutes_per_session: 1–600}` per selected modality (except `other`/`none`) | Yes, per selected modality | |
| `nutritional_goal` | **Decided: simplified to `weight_loss` \| `weight_gain` \| `maintain`** (was `maintenance` \| `weight_loss` \| `muscle_hypertrophy` \| `body_recomposition` \| `athletic_performance` - see §7.4 for the reasoning and the one-time backfill mapping for existing profiles) | Yes | This is "Physical target" / "מטרה תזונתית" — already collected here. The underweight cross-check (disabled/warned if a weight-loss-direction goal is selected while underweight) carries over unchanged. |

**Changes for this redesign:** add a description; correct the mockup's
exercise-preference chips to the real modality set with the real
per-modality scheduling UI (already built — reuse it, don't rebuild it
differently).

### Step 3 — "Medical & Physiological Status" (keep title, add description)

| Field | Type / valid values | Required | Notes |
|---|---|---|---|
| `pregnancy_lactation_status` | `none` \| `pregnant` \| `lactating` | Shown only if `biological_sex === "female"` | Not in the mockup at all — needs to stay, unchanged |
| `has_medical_conditions` | yes/no | Yes | Gates the next two fields |
| `medical_conditions` | multi-select: `celiac_disease`, `hypertension`, `kidney_renal_failure`, `diabetes`, `other`, `prefer_not_to_disclose` | If `has_medical_conditions = yes` | `prefer_not_to_disclose` can't combine with others |
| `medical_conditions_details` | text, max 250 chars, min 3 if shown | Only if `other` selected | AI-validated on submit (see §5) |
| `has_regular_medications` | yes/no | Yes | Gates the next field |
| `regular_medications_details` | text, max 2000 chars, min 3 if shown | If `has_regular_medications = yes` | AI-validated on submit |
| `hot_climate_or_heavy_sweating` | yes/no | Yes | Already required — matches the story's ask |
| `habits` | multi-select: `smoking_or_vaping`, `alcohol`, `none` | Yes | |
| `alcohol_consumption_level` | `low` \| `high` | If `alcohol` selected | **This is the "levels" the "?" should explain** — real copy: "Low consumption" / "High consumption" |
| `smoking_packs_per_day` | number, 0–20 (must be > 0) | If `smoking_or_vaping` selected | Numeric packs/day, not a level enum |

**Changes for this redesign:** add a description; add "?" tooltips next
to Smoking/Alcohol using the real copy above (not the mockup's
placeholder text) — done, this closes item 4 from the last mockup
feedback round precisely.

### Step 4 — "Dietary Profile & Context" (keep title, add description)

| Field | Type / valid values | Required | Notes |
|---|---|---|---|
| `dietary_preference` | `standard` \| `vegetarian` \| `vegan` \| `low_carb_keto` | Optional today | **Decided: add `kosher` and `gluten_free`** as new values (6 total). Pescatarian dropped — not requested. |
| `allergies` | free-text list (`string[]`), each entry validated (3–80 chars, keyword/near-match check) | Optional today | **Decided: make mandatory via a new `has_allergies: boolean` yes/no gate**, mirroring `has_medical_conditions`/`has_regular_medications` exactly - "No" is a real, valid answer; "Yes" requires at least one entry in `allergies` |
| `additional_information` | free text, max 1000 chars | Optional | Freeform notes, not otherwise categorized |
| `accept_ai_extraction` | checkbox | Yes (gates submit) | Consent text already exists: *"I agree to the transfer and storage of my health data with the AI provider for analysis purposes"* |
| Medical document attachment | — | — | **Does not exist today anywhere in onboarding.** New: add here, optional, feeding the same AI document-extraction pipeline Documents already uses elsewhere in the app |

**Changes for this redesign:** add a description; add `kosher` and
`gluten_free` to dietary preference; make allergies mandatory via a new
`has_allergies` gate; add medical document
attachment; this step's submit currently calls
`saveOnboardingProfileAction` directly with no confirmation step — that
now becomes "Next" into the new Targets step instead of a terminal
submit.

## 4. New: Targets Setting (step 5+)

This is genuinely new — no equivalent exists in onboarding today.

**Trigger.** As soon as step 4's data is valid (not necessarily waiting
for an explicit "submit" click — the moment the required fields are
filled), start the background generation call. This is purely to hide
latency: the user is still on step 4 confirming details, or in transit
to step 5, while the AI call is already running. No notification
involved anywhere in onboarding — this is a synchronous, in-flow wait,
never a "come back later" hand-off (explicitly ruled out for onboarding
specifically, unlike the post-onboarding Targets review flow).

**Display.** Each nutrient shown as one rounded **integer** value in a
table, ordered by priority (all 19 nutrients listed in §7.6, pending your
re-ordering). A "?" next
to each explains what it is. The underlying min/max range used to
compute the AI's target is **not shown** — it's retained purely as
internal data (see §5 for the storage question and its future use).
Below the nutrient table: the suggested exercise plan (modality,
frequency/week, duration per session) — this reuses the existing
`exerciseTargets` shape from `lib/targets.ts` directly, no new schema
needed there.

**Three additional standing targets** (explicit ask): **Weight**,
**Daily sleep time** (adjustable in 0.5-hour steps), and **Daily steps**
— suggested here alongside the nutrients, editable later the same way
(chat now, the new Targets page later). This is a real gap to close, not
just a display addition:

- **Weight** (`targetWeightKg`) already exists as a dedicated field and
  is already used for BMI/safety math - but has **no UI tile anywhere
  today**. Needs a real tile here, and needs to become a proper loggable
  entry (see below) so it tracks in Daily Report/Home the same way the
  other two do.
- **Sleep and steps have no dedicated fields at all** - both only exist
  via the generic loggable "custom target" mechanism
  (`userTargets: UserTargetEntry[]`), and **neither is generated by
  default today**. The AI only creates a sleep/steps entry if a user's
  free-text goal specifically asks for it (`lib/ai/targets.ts`) - the
  heuristic fallback never emits either one regardless of input. A
  brand-new onboarding user today would get neither unless they happened
  to type something like "improve my sleep." Making all three standing
  and suggested by default is a real change to both the AI prompt and
  the heuristic fallback, not just something to render.

For all three to behave like the rest of the app's loggable targets (a
numeric input in Daily Report, a progress ring on Home), they need the
full loggable shape already defined by `userTargetEntrySchema` -
`id`, `unit`, `targetMin`, `targetMax` all present (today's occasional
weight entry from the heuristic path only sets `label`/`value`, which
isn't loggable at all). Proposed: `id: "target_weight"` / `"sleep_hours"`
/ `"daily_steps"`, `higherIsBetter: true` for sleep and steps (matching
what the AI path already uses when it does generate them on request).

**Weight range - decided, and important: this is a rule, not a stored
number.** ±10% stays a *live percentage*, evaluated against whatever the
user's most recently reported weight is at the moment a check actually
happens - never baked into a fixed `targetMin`/`targetMax` pair at
generation time. Weight changes as the user logs it, and a frozen
min/max from onboarding day would silently go stale (and wrongly reject
or wrongly allow changes) the moment real weight starts moving, with
nothing re-deriving it. So weight does **not** get the same literal
`targetMin`/`targetMax`-as-stored-numbers treatment sleep/steps/nutrients
get - it needs its own small piece of logic that computes the effective
range on demand from (current known weight) × 1.1 / × 0.9, every time
it's checked, not a value read out of the row. "Current known weight" is
the most recent Daily Report weight log if one exists, falling back to
the profile's `weight_kg` (which is all that exists at onboarding time
itself, before any Daily Report entries do).

**All ranges are the same *mechanism*, even though weight's isn't a
stored number.** Every target's range - nutrients, sleep, steps, and
weight alike - exists for the same reason: it's the **system's own
deterministic validation gate**, checked *before* any AI involvement. A
user-requested change that lands inside the range applies immediately,
no AI call needed. A request outside it prompts a confirmation, and only
on confirming does it go to the AI for a real safety/impact check.
Nutrients/sleep/steps implement this by reading a stored `targetMin`/
`targetMax`; weight implements the identical *rule* by computing its
range live instead, for the staleness reason above. Same gate, same
user-facing behavior, one different (and, for weight, more correct)
implementation underneath.

**Negotiation.** A chat panel — branded "Daffy, your AI coach" per your
explicit direction — lets the user ask questions or request changes
before committing. Daffy should coach toward gradual, sustainable change
rather than large jumps, matching the story's "gradual targets to build
healthier habits over time." On mobile this is a floating bubble +
bottom sheet with New chat / Discard & close / Minimize controls
(prototyped); on desktop, an always-visible side panel with just a New
chat control.

**Completion.** A single primary action locks in the generated plan
(reusing the existing `performTargetsLock`/`lockTargetsAction` machinery
that already exists for the standalone Targets page) and redirects to
**`/app/daily-report`** (decided - not `/app`), so the very next thing a
new user sees is the screen they'll actually use day to day, not an
empty dashboard. There is no separate "discard" action here the way the
post-onboarding review flow has one — discarding a first plan mid-signup
doesn't have an obvious next step, so the negotiation chat is the
mechanism for changing it before locking in, not a discard button.

**Relationship to the standalone Targets page, and the old page's
retirement.** This isn't a one-off screen built only for onboarding - the
new, standalone Targets page (the ground-up redesign of `/app/targets`
already agreed separately) will present the exact same data the same way
: single integer values, the Daffy chat bubble, the same visual language
prototyped here. Onboarding's Targets step and the new Targets page are
one shared design, reached from two different entry points, not two
separate builds to maintain. Sequencing: build onboarding's Targets step
first (this document), then build the new standalone Targets page reusing
it, then - once both are live and working - **the current `/app/targets`
(`TargetsWorkspace`/`TargetsChatWorkspace`) is fully retired, not merely
kept as a fallback.** It stays around only as a temporary data-source
reference during that transition, exactly as already agreed when this
redesign started.

## 5. Data model changes needed

| Change | Why |
|---|---|
| `dietary_preference` enum: add `kosher` and `gluten_free` | Explicit ask - decided |
| Allergies: add a new `has_allergies: boolean` gate (decided - the yes/no pattern, not a sentinel value), mirroring how `has_medical_conditions`/`has_regular_medications` already work | Today's schema has no equivalent to `prefer_not_to_disclose` for allergies specifically — needed to make "must actively answer" real, not just a UI convention |
| Single-value nutrient target: **decided - no new column.** The range stays the primary, authoritative stored data (exactly as today); the single integer shown to the user is computed from it at render/display time (e.g. rounded midpoint), never stored separately. This also means the single value automatically stays consistent with the range if the range itself is ever recomputed - there's only one number to keep in sync. | No schema change needed for this specifically |
| `nutritional_goal`: **decided - simplify from 5 values to the shared 3** (`weight_loss`/`weight_gain`/`maintain`), the exact same set `TargetGoalType` already uses. Onboarding's goal question becomes a direct 3-way choice - no separate enum, no mapping step, no reconciliation needed going forward. `general` (the 4th `TargetGoalType` value) stays, used only outside onboarding. | Explicit ask - see §7.4 for the reasoning and the one-time backfill mapping for existing saved profiles |
| Weight, sleep, steps become standing, always-generated `userTargets` entries (`id: "target_weight"`/`"sleep_hours"`/`"daily_steps"`, full loggable shape - `unit`, `targetMin`, `targetMax` all present for sleep/steps) - no new column, but both the AI prompt (`lib/ai/targets.ts`) and the heuristic fallback (`generateHeuristicTargetProfile`) need to emit all three by default instead of only on explicit request. Weight is the one exception: no stored `targetMin`/`targetMax` - its ±10% range is computed live from the user's latest known weight wherever it's needed (see §4) | Explicit ask (§4) - today neither is generated unless a user's free-text goal happens to ask for it |

## 6. Interaction / click-case catalog

- **Back/Next per step (1–4):** already built, already validates on
  Next-click before advancing — no change needed to this mechanic.
- **"Other" free-text fields (medical condition, medication):** today's
  real behavior is **server-side AI validation on submit attempt**, not
  a live/inline check — if the AI finds it not relevant/clear, the step
  re-renders with a field error, a clarifying question, and up to 3
  suggested rewrites. The mockup showed a *live* inline "checking with
  AI…" indicator as you typed instead — a UX upgrade over today's
  submit-time-only pattern, not something broken. **Needs your call**:
  keep today's submit-time validation, or build the live version the
  mockup demonstrated (real latency/cost implications either way - see
  §7).
- **Document attachment (new):** tap/drop to attach, optional, one or
  more files; ties into the existing Documents AI-extraction pipeline.
- **Habit "?" tooltips (new):** static info only, no interaction beyond
  hover/tap-to-reveal - the actual level fields (alcohol level, smoking
  packs/day) already have their own dedicated inputs shown conditionally.
- **Targets step chat controls:** New chat (reset conversation), Discard
  & close (reset + minimize, mobile only), Minimize (mobile only,
  desktop panel can't be minimized), Send (submits a message, gets a
  reply). Prototyped in the mockup; carry the same control set over.
- **Complete onboarding (final action):** locks in the plan, no
  separate confirmation dialog, redirects to `/app`.

## 7. Open decisions (flagged throughout above, collected here)

1. ~~Dietary preference options~~ — **Resolved:** add `kosher` and
   `gluten_free` (6 total, Pescatarian dropped).
2. ~~Allergies "none" mechanism~~ — **Resolved:** new `has_allergies`
   boolean gate.
3. ~~Single-value nutrient target storage~~ — **Resolved:** computed at
   render time from the range; range stays the one stored, authoritative
   value.
4. ~~`nutritional_goal` ↔ `TargetGoalType` reconciliation~~ —
   **Resolved: collapse to just 3 shared values** - `weight_loss`,
   `weight_gain`, `maintain`. This eliminates the two-enum problem
   entirely rather than mapping between them: onboarding's goal question
   becomes a direct 3-button choice using these exact values (replacing
   the current 5-button `nutritional_goal` UI), and that's the same
   value `TargetGoalType` already expects - no translation step needed
   at all. Proposed default mapping for what the 5 old onboarding values
   would have meant, in case any of today's saved profiles need a
   one-time backfill: `maintenance`→`maintain`,
   `muscle_hypertrophy`→`weight_gain`, `body_recomposition`→`maintain`,
   `athletic_performance`→`maintain`.

   One nuance worth flagging: `TargetGoalType` has a 4th value,
   `general`, used outside onboarding - e.g. the heuristic fallback when
   a user's free-text adjustment request (via chat, post-onboarding)
   doesn't clearly state a direction. That path isn't part of this
   redesign and doesn't go away; `general` just stops being one of the
   choices offered *during onboarding specifically*, since onboarding
   will now always collect an explicit answer among the 3.

5. ~~"Other" field AI validation timing~~ — **Resolved: keep validation
   at Next-click (matches today's real behavior), not live/inline
   per-keystroke.** On Next, validate every relevant field on the
   current step at once; any field needing another look gets its label
   text turned red. Wherever a more specific reason is available (an
   AI-flagged "other" entry that didn't make sense, e.g. "Please type a
   valid exercise"), show that specific message instead of a generic
   "required" - reusing the existing AI-validation-on-submit mechanism
   (clarifying question + suggested rewrites) already built for the
   medical-condition/medication "other" fields, extended to the exercise
   "other" field's own free-text entry too.

6. **Resolved - full nutrient list below**, in today's arbitrary schema
   order; reorder as you like and send it back. Also logged as a
   follow-up: giving an admin a settings screen to reorder this list
   directly (rather than it living in code) - added to
   `docs/planning/pilot-follow-up-todo.md`.

   **Decided - your order** (top 10 explicit, remaining 9 kept in their
   original relative order after them):

   1. Calories
   2. Cholesterol
   3. Protein
   4. Fat
   5. Saturated fat
   6. Fiber
   7. Added sugar
   8. Magnesium
   9. Calcium
   10. Iron
   11. Carbohydrates
   12. Sodium
   13. Water
   14. Potassium
   15. Zinc
   16. Vitamin C
   17. Vitamin B12
   18. Vitamin D
   19. Omega-3

## 8. Performance strategy (120-second target)

The dominant risk is the AI target-generation call, measured at
20–90 seconds worst-case in this same app (see
`docs/design/targets-save-performance-redesign.md`). Mitigation:
starting generation the moment step 4's data is valid (§4) hides most of
this behind the time the user spends on step 4 itself and any transition
to step 5. If generation still hasn't finished by the time the user
reaches the Targets step, show the same honest "still working on it"
state already built for the post-onboarding review flow, not a
misleading instant result. Worth measuring real end-to-end onboarding
time once built, against the 120s target, before considering it done.

## 9. Suggested implementation phases

1. **Schema/enum changes** (§5) - `gluten_free`/`kosher`, `has_allergies`,
   `nutritional_goal` simplification + backfill, weight/sleep/steps
   default-generation logic. Small, low-risk, unblocks everything else.
2. **Enrich steps 1–4** - descriptions, document attachment, allergies
   made mandatory, corrected dietary-preference options. No new steps
   yet, existing users' data unaffected.
3. **Build the Targets step(s)** - background trigger, single+range
   display (19 nutrients + weight/sleep/steps), Daffy-branded chat,
   lock-in action. Reuses existing `performTargetsLock`/target-generation
   code wherever possible rather than duplicating it.
4. **Wire the redirect** - step 4 → Targets step → `/app/daily-report`,
   replacing today's step 4 → `/app` direct submit.
5. **Measure against the 120s target** on real accounts before calling
   this done.
6. **Build the standalone Targets page**, reusing the same
   design/component built in step 3 rather than a second, separate
   implementation (§4's "Relationship to the standalone Targets page").
7. **Retire the current `/app/targets`** (`TargetsWorkspace`/
   `TargetsChatWorkspace`) once steps 3 and 6 are both live and working -
   not kept indefinitely as a fallback, per the explicit decision this
   round. It stays only as a temporary reference during the transition.
