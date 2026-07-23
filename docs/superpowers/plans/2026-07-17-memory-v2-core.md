# Memory V2 Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typed, bi-temporal, participant-scoped memory facts with batched two-call extraction, ADD/REINFORCE/SUPERSEDE reconciliation, ranked retrieval into a fixed-token-budget prompt block — behind a `memory_v2` config flag, leaving the legacy memory path untouched when the flag is off.

**Architecture:** New pgvector-backed `memory_facts` table (bi-temporal columns from day one). Write path: every 5 settled exchanges, one extract LLM call (5-field JSON facts) then one reconcile LLM call (add/reinforce/supersede vs top-3 neighbors). Read path: vector candidates → pure-Python hard filters (participants, retention) → scoring → reserved(pinned+active)/scored budget split → rendered block + memory guard injected by `chat_service._run`. Spec: `docs/superpowers/specs/2026-07-16-memory-system-design.md`.

**Tech Stack:** FastAPI backend modules (plain-function style), SQLAlchemy Core + pgvector, Pydantic v2 for extraction validation, pytest + pytest-asyncio.

## Global Constraints

- Zero comments in any code file (CLAUDE.md rule — applies to every code block below; the blocks are already comment-free, keep them that way).
- Every mutating operation and every phase of the extract pipeline logs one line via `from backend.state import log` — no silent stretches.
- All backend imports are absolute (`from backend.x import y`).
- This checkout is the live app: edit in place, never in a worktree. The `memory_v2` flag defaults to **false** so nothing changes for live users until it's flipped.
- Tests run **inside the container** (host python lacks the backend deps and DATABASE_URL):
  `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory -q"`
  Pure-logic tests also run on the host with `python3 -m pytest` if deps allow; the container command is the reference.
- Commit messages: plain, no Co-Authored-By/attribution trailers.
- New CFG keys: `memory_v2` (bool, default false), `memory_v2_budget_tokens` (int, default 600). Both admin-editable (PUBLIC_CFG_KEYS), neither user-overridable.
- Fact types: `event | state | relationship | world | profile`. Stateful set = `{"state"}`. Active fact = `fact_type == "state" AND valid_until_turn IS NULL`.
- Bi-temporal semantics: `valid_from_turn`/`valid_until_turn` = event time (closing = the fact stopped being current, row still retrievable as history); `expired_ts` = system-time retraction (row invisible to retrieval). SUPERSEDE closes validity, it does **not** set `expired_ts`.

---

### Task 1: Fact store — `memory_facts` table + repository

**Files:**
- Create: `backend/repositories/memory_facts.py`
- Modify: `backend/vectors.py` (two hooks: `ensure_indexes`, `reset_indexes`)
- Test: `tests/memory/test_store.py`, `tests/memory/__init__.py` (empty), `tests/__init__.py` (empty, only if missing)

**Interfaces:**
- Produces (all `async` unless noted, all facts are plain dicts):
  - `build_tables(dim: int)` (sync), `ensure_tables(dim: int)`, `drop_tables()`
  - `insert(fact: dict, vec) -> str` — fact keys: `session_id, char_id, text, fact_type, participants (list[str]), importance (int), valence (int), turn (int)`; returns new id (`nid("mf")`)
  - `reinforce(fact_id: str, turn: int)`
  - `supersede(old_id: str, new_fact: dict, vec, turn: int) -> str`
  - `similar_live(session_id: str, vec, k: int) -> list[dict]` — each dict has all columns except `embedding`, plus `distance: float`
  - `reserved(session_id: str) -> list[dict]` — pinned OR (state + open window), not expired
  - `get_cursor(session_id: str) -> int`, `set_cursor(session_id: str, settled_exchanges: int)`
  - `purge_session(session_id: str)` — deletes that session's facts + cursor (test cleanup / future session delete)

- [ ] **Step 1: Write the failing test**

```python
import os
import uuid
import pytest
import pytest_asyncio

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="needs DATABASE_URL"),
]

VEC_A = [1.0] + [0.0] * 767
VEC_B = [0.0, 1.0] + [0.0] * 766


def _fact(sid, **kw):
    base = {"session_id": sid, "char_id": "char-test", "text": "Mira was stabbed in the shoulder.",
            "fact_type": "state", "participants": ["Mira"], "importance": 5, "valence": -2, "turn": 10}
    base.update(kw)
    return base


@pytest_asyncio.fixture()
async def store():
    from backend import db
    from backend.state import CFG
    from backend.repositories import memory_facts
    await db.init()
    await memory_facts.ensure_tables(CFG["embed_dim"])
    sid = "test-mem-" + uuid.uuid4().hex[:8]
    yield memory_facts, sid
    await memory_facts.purge_session(sid)


async def test_insert_and_similar_live(store):
    repo, sid = store
    fid = await repo.insert(_fact(sid), VEC_A)
    rows = await repo.similar_live(sid, VEC_A, 5)
    assert [r["id"] for r in rows] == [fid]
    assert rows[0]["distance"] < 0.01
    assert rows[0]["valid_until_turn"] is None
    assert "embedding" not in rows[0]


async def test_reinforce_bumps_counters(store):
    repo, sid = store
    fid = await repo.insert(_fact(sid), VEC_A)
    await repo.reinforce(fid, 20)
    row = (await repo.similar_live(sid, VEC_A, 1))[0]
    assert row["reinforcements"] == 1
    assert row["last_turn"] == 20


async def test_supersede_closes_validity_but_stays_live(store):
    repo, sid = store
    old = await repo.insert(_fact(sid, text="Mira trusts the captain.", fact_type="relationship"), VEC_A)
    new = await repo.supersede(old, _fact(sid, text="Mira despises the captain.",
                                          fact_type="relationship", turn=30), VEC_B, 30)
    rows = {r["id"]: r for r in await repo.similar_live(sid, VEC_A, 5)}
    assert set(rows) == {old, new}
    assert rows[old]["valid_until_turn"] == 30
    assert rows[old]["superseded_by"] == new
    assert rows[old]["expired_ts"] is None
    assert rows[new]["valid_until_turn"] is None


async def test_reserved_returns_open_states_and_pinned_only(store):
    repo, sid = store
    open_state = await repo.insert(_fact(sid), VEC_A)
    closed = await repo.insert(_fact(sid, text="Mira had a fever."), VEC_B)
    await repo.supersede(closed, _fact(sid, text="Mira recovered.", fact_type="event", turn=15), VEC_B, 15)
    await repo.insert(_fact(sid, text="They met at dawn.", fact_type="event"), VEC_B)
    got = {r["id"] for r in await repo.reserved(sid)}
    assert open_state in got
    assert closed not in got


async def test_cursor_roundtrip(store):
    repo, sid = store
    assert await repo.get_cursor(sid) == 0
    await repo.set_cursor(sid, 15)
    assert await repo.get_cursor(sid) == 15
    await repo.set_cursor(sid, 20)
    assert await repo.get_cursor(sid) == 20
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_store.py -q"`
Expected: FAIL/ERROR with `ModuleNotFoundError: No module named 'backend.repositories.memory_facts'`. (If pytest itself is missing in the container venv: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/pip install pytest pytest-asyncio"`.)

- [ ] **Step 3: Write the repository**

`backend/repositories/memory_facts.py`:

```python
import time

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, insert as pg_insert

from backend.db import nid
from backend.state import log

_meta = sa.MetaData()
_tbl = None
_cursor_tbl = None


def _engine():
    from backend import db
    return db.engine()


def build_tables(dim: int):
    global _tbl, _cursor_tbl, _meta
    from pgvector.sqlalchemy import Vector
    _meta = sa.MetaData()
    _tbl = sa.Table(
        "memory_facts", _meta,
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("session_id", sa.Text, nullable=False, index=True),
        sa.Column("char_id", sa.Text),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("fact_type", sa.Text, nullable=False),
        sa.Column("participants", ARRAY(sa.Text), nullable=False),
        sa.Column("importance", sa.Integer, nullable=False),
        sa.Column("valence", sa.Integer, nullable=False),
        sa.Column("reinforcements", sa.Integer, nullable=False),
        sa.Column("valid_from_turn", sa.Integer, nullable=False),
        sa.Column("valid_until_turn", sa.Integer),
        sa.Column("last_turn", sa.Integer, nullable=False),
        sa.Column("created_ts", sa.BigInteger, nullable=False),
        sa.Column("expired_ts", sa.BigInteger),
        sa.Column("superseded_by", sa.Text),
        sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("embedding", Vector(dim)),
    )
    _cursor_tbl = sa.Table(
        "memory_extract_cursors", _meta,
        sa.Column("session_id", sa.Text, primary_key=True),
        sa.Column("settled_exchanges", sa.Integer, nullable=False),
    )


async def ensure_tables(dim: int):
    build_tables(dim)
    async with _engine().begin() as conn:
        await conn.run_sync(_meta.create_all)
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_memfacts_hnsw ON memory_facts "
            "USING hnsw (embedding vector_cosine_ops)"))


async def drop_tables():
    async with _engine().begin() as conn:
        await conn.execute(sa.text("DROP TABLE IF EXISTS memory_facts"))
        await conn.execute(sa.text("DROP TABLE IF EXISTS memory_extract_cursors"))


def _row(mapping) -> dict:
    out = dict(mapping)
    out.pop("embedding", None)
    return out


async def insert(fact: dict, vec) -> str:
    fid = nid("mf")
    async with _engine().begin() as conn:
        await conn.execute(_tbl.insert().values(
            id=fid, session_id=fact["session_id"], char_id=fact.get("char_id"),
            text=fact["text"], fact_type=fact["fact_type"],
            participants=list(fact.get("participants") or []),
            importance=int(fact.get("importance") or 3),
            valence=int(fact.get("valence") or 0),
            reinforcements=0,
            valid_from_turn=int(fact["turn"]), valid_until_turn=None,
            last_turn=int(fact["turn"]), created_ts=int(time.time()),
            expired_ts=None, superseded_by=None, pinned=False,
            embedding=list(vec)))
    log.info("memory fact added: session=%s id=%s type=%s importance=%s",
             fact["session_id"], fid, fact["fact_type"], fact.get("importance"))
    return fid


async def reinforce(fact_id: str, turn: int):
    async with _engine().begin() as conn:
        await conn.execute(sa.update(_tbl).where(_tbl.c.id == fact_id).values(
            reinforcements=_tbl.c.reinforcements + 1, last_turn=int(turn)))
    log.info("memory fact reinforced: id=%s turn=%s", fact_id, turn)


async def supersede(old_id: str, new_fact: dict, vec, turn: int) -> str:
    new_id = await insert(new_fact, vec)
    async with _engine().begin() as conn:
        await conn.execute(sa.update(_tbl).where(_tbl.c.id == old_id).values(
            valid_until_turn=int(turn), superseded_by=new_id))
    log.info("memory fact superseded: old=%s new=%s turn=%s", old_id, new_id, turn)
    return new_id


async def similar_live(session_id: str, vec, k: int) -> list[dict]:
    dist = _tbl.c.embedding.cosine_distance(list(vec))
    stmt = (sa.select(_tbl, dist.label("distance"))
            .where(_tbl.c.session_id == session_id, _tbl.c.expired_ts.is_(None))
            .order_by(sa.text("distance")).limit(k))
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [dict(_row(r._mapping), distance=float(r._mapping["distance"])) for r in rows]


async def reserved(session_id: str) -> list[dict]:
    stmt = sa.select(_tbl).where(
        _tbl.c.session_id == session_id, _tbl.c.expired_ts.is_(None),
        sa.or_(_tbl.c.pinned.is_(True),
               sa.and_(_tbl.c.fact_type == "state", _tbl.c.valid_until_turn.is_(None))))
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [_row(r._mapping) for r in rows]


async def get_cursor(session_id: str) -> int:
    stmt = sa.select(_cursor_tbl.c.settled_exchanges).where(_cursor_tbl.c.session_id == session_id)
    async with _engine().connect() as conn:
        row = (await conn.execute(stmt)).fetchone()
    return int(row[0]) if row else 0


async def set_cursor(session_id: str, settled_exchanges: int):
    ins = pg_insert(_cursor_tbl).values(session_id=session_id,
                                        settled_exchanges=int(settled_exchanges))
    ins = ins.on_conflict_do_update(index_elements=["session_id"],
                                    set_={"settled_exchanges": ins.excluded.settled_exchanges})
    async with _engine().begin() as conn:
        await conn.execute(ins)


async def purge_session(session_id: str):
    async with _engine().begin() as conn:
        await conn.execute(sa.delete(_tbl).where(_tbl.c.session_id == session_id))
        await conn.execute(sa.delete(_cursor_tbl).where(_cursor_tbl.c.session_id == session_id))
    log.info("memory facts purged: session=%s", session_id)
```

In `backend/vectors.py`, add to the end of `ensure_indexes` (inside the function, after the existing index statements — import placed inside the function to avoid a module cycle):

```python
    from backend.repositories import memory_facts
    await memory_facts.ensure_tables(dim)
```

And in `reset_indexes`, before the `await ensure_indexes(dim)` line:

```python
    from backend.repositories import memory_facts
    await memory_facts.drop_tables()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_store.py -q"`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/memory_facts.py backend/vectors.py tests/__init__.py tests/memory/
git commit -m "Add memory_facts store: bi-temporal typed facts with pgvector search"
```

---

### Task 2: Extraction models, prompts, and parsing (pure)

**Files:**
- Create: `backend/memory_extraction.py`
- Test: `tests/memory/test_extraction_parse.py`

**Interfaces:**
- Produces:
  - `FACT_TYPES = ("event", "state", "relationship", "world", "profile")`
  - `class FactDraft(BaseModel)`: `text: str`, `fact_type: Literal[...]`, `participants: list[str]`, `importance: int (1..5)`, `valence: int (-2..2)`
  - `class ReconcileDecision(BaseModel)`: `index: int`, `action: Literal["add","reinforce","supersede"]`, `target_id: str | None`
  - `build_extract_prompt(transcript: str, char_name: str, user_name: str, language: str) -> str`
  - `build_reconcile_prompt(drafts: list[FactDraft], neighbors: list[list[dict]]) -> str`
  - `parse_extraction(raw: str) -> list[FactDraft]` — raises `ValueError` on anything invalid
  - `parse_reconcile(raw: str, fact_count: int, valid_ids: set[str]) -> list[ReconcileDecision]` — raises `ValueError`
  - `MAX_FACTS_PER_BATCH = 10`

- [ ] **Step 1: Write the failing test**

```python
import pytest

from backend.memory_extraction import (FactDraft, parse_extraction, parse_reconcile,
                                       build_extract_prompt, build_reconcile_prompt)

GOOD = ('[{"text": "Mira was stabbed.", "fact_type": "state", "participants": ["Mira"], '
        '"importance": 5, "valence": -2}]')


def test_parse_extraction_valid():
    facts = parse_extraction(GOOD)
    assert len(facts) == 1
    assert facts[0].fact_type == "state"
    assert facts[0].participants == ["Mira"]


def test_parse_extraction_strips_fence():
    facts = parse_extraction("```json\n" + GOOD + "\n```")
    assert len(facts) == 1


def test_parse_extraction_empty_array():
    assert parse_extraction("[]") == []


def test_parse_extraction_rejects_bad_type():
    bad = GOOD.replace('"state"', '"opinion"')
    with pytest.raises(ValueError):
        parse_extraction(bad)


def test_parse_extraction_rejects_out_of_range_importance():
    bad = GOOD.replace('"importance": 5', '"importance": 9')
    with pytest.raises(ValueError):
        parse_extraction(bad)


def test_parse_extraction_rejects_non_array():
    with pytest.raises(ValueError):
        parse_extraction('{"text": "x"}')


def test_parse_extraction_caps_at_max():
    many = "[" + ",".join([GOOD[1:-1]] * 15) + "]"
    assert len(parse_extraction(many)) == 10


def test_parse_reconcile_valid():
    raw = '[{"index": 0, "action": "reinforce", "target_id": "mf_a"}]'
    got = parse_reconcile(raw, 1, {"mf_a"})
    assert got[0].action == "reinforce"
    assert got[0].target_id == "mf_a"


def test_parse_reconcile_add_needs_no_target():
    got = parse_reconcile('[{"index": 0, "action": "add"}]', 1, set())
    assert got[0].action == "add"


def test_parse_reconcile_rejects_unknown_target():
    with pytest.raises(ValueError):
        parse_reconcile('[{"index": 0, "action": "supersede", "target_id": "mf_zzz"}]', 1, {"mf_a"})


def test_parse_reconcile_rejects_missing_decision():
    with pytest.raises(ValueError):
        parse_reconcile('[{"index": 0, "action": "add"}]', 2, set())


def test_parse_reconcile_rejects_target_missing_for_non_add():
    with pytest.raises(ValueError):
        parse_reconcile('[{"index": 0, "action": "supersede"}]', 1, {"mf_a"})


def test_prompts_mention_names_and_format_last():
    p = build_extract_prompt("Alice: hi\nKael: hello", "Kael", "Alice", "English")
    assert "Kael" in p and "English" in p
    assert p.strip().endswith("format.")
    drafts = parse_extraction(GOOD)
    rp = build_reconcile_prompt(drafts, [[{"id": "mf_a", "text": "Mira got hurt."}]])
    assert "mf_a" in rp and "Mira was stabbed." in rp
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_extraction_parse.py -q"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.memory_extraction'`.

- [ ] **Step 3: Write the module (parsing + prompts half)**

`backend/memory_extraction.py`:

```python
import json
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

from backend.llm import strip_json_fence

FACT_TYPES = ("event", "state", "relationship", "world", "profile")
MAX_FACTS_PER_BATCH = 10


class FactDraft(BaseModel):
    text: str = Field(min_length=1)
    fact_type: Literal["event", "state", "relationship", "world", "profile"]
    participants: list[str]
    importance: int = Field(ge=1, le=5)
    valence: int = Field(ge=-2, le=2)


class ReconcileDecision(BaseModel):
    index: int = Field(ge=0)
    action: Literal["add", "reinforce", "supersede"]
    target_id: str | None = None

    @model_validator(mode="after")
    def _target_required(self):
        if self.action != "add" and not self.target_id:
            raise ValueError(f"action {self.action} requires target_id")
        return self


EXTRACT_EXAMPLE = (
    '[{"text": "Mira was stabbed in the left shoulder during the ambush.", "fact_type": "state", '
    '"participants": ["Mira"], "importance": 5, "valence": -2},\n'
    ' {"text": "The mine outside Kelder collapsed.", "fact_type": "world", '
    '"participants": [], "importance": 3, "valence": -1}]'
)


def build_extract_prompt(transcript: str, char_name: str, user_name: str, language: str) -> str:
    return (
        f"You extract long-term memory from a roleplay story between {user_name} and {char_name}.\n"
        "List only facts worth remembering many scenes from now.\n"
        "Fact types: event (something happened), state (an ongoing unresolved condition: injury, "
        "promise, debt, live conflict), relationship (how two people relate), world (a fact about "
        "the world involving no specific person), profile (a lasting trait of a person).\n"
        f"Each fact: one short third-person sentence in {language}; copy proper names exactly as "
        "written; participants = the people the fact is about; importance 1 (trivial) to 5 "
        "(pivotal); valence -2 (very negative) to 2 (very positive). Output [] if nothing lasting "
        "happened.\n\n"
        f"Example output:\n{EXTRACT_EXAMPLE}\n\n"
        f"Transcript:\n{transcript}\n\n"
        "Reply with only a JSON array in exactly the example's format."
    )


def build_reconcile_prompt(drafts: list[FactDraft], neighbors: list[list[dict]]) -> str:
    new_lines, neighbor_lines = [], []
    for i, draft in enumerate(drafts):
        new_lines.append(f"{i}. {draft.text}")
        near = neighbors[i] if i < len(neighbors) else []
        if near:
            shown = "; ".join(f"[id={n['id']}] {n['text']}" for n in near)
        else:
            shown = "(none)"
        neighbor_lines.append(f"{i}. {shown}")
    return (
        "You maintain a story's memory database. For each NEW fact, compare it with its SIMILAR "
        "existing facts and decide exactly one action:\n"
        '- "add": genuinely new information\n'
        '- "reinforce": restates an existing fact (give that fact\'s id as target_id)\n'
        '- "supersede": contradicts or replaces an existing fact that is no longer current '
        "(give the outdated fact's id as target_id)\n\n"
        "NEW facts:\n" + "\n".join(new_lines) + "\n\n"
        "SIMILAR existing facts:\n" + "\n".join(neighbor_lines) + "\n\n"
        'Example output:\n[{"index": 0, "action": "reinforce", "target_id": "mf_abc"}]\n\n'
        "Reply with only a JSON array containing exactly one decision per NEW fact, "
        "in exactly the example's format."
    )


def _load_array(raw: str) -> list:
    try:
        data = json.loads(strip_json_fence(raw))
    except Exception as e:
        raise ValueError(f"not valid JSON: {e}") from e
    if not isinstance(data, list):
        raise ValueError("expected a JSON array")
    return data


def parse_extraction(raw: str) -> list[FactDraft]:
    data = _load_array(raw)
    try:
        facts = [FactDraft.model_validate(item) for item in data]
    except ValidationError as e:
        raise ValueError(str(e)) from e
    return facts[:MAX_FACTS_PER_BATCH]


def parse_reconcile(raw: str, fact_count: int, valid_ids: set[str]) -> list[ReconcileDecision]:
    data = _load_array(raw)
    try:
        decisions = [ReconcileDecision.model_validate(item) for item in data]
    except ValidationError as e:
        raise ValueError(str(e)) from e
    seen = {d.index for d in decisions}
    if seen != set(range(fact_count)):
        raise ValueError(f"expected one decision per fact 0..{fact_count - 1}, got indexes {sorted(seen)}")
    for d in decisions:
        if d.action != "add" and d.target_id not in valid_ids:
            raise ValueError(f"unknown target_id {d.target_id}")
    return sorted(decisions, key=lambda d: d.index)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_extraction_parse.py -q"`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/memory_extraction.py tests/memory/test_extraction_parse.py
git commit -m "Add memory extraction models, prompts, and strict JSON parsing"
```

---

### Task 3: Extraction + reconcile LLM calls with one validation retry

**Files:**
- Modify: `backend/memory_extraction.py` (append)
- Test: `tests/memory/test_extraction_llm.py`

**Interfaces:**
- Consumes: `llm.chat_stream(messages, model, parse_think=..., base_url=..., api_key=..., pin_host=True)` (same call shape as `retrieval._extract_turn_signal`), Task 2's parse/build functions.
- Produces:
  - `async run_extract(transcript, char_name, user_name, language, model, base_url=None, api_key=None) -> list[FactDraft]` — returns `[]` after a failed retry (logged), never raises for model misbehavior
  - `async run_reconcile(drafts, neighbors, model, base_url=None, api_key=None) -> list[ReconcileDecision]` — falls back to all-`add` after a failed retry (logged)

- [ ] **Step 1: Write the failing test**

```python
import pytest

from backend import memory_extraction as me

GOOD = ('[{"text": "Mira was stabbed.", "fact_type": "state", "participants": ["Mira"], '
        '"importance": 5, "valence": -2}]')


def _fake_stream(replies):
    calls = []

    async def fake(messages, model, *a, **kw):
        calls.append(messages)
        reply = replies[min(len(calls) - 1, len(replies) - 1)]
        yield "content", reply

    return fake, calls


@pytest.mark.asyncio
async def test_run_extract_happy_path(monkeypatch):
    fake, calls = _fake_stream([GOOD])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    facts = await me.run_extract("t", "Kael", "Alice", "English", "m")
    assert len(facts) == 1 and len(calls) == 1


@pytest.mark.asyncio
async def test_run_extract_retries_once_with_error_feedback(monkeypatch):
    fake, calls = _fake_stream(["not json at all", GOOD])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    facts = await me.run_extract("t", "Kael", "Alice", "English", "m")
    assert len(facts) == 1 and len(calls) == 2
    assert "not valid JSON" in calls[1][-1]["content"]


@pytest.mark.asyncio
async def test_run_extract_gives_up_after_second_failure(monkeypatch):
    fake, calls = _fake_stream(["junk", "more junk"])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    facts = await me.run_extract("t", "Kael", "Alice", "English", "m")
    assert facts == [] and len(calls) == 2


@pytest.mark.asyncio
async def test_run_reconcile_falls_back_to_add(monkeypatch):
    fake, calls = _fake_stream(["junk", "junk"])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    drafts = me.parse_extraction(GOOD)
    decisions = await me.run_reconcile(drafts, [[{"id": "mf_a", "text": "x"}]], "m")
    assert [d.action for d in decisions] == ["add"]


@pytest.mark.asyncio
async def test_run_reconcile_happy_path(monkeypatch):
    fake, calls = _fake_stream(['[{"index": 0, "action": "reinforce", "target_id": "mf_a"}]'])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    drafts = me.parse_extraction(GOOD)
    decisions = await me.run_reconcile(drafts, [[{"id": "mf_a", "text": "x"}]], "m")
    assert decisions[0].action == "reinforce"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_extraction_llm.py -q"`
Expected: FAIL with `AttributeError: ... has no attribute 'run_extract'` (and `me.llm` missing).

- [ ] **Step 3: Append the LLM half**

Add to the imports of `backend/memory_extraction.py`:

```python
from backend import llm
from backend.state import log
```

(Change the existing `from backend.llm import strip_json_fence` usage to `llm.strip_json_fence` inside `_load_array`, or keep both imports — keep both, it's harmless.)

Append:

```python
async def _call(prompt: str, model: str, base_url: str | None, api_key: str | None) -> str:
    out = []
    async for channel, chunk in llm.chat_stream(
            [{"role": "user", "content": prompt}], model, parse_think=True,
            base_url=base_url, api_key=api_key, pin_host=True):
        if channel == "content":
            out.append(chunk)
    return "".join(out)


async def _call_validated(prompt: str, parse, model: str, base_url: str | None,
                          api_key: str | None, label: str):
    raw = await _call(prompt, model, base_url, api_key)
    try:
        return parse(raw)
    except ValueError as first_error:
        log.warning("memory %s parse failed, retrying once: %s", label, first_error)
        retry_prompt = (f"{prompt}\n\nYour previous reply was invalid: {first_error}\n"
                        "Reply again with only the corrected JSON array.")
        raw = await _call(retry_prompt, model, base_url, api_key)
        return parse(raw)


async def run_extract(transcript: str, char_name: str, user_name: str, language: str,
                      model: str, base_url: str | None = None,
                      api_key: str | None = None) -> list[FactDraft]:
    prompt = build_extract_prompt(transcript, char_name, user_name, language)
    try:
        return await _call_validated(prompt, parse_extraction, model, base_url, api_key, "extract")
    except Exception as e:
        log.warning("memory extract batch dropped after retry: %s", e)
        return []


async def run_reconcile(drafts: list[FactDraft], neighbors: list[list[dict]], model: str,
                        base_url: str | None = None,
                        api_key: str | None = None) -> list[ReconcileDecision]:
    if not drafts:
        return []
    valid_ids = {n["id"] for near in neighbors for n in near}
    prompt = build_reconcile_prompt(drafts, neighbors)
    parse = lambda raw: parse_reconcile(raw, len(drafts), valid_ids)
    try:
        return await _call_validated(prompt, parse, model, base_url, api_key, "reconcile")
    except Exception as e:
        log.warning("memory reconcile failed after retry, falling back to add-all: %s", e)
        return [ReconcileDecision(index=i, action="add") for i in range(len(drafts))]
```

The broad `except Exception` in both runners is deliberate per the spec ("a crashed write path is worse than a lost batch") and every path logs before falling back, satisfying the error-handling rule.

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_extraction_llm.py -q"`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/memory_extraction.py tests/memory/test_extraction_llm.py
git commit -m "Add extract/reconcile LLM calls with single validation retry and safe fallbacks"
```

---

### Task 4: Ranking — hard filters, retention decay, scoring (pure)

**Files:**
- Create: `backend/memory_ranking.py`
- Test: `tests/memory/test_ranking.py`

**Interfaces:**
- Consumes: fact dicts as returned by `memory_facts.similar_live` (keys used: `fact_type, participants, importance, valence, reinforcements, valid_until_turn, last_turn, pinned, distance, id`).
- Produces:
  - `STATEFUL_TYPES = {"state"}`
  - `is_active(fact) -> bool`
  - `retention(fact, current_turn) -> float` (1.0 for pinned/active)
  - `passes_filters(fact, present_lower: set[str], current_turn) -> bool`
  - `score(fact, current_turn) -> float`
  - `rank(candidates: list[dict], present: list[str], current_turn: int) -> list[dict]`
  - Constants: `STRENGTH_BASE = 40.0`, `STRENGTH_PER_REINFORCEMENT = 15.0`, `STRENGTH_PER_IMPORTANCE = 10.0`, `STRENGTH_PER_VALENCE = 8.0`, `RETENTION_FLOOR = 0.05`, `RECENCY_SCALE_TURNS = 200.0`, `RELEVANCE_WEIGHT = 1.0`, `RECENCY_WEIGHT = 0.6`, `IMPORTANCE_WEIGHT = 0.4`

- [ ] **Step 1: Write the failing test**

```python
import math

from backend.memory_ranking import (is_active, retention, passes_filters, rank,
                                    RETENTION_FLOOR, STRENGTH_BASE, STRENGTH_PER_IMPORTANCE,
                                    STRENGTH_PER_VALENCE)


def fact(**kw):
    base = {"id": "mf_x", "fact_type": "event", "participants": ["Alice", "Kael"],
            "importance": 3, "valence": 0, "reinforcements": 0,
            "valid_until_turn": None, "last_turn": 10, "pinned": False, "distance": 0.3}
    base.update(kw)
    return base


def test_open_state_is_active_closed_is_not():
    assert is_active(fact(fact_type="state"))
    assert not is_active(fact(fact_type="state", valid_until_turn=50))
    assert not is_active(fact(fact_type="event"))


def test_active_and_pinned_never_decay():
    assert retention(fact(fact_type="state"), 2000) == 1.0
    assert retention(fact(pinned=True), 2000) == 1.0


def test_retention_decays_with_age_and_strength():
    old = fact(last_turn=0)
    strength = STRENGTH_BASE + STRENGTH_PER_IMPORTANCE * 3
    assert math.isclose(retention(old, 100), math.exp(-100 / strength))
    assert retention(old, 100) > retention(old, 500)
    assert retention(fact(last_turn=0, importance=5), 200) > retention(fact(last_turn=0, importance=1), 200)
    assert retention(fact(last_turn=0, valence=-2), 200) > retention(fact(last_turn=0, valence=0), 200)


def test_faded_fact_fails_filter():
    ancient = fact(last_turn=0, importance=1)
    assert retention(ancient, 1000) < RETENTION_FLOOR
    assert not passes_filters(ancient, {"alice", "kael"}, 1000)


def test_participants_hard_filter():
    npc_scene = fact(participants=["Mira", "Bram"])
    assert not passes_filters(npc_scene, {"alice", "kael"}, 20)
    assert passes_filters(npc_scene, {"alice", "mira"}, 20)


def test_world_facts_exempt_from_participant_filter():
    world = fact(fact_type="world", participants=[])
    assert passes_filters(world, {"alice"}, 20)


def test_empty_participants_fails_open():
    orphan = fact(participants=[])
    assert passes_filters(orphan, {"alice"}, 20)


def test_rank_orders_by_relevance_then_filters():
    near = fact(id="near", distance=0.1)
    far = fact(id="far", distance=0.7)
    leaked = fact(id="leak", distance=0.05, participants=["Mira"])
    out = rank([far, near, leaked], ["Alice", "Kael"], 20)
    assert [f["id"] for f in out] == ["near", "far"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_ranking.py -q"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.memory_ranking'`.

- [ ] **Step 3: Write the module**

`backend/memory_ranking.py`:

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


def is_active(fact: dict) -> bool:
    return fact["fact_type"] in STATEFUL_TYPES and fact["valid_until_turn"] is None


def retention(fact: dict, current_turn: int) -> float:
    if fact.get("pinned") or is_active(fact):
        return 1.0
    strength = (STRENGTH_BASE
                + STRENGTH_PER_REINFORCEMENT * fact["reinforcements"]
                + STRENGTH_PER_IMPORTANCE * fact["importance"]
                + STRENGTH_PER_VALENCE * abs(fact["valence"]))
    age = max(0, current_turn - fact["last_turn"])
    return math.exp(-age / strength)


def passes_filters(fact: dict, present_lower: set[str], current_turn: int) -> bool:
    if retention(fact, current_turn) < RETENTION_FLOOR:
        return False
    if fact["fact_type"] == "world":
        return True
    if not fact["participants"]:
        return True
    return any(p.lower() in present_lower for p in fact["participants"])


def score(fact: dict, current_turn: int) -> float:
    relevance = max(0.0, 1.0 - fact["distance"])
    recency = math.exp(-max(0, current_turn - fact["last_turn"]) / RECENCY_SCALE_TURNS)
    weight = (RELEVANCE_WEIGHT * relevance
              + RECENCY_WEIGHT * recency
              + IMPORTANCE_WEIGHT * fact["importance"] / 5.0)
    return weight * retention(fact, current_turn)


def rank(candidates: list[dict], present: list[str], current_turn: int) -> list[dict]:
    present_lower = {p.lower() for p in present}
    kept = [c for c in candidates if passes_filters(c, present_lower, current_turn)]
    return sorted(kept, key=lambda c: score(c, current_turn), reverse=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_ranking.py -q"`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/memory_ranking.py tests/memory/test_ranking.py
git commit -m "Add memory ranking: participant/retention hard filters and weighted scoring"
```

---

### Task 5: Block assembly — reserved/scored budget split (pure)

**Files:**
- Create: `backend/memory_block.py`
- Test: `tests/memory/test_block.py`

**Interfaces:**
- Consumes: fact dicts (keys: `id, text, fact_type, importance, last_turn, valid_until_turn, valid_from_turn, pinned`).
- Produces:
  - `estimate_tokens(text: str) -> int` (`len // 4 + 1`)
  - `build_block(pinned: list[dict], active: list[dict], ranked: list[dict], budget_tokens: int) -> tuple[str, list[str], list[str]]` — `(block_text, used_ids, dropped_reserved_ids)`; empty inputs give `("", [], [])`
  - `RESERVED_FRACTION = 0.6`
  - Rendering: reserved section header `## Ongoing & pinned`, scored header `## Recalled from earlier`; open states get ` (ongoing)` suffix; closed-validity facts get ` (this later changed)` suffix.

- [ ] **Step 1: Write the failing test**

```python
from backend.memory_block import build_block, estimate_tokens, RESERVED_FRACTION


def fact(fid, text, **kw):
    base = {"id": fid, "text": text, "fact_type": "event", "importance": 3,
            "last_turn": 10, "valid_until_turn": None, "valid_from_turn": 5, "pinned": False}
    base.update(kw)
    return base


def test_empty_inputs_give_empty_block():
    assert build_block([], [], [], 600) == ("", [], [])


def test_sections_and_suffixes():
    text, used, dropped = build_block(
        [fact("p1", "Kael swore an oath.", pinned=True)],
        [fact("a1", "Mira is wounded.", fact_type="state")],
        [fact("s1", "They met at dawn."),
         fact("s2", "Mira trusted the captain.", valid_until_turn=90)],
        600)
    assert "## Ongoing & pinned" in text and "## Recalled from earlier" in text
    assert "Mira is wounded. (ongoing)" in text
    assert "Mira trusted the captain. (this later changed)" in text
    assert used == ["p1", "a1", "s1", "s2"]
    assert dropped == []


def test_reserved_capped_leaves_room_for_scored():
    heavy = [fact(f"a{i}", "An unresolved wound throbs badly in the dark. " * 4,
                  fact_type="state", importance=5 - (i % 3)) for i in range(30)]
    scored = [fact("s1", "They met at dawn."), fact("s2", "The city fell.")]
    text, used, dropped = build_block([], heavy, scored, 300)
    assert dropped
    assert "s1" in used and "s2" in used
    assert estimate_tokens(text) <= 300 + 20


def test_reserved_priority_pinned_then_importance():
    pinned = [fact("p1", "x " * 40, pinned=True)]
    states = [fact("hi", "y " * 40, fact_type="state", importance=5),
              fact("lo", "z " * 40, fact_type="state", importance=1)]
    budget = 60
    text, used, dropped = build_block(pinned, states, [], budget)
    assert used[0] == "p1"
    assert "lo" in dropped


def test_scored_stops_at_budget():
    scored = [fact(f"s{i}", f"Scored memory number {i}. " * 6) for i in range(50)]
    text, used, dropped = build_block([], [], scored, 200)
    assert 0 < len(used) < 50
    assert estimate_tokens(text) <= 200 + 20


def test_no_duplicate_between_reserved_and_scored():
    a = fact("a1", "Mira is wounded.", fact_type="state")
    text, used, dropped = build_block([], [a], [dict(a, distance=0.1)], 600)
    assert used.count("a1") == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_block.py -q"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.memory_block'`.

- [ ] **Step 3: Write the module**

`backend/memory_block.py`:

```python
RESERVED_FRACTION = 0.6


def estimate_tokens(text: str) -> int:
    return len(text) // 4 + 1


def _render(fact: dict) -> str:
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
    reserved_lines, used_ids, dropped_ids = [], [], []
    spent = 0
    for fact in ordered_reserved:
        line = _render(fact)
        cost = estimate_tokens(line)
        if spent + cost > reserved_budget:
            dropped_ids.append(fact["id"])
            continue
        reserved_lines.append(line)
        used_ids.append(fact["id"])
        spent += cost
    scored_lines = []
    for fact in ranked:
        if fact["id"] in used_ids:
            continue
        line = _render(fact)
        cost = estimate_tokens(line)
        if spent + cost > budget_tokens:
            break
        scored_lines.append(line)
        used_ids.append(fact["id"])
        spent += cost
    parts = []
    if reserved_lines:
        parts.append("## Ongoing & pinned\n" + "\n".join(reserved_lines))
    if scored_lines:
        parts.append("## Recalled from earlier\n" + "\n".join(scored_lines))
    if not parts:
        return "", [], dropped_ids
    return "\n\n".join(parts), used_ids, dropped_ids
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_block.py -q"`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/memory_block.py tests/memory/test_block.py
git commit -m "Add fixed-budget memory block assembly with reserved/scored split"
```

---

### Task 6: MemoryService — extract/retrieve orchestration

**Files:**
- Create: `backend/memory_service.py`
- Test: `tests/memory/test_service.py`

**Interfaces:**
- Consumes: `memory_facts` (Task 1), `run_extract`/`run_reconcile` (Task 3), `memory_ranking.rank` (Task 4), `memory_block.build_block` (Task 5), `llm.embed`, `chat_sessions.list_messages`, `prompt.strip_think`, `prompt.recent_text`.
- Produces:
  - `BATCH_SIZE = 5`, `SETTLE_MARGIN_EXCHANGES = 1`, `NEIGHBOR_K = 3`, `CANDIDATE_K = 32`
  - `exchanges(msgs) -> list[tuple[dict, dict]]` (user msg, assistant msg pairs, sync)
  - `current_turn(msgs) -> int` (count of user messages, sync)
  - `present_participants(char_name, user_name, known_names, recent) -> list[str]` (sync)
  - `async extract_batch(sid, char_id, char_name, user_name, batch, turn, language, model, chat_base=None, chat_key=None, embed_base=None, embed_key=None) -> dict` — returns `{"facts": n, "added": n, "reinforced": n, "superseded": n}`; the probe harness (Task 8) calls this directly
  - `async maybe_extract(session, char, user_name, language, model, chat_base=None, chat_key=None, embed_base=None, embed_key=None)` — cursor-driven, loops while ≥ BATCH_SIZE settled exchanges remain unextracted, commits cursor per batch
  - `async retrieve_block(session, char, user_name, query, msgs, cfg, embed_base=None, embed_key=None) -> tuple[str, list[str]]` — `("", [])` when nothing retrievable

- [ ] **Step 1: Write the failing test**

```python
import pytest

from backend import memory_service as ms


def msg(role, content, mid="m"):
    return {"id": mid, "role": role, "content": content}


def test_exchanges_pairs_user_assistant():
    msgs = [msg("user", "a"), msg("assistant", "b"), msg("user", "c"),
            msg("assistant", "d"), msg("user", "e")]
    got = ms.exchanges(msgs)
    assert len(got) == 2
    assert got[0][0]["content"] == "a" and got[1][1]["content"] == "d"


def test_current_turn_counts_user_messages():
    msgs = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")]
    assert ms.current_turn(msgs) == 2


def test_present_participants_includes_pair_and_cued_names():
    got = ms.present_participants("Kael", "Alice", ["Mira", "Bram"], "then Mira walked in")
    assert got == ["Alice", "Kael", "Mira"]


class FakeRepo:
    def __init__(self):
        self.cursor = 0
        self.inserted, self.reinforced_calls, self.superseded_calls = [], [], []

    async def get_cursor(self, sid):
        return self.cursor

    async def set_cursor(self, sid, n):
        self.cursor = n

    async def insert(self, fact, vec):
        self.inserted.append(fact)
        return f"mf_{len(self.inserted)}"

    async def reinforce(self, fid, turn):
        self.reinforced_calls.append((fid, turn))

    async def supersede(self, old, fact, vec, turn):
        self.superseded_calls.append((old, turn))
        return "mf_new"

    async def similar_live(self, sid, vec, k):
        return [{"id": "mf_a", "text": "Mira got hurt."}]

    async def reserved(self, sid):
        return []


@pytest.fixture()
def wired(monkeypatch):
    repo = FakeRepo()
    monkeypatch.setattr(ms, "memory_facts", repo)

    async def fake_embed(text, model, base_url=None, api_key=None):
        return [0.0] * 8

    monkeypatch.setattr(ms.llm, "embed", fake_embed)
    return repo


@pytest.mark.asyncio
async def test_maybe_extract_below_threshold_does_nothing(wired, monkeypatch):
    called = []

    async def fake_list(sid):
        return [msg("user", "a"), msg("assistant", "b")] * 3

    monkeypatch.setattr(ms.chat_sessions, "list_messages", fake_list)

    async def fake_extract(*a, **kw):
        called.append(1)
        return []

    monkeypatch.setattr(ms, "run_extract", fake_extract)
    await ms.maybe_extract({"id": "s1"}, {"id": "c1", "name": "Kael"}, "Alice", "English", "m")
    assert called == []


@pytest.mark.asyncio
async def test_maybe_extract_runs_batches_and_advances_cursor(wired, monkeypatch):
    from backend.memory_extraction import FactDraft, ReconcileDecision

    async def fake_list12(sid):
        out = []
        for i in range(12):
            out += [msg("user", f"u{i}"), msg("assistant", f"a{i}")]
        return out

    monkeypatch.setattr(ms.chat_sessions, "list_messages", fake_list12)

    async def fake_extract(transcript, cn, un, lang, model, base_url=None, api_key=None):
        return [FactDraft(text="Mira was stabbed.", fact_type="state",
                          participants=["Mira"], importance=5, valence=-2),
                FactDraft(text="The mine collapsed.", fact_type="world",
                          participants=[], importance=3, valence=-1)]

    async def fake_reconcile(drafts, neighbors, model, base_url=None, api_key=None):
        return [ReconcileDecision(index=0, action="reinforce", target_id="mf_a"),
                ReconcileDecision(index=1, action="add")]

    monkeypatch.setattr(ms, "run_extract", fake_extract)
    monkeypatch.setattr(ms, "run_reconcile", fake_reconcile)
    await ms.maybe_extract({"id": "s1"}, {"id": "c1", "name": "Kael"}, "Alice", "English", "m")
    assert wired.cursor == 10
    assert len(wired.inserted) == 2
    assert len(wired.reinforced_calls) == 2
    assert wired.inserted[0]["fact_type"] == "world"


@pytest.mark.asyncio
async def test_extract_batch_defaults_unattributed_participants(wired, monkeypatch):
    from backend.memory_extraction import FactDraft, ReconcileDecision

    async def fake_extract(*a, **kw):
        return [FactDraft(text="A vow was made.", fact_type="event",
                          participants=[], importance=4, valence=1)]

    async def fake_reconcile(drafts, neighbors, model, base_url=None, api_key=None):
        return [ReconcileDecision(index=0, action="add")]

    monkeypatch.setattr(ms, "run_extract", fake_extract)
    monkeypatch.setattr(ms, "run_reconcile", fake_reconcile)
    batch = [(msg("user", "u"), msg("assistant", "a"))] * 5
    stats = await ms.extract_batch("s1", "c1", "Kael", "Alice", batch, 5, "English", "m")
    assert stats["added"] == 1
    assert wired.inserted[0]["participants"] == ["Alice", "Kael"]


@pytest.mark.asyncio
async def test_retrieve_block_returns_empty_without_query(wired):
    text, used = await ms.retrieve_block({"id": "s1", "known_names": "[]"},
                                         {"id": "c1", "name": "Kael"}, "Alice",
                                         "", [], {"memory_v2_budget_tokens": 600})
    assert text == "" and used == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_service.py -q"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.memory_service'`.

- [ ] **Step 3: Write the module**

`backend/memory_service.py`:

```python
import json

from backend import llm
from backend.state import CFG, log
from backend.repositories import memory_facts
from backend.repositories import chat_sessions
from backend.memory_extraction import run_extract, run_reconcile
from backend import memory_ranking
from backend import memory_block
from backend.prompt import strip_think, recent_text

BATCH_SIZE = 5
SETTLE_MARGIN_EXCHANGES = 1
NEIGHBOR_K = 3
CANDIDATE_K = 32


def exchanges(msgs: list[dict]) -> list[tuple[dict, dict]]:
    out, pending_user = [], None
    for m in msgs:
        if m["role"] == "user":
            pending_user = m
        elif m["role"] == "assistant" and pending_user is not None:
            out.append((pending_user, m))
            pending_user = None
    return out


def current_turn(msgs: list[dict]) -> int:
    return sum(1 for m in msgs if m["role"] == "user")


def present_participants(char_name: str, user_name: str, known_names: list[str],
                         recent: str) -> list[str]:
    lowered = (recent or "").lower()
    present = [user_name, char_name]
    present += [n for n in known_names if n and n.lower() in lowered and n not in present]
    return present


def _transcript(batch: list[tuple[dict, dict]], char_name: str, user_name: str) -> str:
    lines = []
    for user_msg, assistant_msg in batch:
        lines.append(f"{user_name}: {user_msg['content']}")
        lines.append(f"{char_name}: {strip_think(assistant_msg['content'])}")
    return "\n".join(lines)


async def extract_batch(sid: str, char_id: str, char_name: str, user_name: str,
                        batch: list[tuple[dict, dict]], turn: int, language: str, model: str,
                        chat_base: str | None = None, chat_key: str | None = None,
                        embed_base: str | None = None, embed_key: str | None = None) -> dict:
    log.info("memory extract start: session=%s turn=%s batch=%d exchanges", sid, turn, len(batch))
    drafts = await run_extract(_transcript(batch, char_name, user_name),
                               char_name, user_name, language, model, chat_base, chat_key)
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
                            language, model, chat_base, chat_key, embed_base, embed_key)
        cursor = turn
        await memory_facts.set_cursor(sid, cursor)


async def retrieve_block(session: dict, char: dict, user_name: str, query: str,
                         msgs: list[dict], cfg: dict,
                         embed_base: str | None = None,
                         embed_key: str | None = None) -> tuple[str, list[str]]:
    if not query:
        return "", []
    sid = session["id"]
    try:
        qvec = await llm.embed(query, CFG["embed_model"], base_url=embed_base, api_key=embed_key)
    except Exception as e:
        log.warning("memory v2 query embedding failed: session=%s error=%s", sid, e)
        return "", []
    turn = current_turn(msgs)
    known = json.loads(session.get("known_names") or "[]")
    present = present_participants(char["name"], user_name, known, recent_text(msgs))
    candidates = await memory_facts.similar_live(sid, qvec, CANDIDATE_K)
    ranked = memory_ranking.rank(candidates, present, turn)
    guaranteed = await memory_facts.reserved(sid)
    pinned = [f for f in guaranteed if f.get("pinned")]
    active = [f for f in guaranteed if not f.get("pinned")]
    budget = int(cfg.get("memory_v2_budget_tokens") or 600)
    block, used, dropped = memory_block.build_block(pinned, active, ranked, budget)
    if dropped:
        log.info("memory block overflow: session=%s dropped_reserved=%d", sid, len(dropped))
    log.info("memory v2 retrieve: session=%s turn=%s candidates=%d ranked=%d used=%d",
             sid, turn, len(candidates), len(ranked), len(used))
    return block, used
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory/test_service.py -q"`
Expected: 7 passed. Also run the whole suite: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory -q"` — all green.

- [ ] **Step 5: Commit**

```bash
git add backend/memory_service.py tests/memory/test_service.py
git commit -m "Add MemoryService: batched settled-turn extraction and budgeted retrieval"
```

---

### Task 7: Config flag + chat pipeline wiring

**Files:**
- Modify: `backend/state.py` (CFG dict + PUBLIC_CFG_KEYS)
- Modify: `backend/retrieval.py` (`remember` gains `store_semantic` param)
- Modify: `backend/chat_service.py` (`_run`: v2 block injection + guard, skip legacy memory when v2, post-turn `maybe_extract`)
- Test: manual live verification (this task is wiring; its logic lives in already-tested modules)

**Interfaces:**
- Consumes: `memory_service.retrieve_block` / `memory_service.maybe_extract` (Task 6).
- Produces: `CFG["memory_v2"]` (bool), `CFG["memory_v2_budget_tokens"]` (int) — both in `PUBLIC_CFG_KEYS`, admin-editable via PUT /api/settings.

- [ ] **Step 1: Add the config keys**

In `backend/state.py`, inside the `CFG` dict after the `"enable_thinking"` line:

```python
    "memory_v2": os.environ.get("MEMORY_V2", "false").lower() in ("1", "true", "yes", "on"),
    "memory_v2_budget_tokens": int(os.environ.get("MEMORY_V2_BUDGET_TOKENS", "600")),
```

In `PUBLIC_CFG_KEYS`, after `"enable_thinking"`:

```python
    "memory_v2", "memory_v2_budget_tokens",
```

Do NOT add them to `USER_CFG_KEYS` (instance-level rollout switch, not a per-user preference).

- [ ] **Step 2: Gate legacy semantic storage in `remember`**

In `backend/retrieval.py`, change the `remember` signature to add a final keyword param:

```python
async def remember(char_id, char_name, session_id, user_mid, user_text, reply_text, language,
                   chat_model, prev_session: dict = None,
                   embed_base: str | None = None, embed_key: str | None = None,
                   chat_base: str | None = None, chat_key: str | None = None,
                   store_semantic: bool = True):
```

And replace the final storage stanza (`if not signal["key_points"]: return None` through the `store_memory` call) with:

```python
    if not store_semantic or not signal["key_points"]:
        return None
    try:
        vec = await llm.embed(signal["key_points"], CFG["embed_model"],
                              base_url=embed_base, api_key=embed_key)
    except Exception as e:
        log.warning("memory embedding failed for turn %s: %s", user_mid, e)
        return str(e)
    await vectors.store_memory(char_id, session_id, signal["key_points"], vec, mem_id=user_mid)
    return None
```

(The char-state half of `remember` — doing/location/npcs — keeps running in both modes; only the legacy semantic vector write is skipped under v2.)

- [ ] **Step 3: Wire `_run` in `backend/chat_service.py`**

Add to the imports:

```python
from backend import memory_service
```

After the existing `retrieve(...)` call (the `lore_lines, mem_lines, retrieve_err = await retrieve(...)` statement), insert:

```python
    memory_v2 = bool(eff.get("memory_v2"))
    v2_block = ""
    if memory_v2:
        v2_block, _ = await memory_service.retrieve_block(
            s, char, user_name, query, msgs, eff,
            embed_base=ep["embed_base"], embed_key=ep["embed_key"])
```

Replace the existing `if mem_lines:` injection with:

```python
    if memory_v2:
        system += ("\n\n# Recalled memory\n"
                   "Your knowledge of past events in this story is exactly what follows, plus the "
                   "recent conversation itself. If something is in neither, you do not clearly "
                   "remember it — respond with in-character uncertainty rather than inventing "
                   "shared history, past conversations, or prior meetings.\n\n"
                   + (v2_block or "(nothing notable recalled this turn)"))
    elif mem_lines:
        system += "\n\n# Long-term memory (you recall these from earlier)\n" + "\n".join(mem_lines)
```

In `gen()`, change the `remember(...)` call to pass `store_semantic=not memory_v2`, and immediately after the `remember` try/except block add:

```python
        if memory_v2:
            try:
                await memory_service.maybe_extract(
                    s, char, user_name, language, chat_model,
                    chat_base=eff_chat_base, chat_key=eff_api_key,
                    embed_base=ep["embed_base"], embed_key=ep["embed_key"])
            except Exception as e:
                log.warning("memory v2 extraction failed: session=%s error=%s", sid, e)
```

(Deliberately after the `done` SSE payload is prepared but before yielding is fine either way — keep it before the final `yield` so a cancelled task doesn't strand a half-applied batch mid-decision; the cursor commits only after a batch fully applies, so cancellation is safe regardless. Also note the `meta` SSE event still reports the legacy `memory` list — under v2 it will be empty; surfacing the v2 block in the panel is the memory-page plan's job.)

- [ ] **Step 4: Run the full test suite + live verification**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest tests/memory -q"` — all green.

Live check (flag off — default): send one chat message via the app on :3001 (accounts: `claude:0987654321` admin / `test:11111111` user — never create new ones); confirm normal behavior, `grep memory storyhavenai.logs.jsonl` shows no v2 lines.

Live check (flag on): as admin, `PUT /api/settings` with `{"memory_v2": true}` (or flip in the admin panel), then hold a session past 6 exchanges; confirm log lines `memory extract start/done` and `memory v2 retrieve` appear, and the reply still streams normally. Flip the flag back off afterwards.

- [ ] **Step 5: Commit**

```bash
git add backend/state.py backend/retrieval.py backend/chat_service.py
git commit -m "Wire memory v2 behind config flag: block injection, guard, post-turn extraction"
```

---

### Task 8: Probe harness + falsification scripts

**Files:**
- Create: `modules/py/memory_probe_replay.py`
- Create: `modules/py/probe_scripts/contradictions.json`
- Create: `modules/py/probe_scripts/participant_leak.json`
- Create: `modules/py/make_dedup_script.py` (generates `modules/py/probe_scripts/dedup.json`)

**Interfaces:**
- Consumes: `memory_service.extract_batch`/`retrieve_block`, `memory_facts.ensure_tables`/`purge_session`, `db.init`, real LLM + embed endpoints (runs inside the container: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 modules/py/memory_probe_replay.py modules/py/probe_scripts/contradictions.json"`).
- Script JSON format: `{"turns": [{"user": str, "assistant": str}], "probes": [{"query": str, "present": [str], "expect": [str], "reject": [str]}]}` — a probe passes when every `expect` substring appears in the retrieved block (case-insensitive) and no `reject` substring does.
- `--naive` flag: skip reconcile, apply all-add decisions (the dedup A/B arm).
- Exit code 0 iff all probes pass; prints per-probe PASS/FAIL, fact counts, and add/reinforce/supersede totals.

- [ ] **Step 1: Write the replay script**

`modules/py/memory_probe_replay.py`:

```python
import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend import db
from backend import memory_service
from backend.memory_extraction import ReconcileDecision
from backend.repositories import memory_facts
from backend.state import CFG

CHAR_NAME = "Kael"
USER_NAME = "Alice"


def _batches(turns):
    pairs = [({"id": f"u{i}", "role": "user", "content": t["user"]},
              {"id": f"a{i}", "role": "assistant", "content": t["assistant"]})
             for i, t in enumerate(turns)]
    for start in range(0, len(pairs) - len(pairs) % memory_service.BATCH_SIZE,
                       memory_service.BATCH_SIZE):
        yield pairs[start:start + memory_service.BATCH_SIZE], start + memory_service.BATCH_SIZE


async def _run(script_path: str, naive: bool, keep: bool):
    script = json.loads(Path(script_path).read_text(encoding="utf-8"))
    sid = "probe-" + uuid.uuid4().hex[:8]
    await db.init()
    await memory_facts.ensure_tables(CFG["embed_dim"])
    if naive:
        async def all_add(drafts, neighbors, model, base_url=None, api_key=None):
            return [ReconcileDecision(index=i, action="add") for i in range(len(drafts))]
        memory_service.run_reconcile = all_add
    totals = {"facts": 0, "added": 0, "reinforced": 0, "superseded": 0}
    for batch, turn in _batches(script["turns"]):
        stats = await memory_service.extract_batch(
            sid, "probe-char", CHAR_NAME, USER_NAME, batch, turn, "English", CFG["chat_model"])
        for key in totals:
            totals[key] += stats[key]
        print(f"turn {turn}: {stats}")
    session = {"id": sid, "known_names": json.dumps(script.get("known_names", []))}
    msgs = [{"id": "q", "role": "user", "content": "probe"}] * len(script["turns"])
    failures = 0
    for probe in script["probes"]:
        block, used = await memory_service.retrieve_block(
            {**session, "known_names": json.dumps(probe.get("present", []))},
            {"id": "probe-char", "name": CHAR_NAME}, USER_NAME,
            probe["query"], msgs, CFG)
        lowered = block.lower()
        missing = [e for e in probe.get("expect", []) if e.lower() not in lowered]
        leaked = [r for r in probe.get("reject", []) if r.lower() in lowered]
        ok = not missing and not leaked
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}: {probe['query']!r}"
              + (f" missing={missing}" if missing else "")
              + (f" leaked={leaked}" if leaked else ""))
        if not ok:
            print(f"  block was:\n{block}\n")
    print(f"totals: {totals} probes_failed={failures} session={sid}")
    if not keep:
        await memory_facts.purge_session(sid)
    await db.close()
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("--naive", action="store_true")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    failures = asyncio.run(_run(args.script, args.naive, args.keep))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
```

Wrinkle to respect: `retrieve_block` reads `present_participants` from `known_names` + `recent_text(msgs)` — the probe supplies its `present` list via `known_names`, but names only count as present when they appear in recent text. For the harness, make presence explicit: in `memory_service.present_participants`, names pass the recency check via the probe's query being the recent text. Simpler and correct: have the harness bypass that heuristic by monkeypatching — add near the top of `_run`, after imports:

```python
    def fixed_present(char_name, user_name, known_names, recent):
        return [user_name, char_name] + list(known_names)
    memory_service.present_participants = fixed_present
```

(The probe's `present` list then flows through `known_names` verbatim. The app path keeps the recency heuristic.)

- [ ] **Step 2: Write the contradiction + leak fixtures**

`modules/py/probe_scripts/contradictions.json` (filler turns pad each case to a full batch of 5; the pattern: establish → filler → contradict → probe):

```json
{
  "turns": [
    {"user": "Tell me about the captain.", "assistant": "Mira leans in. \"I trust Captain Doran with my life. He saved me at Redford.\""},
    {"user": "We walk along the docks.", "assistant": "The gulls wheel overhead as Kael points out the fishing boats coming in."},
    {"user": "What do you carry?", "assistant": "Kael pats a worn satchel. \"Maps, mostly. And my father's compass — it never leaves me.\""},
    {"user": "We stop for bread.", "assistant": "The baker waves them over, pressing warm rolls into their hands."},
    {"user": "Anything else about town?", "assistant": "\"The old mill's been abandoned for years,\" Kael says. \"Nobody goes there.\""},
    {"user": "We meet Mira again after the Hall.", "assistant": "Mira's jaw is tight. \"Doran sold us out at the Hall. I despise him now — never speak his name kindly to me again.\""},
    {"user": "We rest by the fire.", "assistant": "The flames crackle. Kael stretches out, humming an old tune."},
    {"user": "I check my gear.", "assistant": "Kael nods approvingly at the well-kept blade."},
    {"user": "We talk about the weather.", "assistant": "\"Storm's coming in from the east,\" Kael mutters, eyeing the clouds."},
    {"user": "We turn in for the night.", "assistant": "Kael banks the fire low. \"Sleep. I'll take first watch.\""}
  ],
  "probes": [
    {"query": "How does Mira feel about Captain Doran?", "present": ["Mira"],
     "expect": ["despise"], "reject": []},
    {"query": "What does Kael always carry?", "present": [],
     "expect": ["compass"], "reject": []}
  ]
}
```

(The first probe is the contradiction test: a healthy run either retrieves only the successor, or retrieves the old fact rendered with "this later changed" — so `expect` checks the new state surfaced; a stronger variant adds `"reject": ["trust Captain Doran with my life"]` once supersede quality is confirmed. Start permissive, tighten after the first real run.)

`modules/py/probe_scripts/participant_leak.json`:

```json
{
  "turns": [
    {"user": "I meet Mira alone in the archive, no one else around.", "assistant": "Mira glances about, then whispers: \"I hid the ledger under the third floorboard. Only you know this.\""},
    {"user": "We seal the archive and leave separately.", "assistant": "Mira slips out the back way, satchel empty, expression unreadable."},
    {"user": "Later I meet Bram at the tavern.", "assistant": "Bram raises his mug. \"Good hunting today — the road east is clear, by the way.\""},
    {"user": "Bram and I play cards.", "assistant": "Bram loses three hands and laughs about it, ordering another round."},
    {"user": "I head home for the night.", "assistant": "The streets are quiet; lamplight pools on the cobbles as the door shuts behind you."},
    {"user": "Next day, filler scene one.", "assistant": "Market stalls open slowly under a pale sun."},
    {"user": "Filler scene two.", "assistant": "A courier hurries past with a bundle of letters."},
    {"user": "Filler scene three.", "assistant": "Rain starts, soft against the shutters."},
    {"user": "Filler scene four.", "assistant": "The rain passes; gutters drip in the lane."},
    {"user": "Filler scene five.", "assistant": "Evening settles over the rooftops."}
  ],
  "probes": [
    {"query": "Where is the ledger hidden?", "present": ["Mira"],
     "expect": ["floorboard"], "reject": []},
    {"query": "Where is the ledger hidden?", "present": ["Bram"],
     "expect": [], "reject": ["floorboard", "ledger"]}
  ]
}
```

- [ ] **Step 3: Write the dedup script generator**

`modules/py/make_dedup_script.py`:

```python
import json
from pathlib import Path

FACTS = {
    "compass": ["Kael showed off his father's brass compass again.",
                "\"This compass was my father's,\" Kael said, turning it over.",
                "Kael checked the old compass his father left him.",
                "The battered compass — his father's — never leaves Kael's belt."],
    "wound": ["Mira's stabbed shoulder was aching again.",
              "Mira winced, favoring the shoulder where the knife went in.",
              "The stab wound in Mira's shoulder had not healed.",
              "Mira pressed a hand to her injured shoulder."],
    "debt": ["Kael still owes the innkeeper Serna forty silver.",
             "\"Forty silver, Kael. I haven't forgotten,\" Serna called out.",
             "Serna reminded Kael about the forty silver he owes her.",
             "The debt to Serna — forty silver — came up again."],
    "mill": ["The abandoned mill outside town creaked in the wind.",
             "Nobody has worked the old mill in years; it stands empty.",
             "They passed the derelict mill on the north road again.",
             "The old mill loomed, long abandoned."],
    "song": ["Kael hummed the Redford lament by the fire.",
             "That old Redford lament again — Kael can't stop humming it.",
             "Kael sang a verse of the lament from Redford.",
             "The Redford tune drifted from Kael's lips."],
    "map": ["Kael marked the eastern pass on his map of the Greyspine.",
            "The Greyspine map gained another notation: the eastern pass.",
            "Kael updated his Greyspine map, tracing the eastern pass.",
            "Poring over the Greyspine map, Kael circled the eastern pass."],
}

def main():
    turns = []
    phrasings = max(len(v) for v in FACTS.values())
    for round_index in range(phrasings):
        for key, variants in FACTS.items():
            line = variants[round_index % len(variants)]
            turns.append({"user": f"We continue the journey, scene {len(turns)}.",
                          "assistant": line})
    probes = [
        {"query": "What does Kael carry from his father?", "present": [],
         "expect": ["compass"], "reject": []},
        {"query": "What does Kael owe and to whom?", "present": ["Serna"],
         "expect": ["forty silver"], "reject": []},
        {"query": "What is wrong with Mira?", "present": ["Mira"],
         "expect": ["shoulder"], "reject": []},
        {"query": "What lies on the north road?", "present": [],
         "expect": ["mill"], "reject": []},
        {"query": "What song does Kael like?", "present": [],
         "expect": ["Redford"], "reject": []},
        {"query": "What did Kael mark on the map?", "present": [],
         "expect": ["eastern pass"], "reject": []},
    ]
    out = Path(__file__).parent / "probe_scripts" / "dedup.json"
    out.write_text(json.dumps({"turns": turns, "probes": probes}, indent=1), encoding="utf-8")
    print(f"wrote {out} ({len(turns)} turns, {len(probes)} probes)")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the falsification pass**

```bash
python3 modules/py/make_dedup_script.py
podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 modules/py/memory_probe_replay.py modules/py/probe_scripts/participant_leak.json"
podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 modules/py/memory_probe_replay.py modules/py/probe_scripts/contradictions.json"
podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 modules/py/memory_probe_replay.py modules/py/probe_scripts/dedup.json --naive"
podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 modules/py/memory_probe_replay.py modules/py/probe_scripts/dedup.json"
```

Expected: leak + contradiction scripts exit 0. For the dedup pair, compare the `added=` totals: the reconciled run must show substantially fewer `added` and nonzero `reinforced` versus the naive run (this is the spec's dedup A/B — the design's core claim). Record both totals in the commit message. These calls hit the real chat + embed endpoints; results depend on the configured model — probe failures here are findings, not necessarily code bugs. Investigate FAILs (print shows the block) before tightening or loosening fixtures.

- [ ] **Step 5: Commit**

```bash
git add modules/py/memory_probe_replay.py modules/py/make_dedup_script.py modules/py/probe_scripts/
git commit -m "Add memory probe harness with dedup A/B, contradiction, and leak scripts"
```

---

## Out of scope (later plans, per the spec)

Memory management page (CRUD/pin UI), `dm_notes` debug block, reflection + rolling summary, stale-active-state demotion, memory-driven image generation, `RPG_IMMERSION_PROMPT` slimming, and surfacing the v2 block in the chat UI's memory panel (the `meta` SSE event still carries only the legacy list).
