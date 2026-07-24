# Multiplayer Participant Name Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persona-less multiplayer participants are named by display name then username instead of a shared literal "You".

**Architecture:** One pure resolution helper in `backend/chat_service.py` (multiplayer router already imports from it, no cycle) becomes the single source of truth for participant naming. Three call sites adopt it: `_resolve_sender_persona`, the `other_player_names` assembly (extracted into a testable helper), and the multiplayer participants endpoint.

**Tech Stack:** FastAPI, pytest + pytest-asyncio against live Postgres (rollback fixture `db_conn` from `backend/tests/conftest.py`).

## Global Constraints

- Zero comments and zero docstrings in any file (CLAUDE.md).
- No em dashes or semicolons in user-facing strings (none are added here).
- Never run git stash, git reset, or git checkout on this tree.
- Run tests from the repo root with: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest <file> -q`
- This is a live bind-mounted app. Edits hot-reload. After each task confirm `curl -s -o /dev/null -w "%{http_code}" https://storyhavenai.sillysillysupersillydomain.win/api/health` prints 401.
- Solo sessions (no participant rows) must keep resolving to "You".

---

### Task 1: The resolution helper

**Files:**
- Modify: `backend/chat_service.py` (add function directly above `_resolve_sender_persona`, currently line 88)
- Test: `backend/tests/test_participant_names.py` (create)

**Interfaces:**
- Produces: `participant_display_name(persona: dict | None, user_row: dict | None) -> str` in `backend/chat_service.py`. Tasks 2, 3, and 4 import and call exactly this.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_participant_names.py`:

```python
import pytest

from backend.chat_service import participant_display_name

pytestmark = pytest.mark.asyncio


def test_persona_name_wins():
    assert participant_display_name({"name": "Kaelen"}, {"display_name": "Dana", "username": "dana1"}) == "Kaelen"


def test_display_name_when_no_persona():
    assert participant_display_name(None, {"display_name": "Dana", "username": "dana1"}) == "Dana"


def test_username_when_display_name_empty():
    assert participant_display_name(None, {"display_name": "", "username": "dana1"}) == "dana1"


def test_you_when_no_user_row():
    assert participant_display_name(None, None) == "You"


def test_empty_persona_name_falls_through():
    assert participant_display_name({"name": ""}, {"display_name": "", "username": "dana1"}) == "dana1"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest backend/tests/test_participant_names.py -q`
Expected: ImportError, `participant_display_name` not found.

- [ ] **Step 3: Write the implementation**

In `backend/chat_service.py`, directly above `async def _resolve_sender_persona`:

```python
def participant_display_name(persona: dict | None, user_row: dict | None) -> str:
    if persona and persona.get("name"):
        return persona["name"]
    if user_row:
        return user_row.get("display_name") or user_row.get("username") or "You"
    return "You"
```

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/chat_service.py backend/tests/test_participant_names.py
git commit -m "Add participant_display_name resolution helper for multiplayer naming"
```

---

### Task 2: `_resolve_sender_persona` stops returning a shared "You"

**Files:**
- Modify: `backend/chat_service.py:88-100` (`_resolve_sender_persona`)
- Test: `backend/tests/test_participant_names.py` (append)

**Interfaces:**
- Consumes: `participant_display_name` from Task 1.
- Produces: unchanged signature `_resolve_sender_persona(s, current_user) -> tuple[dict | None, str]`, but a persona-less participant now yields their account name.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_participant_names.py`:

```python
from backend.chat_service import _resolve_sender_persona
from backend.repositories import chat_sessions, characters, session_participants


async def _multiplayer_session(host_id="host-1"):
    char = await characters.create({"owner_id": host_id, "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "You", user_id=host_id)
    await session_participants.add(sid, host_id, None, "host")
    return await chat_sessions.get(sid)


async def test_personaless_participant_uses_account_name(db_conn):
    session = await _multiplayer_session()
    current_user = {"id": "host-1", "username": "dana1", "display_name": "Dana"}
    persona, name = await _resolve_sender_persona(session, current_user)
    assert persona is None
    assert name == "Dana"


async def test_personaless_participant_falls_back_to_username(db_conn):
    session = await _multiplayer_session()
    current_user = {"id": "host-1", "username": "dana1", "display_name": ""}
    persona, name = await _resolve_sender_persona(session, current_user)
    assert name == "dana1"


async def test_deleted_persona_row_falls_back_to_account_name(db_conn):
    char = await characters.create({"owner_id": "host-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "You", user_id="host-1")
    await session_participants.add(sid, "host-1", "p-gone", "host")
    session = await chat_sessions.get(sid)
    current_user = {"id": "host-1", "username": "dana1", "display_name": "Dana"}
    persona, name = await _resolve_sender_persona(session, current_user)
    assert persona is None
    assert name == "Dana"


async def test_solo_session_still_you(db_conn):
    char = await characters.create({"owner_id": "solo-1", "name": "Char", "mode": "character"})
    sid = await chat_sessions.create(char["id"], None, "Solo", "You", user_id="solo-1")
    session = await chat_sessions.get(sid)
    current_user = {"id": "solo-1", "username": "dana1", "display_name": "Dana"}
    persona, name = await _resolve_sender_persona(session, current_user)
    assert name == "You"
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest backend/tests/test_participant_names.py -q`
Expected: `test_personaless_participant_uses_account_name`, `test_personaless_participant_falls_back_to_username`, and `test_deleted_persona_row_falls_back_to_account_name` FAIL (name is "You"). `test_solo_session_still_you` passes.

- [ ] **Step 3: Update the implementation**

Replace the body of `_resolve_sender_persona` in `backend/chat_service.py` (currently):

```python
async def _resolve_sender_persona(s: dict, current_user: dict | None) -> tuple[dict | None, str]:
    if current_user:
        rows = await session_participants.list_for_session(s["id"])
        if rows:
            row = next((r for r in rows if r["user_id"] == current_user["id"]), None)
            if row and row.get("persona_id"):
                persona = await personas.get(row["persona_id"])
                if persona:
                    return persona, persona["name"]
                return None, "You"
            if row:
                return None, "You"
    persona = await personas.get(s["persona_id"]) if s.get("persona_id") else None
```

with:

```python
async def _resolve_sender_persona(s: dict, current_user: dict | None) -> tuple[dict | None, str]:
    if current_user:
        rows = await session_participants.list_for_session(s["id"])
        if rows:
            row = next((r for r in rows if r["user_id"] == current_user["id"]), None)
            if row:
                persona = await personas.get(row["persona_id"]) if row.get("persona_id") else None
                if persona:
                    return persona, persona["name"]
                return None, participant_display_name(None, current_user)
    persona = await personas.get(s["persona_id"]) if s.get("persona_id") else None
```

Keep everything after that line exactly as it is.

- [ ] **Step 4: Run the full test file plus the existing multiplayer suites**

Run: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest backend/tests/test_participant_names.py backend/tests/test_multiplayer_router.py backend/tests/test_multiplayer_parity.py backend/tests/test_chat_service_ownership.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/chat_service.py backend/tests/test_participant_names.py
git commit -m "Name persona-less multiplayer senders by display name then username"
```

---

### Task 3: The GM hears about persona-less players

**Files:**
- Modify: `backend/chat_service.py:632-640` (the `other_player_names` loop inside the chat generation path)
- Test: `backend/tests/test_participant_names.py` (append)

**Interfaces:**
- Consumes: `participant_display_name` from Task 1.
- Produces: `async def _other_player_names(participant_rows: list[dict], sender_id: str | None) -> list[str]` in `backend/chat_service.py`, used by the generation path.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_participant_names.py`:

```python
from backend.chat_service import _other_player_names
from backend.repositories import users as user_repo


async def test_other_player_names_includes_personaless(db_conn):
    await user_repo.create_user("mira", "pw12345678")
    mira = await user_repo.get_user_by_username("mira")
    rows = [
        {"user_id": "sender-1", "persona_id": None},
        {"user_id": mira["id"], "persona_id": None},
    ]
    names = await _other_player_names(rows, "sender-1")
    assert names == ["mira"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest backend/tests/test_participant_names.py::test_other_player_names_includes_personaless -q`
Expected: ImportError, `_other_player_names` not found.

- [ ] **Step 3: Extract and fix the loop**

In `backend/chat_service.py`, add below `participant_display_name`:

```python
async def _other_player_names(participant_rows: list[dict], sender_id: str | None) -> list[str]:
    names = []
    for row in participant_rows:
        if row["user_id"] == sender_id:
            continue
        row_persona = await personas.get(row["persona_id"]) if row.get("persona_id") else None
        user_row = await user_repo.get_user_by_id(row["user_id"])
        names.append(participant_display_name(row_persona, user_row))
    return names
```

`user_repo` must be importable in chat_service. Check the imports at the top of `backend/chat_service.py`: if `from backend.repositories import users as user_repo` is absent, add it beside the existing `from backend.repositories import session_participants` import.

Then replace the existing loop in the generation path (currently):

```python
    other_player_names = []
    if is_multiplayer:
        for row in participant_rows:
            if not row.get("persona_id") or row["user_id"] == (current_user["id"] if current_user else None):
                continue
            row_persona = await personas.get(row["persona_id"])
            if row_persona:
                other_player_names.append(row_persona["name"])
```

with:

```python
    other_player_names = []
    if is_multiplayer:
        other_player_names = await _other_player_names(
            participant_rows, current_user["id"] if current_user else None)
```

- [ ] **Step 4: Run the test file and chat service suites**

Run: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest backend/tests/test_participant_names.py backend/tests/test_chat_service_run.py backend/tests/test_chat_service_broadcast.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/chat_service.py backend/tests/test_participant_names.py
git commit -m "Include persona-less players in the GM's other-player list by account name"
```

---

### Task 4: Participants endpoint returns the resolved name

**Files:**
- Modify: `backend/routers/multiplayer.py:118-134` (`list_participants`)
- Test: `backend/tests/test_participant_names.py` (append)

**Interfaces:**
- Consumes: `participant_display_name` from Task 1 (import from `backend.chat_service`).
- Produces: each row from `GET /sessions/{sid}/multiplayer/participants` carries `"name"`, the same string the story uses.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_participant_names.py`:

```python
from backend.routers import multiplayer as mp


async def test_participants_endpoint_returns_resolved_name(db_conn):
    await user_repo.create_user("theo", "pw12345678")
    theo = await user_repo.get_user_by_username("theo")
    char = await characters.create({"owner_id": theo["id"], "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "You", user_id=theo["id"])
    await session_participants.add(sid, theo["id"], None, "host")
    rows = await mp.list_participants(sid, current_user=theo)
    assert rows[0]["name"] == "theo"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest backend/tests/test_participant_names.py::test_participants_endpoint_returns_resolved_name -q`
Expected: FAIL, KeyError `'name'`.

- [ ] **Step 3: Add the field**

In `backend/routers/multiplayer.py`, add to the imports from chat_service (line 6 currently reads `from backend.chat_service import _own_session`):

```python
from backend.chat_service import _own_session, participant_display_name
```

In `list_participants`, extend the `enriched.append({...})` dict with one entry after `"persona_name"`:

```python
            "name": participant_display_name(persona, user),
```

- [ ] **Step 4: Run the test file and the multiplayer router suite**

Run: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest backend/tests/test_participant_names.py backend/tests/test_multiplayer_router.py -q`
Expected: all pass.

- [ ] **Step 5: Verify the live app and commit**

Run: `curl -s -o /dev/null -w "%{http_code}" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: 401

```bash
git add backend/routers/multiplayer.py backend/tests/test_participant_names.py
git commit -m "Return the resolved participant name from the multiplayer participants endpoint"
```

---

### Task 5: Frontend shows the resolved name

**Files:**
- Modify: `new_ui/js/multiplayer.js` (wherever participant rows render `persona_name` with a "You"/username fallback, find with: `grep -n "persona_name\|user_display_name" new_ui/js/multiplayer.js new_ui/js/chat.js`)
- Test: none (display-only change, JS has no unit harness for this file)

**Interfaces:**
- Consumes: the `name` field from Task 4.

- [ ] **Step 1: Find every render site**

Run: `grep -n "persona_name\|user_display_name" new_ui/js/*.js`
For each hit that renders a participant label, prefer `p.name` (already resolved server-side) over local `persona_name || "You"`-style fallbacks. Keep `persona_name` usages that specifically mean "has a persona" checks.

- [ ] **Step 2: Make the edits, then parse-check**

Run: `/tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -c "import tree_sitter_javascript as j, tree_sitter as t; p=t.Parser(t.Language(j.language())); [print(f, p.parse(open(f,'rb').read()).root_node.has_error) for f in ['new_ui/js/multiplayer.js']]"`
Expected: `False` (no parse errors).

- [ ] **Step 3: Verify live and commit**

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/multiplayer.js | grep -c "\.name"`
Expected: nonzero (fresh file served).

```bash
git add new_ui/js/multiplayer.js
git commit -m "Show the server-resolved participant name in the multiplayer UI"
```
