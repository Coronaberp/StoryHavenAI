# Memory v2 + lore unification — design spec

Date: 2026-07-20
Status: approved, ready for implementation planning

## Problem

Two problems, confirmed by direct code audit (see `report_today.md` for the full trail):

1. **Legacy memory (v1) still exists in the codebase** even though it's no longer read from or written to (a prior change hardcoded `memory_v2 = True` in `chat_service.py` and stripped the flag gates in `session_lore.py`). The dead code — `retrieval.remember()`, `_extract_turn_signal`, `vectors.store_memory`/`search_memory`, the legacy `mem_lines` prompt section — still runs every turn for char-state maintenance, wasting an LLM call, and still exists as a maintenance burden and a second, no-longer-load-bearing system.
2. **Lore and memory_v2 are functionally blind to each other.** `lore_links` (relationships between lore entries) are stored and shown in the UI but never traversed by retrieval — matching entry A never surfaces linked entry B. Memory_v2 and lore retrieval run as two independent code paths that happen to render into adjacent sections of the same prompt; nothing ranks them together, nothing lets a story event update what lore says.

## Goals

- Delete legacy memory (v1) entirely — no flag, no fallback, no dead code path.
- Lore becomes a first-class participant in memory_v2's retrieval pool — ranked and token-budgeted alongside memory facts, not a separate hardcoded section.
- Lore relationships (`lore_links`) get traversed: matching a lore entry pulls in its directly-linked entries as candidates, labeled with the relationship.
- Memory can update lore: when a story event contradicts or supersedes an existing lore entry, that change is reflected back into what the story sees — scoped to the session, not the shared lorebook.
- Char-state (doing/location/known-names) survives the removal of legacy memory by folding into memory_v2's existing batched extraction, eliminating the redundant per-turn LLM call in the process.
- Close the test-coverage gap the prior audit found — the new merge/rank/expand/update logic should be unit-tested from the start, not bolted on after.

## Non-goals

- No change to the keyword-triggered lore path (`always=True` entries, key substring matches against recent text) — it stays a per-turn, no-LLM-call check exactly as it works today. It's cheap and instant; there's no reason to fold it into the batched/semantic side.
- No mutation of the shared/canonical lore entry. Memory-driven lore updates are always session-scoped overrides (see "Lore-update detection" below) — this is a deliberate safety boundary, not a placeholder for a future "upgrade to global mutation."
- No new database tables for the merged candidate pool. Two existing KNN queries (`memory_facts` and `lore_vectors`) are merged in Python, not at the SQL/index level.
- Dropping the legacy `memory_vectors`/`lore_vectors`-adjacent tables from the schema is out of scope — code stops writing/reading the legacy table, but the table itself is left in place (cheap, reversible; a follow-up migration can drop it later once the team is confident nothing needs to read it back).

## Architecture

### Per-turn, no LLM call (unchanged)

Keyword-matched lore stays exactly as today: `always=True` entries and substring key matches against recent text, checked every turn, no embedding call. This is the reliability floor — it must never depend on the batched/semantic machinery below.

### Per-turn semantic retrieval (`memory_service.retrieve_block`, extended)

1. KNN over `memory_facts` (existing, `memory_facts.similar_live`).
2. **New:** KNN over `lore_vectors`, scoped to the character (or global), resolved to content the same way `retrieval.retrieve()` does today (`db.lore_by_ids`).
3. Both result sets are merged into one candidate list. Each candidate is tagged with a `source` field (`"memory"` or `"lore"`) so ranking and rendering can treat them differently where it matters.
4. **New: one-hop relationship expansion.** For every lore candidate present after keyword-match + KNN (including ones added by keyword match, which happens per-turn in a different function — the expansion step needs to see the union of both), pull its directly-linked entries via `lore_links` (both directions — outgoing and incoming) and add them as additional lore candidates, carrying the link label. Expansion is one hop only — do not recursively expand the newly-added neighbors, to keep the candidate pool bounded and avoid a link chain silently pulling in a large fraction of a lorebook.
5. **New scoring behavior for lore candidates:** lore never decays. `memory_ranking.retention()` returns `1.0` for any candidate tagged `source="lore"`, unconditionally — the same treatment `pinned`/active `state` facts already get. Lore candidates still pass through `participants_present()` for symmetry (a `world`-type-equivalent lore entry with no listed participants passes automatically, same rule already in place for memory facts).
6. Packing: `memory_block.build_block()`'s existing reserved/scored split absorbs both types without structural change — keyword-matched lore and pinned/active memory facts compete for the reserved budget (60%), everything else (KNN memory, KNN lore, relationship-expanded lore) competes for the scored budget (40%) by the same `score()` formula. The prompt gets **one** unified section (replacing today's separate "# World information (lore)" and "# Recalled memory" sections) — each rendered line indicates its type so the model can distinguish "this is established world fact" from "this is something that happened."

### Batched extraction (every 5 exchanges, LLM call — cadence unchanged)

1. `run_extract` gains the char-state fields that `_extract_turn_signal` used to own: `doing`, `location`, `npcs`. One extraction call now produces both typed facts and char-state, instead of two separate LLM calls per turn (extraction was already batched; char-state was previously the reason a *second*, per-turn-not-batched call existed at all).
   - **Explicit accepted trade-off:** char-state (the doing/location panel) now updates once per batch (every 5 exchanges) instead of every single turn. This is a real, visible behavior change — the panel will look "stale" for up to 4 turns after a scene change, versus updating immediately today. Accepted as a reasonable cost for eliminating a redundant per-turn LLM call; revisit if this proves noticeable in practice.
2. Fact reconciliation against existing memory facts (`run_reconcile`) is unchanged.
3. **New: lore-update detection.** For each drafted fact (or a filtered subset — see open question below on scoping this to avoid noise), search nearby lore via KNN (same char/global scoping as the retrieval-side lore search). If a close match exists, ask the model a focused, explicit question: *does this event supersede this lore entry's current content, and if so, what should the updated content read?* The model may answer "no update" — this is the expected common case, not an edge case, and the prompt must make that a first-class, easy answer (not something the model has to fight the format to say).
4. If the model confirms a supersession, apply it as a **session-scoped lore override** via the existing `session_lore.py` mechanism (`sls.set_override`/equivalent repository call) — this session's story now reads the updated content; the shared lore entry and every other session using that character/lorebook are untouched.

### Removal of legacy memory (v1)

Delete outright, not deprecate-in-place:
- `retrieval.remember()`, `retrieval._extract_turn_signal`
- `vectors.store_memory`, `vectors.search_memory` (and any now-dead helper only those two call)
- The legacy `elif mem_lines:` prompt branch in `chat_service.py` (already dead now that `memory_v2` is hardcoded `True`, but the surrounding `retrieve()` call itself needs to shrink to lore-keyword-matching only, since KNN lore moves into `retrieve_block`)
- `retrieval.retrieve()` narrows to just the keyword-matching half described above (it currently also does legacy memory KNN and legacy lore KNN — both move out: legacy memory KNN is deleted, lore KNN moves into `memory_service.retrieve_block`)
- Any now-unreferenced legacy config keys (`top_k_memory`, `mem_max_dist` if nothing else reads them post-removal — verify before deleting, `top_k_lore`/`lore_max_dist` likely still needed for the new lore KNN call)

## Data flow (worked example)

Player: *"I storm the palace and overthrow the government."*

1. Keyword lore check (per-turn, no LLM): no exact key match this turn, nothing added here.
2. Semantic retrieval (per-turn): KNN pulls the "Government" lore entry (still says "rules the city") as a candidate. Relationship expansion adds its linked entry "Chancellor Voss" (label: "leads"). Both packed into the one unified prompt section, lore-tagged and non-decaying.
3. Model replies in character; the exchange completes and is stored.
4. Batch extraction fires once 5 exchanges have settled: drafts a fact `event: "the player overthrew the government"`. Lore-update detection finds "Government" lore as a close KNN match, asks the model to confirm — model confirms, proposes new content ("...overthrown by {{user}}, no longer in power"). Applied as a session-scoped override.
5. Next turn: semantic retrieval's lore KNN/keyword lookup resolves through the existing session-override-aware lookup (already how `session_lore.py` overrides are read elsewhere in the codebase) — the *overridden* content surfaces, not the stale original.

## Error handling

Same defensive posture as the rest of this codebase: every LLM/embedding call in the new code wrapped in try/except with a `log.warning` and graceful degradation — a failed lore-update-detection call on a given batch just means lore doesn't get updated that batch (logged, not surfaced as a user-facing error), not a broken turn. A failed lore KNN call during retrieval degrades to memory-only results for that turn (matching how a failed memory KNN or embedding call already degrades today). Lore-update application requires an explicit model confirmation — no similarity-threshold-only auto-apply — so an ambiguous or low-confidence case defaults to *not* touching the override, not a best-guess mutation.

## Testing

Every piece of new logic here is a real target for unit tests, closing the gap the prior audit flagged (`memory_ranking.rank()` and `memory_block.build_block()` had zero tests before this):

- `memory_ranking`: lore-tagged candidates always score `retention() == 1.0` regardless of age; a lore candidate participates in `participants_present()` filtering the same as a `world`-type memory fact.
- Relationship expansion: given a lore entry with known outgoing/incoming links, the expanded candidate set contains exactly its one-hop neighbors (not two-hop), each carrying the correct link label; an entry with no links expands to nothing extra.
- Lore-update detection: a fact that clearly supersedes a nearby lore entry results in a session override being applied; a fact with no close lore match applies nothing; a "no update" model response applies nothing (this path must be exercised explicitly, not just assumed to fall through safely).
- `memory_block.build_block()` with a mixed pool (memory facts + lore candidates, some reserved/pinned-equivalent, some scored) packs and drops correctly under a constrained token budget — including the existing gap the audit found (reserved-section overflow can still drop candidates, now including lore) should be either fixed or explicitly re-verified as an accepted, documented limit in this rewrite, not silently reintroduced without comment.
- End-to-end: the worked example above (or an equivalent), run against the real batch/retrieval functions with mocked LLM/embedding calls, verifying the override is visible on the next turn's retrieval.

## Open questions for the implementation plan to resolve

These are scoping details left for `writing-plans` rather than blocking this design:

1. **Lore-update detection scope per batch:** running it against *every* drafted fact could be noisy/expensive on a busy batch. Consider restricting to facts of type `event`/`state` with `importance >= some threshold`, skipping `relationship`/`profile`-type drafts that are unlikely to contradict world-level lore.
2. **Rendering distinction in the unified prompt block:** the merged section needs a way to visually/structurally distinguish "established world fact" (lore) from "something that happened" (memory) for the model, without reintroducing two separate sections. Likely a per-line tag or grouped sub-headings within the one section (e.g. `## World` / `## Recalled` subheadings inside the single unified block, as `memory_block.build_block()` already does for `## Ongoing & pinned` / `## Recalled from earlier` — extend that existing pattern rather than inventing a new one).
3. **Legacy config key cleanup:** confirm which of `top_k_memory`/`mem_max_dist` become fully dead versus still needed in a repurposed form, before deleting from `CFG`/`UserSettingsIn`/`SettingsIn`.
