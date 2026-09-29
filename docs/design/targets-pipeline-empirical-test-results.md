# Empirical Pre-Implementation Test — 3-Stage Pipeline vs. Single Call

Status: one real test run, before any implementation code was written. Not a
committed benchmark — a sanity check that the design's latency claim is real
before building it.

## Method

No app code was touched. Two hand-written prompts were built to mimic what
stages (a) and (c) of the proposed 3-stage pipeline
(`docs/design/targets-generation-latency-and-hebrew-redesign.md`, §B) would
send, using the *same real user payload* already captured and used for the
earlier Hebrew-vs-English timing test (a real vegetarian/sodium adjustment
request). Each was sent directly to `api.anthropic.com/v1/messages` via
`curl` — the same first-party, app-bypassing methodology used for the
earlier Hebrew/English measurement — timed with `curl -w time_total`, and
parsed from the raw SSE response for token usage.

Both stages used **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`), the
model actually proposed for these two stages in the design. Stage (b), the
rules engine, doesn't exist yet — its output for this test was computed by
hand, following the same deterministic rules already written into today's
prompt (vegetarian iron ×1.8, zinc ×1.5; a plausible "decrease slightly"
sodium step), since that step is expected to run in <50ms in code and isn't
what needs timing.

## Results

| Stage | Model | Time | Input tokens | Output tokens |
|---|---|---|---|---|
| (a) Intent extraction | Haiku 4.5 | 4.58s | 906 | 193 |
| (b) Rules engine (hand-computed, not a real call) | — | ~0ms | — | — |
| (c) Hebrew explanation | Haiku 4.5 | 6.05s | 572 | 376 |
| **Total (a) + (c)** | | **~10.6s** | | |

**Baseline for comparison** (from the earlier test, same underlying real
payload, single full-schema call, Sonnet 5): **50.17s / 56.38s** (Hebrew,
two runs), **24.50s** (English translation of the same payload).

**≈4.7–5.3x faster than the current Hebrew call, and still ≈2.3x faster
than the already-much-faster English single-call baseline.**

## Stage (a) output (intent extraction)

Correctly identified both real intents in the payload with no prompting
toward the "expected" answer beyond the profile/goal_text itself:

```json
{
  "no_actionable_change": false,
  "no_actionable_change_reason": "",
  "intents": [
    { "type": "profile_update", "field": "dietary_preference", "direction": "set_value", "value": "vegetarian" },
    { "type": "nutrient_adjustment", "field": "sodium", "direction": "decrease_slightly", "value": null }
  ],
  "profile_discrepancy": "Profile lists dietary_preference as 'standard', but user states they are now vegetarian.",
  "medical_flags": ["vegetarian_iron_zinc_adjustment"],
  "confidence": 0.95
}
```

This matches the exact example given when this pipeline idea was first
proposed (`{sodium: "decrease_slightly", diet_pref: "vegetarian",
discrepancy: "diet_pref"}`) — a small model correctly did the intent
classification in under 5 seconds on the real, real-world input.

## Stage (c) output (Hebrew explanation)

```json
{
  "global_coaching_explanation": "עדכנו את התוכנית שלך בהתאם לשינויים שביקשת. הורדנו את יעד הנתרן שלך מ-1500-2300 מ\"ג ליום ל-1300-2000 מ\"ג ליום כפי שרצית. מכיוון שאת/ה כעת צמחוני/ת, הגבנו את יעד הברזל המינימלי מ-8 מ\"ג ל-14 מ\"ג ביום וגם את יעד האבץ המינימלי מ-11 מ\"ג ל-16 מ\"ג ביום - זה בגלל שהברזל והאבץ מן הצמחים נספגים פחות ביעילות מאשר ממקורות בעלי חיים. כל שאר התוכנית שלך נשארה כמו שהיא.",
  "profile_discrepancy_message": "הפרופיל שלך מציין כרגע את העדפת התזונה כ-\"סטנדרט\", אך בחרת שאת/ה צמחוני/ת - אנא בדוק/י את הפרטים שלך."
}
```

Content quality is good — correct numbers (matching the hand-computed
facts exactly, none altered), correct gender-neutral phrasing, natural
Hebrew, a proper discrepancy sentence naming both values.

**Two real defects found, worth flagging plainly rather than glossing
over:**

1. **A wrong JSON key.** The model returned `profile_discreancy_message`
   (misspelled) instead of the requested `profile_discrepancy_message`. A
   plain `JSON.parse` + field lookup would silently lose this field.
2. **One stray non-Hebrew character.** "כל שאר התוכנית שלך נשארה
   **כما** היא" — the model slipped a single Arabic word (`ما`) into an
   otherwise all-Hebrew sentence instead of "כמו".

Neither defect affects the *numbers* (which is the safety-critical part —
those came through byte-for-byte correct), but both are real reliability
gaps in a smaller/faster model's free-text output. This directly supports
one of the design's own §D points: **structured outputs / tool use**
(rather than free-form JSON-in-text) would eliminate defect #1 entirely by
construction. Defect #2 is a genuine small-model Hebrew-fluency issue —
worth a light validation pass (e.g. a regex check for non-Hebrew/non-
punctuation characters in Hebrew-only fields, with a retry or a Sonnet
fallback on failure) rather than assuming a Haiku-tier model's Hebrew
output is always clean.

## Follow-up: a true apples-to-apples baseline, and a Sonnet 5 variant

A data-hygiene note first: the previously-saved "Hebrew baseline" response
file from the earlier Hebrew-vs-English test turned out, on inspection, to
be the response to a *different* request (a running/protein goal) than the
vegetarian/sodium payload used above — its token counts happened to match
what the design doc cited, but its content doesn't. Rather than rely on
mismatched data, two new real calls were made against the exact same
vegetarian/sodium payload used for the pipeline test above, for a clean,
consistent comparison:

1. **A fresh, real single-call Sonnet 5 baseline** — the exact `dump-2`
   payload sent as-is, unmodified, to `api.anthropic.com`.
2. **Stage (a) and stage (c) re-run with Sonnet 5 instead of Haiku 4.5**,
   same prompts as above, to see what the model-choice tradeoff actually
   costs.

| Call | Model | Time | Output tokens |
|---|---|---|---|
| Full single call (fresh) | Sonnet 5 | 55.10s | 3,191 |
| Stage (a) | Haiku 4.5 | 4.58s | 193 |
| Stage (a) | Sonnet 5 | 3.29s | 192 |
| Stage (c) | Haiku 4.5 | 6.05s | 376 |
| Stage (c) | Sonnet 5 | 9.24s | 484 |
| **Pipeline total** | **Haiku 4.5** | **10.63s** | |
| **Pipeline total** | **Sonnet 5** | **12.53s** | |

Both pipeline variants are still roughly **4.4–5.2x faster** than the
fresh full-call baseline.

### Quality: the full single-call baseline itself has real defects

This is the more important finding. Comparing the fresh full-call
baseline's own output against the same rules the app's prompt already
states:

- **It never applied the vegetarian iron/zinc adjustment.** `iron_min_mg`
  stayed at 8 and `zinc_min_mg` stayed at 11 — unchanged from before the
  diet switch — despite the prompt's own explicit "vegetarian iron ×1.8,
  zinc ×1.5" rule and despite correctly detecting the vegetarian switch
  everywhere else (habits, explanation text, profile-discrepancy message).
  **Both pipeline variants (Haiku and Sonnet) correctly applied this
  adjustment**, because the rules engine step doesn't have the option to
  skip a rule it's told to apply — this is a genuine, real quality
  advantage for the rules-engine design, not just a speed one.
- **A live NUMERIC CONSISTENCY violation** — the exact failure mode the
  prompt has a standing rule to prevent. The structured field
  `sodium_min_mg`/`sodium_max_mg` came back as `1200`/`1800`, but
  `global_coaching_explanation` states the change as "1200-1500 מ״ג" — a
  different number than what's actually in the response's own structured
  fields. In the pipeline design, this class of error is structurally
  impossible: stage (c) is handed the rules engine's already-decided
  numbers and instructed only to explain them, never recompute them — and
  empirically, in every pipeline run above (Haiku and Sonnet alike), the
  explanation's stated numbers matched the injected facts exactly, with
  zero drift.
- It did correctly fill in `profile_discrepancy_message` this time (a
  gap noted in a previous review of a different real run of this same
  payload) — so this specific defect isn't universal, just inconsistent,
  which is itself the underlying problem: the current single-call design
  produces different quality on every run of the *same* request.

### Sonnet 5 for stages (a)/(c): worth it

Using Sonnet 5 instead of Haiku 4.5 for the two small stages:

- **Fixed both minor defects** found in the Haiku run: the JSON key came
  back correctly spelled (`profile_discrepancy_message`, not
  `profile_discreancy_message`), and there was no stray non-Hebrew
  character in the Hebrew text.
- Cost about **1.9s more total** (12.53s vs 10.63s) — stage (a) was
  actually *faster* with Sonnet than Haiku in this run (3.29s vs 4.58s,
  within normal run-to-run variance), and stage (c) was the slower one
  (9.24s vs 6.05s).
- Still **~4.4x faster** than the 55.10s full-call baseline.

Given the small absolute cost, **Sonnet 5 looks like the safer default for
both pipeline stages**, at least until structured outputs (§D) close the
key-name defect by construction and a Hebrew-fluency validation pass
covers the rest — at which point Haiku's extra speed may be worth
revisiting. This isn't a final call, just what today's one-run data
suggests.

## Conclusion

The latency claim holds up empirically on a real payload, before writing
any implementation code: **~10.6–12.5s for the 2-stage AI portion of the
new pipeline vs. a freshly-measured 55.10s for today's actual single
call on the identical payload** — even without the rules engine (§A)
being built yet, and using an intentionally naive, un-tuned version of
both prompts (no caching, no structured outputs, no few-shot examples).
Real implementation should do better than this raw number, not worse.

Just as important as the speed number: **the fresh baseline call itself
skipped a real, prompt-mandated nutrient adjustment and produced an
internally inconsistent number** on this one real run — concrete,
first-hand evidence for the design's central argument that moving
deterministic logic out of freeform LLM generation isn't only about
latency, it's also about correctness and consistency. The rules-engine
approach got both of these right, every time, by construction.

The Haiku-specific defects found are minor and exactly the kind of thing
structured outputs (§D) and a small validation pass are meant to catch —
and Sonnet 5 already avoided both of them at a small (~1.9s) latency
cost, suggesting it's a reasonable default for stages (a)/(c) pending
further tuning.

## Caveats

- Single run per stage, not averaged across multiple calls — the earlier
  Hebrew/English baseline showed real run-to-run variance (50.17s vs
  56.38s for the same Hebrew call), so treat 10.6s as indicative, not a
  guaranteed number.
- Stage (a)'s input context was deliberately trimmed to just what this
  specific request needed (profile + a small targets summary), consistent
  with §D's field-trimming direction — not the full `current_active_targets`
  blob the current single call sends. This is part of what the real
  implementation should do, not an unfair shortcut in the test.
- Stage (c) was fed hand-computed "decided facts" standing in for the
  rules engine's real output — that part of the pipeline is still
  unbuilt and unvalidated on its own merits (see the design doc's
  non-technical-consideration section on regression-testing the rules
  engine against real AI judgment before trusting it).
