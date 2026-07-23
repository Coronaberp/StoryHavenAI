# Memory System + Prompt Layer — Design Proposal

Status: proposal for review. Thinking output per brief — no code, no final schema.
Grounded against the current implementation: `backend/retrieval.py` (per-turn
`_extract_turn_signal`), `backend/vectors.py` (flat-text session-scoped memory rows),
`backend/prompt.py` (`build_system` + `RPG_IMMERSION_PROMPT`), `backend/chat_service.py`
(`history_turns` raw-tail window).

## 0. Corrections to the "decisions already made" list

Three flags before the numbered questions, because they change the answers below.

**Flag A — the cut list contradicts the decay formula.** Decision 3's strength formula
includes `w_n·novelty`; decision 8 cuts novelty scoring. Drop novelty from `S`. But the
*reason* given for the cut ("needs a similarity query per write") cuts the wrong thing:
the similarity-query-per-write is mandatory anyway, because **dedup-on-write is the single
most load-bearing operation at 1.7k turns** (see §1). Cut the novelty score term, keep the
neighbor lookup. The brief's own cost hierarchy says retrieval compute is negligible —
that applies to the write-path lookup too.

**Flag B — active-immunity shouldn't be a decay carve-out** (see §2). It falls out of the
bi-temporal window for free. Decisions 1 and 3 are one mechanism, not two.

**Flag C — the participants hard filter needs two escape hatches or it eats valid
memories.** (a) World facts ("the mine collapsed") have no participants; a bare
`participants && :present` filter with an empty array silently excludes them forever.
World-scoped facts must be exempt from the filter, not given an empty participant list.
(b) Extraction will sometimes fail to attribute participants; the fail-safe default must
be `[user, char]` (fail-open for the main pair, fail-closed for NPCs — an NPC recalling a
scene they weren't in is the leak the decision guards against; the main character
forgetting a scene they were in is the product failure it exists to prevent).

One decision endorsed with emphasis: **bi-temporal over a boolean is correct**, and it's
also the growth-control mechanism, not just the arc-expression mechanism — closure is what
keeps "current state" queries returning one fact instead of twelve.

## 1. Where this breaks at 1.7k turns

Row count is not the problem. At extraction-every-5-turns producing 2–4 facts per batch,
1.7k turns ≈ 340 batches ≈ 700–1,400 facts per session. pgvector over that is nothing.
The table grows linearly forever and that's fine — Postgres doesn't care.

What breaks is **retrieval precision, three ways**:

**1a. Near-duplicate crowding.** Naive append-only extraction re-states the same durable
fact in slightly different wording dozens of times across 1.7k turns ("Mira distrusts the
captain" extracted at turns 120, 340, 780…). All variants are semantically near-identical,
so a relevant query returns k copies of one fact and zero copies of the next four distinct
facts. Effective distinct-fact recall collapses while every individual retrieval "works."
This is the dominant failure mode and it is invisible below ~100 facts — which is exactly
why the current system looks fine at 20 turns. Fix: Mem0-style ADD / UPDATE / NOOP against
the top-k similar existing facts at write time (Flag A). A duplicate becomes a
reinforcement bump (`reinforcements += 1`, feeding `S`), not a new row.

**1b. Missed contradiction closure.** Bi-temporal closure only happens if the write path
*sees* the fact it should close — the extractor must be shown retrieved neighbors and asked
to decide. Every missed closure leaves two live contradictory facts that can be injected
into the same prompt, which is the product's defining failure served directly to the model.
Expect a real miss rate; that's why the memory management page (edit/delete) and the
adversarial contradiction test in §6 exist. Design for a nonzero miss rate rather than
pretending closure is reliable.

**1c. Reflection does not compress — stop expecting it to.** Generative-Agents-style
reflection *adds* rows (higher-level insights); it removes nothing. Rows being permanent
(decision 4, correct), the actual bound on the per-scene candidate set is the conjunction
of: participant filter → validity window → decay/retention threshold → dedup having kept
distinct facts distinct. Reframe reflection's job: produce summary/arc facts and refresh a
**rolling scene summary** — and accept that growth control lives entirely in
dedup-on-write + closure + decay-as-retrieval-filter.

**A missing layer the brief's four-layer model doesn't cover:** typed facts answer "what is
true," not "what chapter are we in." With only 16 raw turns of history
(`chat_service.py:316`) the model has no narrative-arc continuity at turn 900. Add a fifth
block: a rolling summary, fixed token size (~150–200 tokens), regenerated at reflection
time, versioned in the DB but overwritten in the prompt. Cheap (one call per reflection),
flat-cost, and it covers the class of "bad memory" complaint that no top-k fact retrieval
can — tone, arc, where-we-are.

**An integration wrinkle:** batching extraction every ~5 turns breaks the current
regeneration semantics (memory keyed by `user_mid` so regen overwrites the slot,
`vectors.py:store_memory`). With batches, a regenerated turn may sit inside an
already-extracted batch. Fix: extract only *settled* turns — batch N is extracted when
turn N+1 arrives, and regenerating into an extracted batch marks that batch's facts
expired and re-queues it. Small, but it must be designed in, not patched later.

## 2. Active-vs-resolved: its own axis, expressed bi-temporally

Neither a decay modifier nor a new status enum. **An active state is a fact of a stateful
type (`injury`, `promise`, `conflict`, `possession`, …) whose validity window is open
(`valid_until IS NULL`).** Resolution = close the window + optionally insert a residue
successor ("the wound healed into a scar she touches when nervous").

This wins on every count: the decay rule becomes "stateful type + open window ⇒ retention
= 1.0" — derived, not stored, no formula carve-out; the reserved-slot query is a WHERE
clause, not a score special-case; resolution gets a timestamp for free, which *is* the arc
(decision 1's whole point); and there's one mechanism to test instead of two interacting
ones.

Required safety valve: open stateful facts accumulate when resolution detection misses
(extraction never notices the wound healed). Immune-to-decay + never-resolved = unbounded
reserved-slot demand. Escape hatch: an open stateful fact unreferenced for N turns (~100)
is flagged stale — surfaced on the memory page and demoted from the reserved pool to the
scored pool (still retrievable, no longer guaranteed a seat). Silent auto-closure would
manufacture the contradictions this system exists to prevent; demotion + visibility is the
honest failure mode.

## 3. Extraction on V4: two simple calls, not one complex one

V4's stated weakness is many simultaneous structural constraints. A single call doing
extract + type + participants + importance + valence + contradiction-check + ADD/UPDATE/NOOP
against neighbors is exactly the prompt shape that degrades. Split it:

**Call 1 — extract** (per 5-turn batch): input is the transcript slice; output is a JSON
array of `{text, type, participants, importance, valence}`. Five fields. The prompt is one
instruction line, one worked example per fact type (examples > rules on V4), format
statement last. Temperature 0. In the session's language, proper names verbatim (existing
invariant from `_extract_turn_signal`, keep it — embeddings must match later queries).

**Call 2 — reconcile** (only when call 1 returned facts): for each new fact, its top-3
similar live neighbors are shown; output is one decision per fact:
`ADD | REINFORCE(id) | SUPERSEDE(id)`. This is a small classification task, the shape V4
handles well. SUPERSEDE closes the window and inserts the successor.

Code-side enforcement, never prose: `strip_json_fence` (exists) → Pydantic validation →
on failure, one retry with the validation error appended → on second failure, drop the
batch with a `log.warning`. A silently lost batch of small talk is invisible; a crashed or
retry-looping write path is not. Emotion tag: `valence` is already in call 1's schema per
decision 8 — stored, unused by retrieval initially.

**Different model for extraction: yes, as config, not as requirement.** It's already a
separate call with its own endpoint plumbing (`_extract_turn_signal` takes
`chat_base`/`chat_key`). Add an `extraction_model` config key defaulting to the chat
model. Extraction needs schema obedience, not prose quality — a small instruct model is
fine and cheapens the write path further, but don't *require* a second deployment for a
self-hosted product.

Cost check: two small calls per 5 turns replaces the current one call per turn —
strictly cheaper and flat.

## 4. Token budget: reserved cap + template compression + scored floor

One fixed memory-block budget (~600 tokens, config), never grows. Split:

- **Reserved pool, capped at ~60%:** pinned facts first, then open stateful facts ordered
  by importance × recency-of-reinforcement.
- **Scored pool, floor of ~40% (never below 2 slots):** hard filters first (participants,
  validity, retention threshold), then Generative-Agents scoring
  (relevance × recency × importance × retention) on survivors.

**Overflow in the reserved pool compresses before it drops.** Active state is structured,
so it renders from the row, not from stored prose:
`Wounds: left shoulder (stab, untreated) · ribs (bruised). Promises: find Mira's brother
(turn ~410).` Template-rendered lines are 3–5× denser than extracted sentences; a
realistic extreme-RP load (4 injuries, 3 promises, 3 tensions) fits in ~150 tokens. If it
still overflows: stale-demoted items (§2) exit first, then lowest importance × recency,
each with a `log.info` — and the memory page shows what was benched.

**The scored floor is non-negotiable.** Recognition-driven recall (the user cueing turn
400) is the mechanism doing most of the work per the brief; reserved state crowding it to
zero breaks it precisely during intense play, when contradictions are most visible. And
sustained reserved-pool overflow is a *health signal* — it almost always means resolution
detection is failing (§2), so surface it, don't silently absorb it.

## 5. Minimum system prompt for V4 non-think

The current `RPG_IMMERSION_PROMPT` (~190 lines of stacked rules, timestamp schedule
anchors, weather-by-time-of-day tables) is precisely the long rule-stack the brief says V4
degrades on — and the codebase already contains the proof and the pattern:
`ensure_scene_header` (`prompt.py:36`) exists because the model skips the prose-mandated
header "on a real fraction of turns," and the fix was code, not more prose. Generalize
that lesson.

Prompt keeps (order matters; format last):
1. Identity + narrator/character contract — 3–4 sentences.
2. Card / persona / scenario via the existing `_untrusted` wrapper (keep it; extend the
   same untrusted framing to the memory block — its text is user-influenced).
3. Behavioral core — ~10 lines, the highest-value rules only (never speak for the user,
   no mind-reading, consequences persist).
4. **The memory guard, near the end:** "Your knowledge of past events in this story is
   exactly the RECALLED MEMORY block above. If something isn't there, you don't clearly
   remember it — respond with in-character uncertainty. Never invent shared history,
   past conversations, or prior meetings." Two sentences, positioned late, non-overridable
   by card content because card content is inside `_untrusted` delimiters.
5. Format contract stated once, with one worked example instead of rule paragraphs.

Code enforces (already proven pattern): scene header synthesis (`ensure_scene_header`),
mood-tag strip (`parse_mood`), `<think>` strip, `dm_notes` strip (regex, debug-flag
gated), length truncation if it ever matters. Dropped from prose entirely: time-advance
tables, weather guidance, schedule anchors — high token cost, unverifiable compliance,
and each is a constraint competing for V4's limited rule-following budget. The user-card
"NPCs remember {{user}}" problem is handled by the guard in (4) plus retrieval visibility
(memory page + `dm_notes`), per the brief.

## 6. Cheapest falsifying tests — no generation required

The write path and retrieval path can be tested with **zero roleplay generation**: feed
scripted transcripts through extract/reconcile, then run probe queries and compare
retrieved fact sets against golden sets. At 2 calls per 5 script turns on a cheap
extraction model, a full 1,700-turn synthetic script costs ~680 small calls — dollars and
an hour, not a week of RP.

In order of falsification value per dollar:

1. **Dedup A/B on a scripted long run** (the load-bearing claim, §1a): one script with
   ~40 durable facts each restated 5–20 times in varied wording + planted distinct facts.
   Run naive-append vs ADD/REINFORCE/SUPERSEDE; measure distinct-fact recall@k on a fixed
   probe set. If reconciliation doesn't beat naive append decisively, the design's core
   growth-control claim is false and the architecture needs rethinking — find out first.
2. **Adversarial contradiction suite** (~20 hand-built cases): establish fact → contradict
   it N turns later → probe. Metric: closure rate, and worse, both-versions-retrieved
   rate. This is the product metric.
3. **Participant-leak suite**: scenes with disjoint participant sets; probe as a character
   absent from a scene; assert zero leakage. Also covers Flag C's world-fact exemption.
4. **Replay of real long sessions** (whatever exists in the DB, even 100–300 turns):
   write-path only, then hand-probe. Catches extraction failure shapes synthetic scripts
   don't (rambling, mixed OOC, multilingual).
5. **Only after 1–4 pass:** one live 50-turn session with `dm_notes` on, checking
   "Memories used" against expectation — this is where retrieval-failure vs
   prompt-failure (the diagnosis split the brief calls out) becomes observable.

## Build order (one developer)

1. Facts table + `MemoryService.extract(turns)` / `.retrieve(scene)` skeleton; extraction
   call 1; naive append. Bi-temporal columns present from day one (cheap now, migration
   later), even though nothing closes windows yet.
2. **Probe harness** (tests 1–3 above, empty golden sets grow with each step). Before more
   features — everything after this is falsifiable the day it's written.
3. Reconcile call (ADD/REINFORCE/SUPERSEDE) — run the dedup A/B.
4. Retrieval: hard filters → scoring → fixed-budget block; wire into `build_system` as a
   separate block; memory guard; prompt slimming (§5).
5. Reserved slots + template-rendered active state + stale demotion.
6. Decay (retention filter) — deliberately late: with dedup and closure working, decay is
   a precision refinement, not a correctness requirement.
7. Memory management page (CRUD over a table that exists by step 1; pin = a column).
8. `dm_notes` debug block.
9. Reflection + rolling summary.
10. Memory-driven image gen (reads the same `retrieve(scene)` output; correctly last —
    it's a consumer, not a dependency).

## Findings from the first falsification run (2026-07-17, DeepSeek extraction)

- Contradiction closure worked end-to-end on the first real-model run (trust→despise
  superseded correctly, current state retrieved by both probes).
- Dedup A/B on a 24-turn script: naive 17 added/0 merged vs reconciled 8 added/7
  reinforced — 47% fewer rows, identical 6/6 probe recall. Mechanism validated; the
  at-scale crowding claim still needs a hundreds-of-rows script.
- **Bug found and fixed:** the reserved (pinned + active-state) pool bypassed the
  participants hard filter entirely — an open `state` fact about absent participants rode
  into the block unfiltered. Active states now pass `participants_present`; pinned stays
  exempt (an explicit user pin is an explicit override).
- **Design gap surfaced (open):** the participant filter tests *scene presence*, not
  *witnessing*. The user is present in every scene, so any fact extraction attributes to
  the user ("Alice knows where Mira's brother is") is retrievable everywhere, including
  scenes the *character* never witnessed. Harmless in 1:1 chat (char and user share every
  scene); real for `[as Name]` directed NPC lines and future group scenes — those need a
  POV-character parameter on `retrieve(scene)`, filtering by what *that* speaker
  witnessed, before NPC knowledge isolation can be promised.

## Open questions

- **Session-scoped vs character-scoped facts.** Everything above preserves the existing
  session scoping invariant. Cross-session character memory is a product decision with
  real privacy/expectation implications (a character "remembering" another user's session
  must never happen; even same-user cross-session recall changes the product's promise).
  Defer, but the `char_id` column already on `memory_vectors` keeps the door open.
- **Where does the 600-token budget actually land** vs card + lore + 16-turn history on
  the real context window? Needs one measurement pass on real sessions before the number
  is fixed.
- **Does the rolling summary need user visibility/editing** like facts do? Probably yes
  (same black-box complaint), but it can ship read-only first.
