# Session Lore State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a User reveal a hidden lore entry's facts one at a time for their own session — never the whole entry at once, never a fact that wasn't individually earned — and hand-edit an entry's effective content as a pinned memory fact that actively steers the AI. The Author's original lorebook is never touched by any of it.

**Architecture:** A hidden entry is decomposed once into independent `lore_secrets` rows (cached, regenerated only when the Author edits the entry). `session_secret_reveals` tracks which specific secrets a session has revealed — a join table, not a per-entry flag. `session_lore_state` handles only the separate Override mechanism. A new router (`backend/routers/session_lore.py`) exposes all of this, gated by the existing `_own_session` ownership check. Frontend adds one new modal to the existing chat header dropdown, mirroring `openCharStateModal()`'s established fetch/render pattern.

**Tech Stack:** FastAPI + SQLAlchemy Core (async, Postgres) on the backend; vanilla JS on the frontend. No build step.

## Global Constraints

- Zero comments in any file — code must be self-documenting (project CLAUDE.md Coding style).
- New DB columns/tables are added by editing `backend/db.py`'s `Table` definitions; created automatically via `metadata.create_all(checkfirst=True)` at startup.
- Every mutating endpoint gets a `log.info` on success; every caught exception that doesn't re-raise gets `log.warning`/`log.error` — via `from backend.state import log`.
- Absolute imports only inside `backend/` (`from backend.x import y`), never bare `import x`.
- **A hidden entry's original `content`/`keys` must never be revealed through any surface except an explicit, individual secret reveal.** This is the single most important constraint in this plan — every task that touches lore data must re-verify it holds, not just the tasks that look privacy-related on their face.
- **An unrevealed secret's `text` must never be sent to the client**, not even as a hidden/collapsed field — only `{"id", "revealed": false, "text": null}`.
- **The override feature requires Memory V2 to be enabled** (`_eff_cfg(user_overrides)["memory_v2"]`) — a pinned `memory_facts` row is only ever read by `chat_service.py`'s memory retrieval when `memory_v2` is true. Without this gate, an override would silently do nothing useful — it must 400 with a clear message when memory_v2 is off, not fail silently.
- **The reveal feature works standalone without Memory V2** — recording a reveal into `memory_facts` is best-effort enrichment when V2 happens to be on, never a hard requirement; a Memory V2 failure must never block the reveal itself (same try/log.warning-and-continue pattern `routers/lore.py`'s `index_lore` failure handling already uses).
- This is a live app (`/var/home/staygold/ai-frontend` is the running container's bind mount) — edit files directly, never in a worktree. Backend `.py` edits hot-reload; `new_ui/js` edits are picked up on next page load (no-cache headers).
- Verify against `https://storyhavenai.sillysillysupersillydomain.win` — plain `localhost:3000` is not reachable from this shell.
- Login for manual verification: username `test`, password `11111111` (do not create new accounts, per project CLAUDE.md).

---

### Task 1: `lore_secrets` + `session_secret_reveals` tables and repository

**Files:**
- Modify: `backend/db.py`
- Create: `backend/repositories/lore_secrets.py`
- Test: `backend/tests/test_lore_secrets_repo.py`

**Interfaces:**
- Produces (used by Task 5):
  - `async def secrets_for(lore_id: str) -> list[dict]` (each `{"id", "text", "position"}`, ordered by position)
  - `async def set_secrets(lore_id: str, texts: list[str]) -> list[dict]` (replaces all secrets for this entry — deletes existing rows first, used both for first-time decomposition and content-change regeneration)
  - `async def delete_secrets(lore_id: str) -> None`
  - `async def reveal(session_id: str, secret_id: str) -> None` (idempotent)
  - `async def revealed_ids(session_id: str, secret_ids: list[str]) -> set[str]`

- [ ] **Step 1: Add both tables to `backend/db.py`**

Insert right after the closing `)` of the `lore_links` table definition:

```python
lore_secrets = sa.Table(
    "lore_secrets", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("lore_id", sa.Text, nullable=False),
    sa.Column("text", sa.Text, nullable=False),
    sa.Column("position", sa.Integer, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
)

session_secret_reveals = sa.Table(
    "session_secret_reveals", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("session_id", sa.Text, nullable=False),
    sa.Column("secret_id", sa.Text, nullable=False),
    sa.Column("revealed", sa.Float, nullable=False),
    sa.UniqueConstraint("session_id", "secret_id", name="uq_session_secret_pair"),
)
```

Then find the `sa.Index("idx_lore_links_a", ...)` / `sa.Index("idx_lore_links_b", ...)` lines and add these indexes right after them:

```python
sa.Index("idx_lore_secrets_lore", lore_secrets.c.lore_id)
sa.Index("idx_session_secret_reveals_session", session_secret_reveals.c.session_id)
sa.Index("idx_session_secret_reveals_secret", session_secret_reveals.c.secret_id)
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_lore_secrets_repo.py`:

```python
import pytest

from backend.repositories import lore, lore_secrets as ls

pytestmark = pytest.mark.asyncio


async def _make_lore(db_conn, name="entry", content="content"):
    return await lore.create(None, [], content, always=False, name=name, hidden=True)


async def test_set_secrets_creates_ordered_rows(db_conn):
    lid = await _make_lore(db_conn)
    result = await ls.set_secrets(lid, ["likes sweets", "hates cake"])
    assert [r["text"] for r in result] == ["likes sweets", "hates cake"]
    assert [r["position"] for r in result] == [0, 1]


async def test_secrets_for_returns_ordered(db_conn):
    lid = await _make_lore(db_conn)
    await ls.set_secrets(lid, ["first", "second", "third"])
    result = await ls.secrets_for(lid)
    assert [r["text"] for r in result] == ["first", "second", "third"]


async def test_set_secrets_replaces_existing(db_conn):
    lid = await _make_lore(db_conn)
    await ls.set_secrets(lid, ["old fact"])
    await ls.set_secrets(lid, ["new fact one", "new fact two"])
    result = await ls.secrets_for(lid)
    assert [r["text"] for r in result] == ["new fact one", "new fact two"]


async def test_delete_secrets(db_conn):
    lid = await _make_lore(db_conn)
    await ls.set_secrets(lid, ["a fact"])
    await ls.delete_secrets(lid)
    assert await ls.secrets_for(lid) == []


async def test_reveal_and_revealed_ids(db_conn):
    lid = await _make_lore(db_conn)
    secrets = await ls.set_secrets(lid, ["likes sweets", "hates cake"])
    sweets_id, cake_id = secrets[0]["id"], secrets[1]["id"]
    await ls.reveal("sess-1", sweets_id)
    revealed = await ls.revealed_ids("sess-1", [sweets_id, cake_id])
    assert revealed == {sweets_id}


async def test_reveal_is_idempotent(db_conn):
    lid = await _make_lore(db_conn)
    secrets = await ls.set_secrets(lid, ["a fact"])
    sid = secrets[0]["id"]
    await ls.reveal("sess-1", sid)
    await ls.reveal("sess-1", sid)
    revealed = await ls.revealed_ids("sess-1", [sid])
    assert revealed == {sid}


async def test_reveal_scoped_to_session(db_conn):
    lid = await _make_lore(db_conn)
    secrets = await ls.set_secrets(lid, ["a fact"])
    sid = secrets[0]["id"]
    await ls.reveal("sess-1", sid)
    revealed = await ls.revealed_ids("sess-2", [sid])
    assert revealed == set()


async def test_partial_reveal_does_not_leak_sibling_secret(db_conn):
    lid = await _make_lore(db_conn)
    secrets = await ls.set_secrets(lid, ["likes sweets", "hates cake"])
    sweets_id = secrets[0]["id"]
    cake_id = secrets[1]["id"]
    await ls.reveal("sess-1", sweets_id)
    all_secrets = await ls.secrets_for(lid)
    revealed = await ls.revealed_ids("sess-1", [s["id"] for s in all_secrets])
    assert sweets_id in revealed
    assert cake_id not in revealed
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_secrets_repo.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.repositories.lore_secrets'`

- [ ] **Step 4: Implement `backend/repositories/lore_secrets.py`**

```python
import time

from sqlalchemy import select, insert, delete as sa_delete, and_

from backend.db import lore_secrets, session_secret_reveals, nid, _q, _w
from backend.state import log


def _row(row) -> dict:
    return {"id": row["id"], "text": row["text"], "position": row["position"]}


async def secrets_for(lore_id: str) -> list[dict]:
    rows = await _q(select(lore_secrets).where(lore_secrets.c.lore_id == lore_id)
                    .order_by(lore_secrets.c.position))
    return [_row(r) for r in rows]


async def set_secrets(lore_id: str, texts: list[str]) -> list[dict]:
    await delete_secrets(lore_id)
    created = time.time()
    rows = [{"id": nid("lsec"), "lore_id": lore_id, "text": t, "position": i, "created": created}
            for i, t in enumerate(texts)]
    if rows:
        await _w(insert(lore_secrets).values(rows))
    log.info("lore_secrets: set count=%s lore=%s", len(rows), lore_id)
    return await secrets_for(lore_id)


async def delete_secrets(lore_id: str) -> None:
    await _w(sa_delete(lore_secrets).where(lore_secrets.c.lore_id == lore_id))
    log.info("lore_secrets: deleted lore=%s", lore_id)


async def reveal(session_id: str, secret_id: str) -> None:
    existing = await _q(select(session_secret_reveals).where(
        and_(session_secret_reveals.c.session_id == session_id,
             session_secret_reveals.c.secret_id == secret_id)))
    if existing:
        return
    await _w(insert(session_secret_reveals).values(
        id=nid("ssr"), session_id=session_id, secret_id=secret_id, revealed=time.time()))
    log.info("lore_secrets: revealed session=%s secret=%s", session_id, secret_id)


async def revealed_ids(session_id: str, secret_ids: list[str]) -> set[str]:
    if not secret_ids:
        return set()
    rows = await _q(select(session_secret_reveals.c.secret_id).where(
        and_(session_secret_reveals.c.session_id == session_id,
             session_secret_reveals.c.secret_id.in_(secret_ids))))
    return {r["secret_id"] for r in rows}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_secrets_repo.py -v`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/db.py backend/repositories/lore_secrets.py backend/tests/test_lore_secrets_repo.py
git commit -m "Add lore_secrets and session_secret_reveals tables and repository"
```

---

### Task 2: `memory_facts.py` — pinned inserts + text updates

**Files:**
- Modify: `backend/repositories/memory_facts.py`
- Test: check for an existing `backend/tests/test_memory_facts_repo.py` first

**Interfaces:**
- Produces (used by Task 5): `insert(fact: dict, vec, pinned: bool = False) -> str` (extends the existing signature, backward compatible), `async def update_text(fact_id: str, text: str, vec) -> None`, `async def expire(fact_id: str) -> None`

- [ ] **Step 1: Check for existing test coverage**

Run: `ls backend/tests/ | grep -i memory_fact`. If it exists, add the tests below into it following its established fixtures; if not, create it fresh — check `backend/tests/conftest.py` for how the `db_conn` fixture handles `memory_facts`' dynamically-built pgvector table (`build_tables(dim)`/`ensure_tables(dim)`) before assuming the standard fixture is sufficient.

- [ ] **Step 2: Write the failing tests**

```python
import pytest

from backend.repositories import memory_facts

pytestmark = pytest.mark.asyncio


def _fake_vec(dim=8):
    return [0.1] * dim


async def test_insert_pinned_true_persists(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-1", "char_id": "char-1", "text": "pinned fact",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    reserved = await memory_facts.reserved("sess-1")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["pinned"] is True


async def test_insert_pinned_default_false(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-2", "char_id": "char-1", "text": "ordinary fact",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    reserved = await memory_facts.reserved("sess-2")
    assert fid not in [r["id"] for r in reserved]


async def test_update_text_changes_text_keeps_reinforcements(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-3", "char_id": "char-1", "text": "before",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    await memory_facts.reinforce(fid, 2)
    await memory_facts.update_text(fid, "after", _fake_vec())
    reserved = await memory_facts.reserved("sess-3")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["text"] == "after"
    assert match["reinforcements"] == 1


async def test_expire_removes_from_live_results(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-4", "char_id": "char-1", "text": "expiring fact",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    await memory_facts.expire(fid)
    reserved = await memory_facts.reserved("sess-4")
    assert fid not in [r["id"] for r in reserved]
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_memory_facts_repo.py -v`
Expected: FAIL — `insert()` doesn't accept `pinned`, `update_text`/`expire` don't exist.

- [ ] **Step 4: Update `backend/repositories/memory_facts.py`**

Change `insert`'s signature and body:

```python
async def insert(fact: dict, vec, pinned: bool = False) -> str:
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
            expired_ts=None, superseded_by=None, pinned=pinned,
            embedding=list(vec)))
    log.info("memory fact added: session=%s id=%s type=%s importance=%s pinned=%s",
             fact["session_id"], fid, fact["fact_type"], fact.get("importance"), pinned)
    return fid
```

Add two new functions right after `reinforce`:

```python
async def update_text(fact_id: str, text: str, vec) -> None:
    async with _engine().begin() as conn:
        await conn.execute(sa.update(_tbl).where(_tbl.c.id == fact_id).values(
            text=text, embedding=list(vec)))
    log.info("memory fact text updated: id=%s", fact_id)


async def expire(fact_id: str) -> None:
    async with _engine().begin() as conn:
        await conn.execute(sa.update(_tbl).where(_tbl.c.id == fact_id).values(
            expired_ts=int(time.time())))
    log.info("memory fact expired: id=%s", fact_id)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_memory_facts_repo.py -v`
Expected: PASS

- [ ] **Step 6: Run any pre-existing memory-related tests to check for regressions**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/ -k memory -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add backend/repositories/memory_facts.py backend/tests/test_memory_facts_repo.py
git commit -m "Add pinned inserts, text updates, and expiry to memory_facts"
```

---

### Task 3: `session_lore_state` repository (Override only)

**Files:**
- Modify: `backend/db.py`
- Create: `backend/repositories/session_lore_state.py`
- Test: `backend/tests/test_session_lore_state_repo.py`

**Interfaces:**
- Produces (used by Task 5):
  - `async def get_state(session_id: str, lore_id: str) -> dict | None`
  - `async def set_override(session_id: str, lore_id: str, content: str, fact_id: str) -> None`
  - `async def clear_override(session_id: str, lore_id: str) -> str | None`

- [ ] **Step 1: Add the table to `backend/db.py`**

Insert right after `session_secret_reveals` (from Task 1):

```python
session_lore_state = sa.Table(
    "session_lore_state", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("session_id", sa.Text, nullable=False),
    sa.Column("lore_id", sa.Text, nullable=False),
    sa.Column("override_content", sa.Text),
    sa.Column("override_fact_id", sa.Text),
    sa.Column("updated", sa.Float, nullable=False),
    sa.UniqueConstraint("session_id", "lore_id", name="uq_session_lore_pair"),
)
```

Add a matching index alongside the ones from Task 1:

```python
sa.Index("idx_session_lore_state_session", session_lore_state.c.session_id)
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_session_lore_state_repo.py`:

```python
import pytest

from backend.repositories import lore, session_lore_state as sls

pytestmark = pytest.mark.asyncio


async def _make_lore(db_conn, name="a"):
    return await lore.create(None, [], "content", always=False, name=name)


async def test_get_state_missing_returns_none(db_conn):
    a = await _make_lore(db_conn)
    assert await sls.get_state("sess-1", a) is None


async def test_set_override_creates_state(db_conn):
    a = await _make_lore(db_conn)
    await sls.set_override("sess-1", a, "new content", "mf-123")
    state = await sls.get_state("sess-1", a)
    assert state["override_content"] == "new content"
    assert state["override_fact_id"] == "mf-123"


async def test_set_override_updates_existing_state(db_conn):
    a = await _make_lore(db_conn)
    await sls.set_override("sess-1", a, "first", "mf-1")
    await sls.set_override("sess-1", a, "second", "mf-1")
    state = await sls.get_state("sess-1", a)
    assert state["override_content"] == "second"


async def test_clear_override_returns_fact_id_and_clears(db_conn):
    a = await _make_lore(db_conn)
    await sls.set_override("sess-1", a, "content", "mf-123")
    cleared = await sls.clear_override("sess-1", a)
    assert cleared == "mf-123"
    state = await sls.get_state("sess-1", a)
    assert state["override_content"] is None
    assert state["override_fact_id"] is None


async def test_clear_override_missing_returns_none(db_conn):
    a = await _make_lore(db_conn)
    assert await sls.clear_override("sess-1", a) is None


async def test_override_scoped_to_session(db_conn):
    a = await _make_lore(db_conn)
    await sls.set_override("sess-1", a, "content", "mf-1")
    assert await sls.get_state("sess-2", a) is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_session_lore_state_repo.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 4: Implement `backend/repositories/session_lore_state.py`**

```python
import time

from sqlalchemy import select, insert, update as sa_update, and_

from backend.db import session_lore_state, nid, _q1, _w
from backend.state import log


def _row(row) -> dict:
    return {
        "session_id": row["session_id"],
        "lore_id": row["lore_id"],
        "override_content": row["override_content"],
        "override_fact_id": row["override_fact_id"],
    }


async def get_state(session_id: str, lore_id: str) -> dict | None:
    row = await _q1(select(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id, session_lore_state.c.lore_id == lore_id)))
    return _row(row) if row else None


async def set_override(session_id: str, lore_id: str, content: str, fact_id: str) -> None:
    existing = await get_state(session_id, lore_id)
    if existing:
        await _w(sa_update(session_lore_state).where(
            and_(session_lore_state.c.session_id == session_id, session_lore_state.c.lore_id == lore_id)
        ).values(override_content=content, override_fact_id=fact_id, updated=time.time()))
    else:
        await _w(insert(session_lore_state).values(
            id=nid("sls"), session_id=session_id, lore_id=lore_id,
            override_content=content, override_fact_id=fact_id, updated=time.time()))
    log.info("session_lore_state: override set session=%s lore=%s fact=%s", session_id, lore_id, fact_id)


async def clear_override(session_id: str, lore_id: str) -> str | None:
    existing = await get_state(session_id, lore_id)
    if not existing or not existing["override_fact_id"]:
        return None
    fact_id = existing["override_fact_id"]
    await _w(sa_update(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id, session_lore_state.c.lore_id == lore_id)
    ).values(override_content=None, override_fact_id=None, updated=time.time()))
    log.info("session_lore_state: override cleared session=%s lore=%s fact=%s", session_id, lore_id, fact_id)
    return fact_id
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_session_lore_state_repo.py -v`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/db.py backend/repositories/session_lore_state.py backend/tests/test_session_lore_state_repo.py
git commit -m "Add session_lore_state repository for the Override mechanism"
```

---

### Task 4: `extract_lore_secrets()` + wiring into `lore.py`'s update

**Files:**
- Modify: `backend/ai_helpers.py`
- Modify: `backend/repositories/lore.py`
- Test: `backend/tests/test_ai_helpers.py` (check for existing file first), `backend/tests/test_lore_repo.py` (append)

**Interfaces:**
- Consumes: `lore_secrets.delete_secrets` (Task 1)
- Produces (used by Task 5): `ai_helpers.extract_lore_secrets(content: str, chat_model: str, chat_base: str | None = None, chat_key: str | None = None) -> list[str]`

- [ ] **Step 1: Add `extract_lore_secrets()` to `backend/ai_helpers.py`**

Follow `expand_persona_description()`'s exact call pattern (same file). The prompt bakes in the "likes sweets / hates cake" example directly, since that's precisely the failure mode being guarded against — two facts that would otherwise leak each other by association if kept together:

```python
async def extract_lore_secrets(content: str, chat_model: str,
                               chat_base: str | None = None,
                               chat_key: str | None = None) -> list[str]:
    instruct = (
        "You decompose hidden lore entries for a roleplay platform into a "
        "numbered list of short, independent facts, so a player can learn one "
        "without the others being revealed or implied.\n"
        "Rules:\n"
        "1. Each fact must stand completely on its own — a reader who only "
        "sees one fact must not be able to guess or infer any other fact.\n"
        "2. Never combine two separate pieces of information into one fact, "
        "even if they're related. Example: \"She secretly likes sweets but "
        "hates cake\" must become TWO facts — \"She has a sweet tooth\" and "
        "\"She dislikes cake\" — never one, since knowing the first should "
        "never imply the second.\n"
        "3. Paraphrase in your own words — do not quote more than a few "
        "consecutive words of the source directly.\n"
        "4. Reply with ONLY a numbered list (\"1. \", \"2. \", ...), one fact "
        "per line, no preamble, no headers, no code fences.\n\n"
        f"Input:\n{content}"
    )
    out = []
    async for channel, chunk in llm.chat_stream(
            [{"role": "user", "content": instruct}], chat_model, parse_think=True,
            base_url=chat_base, api_key=chat_key, pin_host=True):
        if channel == "content":
            out.append(chunk)
    raw = llm.strip_json_fence("".join(out)).strip()
    facts = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        stripped = line.split(".", 1)[-1].strip() if line[0].isdigit() else line
        stripped = stripped.lstrip("-").strip()
        if stripped:
            facts.append(stripped)
    return facts
```

- [ ] **Step 2: Write the failing test for `extract_lore_secrets`**

Create `backend/tests/test_ai_helpers.py` if it doesn't already exist (check first: `ls backend/tests/ | grep ai_helpers`); if it exists, add this test following its established mocking pattern for `llm.chat_stream`.

```python
import pytest

from backend import ai_helpers

pytestmark = pytest.mark.asyncio


async def test_extract_lore_secrets_parses_numbered_list(monkeypatch):
    async def fake_chat_stream(*args, **kwargs):
        for c in ["1. She has a sweet tooth\n", "2. She dislikes cake\n"]:
            yield ("content", c)
    monkeypatch.setattr(ai_helpers.llm, "chat_stream", fake_chat_stream)
    result = await ai_helpers.extract_lore_secrets("She secretly likes sweets but hates cake", "test-model")
    assert result == ["She has a sweet tooth", "She dislikes cake"]


async def test_extract_lore_secrets_empty_response_returns_empty_list(monkeypatch):
    async def fake_chat_stream(*args, **kwargs):
        return
        yield
    monkeypatch.setattr(ai_helpers.llm, "chat_stream", fake_chat_stream)
    result = await ai_helpers.extract_lore_secrets("some content", "test-model")
    assert result == []
```

- [ ] **Step 3: Write the failing tests for `lore.py`'s update wiring**

Append to `backend/tests/test_lore_repo.py`:

```python
async def test_update_deletes_secrets_when_content_changes(db_conn):
    from backend.repositories import lore_secrets as ls

    lid = await lore.create(None, [], "original content", always=False, name="s", hidden=True)
    await ls.set_secrets(lid, ["a secret"])
    await lore.update(lid, [], "new content", always=False)
    assert await ls.secrets_for(lid) == []


async def test_update_keeps_secrets_when_content_unchanged(db_conn):
    from backend.repositories import lore_secrets as ls

    lid = await lore.create(None, [], "same content", always=False, name="s", hidden=True)
    await ls.set_secrets(lid, ["a secret"])
    await lore.update(lid, [], "same content", always=True)
    result = await ls.secrets_for(lid)
    assert len(result) == 1
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_ai_helpers.py backend/tests/test_lore_repo.py -v -k "extract_lore_secrets or update_deletes_secrets or update_keeps_secrets"`
Expected: FAIL

- [ ] **Step 5: Wire the deletion into `backend/repositories/lore.py`'s `update()`**

Add the import at the top:

```python
from backend.repositories import lore_secrets
```

In the existing `update()` function, right after the existing `cur = await get(lid)` guard-clause block, compute whether content actually changed and delete secrets if so — add this line right before the existing `await _w(sa_update(lore)...)` call:

```python
    if content is not None and content != cur["content"]:
        await lore_secrets.delete_secrets(lid)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_ai_helpers.py backend/tests/test_lore_repo.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/ai_helpers.py backend/repositories/lore.py backend/tests/test_ai_helpers.py backend/tests/test_lore_repo.py
git commit -m "Add lore secret decomposition and reset secrets when an entry's content changes"
```

---

### Task 5: `session_lore.py` router — reveal, override, and the session-scoped listing

**Files:**
- Create: `backend/routers/session_lore.py`
- Modify: `backend/schemas.py` (add `SessionLoreOverrideIn`)
- Modify: `server.py` (register the new router)
- Test: `backend/tests/test_session_lore_router.py`

**Interfaces:**
- Consumes: `lore_secrets.secrets_for/set_secrets/reveal/revealed_ids` (Task 1), `memory_facts.insert(..., pinned=)/update_text/expire` (Task 2), `session_lore_state.get_state/set_override/clear_override` (Task 3), `ai_helpers.extract_lore_secrets` (Task 4), `_own_session`/`_eff_cfg` (`backend/chat_service.py`, existing), `lore.list_for_character`/`lore.get` (existing), `llm.embed` (existing)
- Produces: `GET /api/sessions/{sid}/lore`, `GET /api/sessions/{sid}/lore/hidden`, `GET /api/sessions/{sid}/lore/{lid}/secrets`, `POST /api/sessions/{sid}/lore/{lid}/secrets/{secret_id}/reveal`, `PUT /api/sessions/{sid}/lore/{lid}/override`

- [ ] **Step 1: Add the schema**

In `backend/schemas.py`, add near `LoreLinksIn`:

```python
class SessionLoreOverrideIn(BaseModel):
    content: str | None = None
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_session_lore_router.py`. Follows the exact pattern already established in `backend/tests/test_lore_repo.py` (router functions called directly, plain dict `current_user`, `HTTPException` asserted via `pytest.raises`):

```python
import pytest
from fastapi import HTTPException

from backend import ai_helpers
from backend.repositories import chat_sessions, characters as characters_repo, lore, lore_secrets as ls
from backend.schemas import SessionLoreOverrideIn

pytestmark = pytest.mark.asyncio


async def _fake_secrets(monkeypatch, facts):
    async def fake_extract(content, chat_model, chat_base=None, chat_key=None):
        return facts
    monkeypatch.setattr(ai_helpers, "extract_lore_secrets", fake_extract)


async def _make_session(db_conn, hidden_content="she likes sweets but hates cake"):
    char = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    visible_id = await lore.create(char["id"], [], "always visible", always=False, name="Visible", hidden=False)
    hidden_id = await lore.create(char["id"], [], hidden_content, always=False, name="Hidden", hidden=True)
    sid = await chat_sessions.create(char["id"], None, "Chat", "You", user_id="user-a")
    return char, sid, visible_id, hidden_id


async def test_list_session_lore_excludes_unrevealed_hidden(db_conn):
    from backend.routers.session_lore import list_session_lore

    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    entries = await list_session_lore(sid, current_user=owner)
    ids = {e["id"] for e in entries}
    assert visible_id in ids
    assert hidden_id not in ids


async def test_list_hidden_session_lore_shows_name_never_content(db_conn):
    from backend.routers.session_lore import list_hidden_session_lore

    char, sid, visible_id, hidden_id = await _make_session(db_conn, hidden_content="the raw secret prose")
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    hidden = await list_hidden_session_lore(sid, current_user=owner)
    assert len(hidden) == 1
    assert hidden[0]["id"] == hidden_id
    assert set(hidden[0].keys()) == {"id", "name", "category"}
    assert "the raw secret prose" not in str(hidden[0])


async def test_get_secrets_never_sends_unrevealed_text(db_conn, monkeypatch):
    from backend.routers.session_lore import get_lore_secrets

    await _fake_secrets(monkeypatch, ["She has a sweet tooth", "She dislikes cake"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
    assert len(secrets) == 2
    assert all(s["revealed"] is False for s in secrets)
    assert all(s["text"] is None for s in secrets)


async def test_reveal_one_secret_does_not_reveal_the_other(db_conn, monkeypatch):
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret, list_session_lore

    await _fake_secrets(monkeypatch, ["She has a sweet tooth", "She dislikes cake"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
    sweet_tooth_id = next(s["id"] for s in secrets)

    await reveal_lore_secret(sid, hidden_id, sweet_tooth_id, current_user=owner)
    after = await get_lore_secrets(sid, hidden_id, current_user=owner)
    revealed = [s for s in after if s["revealed"]]
    unrevealed = [s for s in after if not s["revealed"]]
    assert len(revealed) == 1
    assert revealed[0]["text"] == "She has a sweet tooth"
    assert len(unrevealed) == 1
    assert unrevealed[0]["text"] is None

    entries = await list_session_lore(sid, current_user=owner)
    hidden_entry = next(e for e in entries if e["id"] == hidden_id)
    assert "She has a sweet tooth" in hidden_entry["content"]
    assert "cake" not in hidden_entry["content"].lower()


async def test_reveal_rejects_secret_from_different_entry(db_conn, monkeypatch):
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret

    await _fake_secrets(monkeypatch, ["fact one"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    other_hidden_id = await lore.create(char["id"], [], "other secret", always=False, name="Other", hidden=True)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
    real_secret_id = secrets[0]["id"]

    with pytest.raises(HTTPException) as exc_info:
        await reveal_lore_secret(sid, other_hidden_id, real_secret_id, current_user=owner)
    assert exc_info.value.status_code == 404


async def test_reveal_rejects_wrong_owner(db_conn, monkeypatch):
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret

    await _fake_secrets(monkeypatch, ["fact one"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    stranger = {"id": "user-b", "username": "user-b", "is_admin": False}

    secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
    real_secret_id = secrets[0]["id"]

    with pytest.raises(HTTPException) as exc_info:
        await reveal_lore_secret(sid, hidden_id, real_secret_id, current_user=stranger)
    assert exc_info.value.status_code == 404


async def test_override_requires_memory_v2(db_conn):
    from backend.state import CFG
    from backend.routers.session_lore import set_session_lore_override

    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = False
    try:
        with pytest.raises(HTTPException) as exc_info:
            await set_session_lore_override(sid, visible_id, SessionLoreOverrideIn(content="new text"),
                                            current_user=owner)
        assert exc_info.value.status_code == 400
    finally:
        CFG["memory_v2"] = original


async def test_override_creates_pinned_fact_when_memory_v2_on(db_conn):
    from backend.state import CFG
    from backend.repositories import memory_facts, session_lore_state as sls
    from backend.routers.session_lore import set_session_lore_override

    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = True
    try:
        result = await set_session_lore_override(sid, visible_id, SessionLoreOverrideIn(content="new text"),
                                                  current_user=owner)
        assert result["content"] == "new text"
        state = await sls.get_state(sid, visible_id)
        reserved = await memory_facts.reserved(sid)
        assert any(r["id"] == state["override_fact_id"] for r in reserved)
    finally:
        CFG["memory_v2"] = original


async def test_override_clear_expires_not_deletes(db_conn):
    from backend.state import CFG
    from backend.repositories import session_lore_state as sls
    from backend.routers.session_lore import set_session_lore_override

    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = True
    try:
        await set_session_lore_override(sid, visible_id, SessionLoreOverrideIn(content="new text"),
                                        current_user=owner)
        result = await set_session_lore_override(sid, visible_id, SessionLoreOverrideIn(content=None),
                                                  current_user=owner)
        assert result["content"] is None
        state = await sls.get_state(sid, visible_id)
        assert state["override_fact_id"] is None
    finally:
        CFG["memory_v2"] = original


async def test_reveal_records_memory_fact_when_memory_v2_on(db_conn, monkeypatch):
    from backend.state import CFG
    from backend.repositories import memory_facts
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret

    await _fake_secrets(monkeypatch, ["She has a sweet tooth"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = True
    try:
        secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
        await reveal_lore_secret(sid, hidden_id, secrets[0]["id"], current_user=owner)
        candidates = await memory_facts.similar_live(sid, [0.1] * 8, 10)
        assert any("sweet tooth" in c["text"] for c in candidates)
    finally:
        CFG["memory_v2"] = original


async def test_reveal_does_not_require_memory_v2(db_conn, monkeypatch):
    from backend.state import CFG
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret

    await _fake_secrets(monkeypatch, ["fact one"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = False
    try:
        secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
        result = await reveal_lore_secret(sid, hidden_id, secrets[0]["id"], current_user=owner)
        assert result["revealed"] is True
    finally:
        CFG["memory_v2"] = original
```

Note on `test_reveal_records_memory_fact_when_memory_v2_on`: `memory_facts.similar_live` requires a real embedding, so this test depends on `llm.embed` being callable in the test environment (it hits a real or test-configured embedding endpoint). If that's not reliably available in this test environment, monkeypatch `llm.embed` in this specific test to return a fixed fake vector (e.g. `[0.1] * CFG["embed_dim"]`) rather than skip the test — the goal is verifying `memory_facts.insert` was actually called with the reveal's text, which is what matters here, not exercising real embedding infra.

Note on `fact_type="event"` in `reveal_lore_secret`'s enrichment insert (deliberate, do not change to `"state"`): `memory_facts.reserved()` has a pre-existing query — `sa.or_(pinned.is_(True), sa.and_(fact_type == "state", valid_until_turn.is_(None)))` — that always force-includes every live `fact_type="state"` fact regardless of `pinned`. The reveal enrichment is explicitly unpinned (ordinary ranked memory, not guaranteed-include, per the spec's "best-effort enrichment" language) — using `"state"` here would silently make every revealed secret forcibly reserved anyway, defeating that intent and potentially bloating the prompt budget as more secrets get revealed over a long session. `"event"` avoids that pre-existing special-case entirely. The Override mechanism's own insert (`set_session_lore_override`, further down) correctly keeps `fact_type="state"` — that one is meant to always be reserved, since it's the User's explicit override and `pinned=True` there is intentional.

- [ ] **Step 3: Run tests to verify they fail**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_session_lore_router.py -v`
Expected: FAIL — `backend.routers.session_lore` doesn't exist yet.

- [ ] **Step 4: Implement `backend/routers/session_lore.py`**

```python
from fastapi import HTTPException, Depends

from backend import db
from backend.state import api, CFG, log
from backend.auth import get_current_user
from backend.chat_service import _own_session, _eff_cfg
from backend.repositories import lore
from backend.repositories import lore_secrets as ls
from backend.repositories import session_lore_state as sls
from backend.repositories import memory_facts
from backend import llm
from backend import ai_helpers
from backend.schemas import SessionLoreOverrideIn


async def _ensure_secrets(entry: dict) -> list[dict]:
    existing = await ls.secrets_for(entry["id"])
    if existing:
        return existing
    try:
        texts = await ai_helpers.extract_lore_secrets(entry["content"], CFG["chat_model"])
    except Exception as e:
        log.warning("session_lore: secret extraction failed lore=%s: %s: %s",
                    entry["id"], type(e).__name__, e)
        return []
    if not texts:
        return []
    return await ls.set_secrets(entry["id"], texts)


async def _revealed_content(sid: str, entry: dict) -> str | None:
    secrets = await _ensure_secrets(entry)
    if not secrets:
        return None
    revealed = await ls.revealed_ids(sid, [s["id"] for s in secrets])
    if not revealed:
        return None
    return "\n".join(f"- {s['text']}" for s in secrets if s["id"] in revealed)


async def _entry_with_session_state(sid: str, entry: dict, state: dict | None) -> dict | None:
    effective = dict(entry)
    effective["player_edited"] = bool(state and state.get("override_content") is not None)
    if state and state.get("override_content") is not None:
        effective["content"] = state["override_content"]
        return effective
    if not entry["hidden"]:
        return effective
    revealed = await _revealed_content(sid, entry)
    if revealed is None:
        return None
    effective["content"] = revealed
    return effective


@api.get("/sessions/{sid}/lore")
async def list_session_lore(sid: str, current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entries = await lore.list_for_character(session["char_id"])
    result = []
    for e in entries:
        state = await sls.get_state(sid, e["id"])
        effective = await _entry_with_session_state(sid, e, state)
        if effective is not None:
            result.append(effective)
    return result


@api.get("/sessions/{sid}/lore/hidden")
async def list_hidden_session_lore(sid: str, current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entries = await lore.list_for_character(session["char_id"])
    result = []
    for e in entries:
        if not e["hidden"]:
            continue
        secrets = await _ensure_secrets(e)
        if not secrets:
            continue
        revealed = await ls.revealed_ids(sid, [s["id"] for s in secrets])
        if len(revealed) < len(secrets):
            result.append({"id": e["id"], "name": e["name"], "category": e["category"]})
    return result


@api.get("/sessions/{sid}/lore/{lid}/secrets")
async def get_lore_secrets(sid: str, lid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    secrets = await _ensure_secrets(entry)
    revealed = await ls.revealed_ids(sid, [s["id"] for s in secrets])
    return [
        {"id": s["id"], "revealed": s["id"] in revealed, "text": s["text"] if s["id"] in revealed else None}
        for s in secrets
    ]


@api.post("/sessions/{sid}/lore/{lid}/secrets/{secret_id}/reveal")
async def reveal_lore_secret(sid: str, lid: str, secret_id: str,
                             current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    secrets = await ls.secrets_for(lid)
    match = next((s for s in secrets if s["id"] == secret_id), None)
    if not match:
        raise HTTPException(404, "secret not found on this entry")
    await ls.reveal(sid, secret_id)
    log.info("session_lore: revealed session=%s lore=%s secret=%s by=%s",
             sid, lid, secret_id, current_user["username"])
    user_overrides = await db.get_user_settings(current_user["id"])
    eff = _eff_cfg(user_overrides)
    if eff.get("memory_v2"):
        try:
            vec = await llm.embed(match["text"], CFG["embed_model"])
            await memory_facts.insert({
                "session_id": sid, "char_id": session["char_id"], "text": match["text"],
                "fact_type": "event", "participants": [], "importance": 4, "valence": 0, "turn": 0,
            }, vec)
        except Exception as e:
            log.warning("session_lore: memory enrichment failed session=%s secret=%s: %s: %s",
                        sid, secret_id, type(e).__name__, e)
    return {"id": secret_id, "revealed": True, "text": match["text"]}


@api.put("/sessions/{sid}/lore/{lid}/override")
async def set_session_lore_override(sid: str, lid: str, body: SessionLoreOverrideIn,
                                    current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    if body.content is None:
        fact_id = await sls.clear_override(sid, lid)
        if fact_id:
            await memory_facts.expire(fact_id)
        log.info("session_lore: override cleared session=%s lore=%s by=%s", sid, lid, current_user["username"])
        return {"content": None}
    user_overrides = await db.get_user_settings(current_user["id"])
    eff = _eff_cfg(user_overrides)
    if not eff.get("memory_v2"):
        raise HTTPException(400, "Session lore overrides require Memory V2 to be enabled")
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
    return {"content": body.content}
```

- [ ] **Step 5: Register the router in `server.py`**

Add this line alongside the other router imports (after `import backend.routers.lore`):

```python
import backend.routers.session_lore  # noqa: F401
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_session_lore_router.py -v`
Expected: PASS (11 tests)

- [ ] **Step 7: Manual verification against the live app**

```bash
curl -s -c /tmp/ck.txt -X POST https://storyhavenai.sillysillysupersillydomain.win/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"test","password":"11111111"}'
```

Create a test character with a hidden entry containing two distinct facts (e.g. "She has a sweet tooth. She secretly resents her sister.") and a chat session via the app UI, then:

```bash
curl -s -b /tmp/ck.txt https://storyhavenai.sillysillysupersillydomain.win/api/sessions/SID/lore/hidden
curl -s -b /tmp/ck.txt https://storyhavenai.sillysillysupersillydomain.win/api/sessions/SID/lore/LID/secrets
```

Expected: the second call shows 2 secrets, both `revealed: false, text: null`. Reveal one:

```bash
curl -s -b /tmp/ck.txt -X POST https://storyhavenai.sillysillysupersillydomain.win/api/sessions/SID/lore/LID/secrets/SECRET_ID/reveal
curl -s -b /tmp/ck.txt https://storyhavenai.sillysillysupersillydomain.win/api/sessions/SID/lore/LID/secrets
```

Expected: the revealed secret now has its `text`, the other secret is still `revealed: false, text: null`. Clean up test data afterward and remove `/tmp/ck.txt`.

- [ ] **Step 8: Run the full backend test suite**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/ -v`
Expected: All PASS except the one pre-existing unrelated `test_imagegen_inpaint.py` failure documented earlier in this project's history.

- [ ] **Step 9: Commit**

```bash
git add backend/routers/session_lore.py backend/schemas.py server.py
git commit -m "Add session-scoped per-secret reveal and pinned-override endpoints"
```

---

### Task 6: Frontend — "Session Lore" modal in the chat header dropdown

**Files:**
- Modify: `new_ui/js/chat.js`

**Interfaces:**
- Consumes: `GET /api/sessions/{sid}/lore`, `GET /api/sessions/{sid}/lore/hidden`, `GET /api/sessions/{sid}/lore/{lid}/secrets`, `POST /api/sessions/{sid}/lore/{lid}/secrets/{secret_id}/reveal`, `PUT /api/sessions/{sid}/lore/{lid}/override` (Task 5); existing globals `api`, `openModal`, `closeModal`, `_esc`, `_attr`, `errorToast`, `toast`, `settingsRowHtml`, `svgIcon`

**Interfaces produced:** `ChatView.openSessionLoreModal()` — no other file depends on this beyond the dropdown wiring in this same file.

- [ ] **Step 1: Add the dropdown row**

In `new_ui/js/chat.js`, find this block (around line 327):

```javascript
          ${settingsRowHtml({ icon: svgIcon("eye"), label: "Character state", onclick: "_activeChatView.openCharStateModal()" })}
```

Add a new row right after it:

```javascript
          ${settingsRowHtml({ icon: svgIcon("eye"), label: "Character state", onclick: "_activeChatView.openCharStateModal()" })}
          ${settingsRowHtml({ icon: svgIcon("eye"), label: "Session lore", onclick: "_activeChatView.openSessionLoreModal()" })}
```

- [ ] **Step 2: Wire the dropdown dispatch**

Find (around line 588):

```javascript
        else if (which === "charstate") this.openCharStateModal();
```

Add right after it:

```javascript
        else if (which === "charstate") this.openCharStateModal();
        else if (which === "sessionlore") this.openSessionLoreModal();
```

Check the surrounding 20 lines for how `data-menu="charstate"` is wired in this dropdown's HTML — if the "Character state" row's dispatch is already implicit via the `settingsRowHtml` onclick added in Step 1, this step needs no further changes; verify rather than assume.

- [ ] **Step 3: Implement the modal**

Add these methods right after `openCharStateModal()` (around line 693, after its closing `}`):

```javascript
  async openSessionLoreModal() {
    openModal(`<h3>Session lore</h3><div id="slBody" style="color:var(--color-muted)">Loading&hellip;</div>`);
    const layer = document.querySelector(".modal-layer:last-child");
    const body = layer.querySelector("#slBody");
    let entries, hidden;
    try {
      [entries, hidden] = await Promise.all([
        api(`/api/sessions/${encodeURIComponent(this.sid)}/lore`),
        api(`/api/sessions/${encodeURIComponent(this.sid)}/lore/hidden`),
      ]);
    } catch (err) {
      body.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${_esc(err.message || "Couldn't load session lore.")}</p>`;
      return;
    }
    this.renderSessionLoreList(body, entries, hidden);
  }

  renderSessionLoreList(body, entries, hidden) {
    const hiddenHtml = hidden.length ? `
      <div style="margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--color-line)">
        <h4 style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted);font-family:var(--font-mono)">Still hidden</h4>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${hidden.map((h) => `
            <div style="display:flex;align-items:center;gap:8px;background:var(--color-surface-2);border:1px solid var(--color-line-2);border-radius:8px;padding:7px 10px">
              <span style="font-size:13px;color:var(--color-sec);flex:1">${_esc(h.name || h.category || "Untitled")}</span>
              <button type="button" class="dropdown-item" data-sl-open-secrets="${_attr(h.id)}" style="width:auto;padding:5px 12px">What's hidden here?</button>
            </div>
          `).join("")}
        </div>
      </div>
    ` : "";
    const listHtml = entries.length ? entries.map((e) => `
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--color-line)">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px">
          <h4 style="margin:0;font-size:14px;color:var(--color-ink)">${_esc(e.name || e.category || "Untitled")}</h4>
          ${e.player_edited ? `<span style="font-family:var(--font-mono);font-size:9.5px;color:var(--color-accent);text-transform:uppercase;letter-spacing:.06em">edited</span>` : ""}
        </div>
        <p style="font-size:13px;color:var(--color-sec);line-height:1.55;white-space:pre-wrap;margin:0 0 10px">${_esc(e.content)}</p>
        <div style="display:flex;gap:8px">
          <button type="button" class="dropdown-item" data-sl-edit="${_attr(e.id)}" style="flex:1;text-align:center">Edit</button>
        </div>
      </div>
    `).join("") : `<p style="color:var(--color-sec);font-size:13px;padding:6px 0 16px">Nothing revealed yet in this session.</p>`;
    body.innerHTML = hiddenHtml + listHtml;
    body.querySelectorAll("[data-sl-open-secrets]").forEach((btn) => {
      btn.onclick = () => this.openSessionLoreSecrets(body, btn.dataset.slOpenSecrets);
    });
    body.querySelectorAll("[data-sl-edit]").forEach((btn) => {
      btn.onclick = () => this.openSessionLoreEditor(body, entries, btn.dataset.slEdit);
    });
  }

  async openSessionLoreSecrets(body, lid) {
    body.innerHTML = `<div style="color:var(--color-muted)">Loading&hellip;</div>`;
    let secrets;
    try {
      secrets = await api(`/api/sessions/${encodeURIComponent(this.sid)}/lore/${encodeURIComponent(lid)}/secrets`);
    } catch (err) {
      body.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${_esc(err.message || "Couldn't load secrets.")}</p>`;
      return;
    }
    this.renderSessionLoreSecrets(body, lid, secrets);
  }

  renderSessionLoreSecrets(body, lid, secrets) {
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        ${secrets.map((s) => `
          <div style="display:flex;align-items:center;gap:8px;background:var(--color-surface-2);border:1px solid var(--color-line-2);border-radius:8px;padding:9px 12px">
            <span style="font-size:13px;color:${s.revealed ? "var(--color-ink)" : "var(--color-muted)"};flex:1">${s.revealed ? _esc(s.text) : "Something is hidden here"}</span>
            ${s.revealed ? "" : `<button type="button" class="dropdown-item" data-sl-reveal="${_attr(s.id)}" style="width:auto;padding:5px 12px">Reveal</button>`}
          </div>
        `).join("")}
      </div>
      <button type="button" class="pe-gen-btn" id="slSecretsBack" style="border-color:var(--color-line-2);color:var(--color-sec)">Back</button>
    `;
    body.querySelector("#slSecretsBack").onclick = () => this.openSessionLoreModal();
    body.querySelectorAll("[data-sl-reveal]").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/api/sessions/${encodeURIComponent(this.sid)}/lore/${encodeURIComponent(lid)}/secrets/${encodeURIComponent(btn.dataset.slReveal)}/reveal`,
            { method: "POST" });
          toast("Revealed.");
          this.openSessionLoreSecrets(body, lid);
        } catch (err) {
          errorToast(err.message || "Couldn't reveal this.");
        }
      };
    });
  }

  openSessionLoreEditor(body, entries, lid) {
    const entry = entries.find((e) => e.id === lid);
    body.innerHTML = `
      <h4 style="margin:0 0 10px;font-size:14px;color:var(--color-ink)">${_esc(entry.name || "Edit")}</h4>
      <textarea id="slEditText" class="grimoire-field-textarea" rows="5" style="width:100%;margin-bottom:12px">${_esc(entry.content)}</textarea>
      <div class="grimoire-web-detail" style="border-color:var(--color-warn);margin:0 0 14px;padding:12px 16px">
        <p style="font-family:var(--font-mono);font-size:11px;color:var(--color-warn);margin:0 0 6px">This gets pinned into the AI's memory — it will write as if this is true starting now.</p>
        <p style="font-family:var(--font-mono);font-size:11px;color:var(--color-warn);margin:0 0 6px">That overrides what the Author actually built — their intent for who this character is, and how this story was meant to unfold.</p>
        <p style="font-family:var(--font-mono);font-size:11px;color:var(--color-warn);margin:0">Your story from here can drift somewhere the Author never designed for — and the further you push it, the harder that is to undo.</p>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="pe-gen-btn" id="slEditCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">Cancel</button>
        ${entry.player_edited ? `<button type="button" class="pe-gen-btn" id="slEditClear" style="border-color:var(--color-line-2);color:var(--color-sec)">Clear override</button>` : ""}
        <button type="button" class="pe-gen-btn" id="slEditSave">Save</button>
      </div>
    `;
    body.querySelector("#slEditCancel").onclick = () => this.openSessionLoreModal();
    const clearBtn = body.querySelector("#slEditClear");
    if (clearBtn) clearBtn.onclick = async () => {
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/lore/${encodeURIComponent(lid)}/override`,
          { method: "PUT", body: JSON.stringify({ content: null }) });
        toast("Override cleared.");
        this.openSessionLoreModal();
      } catch (err) {
        errorToast(err.message || "Couldn't clear the override.");
      }
    };
    body.querySelector("#slEditSave").onclick = async () => {
      const content = body.querySelector("#slEditText").value.trim();
      if (!content) { toast("Content required."); return; }
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/lore/${encodeURIComponent(lid)}/override`,
          { method: "PUT", body: JSON.stringify({ content }) });
        toast("Saved.");
        this.openSessionLoreModal();
      } catch (err) {
        errorToast(err.message || "Couldn't save this override.");
      }
    };
  }
```

- [ ] **Step 4: Manual verification**

No browser automation tool is available in this environment (documented, previously established limitation for this project) — verify via curl that the updated JS is served (`curl -s https://storyhavenai.sillysillysupersillydomain.win/js/chat.js | grep -c openSessionLoreModal` should return at least 1) and do a careful static code-trace of the interaction logic (the fetch, the per-secret reveal wiring, the warning always rendering before an override save). Disclose the no-browser-tool limitation explicitly in your report, per the established pattern for every prior frontend task in this project.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/chat.js
git commit -m "Add Session Lore modal with per-secret reveal to the chat header dropdown"
```

---

### Task 7: Final regression pass

**Files:** None modified — verification only.

- [ ] **Step 1: Run the full backend test suite**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/ -v`
Expected: All PASS except the one pre-existing unrelated `test_imagegen_inpaint.py` failure.

- [ ] **Step 2: Full manual walkthrough on the live app**

On `https://storyhavenai.sillysillysupersillydomain.win`, logged in as `test:11111111`:
1. Create a character with a hidden lore entry containing two genuinely distinct facts (e.g. "She has a sweet tooth. She secretly resents her sister."), enable Memory V2 in settings.
2. Start a chat session. Open "Session lore" — confirm the entry is entirely absent from the main list, and appears under "Still hidden."
3. Open "What's hidden here?" — confirm both secrets show as "Something is hidden here" with Reveal buttons, no text visible.
4. Reveal one secret — confirm only that one now shows real text, the other still says "Something is hidden here."
5. Go back to the main list — confirm the entry now appears with only the one revealed fact as its content, not both.
6. Edit an entry's content, confirm the warning renders before save, save it — confirm the `player_edited` badge shows.
7. Clear the override — confirm it reverts.
8. Repeat the override flow with Memory V2 disabled — confirm it's rejected with a clear message.
9. Repeat a secret reveal with Memory V2 disabled — confirm the reveal itself still works (no hard dependency).

- [ ] **Step 3: Check server logs for unexpected errors**

Run: `podman exec --workdir /app/ai-frontend story-game venv/bin/python3 -c "import json; [print(json.loads(l).get('level'), json.loads(l).get('message','')[:200]) for l in open('storyhavenai.logs.jsonl') if json.loads(l).get('level') in ('ERROR','CRITICAL')]" 2>/dev/null | tail -20`
Expected: no `session_lore`/`lore_secrets`/`memory fact` related ERROR/CRITICAL entries from the verification session.
