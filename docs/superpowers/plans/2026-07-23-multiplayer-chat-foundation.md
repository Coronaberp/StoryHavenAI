# Multiplayer Chat Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the backend foundation for multiplayer co-op chat sessions — the `session_participants` schema, the ownership-check change, and the memory-attribution fix — without yet building invites, real-time sync, or any frontend UI (those are separate follow-on plans).

**Architecture:** Additive-only. A new `session_participants` table and a new `sender_user_id` column on `messages` sit alongside the existing single-owner `sessions` model. `chat_service._own_session` gains a fallback check so a session with zero participant rows (every session that exists today) behaves exactly as before. `memory_service.py`'s `_transcript()`/`present_participants()` gain an optional per-sender name lookup mirroring the `names_by_id` pattern they already use for multi-character group chats.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy Core (async, `asyncpg`), pytest + pytest-asyncio, PostgreSQL.

## Global Constraints

- Zero comments in any file, ever (per project style — self-documenting naming only).
- Every new function with real logic gets a pytest test alongside it.
- Every caught exception either re-raises or gets logged via `backend/state.py`'s `log` — no silent `except: pass`.
- Follow the existing one-file-per-domain repository pattern (`backend/repositories/*.py`), plain functions, not classes, matching `backend/repositories/groups.py`.
- New DB tables/columns are added by editing the `Table`/`Column` definitions in `backend/db.py` — `metadata.create_all(checkfirst=True)` handles creation at startup, no manual migration scripts needed for new tables. New nullable columns on an existing table need an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `db.py`'s startup migration block (see existing `nsfw_allowed` precedent at `backend/db.py:822`).
- Never touch the existing single-user solo-chat code path's *behavior* — only its guard conditions may grow a new branch that falls through to the old behavior when no participants exist.

---

### Task 1: `session_participants` schema

**Files:**
- Modify: `backend/db.py` (add `session_participants` Table definition, near `session_characters` at line ~307)
- Test: `backend/tests/test_session_participants_repo.py` (new)

**Interfaces:**
- Produces: `session_participants` SQLAlchemy `Table` object (importable as `from backend.db import session_participants`), columns `session_id: Text`, `user_id: Text`, `persona_id: Text | None`, `role: Text` (`"host"` or `"member"`), `joined_at: Float`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_session_participants_repo.py
import pytest

pytestmark = pytest.mark.asyncio


async def test_session_participants_table_exists():
    from backend.db import session_participants
    assert session_participants.name == "session_participants"
    cols = {c.name for c in session_participants.columns}
    assert cols == {"session_id", "user_id", "persona_id", "role", "joined_at"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_session_participants_repo.py -v`
Expected: FAIL with `ImportError: cannot import name 'session_participants' from 'backend.db'`

- [ ] **Step 3: Add the table definition**

In `backend/db.py`, immediately after the existing `session_characters` table (ends around line 316 with its closing `)`), add:

```python
session_participants = sa.Table(
    "session_participants", _meta,
    sa.Column("session_id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, primary_key=True),
    sa.Column("persona_id", sa.Text),
    sa.Column("role", sa.Text, nullable=False, server_default=text("'member'")),
    sa.Column("joined_at", sa.Float, nullable=False),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_session_participants_repo.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_session_participants_repo.py
git commit -m "Add session_participants table for multiplayer co-op sessions"
```

---

### Task 2: `sender_user_id` column on `messages`

**Files:**
- Modify: `backend/db.py` (add column to `messages` Table at line ~340, plus a migration line in the startup ALTER TABLE block)
- Test: `backend/tests/test_session_participants_repo.py` (append)

**Interfaces:**
- Produces: `messages.c.sender_user_id` (nullable `Text` column) — null means "the session's sole owner sent this" (today's entire dataset), non-null means "this specific participant sent this."

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_session_participants_repo.py`:

```python
async def test_messages_table_has_sender_user_id():
    from backend.db import messages
    cols = {c.name for c in messages.columns}
    assert "sender_user_id" in cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_session_participants_repo.py::test_messages_table_has_sender_user_id -v`
Expected: FAIL with `assert 'sender_user_id' in {...}` (column not present)

- [ ] **Step 3: Add the column**

In `backend/db.py`, add to the `messages` Table definition (after `sa.Column("turn_group", sa.Text),`, the last column before its closing `)`):

```python
    sa.Column("sender_user_id", sa.Text),
```

Then find the startup migration block that runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for existing columns like `nsfw_allowed` (search for `"ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS nsfw_allowed"` around `backend/db.py:822`) and add a sibling line in the same migration function:

```python
        await conn.execute(text(
            "ALTER TABLE IF EXISTS messages ADD COLUMN IF NOT EXISTS sender_user_id TEXT"
        ))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_session_participants_repo.py -v`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_session_participants_repo.py
git commit -m "Add nullable sender_user_id column to messages for multiplayer attribution"
```

---

### Task 3: `session_participants` repository

**Files:**
- Create: `backend/repositories/session_participants.py`
- Test: `backend/tests/test_session_participants_repo.py` (append)

**Interfaces:**
- Consumes: `session_participants` Table (Task 1), `_q`/`_q1`/`_w` from `backend.db` (existing helpers, see `backend/repositories/groups.py` for usage pattern), `log` from `backend.state`.
- Produces:
  - `async def add(session_id: str, user_id: str, persona_id: str | None, role: str) -> None` — raises `ValueError("session full")` if 8 rows already exist for `session_id`.
  - `async def list_for_session(session_id: str) -> list[dict]`
  - `async def remove(session_id: str, user_id: str) -> None`
  - `async def is_participant(session_id: str, user_id: str) -> bool`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_session_participants_repo.py`:

```python
from backend.repositories import session_participants as sp


async def test_add_and_list(db_conn):
    await sp.add("sess-1", "user-a", "persona-1", "host")
    await sp.add("sess-1", "user-b", None, "member")
    rows = await sp.list_for_session("sess-1")
    assert {r["user_id"] for r in rows} == {"user-a", "user-b"}
    host = next(r for r in rows if r["user_id"] == "user-a")
    assert host["role"] == "host" and host["persona_id"] == "persona-1"


async def test_is_participant(db_conn):
    await sp.add("sess-2", "user-a", None, "host")
    assert await sp.is_participant("sess-2", "user-a") is True
    assert await sp.is_participant("sess-2", "user-z") is False


async def test_remove(db_conn):
    await sp.add("sess-3", "user-a", None, "host")
    await sp.remove("sess-3", "user-a")
    assert await sp.list_for_session("sess-3") == []


async def test_add_rejects_ninth_participant(db_conn):
    for i in range(8):
        await sp.add("sess-4", f"user-{i}", None, "host" if i == 0 else "member")
    with pytest.raises(ValueError, match="session full"):
        await sp.add("sess-4", "user-9", None, "member")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_session_participants_repo.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.repositories.session_participants'`

- [ ] **Step 3: Write the repository**

```python
# backend/repositories/session_participants.py
from __future__ import annotations
import time

from sqlalchemy import select, insert, delete as sa_delete, func

from backend.db import session_participants, _q, _q1, _w
from backend.state import log

MAX_PARTICIPANTS = 8


async def add(session_id: str, user_id: str, persona_id: str | None, role: str) -> None:
    count_row = await _q1(
        select(func.count()).select_from(session_participants)
        .where(session_participants.c.session_id == session_id)
    )
    current_count = count_row["count_1"] if count_row else 0
    if current_count >= MAX_PARTICIPANTS:
        raise ValueError("session full")
    await _w(insert(session_participants).values(
        session_id=session_id, user_id=user_id, persona_id=persona_id,
        role=role, joined_at=time.time(),
    ))
    log.info("session_participants: added user=%s session=%s role=%s", user_id, session_id, role)


async def list_for_session(session_id: str) -> list[dict]:
    return await _q(
        select(session_participants).where(session_participants.c.session_id == session_id)
    )


async def remove(session_id: str, user_id: str) -> None:
    await _w(sa_delete(session_participants).where(
        session_participants.c.session_id == session_id,
        session_participants.c.user_id == user_id,
    ))
    log.info("session_participants: removed user=%s session=%s", user_id, session_id)


async def is_participant(session_id: str, user_id: str) -> bool:
    row = await _q1(
        select(session_participants.c.user_id).where(
            session_participants.c.session_id == session_id,
            session_participants.c.user_id == user_id,
        )
    )
    return row is not None
```

Note: `func.count()` with SQLAlchemy Core over asyncpg returns a row keyed `count_1` when selected bare like this — verify the actual key by running the test; if it differs, adjust to whatever key the row dict actually has (print `count_row` during a local debug run if the assertion trips on that specific line, since this is the one line in this file most likely to need a one-word key adjustment for this project's exact `_q1` row-mapping behavior).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_session_participants_repo.py -v`
Expected: PASS (all 6 tests: schema x2, add/list, is_participant, remove, capacity)

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/session_participants.py backend/tests/test_session_participants_repo.py
git commit -m "Add session_participants repository with 8-person capacity enforcement"
```

---

### Task 4: `_own_session` accepts multiplayer participants

**Files:**
- Modify: `backend/chat_service.py:114-120` (`_own_session`)
- Test: `backend/tests/test_chat_service.py` (append if it exists; create `backend/tests/test_chat_service_ownership.py` if no existing test file covers `chat_service.py`)

**Interfaces:**
- Consumes: `session_participants.is_participant(session_id, user_id) -> bool` (Task 3).
- Produces: `_own_session(sid, current_user) -> dict` — same signature and return shape as before, only the authorization rule changes.

- [ ] **Step 1: Check for an existing test file to extend**

Run: `ls backend/tests/ | grep -i chat_service`

If a file exists, add the tests below to it. If not, create `backend/tests/test_chat_service_ownership.py`.

- [ ] **Step 2: Write the failing test**

```python
import pytest

from backend import chat_service
from backend.repositories import chat_sessions, session_participants as sp

pytestmark = pytest.mark.asyncio


async def test_own_session_still_works_for_solo_owner(db_conn):
    sid = await chat_sessions.create("char-1", None, "Solo", "You", user_id="owner-1")
    session = await chat_service._own_session(sid, {"id": "owner-1"})
    assert session["id"] == sid


async def test_own_session_rejects_non_owner_non_participant(db_conn):
    from fastapi import HTTPException
    sid = await chat_sessions.create("char-1", None, "Solo", "You", user_id="owner-1")
    with pytest.raises(HTTPException) as exc_info:
        await chat_service._own_session(sid, {"id": "stranger"})
    assert exc_info.value.status_code == 404


async def test_own_session_allows_multiplayer_participant(db_conn):
    sid = await chat_sessions.create("char-1", None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, "friend-1", None, "member")
    session = await chat_service._own_session(sid, {"id": "friend-1"})
    assert session["id"] == sid
```

- [ ] **Step 3: Run tests to verify the new one fails**

Run: `pytest backend/tests/test_chat_service_ownership.py -v`
Expected: `test_own_session_allows_multiplayer_participant` FAILS with a 404 `HTTPException` (participant not yet recognized); the other two PASS already (existing behavior unchanged).

- [ ] **Step 4: Update `_own_session`**

In `backend/chat_service.py`, replace:

```python
async def _own_session(sid: str, current_user: dict) -> dict:
    """Fetch a session and enforce ownership. Raises 404 if missing/unowned."""
    s = await chat_sessions.get(sid)
    if not s:
        raise HTTPException(404, "session not found")
    if s.get("user_id") != current_user["id"]:
        raise HTTPException(404, "session not found")
    return s
```

with:

```python
async def _own_session(sid: str, current_user: dict) -> dict:
    s = await chat_sessions.get(sid)
    if not s:
        raise HTTPException(404, "session not found")
    if s.get("user_id") == current_user["id"]:
        return s
    if await session_participants.is_participant(sid, current_user["id"]):
        return s
    raise HTTPException(404, "session not found")
```

Add the import at the top of `backend/chat_service.py` alongside the existing `from backend.repositories import chat_sessions`-style imports:

```python
from backend.repositories import session_participants
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest backend/tests/test_chat_service_ownership.py -v`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/chat_service.py backend/tests/test_chat_service_ownership.py
git commit -m "Let session_participants members pass chat_service ownership checks"
```

---

### Task 5: Memory attribution — `present_participants` accepts multiple names

**Files:**
- Modify: `backend/memory_service.py:46-51` (`present_participants`)
- Test: `backend/tests/test_memory_service.py` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `present_participants(char_name: str, user_names: list[str], known_names: list[str], recent: str) -> list[str]` — **signature change**: `user_name: str` becomes `user_names: list[str]`. Every caller in this file must be updated in this same task (see Step 4).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_memory_service.py`:

```python
def test_present_participants_multiple_users():
    from backend.memory_service import present_participants
    result = present_participants("Narrator", ["Mira", "Torvald"], [], "Mira and Torvald enter the archive.")
    assert result == ["Mira", "Torvald", "Narrator"]


def test_present_participants_single_user_unchanged():
    from backend.memory_service import present_participants
    result = present_participants("Narrator", ["You"], [], "You enter the archive.")
    assert result == ["You", "Narrator"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_memory_service.py -k present_participants -v`
Expected: FAIL — current signature takes `user_name: str`, calling with a list produces wrong output (`present = [["Mira", "Torvald"], "Narrator"]`, a list-in-a-list, not equal to the expected flat list).

- [ ] **Step 3: Update `present_participants`**

In `backend/memory_service.py`, replace:

```python
def present_participants(char_name: str, user_name: str, known_names: list[str],
                         recent: str) -> list[str]:
    lowered = (recent or "").lower()
    present = [user_name, char_name]
    present += [n for n in known_names if n and n.lower() in lowered and n not in present]
    return present
```

with:

```python
def present_participants(char_name: str, user_names: list[str], known_names: list[str],
                         recent: str) -> list[str]:
    lowered = (recent or "").lower()
    present = list(user_names) + [char_name]
    present += [n for n in known_names if n and n.lower() in lowered and n not in present]
    return present
```

- [ ] **Step 4: Update every call site in this file**

Run: `grep -n "present_participants(" backend/memory_service.py`

For each call site found (there is exactly one, inside `retrieve_block`, passing a single `user_name` argument), wrap the existing argument in a list: change `present_participants(char["name"], user_name, known, recent_text(msgs))` to `present_participants(char["name"], [user_name], known, recent_text(msgs))`. This keeps `retrieve_block`'s own signature (`user_name: str`) unchanged for now — that call site itself gets its real multi-user upgrade in the multiplayer invite/turn-handling plan, once there's an actual list of active participant names available to pass through instead of one.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest backend/tests/test_memory_service.py -k present_participants -v`
Expected: PASS (both tests)

- [ ] **Step 6: Run the full memory_service test file to check nothing else broke**

Run: `pytest backend/tests/test_memory_service.py -v`
Expected: PASS (all tests, including pre-existing ones)

- [ ] **Step 7: Commit**

```bash
git add backend/memory_service.py backend/tests/test_memory_service.py
git commit -m "present_participants accepts a list of active user names for multiplayer"
```

---

### Task 6: Memory attribution — `_transcript` labels each line by actual sender

**Files:**
- Modify: `backend/memory_service.py:54-67` (`_transcript`), `:71-91` (`extract_batch`, its caller)
- Test: `backend/tests/test_memory_service.py` (append)

**Interfaces:**
- Consumes: nothing new from other tasks (this is self-contained within `memory_service.py`).
- Produces: `_transcript(batch, char_name, user_name, names_by_id=None, user_names_by_sender_id=None) -> str` — new optional fifth parameter, `None`/omitted preserves today's exact single-name behavior.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_memory_service.py`:

```python
def test_transcript_labels_solo_sender_unchanged():
    from backend.memory_service import _transcript
    batch = [
        ({"content": "I open the door."}, {"content": "It creaks open.", "char_id": None}),
    ]
    out = _transcript(batch, "Narrator", "You")
    assert out == "You: I open the door.\nNarrator: It creaks open."


def test_transcript_labels_each_sender_by_id():
    from backend.memory_service import _transcript
    batch = [
        ({"content": "I open the door.", "sender_user_id": "user-a"},
         {"content": "It creaks open.", "char_id": None}),
        ({"content": "I keep watch.", "sender_user_id": "user-b"},
         {"content": "Nothing stirs.", "char_id": None}),
    ]
    out = _transcript(batch, "Narrator", "You", user_names_by_sender_id={"user-a": "Mira", "user-b": "Torvald"})
    assert out == (
        "Mira: I open the door.\n"
        "Narrator: It creaks open.\n"
        "Torvald: I keep watch.\n"
        "Narrator: Nothing stirs."
    )


def test_transcript_falls_back_to_user_name_for_unknown_sender():
    from backend.memory_service import _transcript
    batch = [
        ({"content": "I open the door.", "sender_user_id": "user-unknown"},
         {"content": "It creaks open.", "char_id": None}),
    ]
    out = _transcript(batch, "Narrator", "You", user_names_by_sender_id={"user-a": "Mira"})
    assert out == "You: I open the door.\nNarrator: It creaks open."
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pytest backend/tests/test_memory_service.py -k transcript -v`
Expected: `test_transcript_labels_solo_sender_unchanged` PASSES already (no behavior change needed for the solo case); the other two FAIL with `TypeError: _transcript() got an unexpected keyword argument 'user_names_by_sender_id'`.

- [ ] **Step 3: Update `_transcript`**

In `backend/memory_service.py`, replace:

```python
def _transcript(batch: list[tuple[dict, dict]], char_name: str, user_name: str,
                names_by_id: dict | None = None) -> str:
    names_by_id = names_by_id or {}
    lines, prev_user_key = [], None
    for user_msg, assistant_msg in batch:
        if id(user_msg) != prev_user_key:
            lines.append(f"{user_name}: {user_msg['content']}")
            prev_user_key = id(user_msg)
        speaker = names_by_id.get(assistant_msg.get("char_id")) or char_name
        char_line = f"{speaker}: {strip_think(assistant_msg['content'])}"
        mood = assistant_msg.get("mood")
        if mood:
            char_line += f" [mood: {mood}]"
        lines.append(char_line)
    return "\n".join(lines)
```

with:

```python
def _transcript(batch: list[tuple[dict, dict]], char_name: str, user_name: str,
                names_by_id: dict | None = None,
                user_names_by_sender_id: dict | None = None) -> str:
    names_by_id = names_by_id or {}
    user_names_by_sender_id = user_names_by_sender_id or {}
    lines, prev_user_key = [], None
    for user_msg, assistant_msg in batch:
        if id(user_msg) != prev_user_key:
            sender_id = user_msg.get("sender_user_id")
            sender_name = user_names_by_sender_id.get(sender_id) or user_name
            lines.append(f"{sender_name}: {user_msg['content']}")
            prev_user_key = id(user_msg)
        speaker = names_by_id.get(assistant_msg.get("char_id")) or char_name
        char_line = f"{speaker}: {strip_think(assistant_msg['content'])}"
        mood = assistant_msg.get("mood")
        if mood:
            char_line += f" [mood: {mood}]"
        lines.append(char_line)
    return "\n".join(lines)
```

- [ ] **Step 4: Thread the new parameter through `extract_batch`**

Run: `grep -n "def extract_batch\|_transcript(" backend/memory_service.py`

In `extract_batch`'s signature (currently `async def extract_batch(sid, char_id, char_name, user_name, batch, turn, language, model, prev_session, chat_base=None, chat_key=None, embed_base=None, embed_key=None, names_by_id=None, cast_names=None, batch_id=None) -> dict:`), add `user_names_by_sender_id: dict | None = None` as a new keyword parameter, and update its internal call from `_transcript(batch, char_name, user_name, names_by_id)` to `_transcript(batch, char_name, user_name, names_by_id, user_names_by_sender_id)`. Leave every existing caller of `extract_batch` unchanged — the new parameter defaults to `None`, reproducing today's exact behavior — wiring real values through from the session's actual participants is done in the multiplayer invite/turn-handling plan, once `session_participants` data is available at the call site.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest backend/tests/test_memory_service.py -k transcript -v`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Run the full memory_service test file**

Run: `pytest backend/tests/test_memory_service.py -v`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add backend/memory_service.py backend/tests/test_memory_service.py
git commit -m "_transcript attributes each line to its actual sender for multiplayer sessions"
```

---

### Task 7: Solo-chat parity regression test

**Files:**
- Test: `backend/tests/test_multiplayer_parity.py` (new)

**Interfaces:**
- Consumes: `chat_service._own_session` (Task 4), `memory_service.present_participants`/`_transcript` (Tasks 5–6), `session_participants` repo (Task 3).
- Produces: nothing new — this task exists purely to check the parity guarantee as a fact, not a claim.

- [ ] **Step 1: Write the parity test**

```python
# backend/tests/test_multiplayer_parity.py
import pytest

from backend import chat_service
from backend.memory_service import present_participants, _transcript
from backend.repositories import chat_sessions, session_participants as sp

pytestmark = pytest.mark.asyncio


async def test_solo_session_ownership_unaffected_by_multiplayer_code(db_conn):
    sid = await chat_sessions.create("char-1", None, "Solo", "You", user_id="owner-1")
    session = await chat_service._own_session(sid, {"id": "owner-1"})
    assert session["id"] == sid
    assert await sp.list_for_session(sid) == []


async def test_solo_memory_extraction_shape_unaffected(db_conn):
    batch = [
        ({"content": "I look around.", "sender_user_id": None},
         {"content": "Dust hangs in still air.", "char_id": None}),
    ]
    transcript = _transcript(batch, "Narrator", "You")
    assert transcript == "You: I look around.\nNarrator: Dust hangs in still air."
    participants = present_participants("Narrator", ["You"], [], transcript)
    assert participants == ["You", "Narrator"]
```

- [ ] **Step 2: Run the test**

Run: `pytest backend/tests/test_multiplayer_parity.py -v`
Expected: PASS (both tests) — if either fails, it means a prior task's change altered solo-session behavior, which must be fixed before continuing.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_multiplayer_parity.py
git commit -m "Add regression test proving solo chat is unaffected by multiplayer foundation changes"
```

---

### Task 8: Full backend test suite sanity check

- [ ] **Step 1: Run the entire backend test suite**

Run: `pytest backend/tests/ -v`
Expected: PASS — every test in the suite, not just the new ones, confirming nothing in this plan broke an unrelated existing test (auth, characters, lore, etc.).

- [ ] **Step 2: If anything unrelated fails, investigate before considering this plan done**

This plan's changes touch `backend/db.py` (schema), `backend/chat_service.py` (ownership), and `backend/memory_service.py` (extraction) — all three are imported broadly, so a real regression elsewhere would show up here. Do not skip this step.

---

## What's next (separate plans, not part of this one)

- Invite/join flow (link + username invites, notifications, capacity-aware accept endpoint)
- Real-time SSE broadcast (`GET /api/sessions/{id}/live`, per-session pub/sub)
- Turn-lock enforcement in `_run` (reject a new action from anyone while `generating` is true for the session)
- Party chat channel (new table, new endpoint, never touches memory)
- Feature gating (`experimental_features_enabled` user setting, Settings toggle, new Multiplayer nav section)
- Frontend: participant strip, locked-composer UI, party chat panel (per the approved mockup)
