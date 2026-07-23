# Scene-Aware Memory Design

## Problem

`memory_ranking.is_active()` gives any `state`-type fact with no `valid_until_turn`
and importance above `ACTIVE_STATE_IMPORTANCE_FLOOR` an unconditional
`retention()` of `1.0`, which routes it straight into the token-budget's
reserved tier (`memory_facts.reserved()` → `active` in
`memory_service.retrieve_block`), bypassing all scoring.

Nothing in this path is aware of scene or location. `chat_sessions.char_location`
is a single field overwritten every extraction batch, with no history.
Individual `memory_facts` rows carry no location tag at all. The result: a
`state` fact created at one scene (e.g. "the player is negotiating with the
guard at the mountain pass") stays permanently reserved even after the story
moves to a tavern, an abandoned mill, a forest clearing, a river — each new
scene's active facts pile on top rather than displacing the old ones. This
was measured directly in a 1700-turn stress test with five scene shifts:
recall did not improve after an earlier reserved-tier fix (importance floor),
staying at 2/13.

Returning to an earlier scene has no structural resurfacing path either —
whatever brings an old fact back has to happen through generic semantic KNN
similarity, which is noisy and not scene-aware.

## Fix

Tag every fact with the location it was created in. Demote (never delete) a
fact out of the unconditional-reserve tier the moment the story's location
moves on from it, letting it compete for the budget through normal scoring
instead. Give facts a relevance boost when their location matches the
current scene, so returning to a scene reliably resurfaces what happened
there. Additionally: hard-cap the reserved tier so a single long scene can't
by itself re-create the crowding problem, and raise the memory token budget
so more of what does get ranked actually survives packing.

## 1. Schema: `memory_facts.location`

Add a nullable `TEXT` column, following the same live-migration pattern used
for `messages.swipes` earlier in this project:

- `backend/repositories/memory_facts.py` `build_tables()`: add
  `sa.Column("location", sa.Text)` to the `_tbl` definition.
- `ensure_tables()`: add
  `await conn.execute(sa.text("ALTER TABLE memory_facts ADD COLUMN IF NOT EXISTS location TEXT"))`
  before `metadata.create_all`, so existing deployments pick it up live
  without a manual migration step.

Existing rows get `NULL`. A `NULL` location is treated as "always matches"
throughout this design (see `location_matches` below) — legacy facts keep
today's behavior (never demoted) rather than being silently mis-scored by a
scene tag they were never given. No backfill.

## 2. Extraction: tagging facts with their scene

`memory_service.extract_batch` already resolves the batch's effective
location (the value being written via `chat_sessions.set_char_state`):

```python
resolved_location = char_state.location or prev_session.get("char_location")
```

That same value gets stamped onto the `fact` dict before it's persisted, for
both `add` and `supersede` decisions (which call `memory_facts.insert`):

```python
fact.update(session_id=sid, char_id=char_id, turn=turn, location=resolved_location)
```

`reinforce` does not change location — reinforcing an existing fact means
the same state is still true; it doesn't relocate the fact to wherever the
story currently is.

`memory_facts.insert(fact, vec, pinned=False)` stores
`location=fact.get("location")` in its `INSERT`. `supersede()` calls
`insert()` internally so it's covered by the same change.

## 3. Demotion: `location_matches` and `is_active`

New helper in `backend/memory_ranking.py`:

```python
def location_matches(fact: dict, current_location: str | None) -> bool:
    fact_location = fact.get("location")
    if not fact_location or not current_location:
        return True
    return fact_location.strip().lower() == current_location.strip().lower()
```

`is_active` gains the check, with `current_location` defaulting to `None` so
every existing call site (tests, the probe harnesses) keeps working
unchanged — `None` means "don't consider location," matching current
behavior exactly:

```python
def is_active(fact: dict, current_location: str | None = None) -> bool:
    return (fact["fact_type"] in STATEFUL_TYPES and fact["valid_until_turn"] is None
            and fact["importance"] >= ACTIVE_STATE_IMPORTANCE_FLOOR
            and location_matches(fact, current_location))
```

`retention()` and `score()` thread `current_location` through to `is_active()`
the same way (default `None`, additive parameter, no breaking change to
existing signatures' positional behavior):

```python
def retention(fact: dict, current_turn: int, current_location: str | None = None) -> float:
    if fact.get("source") == "lore" or fact.get("pinned") or is_active(fact, current_location):
        return 1.0
    ...  # unchanged
```

## 4. Resurfacing boost: `score()`

New constant alongside the existing weights:

```python
LOCATION_MATCH_WEIGHT = 0.5
```

`score()` adds a location-match bonus term, only ever positive (never a
penalty — a location mismatch just means no bonus, not a demerit, since
mismatch is already handled by `is_active`/reserved-tier demotion):

```python
def score(fact: dict, current_turn: int, current_location: str | None = None) -> float:
    relevance = max(0.0, 1.0 - fact["distance"])
    recency = math.exp(-max(0, current_turn - fact["last_turn"]) / RECENCY_SCALE_TURNS)
    location_bonus = (LOCATION_MATCH_WEIGHT
                       if current_location and fact.get("location")
                       and fact["location"].strip().lower() == current_location.strip().lower()
                       else 0.0)
    weight = (RELEVANCE_WEIGHT * relevance
              + RECENCY_WEIGHT * recency
              + IMPORTANCE_WEIGHT * fact["importance"] / 5.0
              + location_bonus)
    return weight * retention(fact, current_turn, current_location)
```

`rank()` gains the same `current_location: str | None = None` parameter and
passes it to `passes_filters`/`score`:

```python
def passes_filters(fact: dict, present_lower: set[str], current_turn: int,
                    current_location: str | None = None) -> bool:
    if retention(fact, current_turn, current_location) < RETENTION_FLOOR:
        return False
    return participants_present(fact, present_lower)


def rank(candidates: list[dict], present: list[str], current_turn: int,
         current_location: str | None = None) -> list[dict]:
    present_lower = {p.lower() for p in present}
    kept = [c for c in candidates if passes_filters(c, present_lower, current_turn, current_location)]
    return sorted(kept, key=lambda c: score(c, current_turn, current_location), reverse=True)
```

## 5. Hard cap on the reserved tier

Even with location-filtering, a single long scene can still accumulate more
active state facts than the budget should unconditionally reserve. New
constant:

```python
MAX_ACTIVE_RESERVED_FACTS = 12
```

## 6. Wiring it together: `memory_service.retrieve_block`

```python
current_location = session.get("char_location")
...
guaranteed = await memory_facts.reserved(sid)
pinned = [f for f in guaranteed if f.get("pinned")]
present_and_unpinned = [f for f in guaranteed if not f.get("pinned")
                         and memory_ranking.participants_present(f, present_lower)]
active_matching = [f for f in present_and_unpinned
                    if memory_ranking.is_active(f, current_location)]
active_matching.sort(key=lambda f: (f["importance"], f["last_turn"]), reverse=True)
active = active_matching[:memory_ranking.MAX_ACTIVE_RESERVED_FACTS]
demoted = [f for f in present_and_unpinned if f not in active]
```

(`is_active` already encodes the location-match check from step 3, so
`active_matching` is exactly "still active AND from the current scene";
anything cut by the cap, or excluded because its scene moved on, lands in
`demoted`.)

`demoted` facts are not discarded — they compete for the scored budget
through the same pipeline as any KNN-surfaced candidate. Since they weren't
reached via embedding similarity, they get a neutral `distance` so their
`relevance` term is zero and they're scored on recency/importance/location
match alone:

```python
for f in demoted:
    f.setdefault("distance", 1.0)
candidates = await memory_facts.similar_live(sid, qvec, CANDIDATE_K) if qvec is not None else []
merged = {f["id"]: f for f in candidates}
for f in demoted:
    merged.setdefault(f["id"], f)
ranked_memory = memory_ranking.rank(list(merged.values()), present, turn, current_location)
```

(`merged` dedups by id in case a demoted fact also happens to be a live KNN
hit — the KNN version, with its real `distance`, wins since it's inserted
first.)

`lore_scored` keeps calling `memory_ranking.rank(...)` too, now passing
`current_location` for signature consistency — lore candidate dicts never
carry a `location` key, so `location_bonus` is always `0.0` for them; this
is a no-op for lore, not a behavior change.

## 7. Token budget

`backend/state.py:137`:

```python
"memory_v2_budget_tokens": int(os.environ.get("MEMORY_V2_BUDGET_TOKENS", "1000")),
```

(was `"600"`). Still overridable via the `MEMORY_V2_BUDGET_TOKENS` env var
and the existing global/per-user settings UI (`USER_CFG_KEYS` already lists
`memory_v2_budget_tokens` — no new plumbing). `memory_service.retrieve_block`'s
own fallback (`cfg.get("memory_v2_budget_tokens") or 600`) is left as a
defensive fallback for a missing config key, not the primary default path,
so it does not need to change — but for consistency it's bumped to `1000` too.

## Testing

- `backend/tests/test_memory_ranking.py`: extend for
  `location_matches` (matching, mismatching, either-side-`None`),
  `is_active` with a location mismatch returning `False`, `score`'s
  location bonus applying only on a match, and `rank` threading
  `current_location` through end to end.
- `backend/tests/test_memory_service.py`: extend `extract_batch`'s test(s)
  to assert the inserted fact carries the resolved `location`, and
  `retrieve_block`'s test(s) to cover: a same-location active fact staying
  reserved, a different-location active fact getting demoted into the
  ranked pool, the `MAX_ACTIVE_RESERVED_FACTS` cap trimming an oversized
  active set, and a demoted fact resurfacing via the location bonus when
  `current_location` matches it again.
- `backend/tests/test_memory_facts_repo.py`: extend `insert`'s test to
  assert `location` round-trips through `_row`.

## Non-goals

- No backfill of `location` on facts created before this change.
- No change to `chat_sessions.char_location`'s single-field, no-history
  design — scene identity for ranking purposes is carried on the fact
  itself, not reconstructed from session history.
- No LLM-based location normalization (e.g. canonicalizing "the mill" vs
  "the abandoned mill" to the same scene id) — out of scope, matching the
  approved "raw location string" tagging approach.
