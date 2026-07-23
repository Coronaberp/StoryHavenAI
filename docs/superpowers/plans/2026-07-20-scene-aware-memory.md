# Scene-Aware Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag memory facts with the scene/location they were created in so state facts stop permanently squatting on the reserved token budget once the story moves to a new scene, and resurface with a relevance boost when the story returns to a previously-visited scene.

**Architecture:** Add a nullable `location` column to `memory_facts`, stamp it at extraction time from the same value already written to `chat_sessions.char_location`, thread an optional `current_location` parameter through `memory_ranking.py`'s `is_active`/`retention`/`score`/`rank` so a scene mismatch drops a fact out of the unconditional-reserve tier and a scene match adds a scoring bonus, then wire `memory_service.retrieve_block` to split/cap/merge the reserved-tier facts accordingly. Also raise the `memory_v2_budget_tokens` default.

**Tech Stack:** Python, SQLAlchemy Core (async), pytest + pytest-asyncio, PostgreSQL + pgvector (via the live `story-game` container).

## Global Constraints

- This is a live app (see project CLAUDE.md) — this checkout IS the running container's bind mount. After every edit to a `.py` file: `python3 -c "import ast; ast.parse(open('<file>').read())"`, then `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health` (expect `401`, not `502`/`500`), then `podman logs --tail 50 story-game | grep -i "error\|traceback"`.
- Zero comments in any file, including docstrings (see project CLAUDE.md "Coding style").
- No abbreviations in identifiers.
- New nullable column `location TEXT` on `memory_facts`, migrated live via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (mirrors the existing `messages.swipes` pattern) — no manual migration step, no backfill.
- `is_active(fact, current_location=None)`, `retention(fact, current_turn, current_location=None)`, `score(fact, current_turn, current_location=None)`, `rank(candidates, present, current_turn, current_location=None)` — `current_location` is always the last parameter, always defaults to `None`, so every existing call site keeps working unchanged.
- `MAX_ACTIVE_RESERVED_FACTS = 12` (backend/memory_ranking.py), `LOCATION_MATCH_WEIGHT = 0.5` (backend/memory_ranking.py).
- `memory_v2_budget_tokens` default changes from `600` to `1000` in both `backend/state.py:137` and the fallback in `backend/memory_service.py:171`.
- Every new function with real logic gets a pytest test in the matching existing test file (`test_memory_ranking.py`, `test_memory_facts_repo.py`, `test_memory_service.py`) — no new test files needed, this feature extends existing ones.

---

### Task 1: `memory_facts.location` column + `insert`/`reserved` support

**Files:**
- Modify: `backend/repositories/memory_facts.py` (`build_tables`, `ensure_tables`, `insert`)
- Test: `backend/tests/test_memory_facts_repo.py`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `memory_facts.insert(fact: dict, vec, pinned: bool = False) -> str` now reads an optional `fact["location"]` (`str | None`) and persists it; `_row()` already returns every column via `dict(mapping)`, so `location` appears in every dict this module returns (`insert`'s implicit read-back via `reserved`, `similar_live`, `list_live`) with no further change needed there.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_memory_facts_repo.py`:

```python
async def test_insert_stores_location(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-loc-1", "char_id": "char-1", "text": "at the mill",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
        "location": "the abandoned mill",
    }, _fake_vec(), pinned=True)
    reserved = await memory_facts.reserved("sess-loc-1")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["location"] == "the abandoned mill"


async def test_insert_without_location_stores_none(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-loc-2", "char_id": "char-1", "text": "no location given",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    reserved = await memory_facts.reserved("sess-loc-2")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["location"] is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_memory_facts_repo.py::test_insert_stores_location backend/tests/test_memory_facts_repo.py::test_insert_without_location_stores_none -v`
Expected: FAIL — `KeyError: 'location'` (the column doesn't exist yet, so `match["location"]` raises).

- [ ] **Step 3: Add the column and persist it**

In `backend/repositories/memory_facts.py`, in `build_tables`, add the new column right after `pinned` (around line 40):

```python
        sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("location", sa.Text),
        sa.Column("embedding", Vector(dim)),
```

In `ensure_tables`, add the live migration before `metadata.create_all` (around line 52):

```python
async def ensure_tables(dim: int):
    build_tables(dim)
    async with _engine().begin() as conn:
        await conn.execute(sa.text(
            "ALTER TABLE memory_facts ADD COLUMN IF NOT EXISTS location TEXT"))
        await conn.run_sync(_meta.create_all)
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_memfacts_hnsw ON memory_facts "
            "USING hnsw (embedding vector_cosine_ops)"))
```

In `insert`, add `location=fact.get("location")` to the `values(...)` call (around line 75):

```python
async def insert(fact: dict, vec, pinned: bool = False) -> str:
    fid = nid("mf")
    async with _engine().begin() as conn:
        await conn.execute(_tbl.insert().values(
            id=fid, session_id=fact["session_id"], char_id=fact.get("char_id"),
            text=_encrypt_secret(fact["text"]), fact_type=fact["fact_type"],
            participants=list(fact.get("participants") or []),
            importance=int(fact.get("importance") or 3),
            valence=int(fact.get("valence") or 0),
            reinforcements=0,
            valid_from_turn=int(fact["turn"]), valid_until_turn=None,
            last_turn=int(fact["turn"]), created_ts=int(time.time()),
            expired_ts=None, superseded_by=None, pinned=pinned,
            location=fact.get("location"),
            embedding=list(vec)))
    log.info("memory fact added: session=%s id=%s type=%s importance=%s pinned=%s",
             fact["session_id"], fid, fact["fact_type"], fact.get("importance"), pinned)
    return fid
```

- [ ] **Step 4: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/repositories/memory_facts.py').read())"`
Expected: no output (valid syntax).

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors (the app auto-reloads on save via uvicorn `--reload`; `ensure_tables` runs at startup so the column gets added to the live database the next time the app starts — confirm no traceback from the `ALTER TABLE`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_memory_facts_repo.py -v`
Expected: PASS, all tests including the two new ones and every pre-existing test in the file.

- [ ] **Step 6: Commit**

```bash
git add backend/repositories/memory_facts.py backend/tests/test_memory_facts_repo.py
git commit -m "Add location column to memory_facts"
```

---

### Task 2: `memory_ranking.py` location-awareness

**Files:**
- Modify: `backend/memory_ranking.py`
- Test: `backend/tests/test_memory_ranking.py`

**Interfaces:**
- Consumes: fact dicts now may carry a `"location": str | None` key (Task 1).
- Produces:
  - `location_matches(fact: dict, current_location: str | None) -> bool`
  - `is_active(fact: dict, current_location: str | None = None) -> bool`
  - `retention(fact: dict, current_turn: int, current_location: str | None = None) -> float`
  - `score(fact: dict, current_turn: int, current_location: str | None = None) -> float`
  - `rank(candidates: list[dict], present: list[str], current_turn: int, current_location: str | None = None) -> list[dict]`
  - `MAX_ACTIVE_RESERVED_FACTS = 12`
  - `LOCATION_MATCH_WEIGHT = 0.5`

  These are consumed by Task 3 (`memory_service.retrieve_block`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_memory_ranking.py`:

```python
def test_location_matches_when_equal_case_insensitive():
    fact = _memory_fact(location="The Abandoned Mill")
    assert memory_ranking.location_matches(fact, "the abandoned mill") is True


def test_location_matches_when_fact_location_missing():
    fact = _memory_fact(location=None)
    assert memory_ranking.location_matches(fact, "the abandoned mill") is True


def test_location_matches_when_current_location_missing():
    fact = _memory_fact(location="the abandoned mill")
    assert memory_ranking.location_matches(fact, None) is True


def test_location_matches_false_when_different():
    fact = _memory_fact(location="the abandoned mill")
    assert memory_ranking.location_matches(fact, "the tavern") is False


def test_is_active_false_when_location_mismatched():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the abandoned mill")
    assert memory_ranking.is_active(fact, current_location="the tavern") is False


def test_is_active_true_when_location_matches():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the abandoned mill")
    assert memory_ranking.is_active(fact, current_location="the abandoned mill") is True


def test_retention_decays_active_fact_from_mismatched_location():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the abandoned mill", last_turn=1)
    assert memory_ranking.retention(fact, current_turn=10_000, current_location="the tavern") < 1.0


def test_score_applies_location_bonus_on_match():
    matching = _memory_fact(location="the abandoned mill", last_turn=1)
    mismatched = _memory_fact(location="the tavern", last_turn=1)
    matching_score = memory_ranking.score(matching, current_turn=1, current_location="the abandoned mill")
    mismatched_score = memory_ranking.score(mismatched, current_turn=1, current_location="the abandoned mill")
    assert matching_score > mismatched_score


def test_rank_passes_current_location_through_to_score():
    facts = [
        _memory_fact(id="mf-a", location="the tavern", last_turn=1),
        _memory_fact(id="mf-b", location="the abandoned mill", last_turn=1),
    ]
    ranked = memory_ranking.rank(facts, present=["Alice"], current_turn=1,
                                 current_location="the abandoned mill")
    assert ranked[0]["id"] == "mf-b"
```

Update `_memory_fact`'s base dict (around line 16) to include a default `location` key so existing tests that don't pass it keep working:

```python
def _memory_fact(**overrides):
    base = {
        "id": "mf-1", "fact_type": "event", "text": "the player arrived in town",
        "participants": ["Alice"], "importance": 3, "valence": 0,
        "reinforcements": 0, "pinned": False, "location": None,
        "valid_until_turn": None, "last_turn": 1, "distance": 0.1,
    }
    base.update(overrides)
    return base
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_memory_ranking.py -v`
Expected: FAIL — `AttributeError: module 'backend.memory_ranking' has no attribute 'location_matches'` and related failures for `is_active`/`retention`/`score`/`rank` not yet accepting `current_location`.

- [ ] **Step 3: Implement location-awareness**

Replace the full content of `backend/memory_ranking.py`:

```python
import math

STATEFUL_TYPES = {"state"}
STRENGTH_BASE = 40.0
STRENGTH_PER_REINFORCEMENT = 15.0
STRENGTH_PER_IMPORTANCE = 10.0
STRENGTH_PER_VALENCE = 8.0
RETENTION_FLOOR = 0.05
RECENCY_SCALE_TURNS = 200.0
RELEVANCE_WEIGHT = 1.0
RECENCY_WEIGHT = 0.6
IMPORTANCE_WEIGHT = 0.4
LOCATION_MATCH_WEIGHT = 0.5
ACTIVE_STATE_IMPORTANCE_FLOOR = 3
MAX_ACTIVE_RESERVED_FACTS = 12


def location_matches(fact: dict, current_location: str | None) -> bool:
    fact_location = fact.get("location")
    if not fact_location or not current_location:
        return True
    return fact_location.strip().lower() == current_location.strip().lower()


def is_active(fact: dict, current_location: str | None = None) -> bool:
    return (fact["fact_type"] in STATEFUL_TYPES and fact["valid_until_turn"] is None
            and fact["importance"] >= ACTIVE_STATE_IMPORTANCE_FLOOR
            and location_matches(fact, current_location))


def retention(fact: dict, current_turn: int, current_location: str | None = None) -> float:
    if fact.get("source") == "lore" or fact.get("pinned") or is_active(fact, current_location):
        return 1.0
    strength = (STRENGTH_BASE
                + STRENGTH_PER_REINFORCEMENT * fact["reinforcements"]
                + STRENGTH_PER_IMPORTANCE * fact["importance"]
                + STRENGTH_PER_VALENCE * abs(fact["valence"]))
    age = max(0, current_turn - fact["last_turn"])
    return math.exp(-age / strength)


def participants_present(fact: dict, present_lower: set[str]) -> bool:
    if fact["fact_type"] == "world" or fact.get("source") == "lore":
        return True
    if not fact["participants"]:
        return True
    return any(p.lower() in present_lower for p in fact["participants"])


def passes_filters(fact: dict, present_lower: set[str], current_turn: int,
                    current_location: str | None = None) -> bool:
    if retention(fact, current_turn, current_location) < RETENTION_FLOOR:
        return False
    return participants_present(fact, present_lower)


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


def rank(candidates: list[dict], present: list[str], current_turn: int,
         current_location: str | None = None) -> list[dict]:
    present_lower = {p.lower() for p in present}
    kept = [c for c in candidates if passes_filters(c, present_lower, current_turn, current_location)]
    return sorted(kept, key=lambda c: score(c, current_turn, current_location), reverse=True)
```

- [ ] **Step 4: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/memory_ranking.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_memory_ranking.py -v`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add backend/memory_ranking.py backend/tests/test_memory_ranking.py
git commit -m "Add location-awareness to memory fact ranking"
```

---

### Task 3: Extraction tagging + `retrieve_block` wiring + budget bump

**Files:**
- Modify: `backend/memory_service.py` (`extract_batch`, `retrieve_block`)
- Modify: `backend/state.py:137`
- Test: `backend/tests/test_memory_service.py`

**Interfaces:**
- Consumes: `memory_facts.insert` accepting `fact["location"]` (Task 1); `memory_ranking.is_active`, `memory_ranking.rank`, `memory_ranking.MAX_ACTIVE_RESERVED_FACTS` (Task 2).
- Produces: `extract_batch` and `retrieve_block` keep their existing external signatures (no caller elsewhere in the codebase needs to change) — this task only changes their internal behavior.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_memory_service.py`:

```python
async def test_extract_batch_tags_new_fact_with_resolved_location(db_conn, monkeypatch):
    async def fake_run_extract(*args, **kwargs):
        from backend.memory_extraction import FactDraft, CharStateDraft
        return ([FactDraft(text="found a hidden door", fact_type="state",
                           participants=[], importance=3, valence=0)],
                CharStateDraft(doing="", location="the abandoned mill", npcs=[]))
    monkeypatch.setattr("backend.memory_service.run_extract", fake_run_extract)
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    async def fake_reconcile(*args, **kwargs):
        from backend.memory_extraction import ReconcileDecision
        return [ReconcileDecision(index=0, action="add")]
    monkeypatch.setattr("backend.memory_service.run_reconcile", fake_reconcile)
    async def fake_detect(*args, **kwargs):
        return {"checked": 0, "applied": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_apply_lore_updates", fake_detect)
    async def fake_reveal(*args, **kwargs):
        return {"checked": 0, "revealed": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_reveal_secrets", fake_reveal)

    await memory_service.extract_batch(
        "sess-loc-eb-1", "char-loc-eb-1", "Char", "Player",
        [({"content": "hi", "role": "user"}, {"content": "hello", "role": "assistant", "mood": None})],
        turn=5, language="English", model="test-model",
        prev_session={"known_names": "[]", "char_location": "the tavern"})

    live = await memory_facts.list_live("sess-loc-eb-1")
    assert live[0]["location"] == "the abandoned mill"


async def test_retrieve_block_demotes_active_fact_from_different_location(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    await memory_facts.insert({
        "session_id": "sess-loc-rb-1", "char_id": "char-loc-rb-1",
        "text": "the bridge is guarded", "fact_type": "state",
        "participants": [], "importance": memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
        "valence": 0, "turn": 1, "location": "the mountain pass",
    }, [0.1] * 768)

    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-loc-rb-1", "known_names": "[]", "char_location": "the tavern"},
        char={"id": "char-loc-rb-1", "name": "Test"},
        user_name="Player", query="what is happening at the tavern",
        msgs=[{"role": "user", "content": "what is happening at the tavern"}],
        cfg={"memory_v2_budget_tokens": 1000}, keyword_lore_entries=[])
    assert "the bridge is guarded" not in block


async def test_retrieve_block_keeps_active_fact_from_matching_location(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    await memory_facts.insert({
        "session_id": "sess-loc-rb-2", "char_id": "char-loc-rb-2",
        "text": "the tavern keeper is nervous", "fact_type": "state",
        "participants": [], "importance": memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
        "valence": 0, "turn": 1, "location": "the tavern",
    }, [0.1] * 768)

    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-loc-rb-2", "known_names": "[]", "char_location": "the tavern"},
        char={"id": "char-loc-rb-2", "name": "Test"},
        user_name="Player", query="what is happening at the tavern",
        msgs=[{"role": "user", "content": "what is happening at the tavern"}],
        cfg={"memory_v2_budget_tokens": 1000}, keyword_lore_entries=[])
    assert "the tavern keeper is nervous" in block


async def test_retrieve_block_caps_active_facts_at_max_reserved(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    for index in range(memory_ranking.MAX_ACTIVE_RESERVED_FACTS + 3):
        await memory_facts.insert({
            "session_id": "sess-loc-rb-3", "char_id": "char-loc-rb-3",
            "text": f"ongoing detail number {index}", "fact_type": "state",
            "participants": [], "importance": memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
            "valence": 0, "turn": index + 1, "location": "the tavern",
        }, [0.1] * 768)

    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-loc-rb-3", "known_names": "[]", "char_location": "the tavern"},
        char={"id": "char-loc-rb-3", "name": "Test"},
        user_name="Player", query="what is happening at the tavern",
        msgs=[{"role": "user", "content": "what is happening at the tavern"}],
        cfg={"memory_v2_budget_tokens": 1000}, keyword_lore_entries=[])
    reserved_count = sum(1 for line in mem_lines if "ongoing detail number" in line)
    assert reserved_count <= memory_ranking.MAX_ACTIVE_RESERVED_FACTS
```

Add the required imports at the top of `backend/tests/test_memory_service.py` if not already present:

```python
from backend import memory_ranking
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_memory_service.py -v`
Expected: FAIL — `test_extract_batch_tags_new_fact_with_resolved_location` fails because `location` is `None` (extraction doesn't tag it yet); `test_retrieve_block_demotes_active_fact_from_different_location` fails because the fact is still unconditionally reserved regardless of location; `test_retrieve_block_caps_active_facts_at_max_reserved` fails because there's no cap yet.

- [ ] **Step 3: Tag facts at extraction time**

In `backend/memory_service.py`, in `extract_batch` (around line 60), after `char_state` is resolved and before the `for decision in decisions:` loop, resolve and stamp the location:

```python
async def extract_batch(sid: str, char_id: str, char_name: str, user_name: str,
                        batch: list[tuple[dict, dict]], turn: int, language: str, model: str,
                        prev_session: dict, chat_base: str | None = None, chat_key: str | None = None,
                        embed_base: str | None = None, embed_key: str | None = None,
                        names_by_id: dict | None = None, cast_names: list[str] | None = None) -> dict:
    log.info("memory extract start: session=%s turn=%s batch=%d exchanges group=%s",
             sid, turn, len(batch), bool(cast_names))
    drafts, char_state = await run_extract(_transcript(batch, char_name, user_name, names_by_id),
                                           char_name, user_name, language, model, chat_base, chat_key,
                                           cast_names=cast_names)
    resolved_location = char_state.location or prev_session.get("char_location")
    try:
        known = set(json.loads(prev_session.get("known_names") or "[]"))
        known.update(char_state.npcs)
        await chat_sessions.set_char_state(
            sid,
            doing=char_state.doing or prev_session.get("char_doing"),
            location=resolved_location,
            known_names=sorted(known))
    except Exception as e:
        log.warning("character-state update failed for session %s turn %s: %s", sid, turn, e)
```

Then update the `fact.update(...)` call inside the `for decision in decisions:` loop (still in `extract_batch`) to include the resolved location:

```python
    for decision in decisions:
        draft, vec = drafts[decision.index], vecs[decision.index]
        fact = draft.model_dump()
        if fact["fact_type"] != "world" and not fact["participants"]:
            fact["participants"] = [user_name, char_name]
        fact.update(session_id=sid, char_id=char_id, turn=turn, location=resolved_location)
        if decision.action == "add":
            await memory_facts.insert(fact, vec)
            stats["added"] += 1
        elif decision.action == "reinforce":
            await memory_facts.reinforce(decision.target_id, turn)
            stats["reinforced"] += 1
        else:
            await memory_facts.supersede(decision.target_id, fact, vec, turn)
            stats["superseded"] += 1
```

- [ ] **Step 4: Wire `retrieve_block` to split, cap, and merge**

Replace `retrieve_block` in `backend/memory_service.py`:

```python
async def retrieve_block(session: dict, char: dict, user_name: str, query: str,
                         msgs: list[dict], cfg: dict, keyword_lore_entries: list[dict],
                         viewer_id: str | None = None,
                         embed_base: str | None = None,
                         embed_key: str | None = None) -> tuple[str, list[str], list[str], list[str]]:
    sid = session["id"]
    turn = current_turn(msgs)
    current_location = session.get("char_location")
    qvec = None
    if query:
        try:
            qvec = await llm.embed(query, CFG["embed_model"], base_url=embed_base, api_key=embed_key)
        except Exception as e:
            log.warning("memory v2 query embedding failed: session=%s error=%s", sid, e)
    lore_candidates = await lore_memory.fetch_lore_candidates(
        char["id"], sid, keyword_lore_entries, qvec, cfg, turn)
    if not query and not lore_candidates:
        return "", [], [], []
    known = json.loads(session.get("known_names") or "[]")
    present = present_participants(char["name"], user_name, known, recent_text(msgs))
    present_lower = {p.lower() for p in present}
    candidates = []
    if qvec is not None:
        candidates = await memory_facts.similar_live(sid, qvec, CANDIDATE_K)
    guaranteed = await memory_facts.reserved(sid)
    pinned = [f for f in guaranteed if f.get("pinned")]
    present_and_unpinned = [f for f in guaranteed if not f.get("pinned")
                            and memory_ranking.participants_present(f, present_lower)]
    active_matching = [f for f in present_and_unpinned
                       if memory_ranking.is_active(f, current_location)]
    active_matching.sort(key=lambda f: (f["importance"], f["last_turn"]), reverse=True)
    active = active_matching[:memory_ranking.MAX_ACTIVE_RESERVED_FACTS]
    active_ids = {f["id"] for f in active}
    demoted = [f for f in present_and_unpinned if f["id"] not in active_ids]
    for fact in demoted:
        fact.setdefault("distance", 1.0)
    merged_candidates = {f["id"]: f for f in candidates}
    for fact in demoted:
        merged_candidates.setdefault(fact["id"], fact)
    ranked_memory = memory_ranking.rank(list(merged_candidates.values()), present, turn, current_location)
    lore_pinned = [c for c in lore_candidates if c["pinned"]]
    lore_scored = memory_ranking.rank(
        [c for c in lore_candidates if not c["pinned"]], present, turn, current_location)
    budget = int(cfg.get("memory_v2_budget_tokens") or 1000)
    block, used, dropped = memory_block.build_block(
        pinned + lore_pinned, active, ranked_memory + lore_scored, budget)
    if dropped:
        log.info("memory block overflow: session=%s dropped_reserved=%d", sid, len(dropped))
    used_set = set(used)
    meta_lore_lines = [memory_block._render(c) for c in lore_candidates if c["id"] in used_set]
    meta_memory_lines = [memory_block._render(f) for f in (pinned + active + ranked_memory)
                         if f["id"] in used_set]
    log.info("memory v2 retrieve: session=%s turn=%s memory_candidates=%d lore_candidates=%d used=%d",
             sid, turn, len(ranked_memory), len(lore_candidates), len(used))
    return block, used, meta_lore_lines, meta_memory_lines
```

- [ ] **Step 5: Raise the token budget default**

In `backend/state.py:137`, change:

```python
    "memory_v2_budget_tokens": int(os.environ.get("MEMORY_V2_BUDGET_TOKENS", "600")),
```

to:

```python
    "memory_v2_budget_tokens": int(os.environ.get("MEMORY_V2_BUDGET_TOKENS", "1000")),
```

In `backend/memory_service.py`, the `budget = int(cfg.get("memory_v2_budget_tokens") or 1000)` line from Step 4 already carries the matching fallback — no separate edit needed.

- [ ] **Step 6: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/memory_service.py').read())"`
Expected: no output.

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/state.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_memory_service.py backend/tests/test_memory_ranking.py backend/tests/test_memory_facts_repo.py backend/tests/test_memory_extraction.py -v`
Expected: PASS, all tests across all four files (confirms this task's changes didn't regress Task 1/2's work or the pre-existing extraction tests).

- [ ] **Step 8: Commit**

```bash
git add backend/memory_service.py backend/state.py backend/tests/test_memory_service.py
git commit -m "Wire scene-aware demotion and resurfacing into memory retrieval, raise token budget"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (schema) → Task 1. Section 2 (extraction tagging) → Task 3 Step 3. Section 3 (demotion via `location_matches`/`is_active`) → Task 2. Section 4 (resurfacing boost in `score`) → Task 2. Section 5 (hard cap) → Task 2 constant + Task 3 Step 4 wiring. Section 6 (wiring in `retrieve_block`) → Task 3 Step 4. Section 7 (token budget) → Task 3 Step 5. All spec sections are covered.
- **Placeholder scan:** none found — every step has complete, runnable code.
- **Type consistency:** `current_location: str | None = None` is the exact final parameter on `is_active`, `retention`, `score`, `rank` across Task 2 and every call site added in Task 3. `MAX_ACTIVE_RESERVED_FACTS` and `LOCATION_MATCH_WEIGHT` are defined once in Task 2 and referenced (not redefined) in Task 3's tests and code.
