# Memory v2 + Lore Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete legacy memory (v1) entirely, and make lore a first-class, non-decaying participant in memory_v2's ranked retrieval pool — including one-hop relationship traversal and story events being able to update lore via session-scoped overrides.

**Architecture:** `backend/lore_memory.py` (new) owns lore-candidate assembly (keyword + KNN + relationship expansion + session-override resolution) and lore-update detection/application. `backend/memory_ranking.py`/`backend/memory_block.py` gain a `source` distinction so lore candidates never decay and render under their own subheading. `backend/memory_extraction.py` gains char-state extraction (folded into the existing batch call) and lore-update-decision parsing. `backend/retrieval.py` shrinks to keyword-only lore matching; `remember()`/`_extract_turn_signal` and the legacy vector-memory functions in `backend/vectors.py` are deleted outright.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy Core (async), pgvector, pytest + pytest-asyncio (real Postgres via `db_conn` fixture — see `backend/tests/conftest.py`).

## Global Constraints

- Zero comments in any file, ever — self-documenting via naming/structure only (per CLAUDE.md).
- No bare `except:` — every caught exception either re-raises or is logged via `backend.state.log` with enough detail to diagnose.
- Never indent more than 3 levels — extract a function instead.
- Every new function with real logic gets a test alongside it in the same task.
- `backend/repositories/*.py` are plain-function modules (not classes) — matches existing pattern.
- No new database tables. No dropping the legacy `memory_vectors` table from the schema (leave `CREATE TABLE`/`CREATE INDEX` in place, harmless) — only stop code from reading/writing it.
- Reuse `session_lore.py`'s existing override mechanism for lore updates — never mutate the shared/canonical `lore` table row from memory-driven logic.
- Run tests with: `cd /var/home/staygold/ai-frontend && python3 -m pytest backend/tests/<file> -v` (uses the live `storyhaven-postgres` container already running).

---

### Task 1: `memory_facts.list_live` + `memory_facts.purge_char`

**Files:**
- Modify: `backend/repositories/memory_facts.py`
- Test: `backend/tests/test_memory_facts_repo.py`

**Interfaces:**
- Produces: `async def list_live(session_id: str, k: int = 50) -> list[dict]` (live, non-expired facts, newest `last_turn` first, same shape as `_row()`), `async def purge_char(char_id: str) -> None` (deletes all facts for a character across every session, mirrors `purge_session`).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_memory_facts_repo.py`:

```python
async def test_list_live_excludes_expired(db_conn):
    live_id = await memory_facts.insert({
        "session_id": "sess-live", "char_id": "char-1", "text": "still here",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    expired_id = await memory_facts.insert({
        "session_id": "sess-live", "char_id": "char-1", "text": "gone",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    await memory_facts.expire(expired_id)
    result = await memory_facts.list_live("sess-live")
    ids = [r["id"] for r in result]
    assert live_id in ids
    assert expired_id not in ids


async def test_list_live_orders_newest_last_turn_first(db_conn):
    older = await memory_facts.insert({
        "session_id": "sess-order", "char_id": "char-1", "text": "older",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    newer = await memory_facts.insert({
        "session_id": "sess-order", "char_id": "char-1", "text": "newer",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 5,
    }, _fake_vec())
    result = await memory_facts.list_live("sess-order")
    ids = [r["id"] for r in result]
    assert ids.index(newer) < ids.index(older)


async def test_purge_char_removes_facts_across_sessions(db_conn):
    fid_a = await memory_facts.insert({
        "session_id": "sess-a", "char_id": "char-purge", "text": "a",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    fid_b = await memory_facts.insert({
        "session_id": "sess-b", "char_id": "char-purge", "text": "b",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    await memory_facts.purge_char("char-purge")
    remaining_a = await memory_facts.list_live("sess-a")
    remaining_b = await memory_facts.list_live("sess-b")
    assert fid_a not in [r["id"] for r in remaining_a]
    assert fid_b not in [r["id"] for r in remaining_b]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_memory_facts_repo.py -v -k "list_live or purge_char"`
Expected: FAIL with `AttributeError: module 'backend.repositories.memory_facts' has no attribute 'list_live'`

- [ ] **Step 3: Implement**

Add to `backend/repositories/memory_facts.py`, after `reserved()`:

```python
async def list_live(session_id: str, k: int = 50) -> list[dict]:
    stmt = (sa.select(_tbl).where(
                _tbl.c.session_id == session_id, _tbl.c.expired_ts.is_(None))
            .order_by(_tbl.c.last_turn.desc()).limit(k))
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [_row(r._mapping) for r in rows]
```

Add after `purge_session()`:

```python
async def purge_char(char_id: str):
    async with _engine().begin() as conn:
        await conn.execute(sa.delete(_tbl).where(_tbl.c.char_id == char_id))
    log.info("memory facts purged: char=%s", char_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_memory_facts_repo.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/memory_facts.py backend/tests/test_memory_facts_repo.py
git commit -m "Add memory_facts.list_live and purge_char"
```

---

### Task 2: `session_lore_state.get_all_overrides_for_session`

**Files:**
- Modify: `backend/repositories/session_lore_state.py`
- Test: `backend/tests/test_session_lore_state_repo.py`

**Interfaces:**
- Produces: `async def get_all_overrides_for_session(session_id: str) -> dict[str, str]` (maps `lore_id -> override_content`, only entries with a non-null override).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_session_lore_state_repo.py` (check the file's existing imports/fixtures first and match them — it already tests `set_override`/`get_state`/`clear_override` against this same repo):

```python
async def test_get_all_overrides_for_session_returns_only_active_overrides(db_conn):
    await session_lore_state.set_override("sess-bulk", "lore-a", "override A", "mf-a")
    await session_lore_state.set_override("sess-bulk", "lore-b", "override B", "mf-b")
    await session_lore_state.clear_override("sess-bulk", "lore-b")
    result = await session_lore_state.get_all_overrides_for_session("sess-bulk")
    assert result == {"lore-a": "override A"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_session_lore_state_repo.py -v -k get_all_overrides`
Expected: FAIL with `AttributeError`

- [ ] **Step 3: Implement**

Add to `backend/repositories/session_lore_state.py`:

```python
async def get_all_overrides_for_session(session_id: str) -> dict[str, str]:
    rows = await _q(select(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id,
             session_lore_state.c.override_content.is_not(None))))
    return {r["lore_id"]: _decrypt_secret(r["override_content"]) for r in rows}
```

This needs `_q` imported — check the top of the file: currently imports `select, insert, update as sa_update, and_` from `sqlalchemy` and `session_lore_state, nid, _q1, _w, _encrypt_secret, _decrypt_secret` from `backend.db`. Add `_q` to that second import line.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest backend/tests/test_session_lore_state_repo.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/session_lore_state.py backend/tests/test_session_lore_state_repo.py
git commit -m "Add session_lore_state.get_all_overrides_for_session"
```

---

### Task 3: Lore candidates never decay in `memory_ranking`

**Files:**
- Modify: `backend/memory_ranking.py`
- Test: `backend/tests/test_memory_ranking.py` (new file)

**Interfaces:**
- Consumes: nothing new — extends existing `retention()`, `participants_present()`.
- Produces: candidates with `fact.get("source") == "lore"` now always score `retention() == 1.0` and always pass `participants_present()`. This is the contract Task 5 (candidate assembly) and Task 6 (packing) depend on.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_memory_ranking.py`:

```python
from backend import memory_ranking


def _lore_fact(**overrides):
    base = {
        "id": "lore-1", "source": "lore", "fact_type": "lore",
        "text": "The Sunken City lies beneath the bay.",
        "participants": [], "importance": 3, "valence": 0,
        "reinforcements": 0, "pinned": False,
        "valid_until_turn": None, "last_turn": 1, "distance": 0.1,
    }
    base.update(overrides)
    return base


def _memory_fact(**overrides):
    base = {
        "id": "mf-1", "fact_type": "event", "text": "the player arrived in town",
        "participants": ["Alice"], "importance": 3, "valence": 0,
        "reinforcements": 0, "pinned": False,
        "valid_until_turn": None, "last_turn": 1, "distance": 0.1,
    }
    base.update(overrides)
    return base


def test_lore_candidate_never_decays_regardless_of_age():
    fact = _lore_fact(last_turn=1)
    assert memory_ranking.retention(fact, current_turn=10_000) == 1.0


def test_non_lore_candidate_decays_with_age():
    fact = _memory_fact(last_turn=1, importance=1)
    assert memory_ranking.retention(fact, current_turn=10_000) < memory_ranking.RETENTION_FLOOR


def test_lore_candidate_passes_participants_filter_with_no_participants():
    fact = _lore_fact(participants=[])
    assert memory_ranking.participants_present(fact, present_lower={"alice"}) is True


def test_lore_candidate_with_no_participants_kept_by_passes_filters():
    fact = _lore_fact(participants=[])
    assert memory_ranking.passes_filters(fact, present_lower={"alice"}, current_turn=10_000) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_memory_ranking.py -v`
Expected: `test_lore_candidate_never_decays_regardless_of_age` and `test_lore_candidate_passes_participants_filter_with_no_participants` FAIL (lore isn't special-cased yet); the other two already pass against current code.

- [ ] **Step 3: Implement**

In `backend/memory_ranking.py`, modify `retention()`:

```python
def retention(fact: dict, current_turn: int) -> float:
    if fact.get("source") == "lore" or fact.get("pinned") or is_active(fact):
        return 1.0
    strength = (STRENGTH_BASE
                + STRENGTH_PER_REINFORCEMENT * fact["reinforcements"]
                + STRENGTH_PER_IMPORTANCE * fact["importance"]
                + STRENGTH_PER_VALENCE * abs(fact["valence"]))
    age = max(0, current_turn - fact["last_turn"])
    return math.exp(-age / strength)
```

Modify `participants_present()`:

```python
def participants_present(fact: dict, present_lower: set[str]) -> bool:
    if fact["fact_type"] == "world" or fact.get("source") == "lore":
        return True
    if not fact["participants"]:
        return True
    return any(p.lower() in present_lower for p in fact["participants"])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_memory_ranking.py -v`
Expected: all 4 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/memory_ranking.py backend/tests/test_memory_ranking.py
git commit -m "Make lore-sourced candidates non-decaying and always participant-eligible"
```

---

### Task 4: `memory_block` renders lore under its own subheading

**Files:**
- Modify: `backend/memory_block.py`
- Test: `backend/tests/test_memory_block.py` (new file)

**Interfaces:**
- Consumes: candidate dicts with `source` (`"lore"` or absent/`"memory"`), and for lore candidates, an optional `link_label` key.
- Produces: `build_block(pinned, active, ranked, budget_tokens)` unchanged signature; return value's `block` text now has up to three subsections: `## Established world facts` (all `source == "lore"` lines, reserved+scored combined, in packing order), `## Ongoing & pinned` (non-lore reserved), `## Recalled from earlier` (non-lore scored).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_memory_block.py`:

```python
from backend import memory_block


def _lore(id_, text, importance=3, link_label=None):
    return {
        "id": id_, "source": "lore", "fact_type": "lore", "text": text,
        "importance": importance, "valid_until_turn": None, "last_turn": 1,
        "pinned": True, "link_label": link_label,
    }


def _memory(id_, text, pinned=False, fact_type="event", importance=3):
    return {
        "id": id_, "fact_type": fact_type, "text": text, "importance": importance,
        "valid_until_turn": None, "last_turn": 1, "pinned": pinned,
    }


def test_lore_lines_render_under_established_world_facts_heading():
    pinned = [_lore("l1", "The Sunken City lies beneath the bay.")]
    block, used, dropped = memory_block.build_block(pinned, [], [], budget_tokens=600)
    assert "## Established world facts" in block
    assert "The Sunken City lies beneath the bay." in block
    assert "l1" in used
    assert dropped == []


def test_lore_line_includes_link_label_when_present():
    pinned = [_lore("l1", "Chancellor Voss", link_label="leads")]
    block, _, _ = memory_block.build_block(pinned, [], [], budget_tokens=600)
    assert "leads" in block


def test_memory_pinned_lines_render_under_ongoing_and_pinned_heading():
    pinned = [_memory("m1", "Mira was stabbed", fact_type="state", pinned=True)]
    block, used, _ = memory_block.build_block(pinned, [], [], budget_tokens=600)
    assert "## Ongoing & pinned" in block
    assert "## Established world facts" not in block
    assert "m1" in used


def test_ranked_memory_lines_render_under_recalled_heading():
    ranked = [_memory("m2", "the player arrived in town")]
    block, used, _ = memory_block.build_block([], [], ranked, budget_tokens=600)
    assert "## Recalled from earlier" in block
    assert "m2" in used


def test_mixed_pool_renders_all_three_headings():
    pinned = [_lore("l1", "world fact"), _memory("m1", "pinned fact", fact_type="state", pinned=True)]
    ranked = [_memory("m2", "recalled fact")]
    block, used, _ = memory_block.build_block(pinned, [], ranked, budget_tokens=600)
    assert "## Established world facts" in block
    assert "## Ongoing & pinned" in block
    assert "## Recalled from earlier" in block
    assert set(used) == {"l1", "m1", "m2"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_memory_block.py -v`
Expected: FAIL — current `build_block` only emits two headings and doesn't know about `source`/`link_label`.

- [ ] **Step 3: Implement**

Replace `backend/memory_block.py` in full:

```python
RESERVED_FRACTION = 0.6


def estimate_tokens(text: str) -> int:
    return len(text) // 4 + 1


def _render(fact: dict) -> str:
    if fact.get("source") == "lore":
        suffix = f" (linked: {fact['link_label']})" if fact.get("link_label") else ""
        return f"- {fact['text']}{suffix}"
    if fact["fact_type"] == "state" and fact["valid_until_turn"] is None:
        return f"- {fact['text']} (ongoing)"
    if fact["valid_until_turn"] is not None:
        return f"- {fact['text']} (this later changed)"
    return f"- {fact['text']}"


def build_block(pinned: list[dict], active: list[dict], ranked: list[dict],
                budget_tokens: int) -> tuple[str, list[str], list[str]]:
    reserved_budget = int(budget_tokens * RESERVED_FRACTION)
    ordered_reserved = (sorted(pinned, key=lambda f: -f["importance"])
                        + sorted(active, key=lambda f: (-f["importance"], -f["last_turn"])))
    reserved_facts, used_ids, dropped_ids = [], [], []
    spent = 0
    for fact in ordered_reserved:
        line = _render(fact)
        cost = estimate_tokens(line)
        if spent + cost > reserved_budget:
            dropped_ids.append(fact["id"])
            continue
        reserved_facts.append(fact)
        used_ids.append(fact["id"])
        spent += cost
    scored_facts = []
    for fact in ranked:
        if fact["id"] in used_ids:
            continue
        line = _render(fact)
        cost = estimate_tokens(line)
        if spent + cost > budget_tokens:
            break
        scored_facts.append(fact)
        used_ids.append(fact["id"])
        spent += cost
    all_facts = reserved_facts + scored_facts
    lore_lines = [_render(f) for f in all_facts if f.get("source") == "lore"]
    pinned_lines = [_render(f) for f in reserved_facts if f.get("source") != "lore"]
    recalled_lines = [_render(f) for f in scored_facts if f.get("source") != "lore"]
    parts = []
    if lore_lines:
        parts.append("## Established world facts\n" + "\n".join(lore_lines))
    if pinned_lines:
        parts.append("## Ongoing & pinned\n" + "\n".join(pinned_lines))
    if recalled_lines:
        parts.append("## Recalled from earlier\n" + "\n".join(recalled_lines))
    if not parts:
        return "", [], dropped_ids
    return "\n\n".join(parts), used_ids, dropped_ids
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_memory_block.py -v`
Expected: all 5 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/memory_block.py backend/tests/test_memory_block.py
git commit -m "Render lore candidates under their own subheading in the memory block"
```

---

### Task 5: `backend/lore_memory.py` — candidate assembly + relationship expansion

**Files:**
- Create: `backend/lore_memory.py`
- Test: `backend/tests/test_lore_memory.py` (new file)

**Interfaces:**
- Consumes: `backend.repositories.lore_links.outgoing_for_many`/`incoming_for_many` (existing, exact signatures shown in Task context below), `backend.repositories.session_lore_state.get_all_overrides_for_session` (Task 2), `backend.db.lore_by_ids`/`list_lore` (existing), `backend.vectors.search_lore_ids` (existing).
- Produces:
  - `def lore_candidate(entry: dict, current_turn: int, distance: float = 0.0, pinned: bool = False, link_label: str | None = None) -> dict` — builds the uniform candidate shape Task 3/4 expect.
  - `async def fetch_lore_candidates(char_id: str, session_id: str, keyword_entries: list[dict], query_vec, cfg: dict, current_turn: int) -> list[dict]` — returns the full merged lore candidate list (keyword-matched as pinned, KNN-matched as scored, one-hop relationship expansion added as scored, all with session overrides applied). This is what Task 6 wires into `memory_service.retrieve_block`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_lore_memory.py`. These tests exercise `lore_candidate` directly (pure) and `fetch_lore_candidates` against a fake in-memory setup — since `fetch_lore_candidates` calls real repository functions (`db.lore_by_ids`, `vectors.search_lore_ids`, `lore_links.*`, `session_lore_state.*`), test it against the real `db_conn` fixture using the existing lore/lore_links/session_lore_state repos directly (matching how `test_session_lore_router.py` already sets up lore fixtures — check that file's setup helpers first and reuse them rather than reinventing lore-creation boilerplate).

```python
from backend import lore_memory


def test_lore_candidate_shape_for_keyword_match():
    entry = {"id": "l1", "content": "The Sunken City lies beneath the bay.",
             "category": "Locations", "name": "Sunken City"}
    cand = lore_memory.lore_candidate(entry, current_turn=42, pinned=True)
    assert cand["id"] == "l1"
    assert cand["source"] == "lore"
    assert cand["text"] == "The Sunken City lies beneath the bay."
    assert cand["pinned"] is True
    assert cand["last_turn"] == 42
    assert cand["valid_until_turn"] is None
    assert cand["link_label"] is None


def test_lore_candidate_carries_link_label_and_distance():
    entry = {"id": "l2", "content": "Chancellor Voss leads the council.", "category": "", "name": ""}
    cand = lore_memory.lore_candidate(entry, current_turn=1, distance=0.3, link_label="leads")
    assert cand["distance"] == 0.3
    assert cand["link_label"] == "leads"
    assert cand["pinned"] is False


async def test_fetch_lore_candidates_includes_keyword_matches_as_pinned(db_conn):
    from backend.repositories import lore as lore_repo
    entry = await lore_repo.create({
        "char_id": "char-lm-1", "content": "The gate is sealed.", "keys": ["gate"],
        "always": True, "hidden": False, "category": "", "name": "", "owner_id": "user-1",
    })
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-lm-1", session_id="sess-lm-1",
        keyword_entries=[entry], query_vec=None,
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8}, current_turn=1)
    ids = [c["id"] for c in candidates]
    assert entry["id"] in ids
    match = next(c for c in candidates if c["id"] == entry["id"])
    assert match["pinned"] is True


async def test_fetch_lore_candidates_expands_one_hop_relationships(db_conn):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_links
    a = await lore_repo.create({
        "char_id": "char-lm-2", "content": "The Government rules the city.", "keys": ["gov"],
        "always": True, "hidden": False, "category": "", "name": "", "owner_id": "user-1",
    })
    b = await lore_repo.create({
        "char_id": "char-lm-2", "content": "Chancellor Voss leads the Government.", "keys": [],
        "always": False, "hidden": False, "category": "", "name": "", "owner_id": "user-1",
    })
    await lore_links.set_link(a["id"], b["id"], "leads")
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-lm-2", session_id="sess-lm-2",
        keyword_entries=[a], query_vec=None,
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8}, current_turn=1)
    ids = [c["id"] for c in candidates]
    assert b["id"] in ids
    expanded = next(c for c in candidates if c["id"] == b["id"])
    assert expanded["link_label"] == "leads"
    assert expanded["pinned"] is False


async def test_fetch_lore_candidates_applies_session_override_content(db_conn):
    from backend.repositories import lore as lore_repo
    from backend.repositories import session_lore_state
    entry = await lore_repo.create({
        "char_id": "char-lm-3", "content": "The Government rules the city.", "keys": ["gov"],
        "always": True, "hidden": False, "category": "", "name": "", "owner_id": "user-1",
    })
    await session_lore_state.set_override("sess-lm-3", entry["id"], "The Government was overthrown.", "mf-fake")
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-lm-3", session_id="sess-lm-3",
        keyword_entries=[entry], query_vec=None,
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8}, current_turn=1)
    match = next(c for c in candidates if c["id"] == entry["id"])
    assert match["text"] == "The Government was overthrown."
```

Before writing these, read `backend/repositories/lore.py`'s `create()` signature and `backend/tests/test_lore_repo.py`'s fixture calls to match the exact required fields — the dict shape above is illustrative; align field names exactly with what `lore.create()` actually accepts (check the file, don't guess).

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_lore_memory.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.lore_memory'`

- [ ] **Step 3: Implement**

Create `backend/lore_memory.py`:

```python
from backend import db
from backend import vectors
from backend.repositories import lore_links
from backend.repositories import session_lore_state


def lore_candidate(entry: dict, current_turn: int, distance: float = 0.0,
                   pinned: bool = False, link_label: str | None = None) -> dict:
    return {
        "id": entry["id"], "source": "lore", "fact_type": "lore",
        "text": entry["content"], "participants": [], "importance": 3, "valence": 0,
        "reinforcements": 0, "pinned": pinned, "valid_until_turn": None,
        "last_turn": current_turn, "distance": distance, "link_label": link_label,
    }


async def fetch_lore_candidates(char_id: str, session_id: str, keyword_entries: list[dict],
                                query_vec, cfg: dict, current_turn: int) -> list[dict]:
    overrides = await session_lore_state.get_all_overrides_for_session(session_id)
    seen_ids = {e["id"] for e in keyword_entries}
    candidates = [
        lore_candidate({**e, "content": overrides.get(e["id"], e["content"])},
                       current_turn, pinned=True)
        for e in keyword_entries
    ]
    if query_vec is not None:
        knn_ids = await vectors.search_lore_ids(
            char_id, query_vec, cfg["top_k_lore"], cfg["lore_max_dist"])
        new_knn_ids = [lid for lid in knn_ids if lid not in seen_ids]
        if new_knn_ids:
            knn_entries = await db.lore_by_ids(new_knn_ids)
            for e in knn_entries:
                candidates.append(lore_candidate(
                    {**e, "content": overrides.get(e["id"], e["content"])}, current_turn))
                seen_ids.add(e["id"])
    expand_ids = [c["id"] for c in candidates]
    if expand_ids:
        outgoing = await lore_links.outgoing_for_many(expand_ids)
        incoming = await lore_links.incoming_for_many(expand_ids)
        neighbor_labels: dict[str, str] = {}
        for links in outgoing.values():
            for link in links:
                if link["target_id"] not in seen_ids:
                    neighbor_labels.setdefault(link["target_id"], link["label"])
        for links in incoming.values():
            for link in links:
                if link["source_id"] not in seen_ids:
                    neighbor_labels.setdefault(link["source_id"], link["label"])
        if neighbor_labels:
            neighbor_entries = await db.lore_by_ids(list(neighbor_labels))
            for e in neighbor_entries:
                candidates.append(lore_candidate(
                    {**e, "content": overrides.get(e["id"], e["content"])},
                    current_turn, link_label=neighbor_labels[e["id"]] or None))
                seen_ids.add(e["id"])
    return candidates
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_lore_memory.py -v`
Expected: all PASS. If field-name mismatches surface against `lore.create()`'s real signature, fix the test fixtures (not the implementation) to match the real repository contract.

- [ ] **Step 5: Commit**

```bash
git add backend/lore_memory.py backend/tests/test_lore_memory.py
git commit -m "Add lore_memory.fetch_lore_candidates: keyword+KNN+relationship expansion+overrides"
```

---

### Task 6: Wire lore candidates into `memory_service.retrieve_block`

**Files:**
- Modify: `backend/memory_service.py`
- Test: `backend/tests/test_memory_service.py` (new file — none exists yet)

**Interfaces:**
- Consumes: `lore_memory.fetch_lore_candidates` (Task 5), `memory_block.build_block` (Task 4, now returns 3-tuple same as before — signature unchanged), `memory_ranking.rank` (Task 3).
- Produces: `retrieve_block(session, char, user_name, query, msgs, cfg, keyword_lore_entries, viewer_id=None, embed_base=None, embed_key=None) -> tuple[str, list[str], list[str], list[str]]` — `(block_text, used_ids, meta_lore_lines, meta_memory_lines)`. The new `keyword_lore_entries` parameter and the two new meta-line return values are the breaking changes downstream Task 7 must account for.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_memory_service.py`. This exercises `retrieve_block` end-to-end against real repos with a fake embed function (monkeypatched, since real embedding requires a live LLM endpoint unavailable in test) — follow the mocking pattern already used in `backend/tests/test_session_lore_router.py` for embedding/LLM calls (check that file for the exact monkeypatch target before writing this, and reuse the same approach rather than inventing a new one).

```python
import pytest

from backend import memory_service


pytestmark = pytest.mark.asyncio


async def test_retrieve_block_returns_empty_for_blank_query(db_conn):
    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-rb-1", "known_names": "[]"},
        char={"id": "char-rb-1", "name": "Test"},
        user_name="Player", query="", msgs=[], cfg={}, keyword_lore_entries=[])
    assert block == ""
    assert used == []
    assert lore_lines == []
    assert mem_lines == []


async def test_retrieve_block_includes_keyword_lore_in_meta_lines(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    entry = {"id": "l-rb-1", "content": "The gate is sealed.", "category": "", "name": ""}
    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-rb-2", "known_names": "[]"},
        char={"id": "char-rb-2", "name": "Test"},
        user_name="Player", query="tell me about the gate",
        msgs=[{"role": "user", "content": "tell me about the gate"}],
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8, "memory_v2_budget_tokens": 600},
        keyword_lore_entries=[entry])
    assert "The gate is sealed." in lore_lines
    assert "## Established world facts" in block
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_memory_service.py -v`
Expected: FAIL — `retrieve_block` doesn't accept `keyword_lore_entries` yet and returns a 2-tuple, not 4-tuple.

- [ ] **Step 3: Implement**

In `backend/memory_service.py`, add the import (top of file, alongside existing imports):

```python
from backend import lore_memory
```

Replace `retrieve_block`:

```python
async def retrieve_block(session: dict, char: dict, user_name: str, query: str,
                         msgs: list[dict], cfg: dict, keyword_lore_entries: list[dict],
                         viewer_id: str | None = None,
                         embed_base: str | None = None,
                         embed_key: str | None = None) -> tuple[str, list[str], list[str], list[str]]:
    sid = session["id"]
    turn = current_turn(msgs)
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
    ranked_memory = []
    if qvec is not None:
        candidates = await memory_facts.similar_live(sid, qvec, CANDIDATE_K)
        ranked_memory = memory_ranking.rank(candidates, present, turn)
    guaranteed = await memory_facts.reserved(sid)
    pinned = [f for f in guaranteed if f.get("pinned")]
    active = [f for f in guaranteed if not f.get("pinned")
              and memory_ranking.participants_present(f, present_lower)]
    lore_pinned = [c for c in lore_candidates if c["pinned"]]
    lore_scored = memory_ranking.rank(
        [c for c in lore_candidates if not c["pinned"]], present, turn)
    budget = int(cfg.get("memory_v2_budget_tokens") or 600)
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

Note `memory_block._render` is being called from outside its module here (underscore-prefixed but used cross-module) — this is acceptable since `memory_block.py` and `memory_service.py` are tightly coupled collaborators in the same subsystem (same pattern as other `_`-prefixed helpers reused within a feature's own module cluster elsewhere in this codebase), but if code review objects, rename `_render` to `render` (drop the underscore) in Task 4 instead — a one-line change, flag it there if so.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_memory_service.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/memory_service.py backend/tests/test_memory_service.py
git commit -m "Wire lore candidates into memory_service.retrieve_block"
```

---

### Task 7: Char-state extraction folds into the batch call

**Files:**
- Modify: `backend/memory_extraction.py`
- Modify: `backend/memory_service.py`
- Test: `backend/tests/test_memory_extraction.py` (new file)

**Interfaces:**
- Produces: `class CharStateDraft(BaseModel)` (`doing: str`, `location: str`, `npcs: list[str]`) in `memory_extraction.py`. `run_extract(...)` now returns `tuple[list[FactDraft], CharStateDraft]` instead of `list[FactDraft]` — this is a breaking signature change, Task 6's caller in `memory_service.extract_batch` (modified in this task) is the only caller.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_memory_extraction.py`:

```python
import pytest

from backend.memory_extraction import (
    CharStateDraft, build_extract_prompt, parse_extract_response,
)

pytestmark = pytest.mark.asyncio


def test_parse_extract_response_splits_facts_and_char_state():
    raw = (
        '{"facts": [{"text": "The player arrived in town.", "fact_type": "event", '
        '"participants": [], "importance": 3, "valence": 0}], '
        '"char_state": {"doing": "standing watch", "location": "the town gate", "npcs": ["Mira"]}}'
    )
    facts, char_state = parse_extract_response(raw)
    assert len(facts) == 1
    assert facts[0].text == "The player arrived in town."
    assert char_state.doing == "standing watch"
    assert char_state.location == "the town gate"
    assert char_state.npcs == ["Mira"]


def test_parse_extract_response_defaults_missing_char_state_to_empty():
    raw = '{"facts": [], "char_state": {"doing": "", "location": "", "npcs": []}}'
    facts, char_state = parse_extract_response(raw)
    assert facts == []
    assert char_state.doing == ""
    assert char_state.npcs == []


def test_build_extract_prompt_requests_combined_shape():
    prompt = build_extract_prompt("Player: hi\nChar: hello", "Char", "Player", "English")
    assert '"facts"' in prompt
    assert '"char_state"' in prompt
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_memory_extraction.py -v`
Expected: FAIL — `parse_extract_response` doesn't exist yet, `build_extract_prompt` doesn't mention `char_state`.

- [ ] **Step 3: Implement**

In `backend/memory_extraction.py`, add after the `FactDraft` class:

```python
class CharStateDraft(BaseModel):
    doing: str = ""
    location: str = ""
    npcs: list[str] = []
```

Replace `EXTRACT_EXAMPLE` and `build_extract_prompt`:

```python
EXTRACT_EXAMPLE = (
    '{"facts": [{"text": "Mira was stabbed in the left shoulder during the ambush.", '
    '"fact_type": "state", "participants": ["Mira"], "importance": 5, "valence": -2},\n'
    '{"text": "The mine outside Kelder collapsed.", "fact_type": "world", '
    '"participants": [], "importance": 3, "valence": -1}],\n'
    '"char_state": {"doing": "tending to Mira\'s wound", "location": "the collapsed mine entrance", '
    '"npcs": ["Mira"]}}'
)


def build_extract_prompt(transcript: str, char_name: str, user_name: str, language: str) -> str:
    return (
        f"Analyze this roleplay story between {user_name} and {char_name}.\n"
        "List facts worth remembering many scenes from now, and the current scene state.\n"
        "Fact types: event (something happened), state (an ongoing unresolved condition: injury, "
        "promise, debt, live conflict, or a mood that persists beyond this exchange), relationship "
        "(how two people relate), world (a fact about the world involving no specific person), "
        "profile (a lasting trait of a person). A trailing [mood: X] tag on a character's line is "
        "their current emotional state — only turn it into a state fact if it reflects something "
        "lasting (e.g. a grudge, a fear taking hold), not a passing reaction to one line.\n"
        f"Each fact: one short third-person sentence in {language}; copy proper names exactly as "
        "written; participants = the people the fact is about; importance 1 (trivial) to 5 "
        "(pivotal); valence -2 (very negative) to 2 (very positive). facts is [] if nothing lasting "
        "happened.\n"
        f"char_state: doing = a short phrase (in {language}) describing what {char_name} is doing "
        f"or experiencing right now, or empty string; location = a short phrase (in {language}) "
        "describing where the current scene is taking place, or empty string; npcs = proper names "
        f"of named characters mentioned in this exchange, excluding {char_name} and {user_name} — "
        "empty array if none. Never translate, transliterate, or alter proper names in any field.\n\n"
        f"Example output:\n{EXTRACT_EXAMPLE}\n\n"
        f"Transcript:\n{transcript}\n\n"
        "Reply with only a JSON object in exactly the example's format."
    )
```

Replace `parse_extraction` with `parse_extract_response`:

```python
def parse_extract_response(raw: str) -> tuple[list[FactDraft], CharStateDraft]:
    data = json.loads(strip_json_fence(raw))
    if not isinstance(data, dict):
        raise ValueError("expected a JSON object with facts and char_state")
    try:
        facts = [FactDraft.model_validate(item) for item in (data.get("facts") or [])]
        char_state = CharStateDraft.model_validate(data.get("char_state") or {})
    except ValidationError as e:
        raise ValueError(str(e)) from e
    return facts[:MAX_FACTS_PER_BATCH], char_state
```

Update `run_extract`'s body (keep the retry/fallback wrapper, change what it calls and returns):

```python
async def run_extract(transcript: str, char_name: str, user_name: str, language: str,
                      model: str, base_url: str | None = None,
                      api_key: str | None = None) -> tuple[list[FactDraft], CharStateDraft]:
    prompt = build_extract_prompt(transcript, char_name, user_name, language)
    try:
        return await _call_validated(prompt, parse_extract_response, model, base_url, api_key, "extract")
    except Exception as e:
        log.warning("memory extract batch dropped after retry: %s", e)
        return [], CharStateDraft()
```

Note: `parse_extraction`'s old callers — grep for `parse_extraction` across the codebase before deleting it entirely; if nothing outside this file calls it directly (only `run_extract` did), it's safe to remove. Leave `_load_array` alone — it's still used by `parse_reconcile`.

In `backend/memory_service.py`, modify `extract_batch` to accept and apply the char-state result. Add these imports at the top if not already present: `from backend.repositories import chat_sessions` (already imported). Replace the body of `extract_batch`:

```python
async def extract_batch(sid: str, char_id: str, char_name: str, user_name: str,
                        batch: list[tuple[dict, dict]], turn: int, language: str, model: str,
                        prev_session: dict, chat_base: str | None = None, chat_key: str | None = None,
                        embed_base: str | None = None, embed_key: str | None = None) -> dict:
    log.info("memory extract start: session=%s turn=%s batch=%d exchanges", sid, turn, len(batch))
    drafts, char_state = await run_extract(_transcript(batch, char_name, user_name),
                                           char_name, user_name, language, model, chat_base, chat_key)
    try:
        known = set(json.loads(prev_session.get("known_names") or "[]"))
        known.update(char_state.npcs)
        await chat_sessions.set_char_state(
            sid,
            doing=char_state.doing or prev_session.get("char_doing"),
            location=char_state.location or prev_session.get("char_location"),
            known_names=sorted(known))
    except Exception as e:
        log.warning("character-state update failed for session %s turn %s: %s", sid, turn, e)
    stats = {"facts": len(drafts), "added": 0, "reinforced": 0, "superseded": 0}
    if not drafts:
        log.info("memory extract done: session=%s turn=%s no facts", sid, turn)
        return stats
    vecs, neighbors = [], []
    for draft in drafts:
        vec = await llm.embed(draft.text, CFG["embed_model"],
                              base_url=embed_base, api_key=embed_key)
        vecs.append(vec)
        neighbors.append(await memory_facts.similar_live(sid, vec, NEIGHBOR_K))
    decisions = await run_reconcile(drafts, neighbors, model, chat_base, chat_key)
    for decision in decisions:
        draft, vec = drafts[decision.index], vecs[decision.index]
        fact = draft.model_dump()
        if fact["fact_type"] != "world" and not fact["participants"]:
            fact["participants"] = [user_name, char_name]
        fact.update(session_id=sid, char_id=char_id, turn=turn)
        if decision.action == "add":
            await memory_facts.insert(fact, vec)
            stats["added"] += 1
        elif decision.action == "reinforce":
            await memory_facts.reinforce(decision.target_id, turn)
            stats["reinforced"] += 1
        else:
            await memory_facts.supersede(decision.target_id, fact, vec, turn)
            stats["superseded"] += 1
    log.info("memory extract done: session=%s turn=%s facts=%d added=%d reinforced=%d superseded=%d",
             sid, turn, stats["facts"], stats["added"], stats["reinforced"], stats["superseded"])
    return stats
```

Update `maybe_extract` to pass `session` through as `prev_session`:

```python
async def maybe_extract(session: dict, char: dict, user_name: str, language: str, model: str,
                        chat_base: str | None = None, chat_key: str | None = None,
                        embed_base: str | None = None, embed_key: str | None = None):
    sid = session["id"]
    msgs = await chat_sessions.list_messages(sid)
    pairs = exchanges(msgs)
    settled = max(0, len(pairs) - SETTLE_MARGIN_EXCHANGES)
    cursor = await memory_facts.get_cursor(sid)
    while settled - cursor >= BATCH_SIZE:
        batch = pairs[cursor:cursor + BATCH_SIZE]
        turn = cursor + BATCH_SIZE
        await extract_batch(sid, char["id"], char["name"], user_name, batch, turn,
                            language, model, session, chat_base, chat_key, embed_base, embed_key)
        cursor = turn
        await memory_facts.set_cursor(sid, cursor)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_memory_extraction.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/memory_extraction.py backend/memory_service.py backend/tests/test_memory_extraction.py
git commit -m "Fold char-state extraction into the batched memory-extraction call"
```

---

### Task 8: Lore-update detection and application

**Files:**
- Modify: `backend/memory_extraction.py`
- Modify: `backend/lore_memory.py`
- Modify: `backend/routers/session_lore.py` (dedupe override-apply logic against the new shared helper)
- Test: `backend/tests/test_memory_extraction.py` (extend)
- Test: `backend/tests/test_lore_memory.py` (extend)

**Interfaces:**
- Produces (`memory_extraction.py`): `class LoreUpdateDecision(BaseModel)` (`index: int`, `lore_id: str`, `new_content: str`), `def build_lore_update_prompt(drafts, lore_neighbors) -> str`, `def parse_lore_updates(raw, fact_count, valid_lore_ids) -> list[LoreUpdateDecision]`, `async def run_lore_update_detection(drafts, lore_neighbors, model, base_url=None, api_key=None) -> list[LoreUpdateDecision]`.
- Produces (`lore_memory.py`): `async def apply_session_lore_override(session_id: str, char_id: str, lore_id: str, content: str) -> str` (returns the fact id — this is the extracted, shared version of the insert-or-update logic currently duplicated inline in `session_lore.py`'s `set_session_lore_override`), `async def detect_and_apply_lore_updates(session_id: str, char_id: str, drafts: list[FactDraft], model: str, chat_base: str | None, chat_key: str | None, embed_base: str | None, embed_key: str | None) -> dict` (stats: `{"checked": int, "applied": int}`).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_memory_extraction.py`:

```python
from backend.memory_extraction import (
    FactDraft, LoreUpdateDecision, build_lore_update_prompt, parse_lore_updates,
)


def test_parse_lore_updates_valid_decision():
    raw = '[{"index": 0, "lore_id": "l-abc", "new_content": "The government was overthrown."}]'
    decisions = parse_lore_updates(raw, fact_count=1, valid_lore_ids={"l-abc"})
    assert len(decisions) == 1
    assert decisions[0].lore_id == "l-abc"
    assert decisions[0].new_content == "The government was overthrown."


def test_parse_lore_updates_empty_array_means_no_updates():
    decisions = parse_lore_updates("[]", fact_count=2, valid_lore_ids={"l-abc"})
    assert decisions == []


def test_parse_lore_updates_rejects_unknown_lore_id():
    raw = '[{"index": 0, "lore_id": "l-unknown", "new_content": "x"}]'
    with pytest.raises(ValueError):
        parse_lore_updates(raw, fact_count=1, valid_lore_ids={"l-abc"})


def test_build_lore_update_prompt_allows_no_update_answer():
    draft = FactDraft(text="the player overthrew the government", fact_type="event",
                      participants=[], importance=5, valence=1)
    prompt = build_lore_update_prompt([draft], [[{"id": "l-abc", "text": "The government rules the city."}]])
    assert "no update" in prompt.lower() or "[]" in prompt
```

Add to `backend/tests/test_lore_memory.py`:

```python
async def test_apply_session_lore_override_creates_pinned_fact_and_state(db_conn, monkeypatch):
    from backend.repositories import session_lore_state
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    fact_id = await lore_memory.apply_session_lore_override(
        "sess-apply-1", "char-apply-1", "lore-apply-1", "The government was overthrown.")
    assert fact_id
    state = await session_lore_state.get_state("sess-apply-1", "lore-apply-1")
    assert state["override_content"] == "The government was overthrown."
    assert state["override_fact_id"] == fact_id


async def test_apply_session_lore_override_updates_existing_override(db_conn, monkeypatch):
    from backend.repositories import session_lore_state
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    first_id = await lore_memory.apply_session_lore_override(
        "sess-apply-2", "char-apply-2", "lore-apply-2", "first version")
    second_id = await lore_memory.apply_session_lore_override(
        "sess-apply-2", "char-apply-2", "lore-apply-2", "second version")
    assert first_id == second_id
    state = await session_lore_state.get_state("sess-apply-2", "lore-apply-2")
    assert state["override_content"] == "second version"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_memory_extraction.py backend/tests/test_lore_memory.py -v -k "lore_update or apply_session_lore_override"`
Expected: FAIL — none of these names exist yet.

- [ ] **Step 3: Implement**

In `backend/memory_extraction.py`, add after `ReconcileDecision`:

```python
class LoreUpdateDecision(BaseModel):
    index: int = Field(ge=0)
    lore_id: str
    new_content: str = Field(min_length=1)
```

Add after `build_reconcile_prompt`:

```python
def build_lore_update_prompt(drafts: list[FactDraft], lore_neighbors: list[list[dict]]) -> str:
    new_lines, neighbor_lines = [], []
    for i, draft in enumerate(drafts):
        new_lines.append(f"{i}. {draft.text}")
        near = lore_neighbors[i] if i < len(lore_neighbors) else []
        if near:
            shown = "; ".join(f"[lore_id={n['id']}] {n['text']}" for n in near)
        else:
            shown = "(none)"
        neighbor_lines.append(f"{i}. {shown}")
    return (
        "You maintain a story's world lorebook. For each NEW fact, check its NEARBY existing lore "
        "entries — does this fact make any of them factually outdated (a change of ruler, an "
        "overthrown government, a destroyed location, a died character)? Most facts update nothing "
        "— only flag a genuine, clear contradiction or supersession, not a minor detail or something "
        "that could simply be added alongside the existing lore without contradicting it.\n\n"
        "NEW facts:\n" + "\n".join(new_lines) + "\n\n"
        "NEARBY lore entries:\n" + "\n".join(neighbor_lines) + "\n\n"
        'Example output (only include facts that genuinely update lore):\n'
        '[{"index": 0, "lore_id": "l_abc", "new_content": "The government was overthrown by '
        'the player; the old ruling council no longer holds power."}]\n\n'
        "Reply with only a JSON array — one entry per fact that updates lore, [] if none do."
    )


def parse_lore_updates(raw: str, fact_count: int, valid_lore_ids: set[str]) -> list[LoreUpdateDecision]:
    data = _load_array(raw)
    try:
        decisions = [LoreUpdateDecision.model_validate(item) for item in data]
    except ValidationError as e:
        raise ValueError(str(e)) from e
    for d in decisions:
        if d.index >= fact_count:
            raise ValueError(f"index {d.index} out of range for {fact_count} facts")
        if d.lore_id not in valid_lore_ids:
            raise ValueError(f"unknown lore_id {d.lore_id}")
    return decisions
```

Add after `run_reconcile`:

```python
async def run_lore_update_detection(drafts: list[FactDraft], lore_neighbors: list[list[dict]],
                                    model: str, base_url: str | None = None,
                                    api_key: str | None = None) -> list[LoreUpdateDecision]:
    if not drafts or not any(lore_neighbors):
        return []
    valid_lore_ids = {n["id"] for near in lore_neighbors for n in near}
    prompt = build_lore_update_prompt(drafts, lore_neighbors)
    parse = lambda raw: parse_lore_updates(raw, len(drafts), valid_lore_ids)
    try:
        return await _call_validated(prompt, parse, model, base_url, api_key, "lore_update")
    except Exception as e:
        log.warning("lore update detection failed after retry, applying no updates: %s", e)
        return []
```

In `backend/lore_memory.py`, add imports for `llm`, `CFG` from `backend.state`, and `memory_facts`:

```python
from backend import llm
from backend.state import CFG, log
from backend.repositories import memory_facts
from backend.memory_extraction import run_lore_update_detection
```

Add:

```python
NEIGHBOR_K = 3


async def apply_session_lore_override(session_id: str, char_id: str, lore_id: str, content: str) -> str:
    vec = await llm.embed(content, CFG["embed_model"])
    existing = await session_lore_state.get_state(session_id, lore_id)
    if existing and existing.get("override_fact_id"):
        await memory_facts.update_text(existing["override_fact_id"], content, vec)
        fact_id = existing["override_fact_id"]
    else:
        fact_id = await memory_facts.insert({
            "session_id": session_id, "char_id": char_id, "text": content,
            "fact_type": "state", "participants": [], "importance": 5, "valence": 0, "turn": 0,
        }, vec, pinned=True)
    await session_lore_state.set_override(session_id, lore_id, content, fact_id)
    return fact_id


async def detect_and_apply_lore_updates(session_id: str, char_id: str, drafts: list,
                                        model: str, chat_base: str | None, chat_key: str | None,
                                        embed_base: str | None, embed_key: str | None) -> dict:
    stats = {"checked": len(drafts), "applied": 0}
    if not drafts:
        return stats
    lore_neighbors = []
    for draft in drafts:
        try:
            vec = await llm.embed(draft.text, CFG["embed_model"], base_url=embed_base, api_key=embed_key)
            ids = await vectors.search_lore_ids(char_id, vec, NEIGHBOR_K, CFG["lore_max_dist"])
            entries = await db.lore_by_ids(ids) if ids else []
            lore_neighbors.append([{"id": e["id"], "text": e["content"]} for e in entries])
        except Exception as e:
            log.warning("lore-update neighbor search failed session=%s: %s: %s",
                        session_id, type(e).__name__, e)
            lore_neighbors.append([])
    decisions = await run_lore_update_detection(drafts, lore_neighbors, model, chat_base, chat_key)
    for decision in decisions:
        try:
            await apply_session_lore_override(session_id, char_id, decision.lore_id, decision.new_content)
            stats["applied"] += 1
            log.info("lore_memory: session-scoped override applied session=%s lore=%s",
                     session_id, decision.lore_id)
        except Exception as e:
            log.warning("lore-update apply failed session=%s lore=%s: %s: %s",
                        session_id, decision.lore_id, type(e).__name__, e)
    return stats
```

Now dedupe `backend/routers/session_lore.py`'s `set_session_lore_override` to use the shared helper. Replace this block (the one with the `existing.get("override_fact_id")` branch, inside `set_session_lore_override`):

```python
    vec = await llm.embed(body.content, CFG["embed_model"])
    existing = await sls.get_state(sid, lid)
    if existing and existing.get("override_fact_id"):
        await memory_facts.update_text(existing["override_fact_id"], body.content, vec)
        fact_id = existing["override_fact_id"]
    else:
        fact_id = await memory_facts.insert({
            "session_id": sid, "char_id": session["char_id"], "text": body.content,
            "fact_type": "state", "participants": [], "importance": 5, "valence": 0, "turn": 0,
        }, vec, pinned=True)
    await sls.set_override(sid, lid, body.content, fact_id)
    log.info("session_lore: override set session=%s lore=%s fact=%s by=%s",
             sid, lid, fact_id, current_user["username"])
```

with:

```python
    fact_id = await lore_memory.apply_session_lore_override(
        sid, session["char_id"], lid, body.content)
    log.info("session_lore: override set session=%s lore=%s fact=%s by=%s",
             sid, lid, fact_id, current_user["username"])
```

Add `from backend import lore_memory` to `session_lore.py`'s imports. The `llm` import in that file may now be unused — check after the edit (`_translate_for_session`/`reveal_lore_secret` still use `llm.embed` directly, so it stays; `CFG`/`memory_facts` imports may become partially unused, verify with a grep before removing anything).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_memory_extraction.py backend/tests/test_lore_memory.py backend/tests/test_session_lore_router.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/memory_extraction.py backend/lore_memory.py backend/routers/session_lore.py backend/tests/test_memory_extraction.py backend/tests/test_lore_memory.py
git commit -m "Add lore-update detection: memory can now propose session-scoped lore overrides"
```

---

### Task 9: Wire lore-update detection into the batch extraction flow

**Files:**
- Modify: `backend/memory_service.py`
- Test: `backend/tests/test_memory_service.py` (extend)

**Interfaces:**
- Consumes: `lore_memory.detect_and_apply_lore_updates` (Task 8).
- Produces: `extract_batch`'s return `stats` dict gains a `lore_updates_applied: int` key.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_memory_service.py`:

```python
async def test_extract_batch_calls_lore_update_detection(db_conn, monkeypatch):
    calls = []
    async def fake_detect(session_id, char_id, drafts, *args, **kwargs):
        calls.append((session_id, char_id, drafts))
        return {"checked": len(drafts), "applied": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_apply_lore_updates", fake_detect)
    async def fake_run_extract(*args, **kwargs):
        from backend.memory_extraction import FactDraft, CharStateDraft
        return [FactDraft(text="a fact", fact_type="event", participants=[],
                          importance=3, valence=0)], CharStateDraft()
    monkeypatch.setattr("backend.memory_service.run_extract", fake_run_extract)
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    async def fake_reconcile(*args, **kwargs):
        from backend.memory_extraction import ReconcileDecision
        return [ReconcileDecision(index=0, action="add")]
    monkeypatch.setattr("backend.memory_service.run_reconcile", fake_reconcile)

    stats = await memory_service.extract_batch(
        "sess-eb-1", "char-eb-1", "Char", "Player", [({"content": "hi", "role": "user"},
        {"content": "hello", "role": "assistant", "mood": None})], turn=5,
        language="English", model="test-model", prev_session={"known_names": "[]"})
    assert len(calls) == 1
    assert stats["lore_updates_applied"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_memory_service.py -v -k lore_update_detection`
Expected: FAIL — `extract_batch` never calls `lore_memory.detect_and_apply_lore_updates`, and `stats` has no `lore_updates_applied` key.

- [ ] **Step 3: Implement**

In `backend/memory_service.py`, add `from backend import lore_memory` to the imports (if not already added in Task 6 — it was, for `retrieve_block`; reuse the same import). In `extract_batch`, after the `decisions`/`for decision in decisions:` loop and before the final `log.info`/`return stats` lines, add:

```python
    lore_stats = await lore_memory.detect_and_apply_lore_updates(
        sid, char_id, drafts, model, chat_base, chat_key, embed_base, embed_key)
    stats["lore_updates_applied"] = lore_stats["applied"]
```

And update the final log line to include it:

```python
    log.info("memory extract done: session=%s turn=%s facts=%d added=%d reinforced=%d superseded=%d lore_updates=%d",
             sid, turn, stats["facts"], stats["added"], stats["reinforced"], stats["superseded"],
             stats["lore_updates_applied"])
```

Also fix the earlier `if not drafts:` early-return branch (which returns `stats` before the lore-update call) to include the key for consistency:

```python
    if not drafts:
        stats["lore_updates_applied"] = 0
        log.info("memory extract done: session=%s turn=%s no facts", sid, turn)
        return stats
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_memory_service.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/memory_service.py backend/tests/test_memory_service.py
git commit -m "Call lore-update detection at the end of every extraction batch"
```

---

### Task 10: Shrink `retrieval.py` to keyword-only lore matching; delete v1 memory functions

**Files:**
- Modify: `backend/retrieval.py`
- Modify: `backend/vectors.py`

**Interfaces:**
- Produces: `retrieval.retrieve(char_id, session_id, query, recent, viewer_id=None) -> tuple[list[dict], str | None]` — now returns matched lore **entry dicts** (not pre-joined strings) plus an optional error, dropping the `exclude_mid`/`cfg`/`embed_base`/`embed_key` params entirely (no embedding happens here anymore) and dropping `mem_lines` from the return entirely.
- Removes: `retrieval.remember`, `retrieval._extract_turn_signal`, `retrieval.index_lore` stays (still used by lore create/update), `vectors.store_memory`, `vectors.search_memory`, `vectors.list_memory`, `vectors.search_memory_scored`.

This task has no new automated test of its own — it's a deletion/narrowing task whose correctness is verified by Task 11 (the `chat_service.py` integration) still passing its own tests, and by the full test suite (Step 4 below) staying green. Every function being removed here already had zero test coverage per the original audit, so there's nothing to un-test.

- [ ] **Step 1: Replace `backend/retrieval.py` in full**

```python
"""Keyword-triggered lore matching for a chat turn, and the lore-embedding
entry point (index_lore()) called on lore create/update. Semantic lore
retrieval, relationship expansion, and all memory retrieval/extraction now
live in backend/lore_memory.py and backend/memory_service.py."""
from backend import db
from backend import vectors
from backend import llm
from backend.state import CFG, log


async def index_lore(lid, char_id, content, name: str = "", category: str = ""):
    """Embeds name/category alongside the body content, not content alone —
    entries are often written assuming their own title provides context (e.g.
    a "Sunken City" entry whose content never repeats that name), so semantic
    search on content-only text can miss exactly the query it should match.
    Category groups related entries under a shared label the author chose, so
    including it helps a query for the general topic surface the right entry
    even when the content wording doesn't overlap with the query."""
    try:
        prefix = ", ".join(p for p in (category, name) if p)
        embed_text = f"{prefix}: {content}" if prefix else content
        vec = await llm.embed(embed_text, CFG["embed_model"])
        await vectors.store_lore_vector(lid, char_id, vec)
    except Exception as e:
        log.warning("lore embedding failed for %s: %s", lid, e)


async def retrieve(char_id, session_id, query, recent, viewer_id: str | None = None) -> tuple[list[dict], None]:
    """Keyword-triggered lore matching only — always-on entries and entries whose
    keys substring-match the recent conversation text. No embedding call, no LLM
    call; this must stay cheap and instant every turn. Semantic (KNN) matching and
    relationship expansion happen in backend/lore_memory.fetch_lore_candidates."""
    rt = (recent or "").lower()
    matched = []
    for e in await db.list_lore(char_id, viewer_id):
        if e["always"] or any(k.lower() in rt for k in e["keys"]):
            matched.append(e)
    return matched, None
```

- [ ] **Step 2: Remove the deleted functions from `backend/vectors.py`**

Delete `store_memory`, `search_memory`, `list_memory`, `search_memory_scored` (the four functions under the `# Memory` section header) from `backend/vectors.py`. Keep `delete_memory` for now (still referenced by `chat_service.py`'s regenerate path until Task 11 removes that call too — check Task 11 before deleting `delete_memory`; if nothing calls it after Task 11, remove it then instead, not here, to keep this task's diff focused on `retrieve()`'s shape change).

Leave `_build_tables()`, `ensure_indexes()`, `MEM_INDEX`, `_mem_tbl` in place — the schema itself is untouched per the plan's global constraints (no dropping tables).

Narrow `delete_by_tag` to lore-only, since after Task 11 nothing will call it with `MEM_INDEX` anymore:

```python
async def delete_by_tag(field: str, value: str):
    """Bulk-delete lore vectors matching a scope tag — a single scoped DELETE.
    `field` is 'session' or 'chartag' as used by callers."""
    try:
        col = _lore_tbl.c.session_id if field == "session" else _lore_tbl.c.char_id
        async with _engine().begin() as conn:
            await conn.execute(sa.delete(_lore_tbl).where(col == value))
    except Exception as e:
        log.warning("delete_by_tag(%s=%s) failed: %s", field, value, e)
```

Note `_lore_tbl` has no `session_id` column (only `lore_id`, `char_id`, `embedding` per `_build_tables`) — check actual current callers of `delete_by_tag` before finalizing this signature. Grep `delete_by_tag` call sites (`backend/routers/sessions.py`, `backend/routers/characters.py`, `backend/routers/chat.py`) — Task 11 changes all three to call `memory_facts.purge_session`/`purge_char` instead for the memory half, and only `characters.py`'s `vectors.delete_by_tag(vectors.LORE_INDEX, "chartag", cid)` call survives as a lore-vector cleanup — so `delete_by_tag` only ever needs the `chartag` path against `_lore_tbl` post-Task-11. Simplify accordingly:

```python
async def delete_lore_vectors_by_char(char_id: str):
    try:
        async with _engine().begin() as conn:
            await conn.execute(sa.delete(_lore_tbl).where(_lore_tbl.c.char_id == char_id))
    except Exception as e:
        log.warning("delete_lore_vectors_by_char(%s) failed: %s", char_id, e)
```

Remove `delete_by_tag` and `MEM_INDEX`/`LORE_INDEX` constants entirely in favor of this one purpose-built function — simpler than a generic tag-based deleter with only one real caller left. Update Task 11's `characters.py` edit to call `vectors.delete_lore_vectors_by_char(cid)` instead of `vectors.delete_by_tag(vectors.LORE_INDEX, "chartag", cid)`.

- [ ] **Step 3: Run the full existing test suite to check for breakage**

Run: `python3 -m pytest backend/tests/ -v 2>&1 | tail -60`
Expected: failures in `backend/routers/lore.py` (still imports `index_lore` — unaffected, signature unchanged) should NOT appear. Failures are expected in `chat_service.py`-dependent tests (if any) and anywhere still calling the old `retrieve()`/`remember()` signatures — Task 11 fixes those. If this task's own change to `vectors.py`/`retrieval.py` introduces syntax errors, fix them now; do not fix unrelated call-site breakage here, that's explicitly Task 11's job.

- [ ] **Step 4: Commit**

```bash
git add backend/retrieval.py backend/vectors.py
git commit -m "Shrink retrieval.py to keyword-only lore matching; delete v1 memory vector functions"
```

---

### Task 11: Rewire `chat_service.py` — delete `remember()`/`_extract_turn_signal` usage, unify the prompt block

**Files:**
- Modify: `backend/chat_service.py`

**Interfaces:**
- Consumes: `retrieval.retrieve` (Task 10's new signature), `memory_service.retrieve_block` (Task 6's new signature), `memory_service.maybe_extract` (Task 7, unchanged call signature).

No new isolated unit test for this task — it's glue code in `_run`, already covered end-to-end by whatever integration/router tests exist (`test_session_lore_router.py` exercises this path indirectly). Verify via Step 4 (manual smoke check against the live app, since this is exactly the kind of "live-editing container" change CLAUDE.md describes — the running `story-game` container picks up `.py` edits via `uvicorn --reload` automatically) rather than a new automated test, since `_run` itself has no existing test harness to extend and building one from scratch is out of this plan's scope.

- [ ] **Step 1: Update imports**

In `backend/chat_service.py`, change:

```python
from backend.retrieval import retrieve, remember
```

to:

```python
from backend.retrieval import retrieve
```

- [ ] **Step 2: Replace the retrieval + prompt-assembly block**

Replace lines 295-327 (the `lore_lines, mem_lines, retrieve_err = await retrieve(...)` block through the `elif mem_lines:` branch) with:

```python
    keyword_lore_entries, retrieve_err = await retrieve(
        char["id"], sid, query, recent_text(msgs),
        viewer_id=current_user["id"] if current_user else None)

    block, used_ids, meta_lore_lines, meta_memory_lines = await memory_service.retrieve_block(
        s, char, user_name, query, msgs, eff, keyword_lore_entries,
        viewer_id=current_user["id"] if current_user else None,
        embed_base=ep["embed_base"], embed_key=ep["embed_key"])

    assistant_turns = sum(1 for m in msgs if m["role"] == "assistant")
    full_system = (assistant_turns % 4 == 0)
    system = build_system(char, persona, user_name, mode, language=language, full=full_system)
    system += ("\n\n# Story context\n"
               "Everything below is what you actually know: established world facts, ongoing "
               "conditions, and things recalled from earlier in this story, plus the recent "
               "conversation itself. If something isn't in either, you don't clearly know or "
               "remember it — respond with in-character uncertainty rather than inventing shared "
               "history, past conversations, world details, or prior meetings.\n\n"
               + (block or "(nothing notable recalled this turn)"))
```

- [ ] **Step 3: Update the log line, SSE meta event, and remove the `remember()`/legacy-memory call**

Replace:

```python
    log.info("chat turn start: session=%s char=%s mode=%s think=%s lang=%s lore_hits=%d memory_hits=%d full_system=%s",
             sid, char["id"], mode, do_think, language, len(lore_lines), len(mem_lines), full_system)
```

with:

```python
    log.info("chat turn start: session=%s char=%s mode=%s think=%s lang=%s lore_hits=%d memory_hits=%d full_system=%s",
             sid, char["id"], mode, do_think, language, len(meta_lore_lines), len(meta_memory_lines), full_system)
```

Replace the `meta = {"type": "meta", "lore": lore_lines, "memory": mem_lines, ...}` line with:

```python
        meta = {"type": "meta", "lore": meta_lore_lines, "memory": meta_memory_lines,
                "user_mid": user_mid, "think": do_think, "retrieve_error": retrieve_err}
```

Find the `remember()` call block (search for `remember_err = None` in the file) and delete it entirely, along with the `if regenerate and user_mid: await vectors.delete_memory(user_mid)` line near the top of `_run` (legacy per-turn memory deletion — no longer applicable, memory reconciliation/supersession is memory_v2's job now and already runs independently of regeneration). Also delete the now-unused `memory_v2 = True` / `v2_block` local variables entirely (the whole `if memory_v2:` conditional structure collapses since there's only one path now) — replace:

```python
        remember_err = None
        try:
            remember_err = await remember(char["id"], char["name"], sid, user_mid, query, reply_disp,
                                          language, chat_model, prev_session=s,
                                          embed_base=ep["embed_base"], embed_key=ep["embed_key"],
                                          chat_base=eff_chat_base, chat_key=eff_api_key,
                                          store_semantic=not memory_v2)
        except Exception as e:
            remember_err = str(e)
            log.warning("remember() raised unexpectedly: %s", e)
        if memory_v2:
            try:
                await memory_service.maybe_extract(
                    s, char, user_name, language, chat_model,
                    chat_base=eff_chat_base, chat_key=eff_api_key,
                    embed_base=ep["embed_base"], embed_key=ep["embed_key"])
```

with:

```python
        try:
            await memory_service.maybe_extract(
                s, char, user_name, language, chat_model,
                chat_base=eff_chat_base, chat_key=eff_api_key,
                embed_base=ep["embed_base"], embed_key=ep["embed_key"])
```

Read the full surrounding `try`/`except` block in the actual current file before editing — this plan shows the two specific chunks to change, but the exact enclosing indentation/structure (there is an `except Exception as e:` immediately after the `maybe_extract` call already) must be preserved; only remove the `remember()` call and the now-dead `memory_v2`/`remember_err` variables, do not restructure the surrounding exception handling.

Also grep the rest of `chat_service.py` for `remember_err` (it may be referenced later, e.g. included in a `done` SSE event's `memory_error` field per CLAUDE.md's SSE format docs) — if found, decide whether to drop that field from the `done` event entirely or repoint it to a lore/memory error surfaced from `retrieve_block`/`retrieve` (there currently is no such per-turn error from the new functions beyond `retrieve_err`, which is already in `meta`). Simplest: remove `memory_error` from the `done` event payload, since there's no longer a separate memory-write error distinct from the retrieval error already surfaced.

- [ ] **Step 4: Manual smoke test against the live app**

This app auto-reloads on `.py` file changes (see CLAUDE.md — the running container is bind-mounted to this checkout). After saving, verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health
```

Expected: a 401 (auth required) is fine — it proves the server didn't crash on reload. Then check the server didn't error on import:

```bash
podman logs --tail 30 story-game 2>&1 | grep -i "error\|traceback"
```

Expected: no new tracebacks referencing `chat_service.py`. If there are, fix them before proceeding — do not commit a broken import.

Then drive one real turn through the UI (log in, open any existing chat, send a message) and confirm: the reply streams normally, and `podman exec story-game tail -n 20 /app/ai-frontend/storyhavenai.logs.jsonl` shows a `chat turn start` line and (once 5 exchanges have settled) a `memory extract done` line with the new `lore_updates=` field in it.

- [ ] **Step 5: Commit**

```bash
git add backend/chat_service.py
git commit -m "Remove legacy memory from chat_service._run; unify prompt into one story-context block"
```

---

### Task 12: Repoint session/character deletion cleanup to memory_facts + lore-only vector cleanup

**Files:**
- Modify: `backend/routers/sessions.py`
- Modify: `backend/routers/characters.py`
- Modify: `backend/routers/chat.py`

**Interfaces:**
- Consumes: `memory_facts.purge_session` (existing), `memory_facts.purge_char` (Task 1), `vectors.delete_lore_vectors_by_char` (Task 10), `memory_facts.list_live` (Task 1), `memory_facts.expire` (existing).

No new test file — these are three small router edits; verified via Step 4's manual check plus the existing `test_session_lore_router.py`/router-adjacent tests staying green.

- [ ] **Step 1: `backend/routers/sessions.py`**

Add `from backend.repositories import memory_facts` to the imports. Replace:

```python
@api.delete("/sessions/{sid}")
async def delete_session(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await chat_sessions.delete(sid)
    await vectors.delete_by_tag(vectors.MEM_INDEX, "session", sid)
    return {"deleted": True}
```

with:

```python
@api.delete("/sessions/{sid}")
async def delete_session(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await chat_sessions.delete(sid)
    await memory_facts.purge_session(sid)
    return {"deleted": True}
```

If `vectors` import in this file becomes unused after this change, remove it — grep the rest of the file for other `vectors.` usage first.

- [ ] **Step 2: `backend/routers/characters.py`**

Add `from backend.repositories import memory_facts` to the imports. Replace:

```python
    await characters.delete(cid)
    await vectors.delete_by_tag(vectors.MEM_INDEX, "chartag", cid)
    await vectors.delete_by_tag(vectors.LORE_INDEX, "chartag", cid)
```

with:

```python
    await characters.delete(cid)
    await memory_facts.purge_char(cid)
    await vectors.delete_lore_vectors_by_char(cid)
```

- [ ] **Step 3: `backend/routers/chat.py`**

Replace the whole `/memory` GET/DELETE/DELETE-one block:

```python
@api.get("/sessions/{sid}/memory")
async def get_memory(sid: str, q: str | None = None, k: int = 30,
                     current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    user_overrides = await db.get_user_settings(current_user["id"])
    ep = await _endpoints(user_overrides, current_user["id"], current_user.get("is_admin", False))

    if q:
        vec = await llm.embed(q, CFG["embed_model"],
                              base_url=ep["embed_base"], api_key=ep["embed_key"])
        candidates = await memory_facts.similar_live(sid, vec, k)
        return [{"id": c["id"], "text": c["text"]} for c in candidates]
    live = await memory_facts.list_live(sid, k)
    return [{"id": f["id"], "text": f["text"]} for f in live]


@api.delete("/sessions/{sid}/memory")
async def clear_memory(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await memory_facts.purge_session(sid)
    return {"cleared": True}


@api.delete("/sessions/{sid}/memory/{mid}")
async def delete_memory_entry(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await memory_facts.expire(mid)
    return {"deleted": True}
```

Add `from backend.repositories import memory_facts` to this file's imports. Check whether `vectors` is still used elsewhere in `chat.py` after this change — if not, remove the import.

- [ ] **Step 4: Manual smoke test**

In the live app UI, open a chat with existing memory facts (or send a few messages and wait for a batch to settle), open the "View memory" panel (per CLAUDE.md, this exists in the chat sidebar), confirm it loads without error, delete one entry, confirm it disappears, then clear all and confirm the list empties. This exercises all three endpoints touched in this task through the existing, unchanged frontend (`new_ui/js/chat.js`'s memory modal — verified in this plan's research to expect exactly `{id, text}` shaped items, which the new implementation returns).

- [ ] **Step 5: Commit**

```bash
git add backend/routers/sessions.py backend/routers/characters.py backend/routers/chat.py
git commit -m "Repoint session/character deletion and memory panel to memory_facts (v1 fully removed)"
```

---

### Task 13: Clean up dead config keys and stale references

**Files:**
- Modify: `backend/state.py`
- Modify: `backend/schemas.py`

**Interfaces:** None — this is a dead-code removal pass with no behavioral surface.

- [ ] **Step 1: Check what's still live**

Run:

```bash
grep -rn "top_k_memory\|mem_max_dist" backend/ --include=*.py
```

Expected after Tasks 10-12: only `backend/state.py`'s `CFG` definition and `backend/schemas.py`'s `SettingsIn`/`UserSettingsIn` should reference these — no functional code should read them anymore (the old `retrieval.retrieve()` was the only reader, and it no longer takes a `cfg` param at all per Task 10).

- [ ] **Step 2: Remove the dead keys**

In `backend/state.py`, remove the `top_k_memory` and `mem_max_dist` entries from the `CFG` dict and from `USER_CFG_KEYS`/`PUBLIC_CFG_KEYS` (wherever they're listed alongside `top_k_lore`/`lore_max_dist` — keep those two, they're still read by `lore_memory.fetch_lore_candidates` via the `cfg` dict passed through `memory_service.retrieve_block`).

In `backend/schemas.py`, remove `top_k_memory`/`mem_max_dist` fields if present in `SettingsIn`/`UserSettingsIn` (check both — they may only be in one).

- [ ] **Step 3: Run the full test suite**

Run: `python3 -m pytest backend/tests/ -v 2>&1 | tail -30`
Expected: all PASS, no `KeyError`/`AttributeError` referencing the removed keys anywhere.

- [ ] **Step 4: Commit**

```bash
git add backend/state.py backend/schemas.py
git commit -m "Remove dead top_k_memory/mem_max_dist config keys (legacy memory v1 removed)"
```

---

### Task 14: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Rewrite the "Memory v2" section**

`CLAUDE.md` currently has a "Memory v2" section (added in an earlier session) describing it as flag-gated and separate from lore. Replace that section and the "Session-scoped lore overrides" section with an accurate description reflecting this plan's outcome: memory_v2 is now the only memory system (no flag, `remember()`/`_extract_turn_signal` deleted), lore is a ranked, non-decaying participant in the same retrieval pool (`backend/lore_memory.py`), one-hop `lore_links` relationship expansion happens automatically, and story events can propose session-scoped lore overrides via the same batched extraction call that produces typed facts. Reference the new module: `backend/lore_memory.py` in the module-responsibilities table (add a row).

- [ ] **Step 2: Update the module responsibilities table**

Remove the row(s) describing `backend/retrieval.py` as owning `remember()`/turn-signal extraction — it now only does keyword lore matching + `index_lore()`. Add a row for `backend/lore_memory.py`: candidate assembly (keyword + KNN + relationship expansion + session overrides) and lore-update detection/application.

- [ ] **Step 3: Update the SSE stream format section**

The `meta` event's `memory` field description and the `done` event's `memory_error` field (if it was removed in Task 11 Step 3) need updating to match reality.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md: memory_v2+lore unification, v1 memory removed"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section has a task — lore joining the ranked pool (Tasks 3-6), relationship expansion (Task 5), non-decay (Task 3), session-scoped override sync both directions (Task 8/9, and Task 5's override-resolution read side), char-state folding into batch extraction with the explicit trade-off called out (Task 7), full v1 deletion (Tasks 10-12), test coverage built in throughout (every task has tests except 11/12/14 which are glue/docs, justified inline), config cleanup (Task 13), CLAUDE.md update (Task 14).
- **Open questions from the spec, resolved:** lore-update detection scope (resolved in Task 8 — runs against every draft with any nearby lore, relies on the model's own "most facts update nothing" instruction rather than a pre-filter by fact type/importance, since building an accurate pre-filter heuristic without real usage data risked being wrong in either direction; revisit if it proves noisy in practice). Unified-block subheadings (resolved in Task 4 — three-way split reusing the existing pattern). Config key cleanup (Task 13).
- **Known residual risk, flagged for whoever executes Task 11:** `chat_service.py`'s exact current line numbers/surrounding structure around the `remember()` call and any `memory_error` SSE field may have shifted slightly by execution time if other work lands on this file first — Task 11 says explicitly to read the live file before editing rather than trusting line numbers blindly, for exactly this reason.
