# Group Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user publish a group chat's setup as a reusable group template with its own `/g/{id}` detail page, discoverable in the same community feed as characters.

**Architecture:** A new `groups` template entity (name, opening, mode, cast) separate from the private `sessions`. Publishing snapshots a group session's setup into a `groups` row. Templates are browsed via the existing community characters endpoint (tagged `kind:"group"`), viewed at `/g/{id}`, and started into a fresh session. Full owner edit (name, opening, cast). Backend mirrors the router/repository one-file-per-domain pattern; frontend is vanilla JS following the character-page pattern.

**Tech Stack:** FastAPI, SQLAlchemy Core, Postgres+pgvector, vanilla-JS SPA, pytest.

## Global Constraints

- Zero comments/docstrings in any file, ever (including Python `"""..."""`). Explanations go in the chat, never the file.
- Every mutating endpoint logs `log.info` on success; every caught error logs `log.warning`/`error`. Never log chat/character content, keys, or full URLs — only ids/roles/counts/status. Import: `from backend.state import log`.
- Backend imports are absolute: `from backend.x import y`.
- Every new function with real logic gets a pytest test alongside it.
- UI copy follows PROSE_STYLE_GUARD: no em dashes, no semicolons, no AI-cliché stock phrasing; join clauses with a period, comma, or "so"/"since"/"because". All user-facing strings go through `t(key, fallback)`.
- Cast size is 2–4 characters everywhere it is validated.
- Group ids use `nid("g")`; template cast join rows use `nid("gc")`.
- Never hand-edit `new_ui/css/app.css` (compiled). Custom CSS goes in `new_ui/css/cards.css`; run `./rebuild.sh --once` after editing source CSS.
- Verify frontend against the live app at `https://storyhavenai.sillysillysupersillydomain.win` (plain `localhost:3000` is unreachable from the shell). Backend `.py` edits live-reload; static edits are no-cache.
- Test accounts only: `claude:0987654321` (admin), `test:11111111` (user). Do not create accounts.
- Git commits are authored as the user with NO Claude attribution/trailer/session link.

---

## File structure

- Create `backend/repositories/groups.py` — template CRUD + cast + discovery queries.
- Create `backend/routers/groups.py` — publish, detail, edit, delete, start-chat.
- Create `new_ui/js/group-detail.js` — `GroupDetailView` for `/g/{id}`.
- Modify `backend/db.py` — `groups` + `group_characters` tables.
- Modify `backend/schemas.py` — `GroupPublishIn`, `GroupEditIn`.
- Modify `backend/routers/sessions.py` — rename `POST /api/groups` → `POST /api/group-chats`; extract reusable start-group helper.
- Modify `backend/routers/characters.py` — community listing merges groups; `GET /api/characters/{cid}/groups`.
- Modify `server.py` — register `backend.routers.groups`.
- Modify `new_ui/js/group-create.js`, `new_ui/js/chat.js` — retarget renamed endpoint.
- Modify `new_ui/js/router.js` — `/g/{id}` route + `PUBLIC_ROUTES`.
- Modify `new_ui/js/explore-characters.js` — render `kind:"group"` tiles.
- Modify `new_ui/js/character.js` — "Appears in these groups" section.
- Modify `new_ui/index.html` — `<script src="/js/group-detail.js" defer>`.
- Modify `new_ui/js/translations.js` — `group_publish_*` / `group_detail_*` keys.
- Modify `new_ui/css/cards.css` — group-detail + group-tile styles (Task: frontend-design).
- Create `backend/tests/test_groups_repo.py`, `backend/tests/test_groups_router.py`.

---

### Task 1: `groups` + `group_characters` tables

**Files:**
- Modify: `backend/db.py` (after the `session_characters` table definition, ~line 303)
- Test: `backend/tests/test_groups_repo.py`

**Interfaces:**
- Produces: `backend.db.groups` and `backend.db.group_characters` Table objects.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from backend.repositories import groups as gr
pytestmark = pytest.mark.asyncio


async def test_tables_exist():
    from backend.db import groups, group_characters
    assert groups.name == "groups"
    assert group_characters.name == "group_characters"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_repo.py::test_tables_exist -q"`
Expected: FAIL (ModuleNotFoundError: backend.repositories.groups)

- [ ] **Step 3: Add the tables in `backend/db.py`**

Add immediately after the `session_characters = sa.Table(...)` block:

```python
groups = sa.Table(
    "groups", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("owner_id", sa.Text, nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("opening", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("group_mode", sa.Text, nullable=False, server_default=text("'roleplay'")),
    sa.Column("is_public", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("updated", sa.Float, nullable=False),
)

group_characters = sa.Table(
    "group_characters", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("group_id", sa.Text, nullable=False),
    sa.Column("char_id", sa.Text, nullable=False),
    sa.Column("position", sa.Integer, nullable=False, server_default=text("0")),
    sa.UniqueConstraint("group_id", "char_id", name="uq_group_char"),
)
```

Create `backend/repositories/groups.py` with a temporary stub so the import resolves (real body in Task 2):

```python
from __future__ import annotations
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_repo.py::test_tables_exist -q"`
Expected: PASS (new tables are created by `metadata.create_all(checkfirst=True)` on the next startup; the test only imports Table objects)

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/repositories/groups.py backend/tests/test_groups_repo.py
git commit -m "Add groups and group_characters tables"
```

---

### Task 2: `groups` repository

**Files:**
- Modify: `backend/repositories/groups.py`
- Test: `backend/tests/test_groups_repo.py`

**Interfaces:**
- Consumes: `backend.db.groups`, `backend.db.group_characters`, `nid`, `_q`, `_q1`, `_w`.
- Produces:
  - `async create(owner_id, name, opening, group_mode, is_public, char_ids) -> str` (returns group id)
  - `async get(gid) -> dict | None`
  - `async update(gid, name, opening, group_mode, char_ids) -> None`
  - `async set_public(gid, is_public) -> None`
  - `async delete(gid) -> None`
  - `async set_cast(gid, char_ids) -> None`
  - `async list_cast(gid) -> list[dict]` (rows with `char_id`, `position`)
  - `async list_public(q, creator_ids) -> list[dict]`
  - `async list_public_for_char(char_id) -> list[dict]`
  - `async list_by_owner(owner_id) -> list[dict]`

- [ ] **Step 1: Write the failing tests**

```python
async def test_create_get_and_cast(db_conn):
    gid = await gr.create("owner-1", "The Crew", "They meet.", "roleplay", 1, ["a", "b"])
    g = await gr.get(gid)
    assert g["name"] == "The Crew" and g["is_public"] == 1 and g["group_mode"] == "roleplay"
    cast = await gr.list_cast(gid)
    assert [c["char_id"] for c in cast] == ["a", "b"]


async def test_update_rewrites_cast(db_conn):
    gid = await gr.create("owner-1", "X", "o", "chat", 0, ["a", "b"])
    await gr.update(gid, "Y", "o2", "roleplay", ["c", "d", "e"])
    g = await gr.get(gid)
    assert g["name"] == "Y" and g["group_mode"] == "roleplay"
    assert [c["char_id"] for c in await gr.list_cast(gid)] == ["c", "d", "e"]


async def test_delete_removes_group_and_cast(db_conn):
    gid = await gr.create("o", "X", "o", "chat", 1, ["a", "b"])
    await gr.delete(gid)
    assert await gr.get(gid) is None
    assert await gr.list_cast(gid) == []


async def test_list_public_only_public(db_conn):
    pub = await gr.create("o", "Pub", "o", "chat", 1, ["a", "b"])
    await gr.create("o", "Priv", "o", "chat", 0, ["a", "b"])
    ids = [g["id"] for g in await gr.list_public(None, None)]
    assert pub in ids
    assert all(g["is_public"] == 1 for g in await gr.list_public(None, None))


async def test_list_public_for_char(db_conn):
    gid = await gr.create("o", "Feat", "o", "chat", 1, ["hero", "sidekick"])
    await gr.create("o", "Priv", "o", "chat", 0, ["hero", "villain"])
    featuring = await gr.list_public_for_char("hero")
    assert gid in [g["id"] for g in featuring]
    assert all(g["is_public"] == 1 for g in featuring)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_repo.py -q"`
Expected: FAIL (AttributeError: module has no attribute 'create')

- [ ] **Step 3: Implement `backend/repositories/groups.py`**

```python
from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, or_

from backend.db import groups, group_characters, nid, _q, _q1, _w
from backend.state import log


async def _write_cast(gid: str, char_ids: list[str]) -> None:
    await _w(sa_delete(group_characters).where(group_characters.c.group_id == gid))
    for position, char_id in enumerate(char_ids):
        await _w(insert(group_characters).values(
            id=nid("gc"), group_id=gid, char_id=char_id, position=position))


async def create(owner_id: str, name: str, opening: str, group_mode: str,
                 is_public: int, char_ids: list[str]) -> str:
    gid = nid("g")
    now = time.time()
    await _w(insert(groups).values(
        id=gid, owner_id=owner_id, name=name, opening=opening,
        group_mode=group_mode, is_public=1 if is_public else 0, created=now, updated=now))
    await _write_cast(gid, char_ids)
    log.info("group template created: id=%s owner=%s cast=%d public=%s",
             gid, owner_id, len(char_ids), bool(is_public))
    return gid


async def get(gid: str) -> dict | None:
    row = await _q1(select(groups).where(groups.c.id == gid))
    return dict(row) if row else None


async def update(gid: str, name: str, opening: str, group_mode: str, char_ids: list[str]) -> None:
    await _w(sa_update(groups).where(groups.c.id == gid).values(
        name=name, opening=opening, group_mode=group_mode, updated=time.time()))
    await _write_cast(gid, char_ids)
    log.info("group template updated: id=%s cast=%d", gid, len(char_ids))


async def set_public(gid: str, is_public: int) -> None:
    await _w(sa_update(groups).where(groups.c.id == gid).values(
        is_public=1 if is_public else 0, updated=time.time()))
    log.info("group template visibility: id=%s public=%s", gid, bool(is_public))


async def delete(gid: str) -> None:
    await _w(sa_delete(group_characters).where(group_characters.c.group_id == gid))
    await _w(sa_delete(groups).where(groups.c.id == gid))
    log.info("group template deleted: id=%s", gid)


async def set_cast(gid: str, char_ids: list[str]) -> None:
    await _write_cast(gid, char_ids)
    log.info("group template cast set: id=%s cast=%d", gid, len(char_ids))


async def list_cast(gid: str) -> list[dict]:
    rows = await _q(select(group_characters)
                    .where(group_characters.c.group_id == gid)
                    .order_by(group_characters.c.position))
    return [dict(r) for r in rows]


async def list_public(q: str | None, creator_ids: list[str] | None) -> list[dict]:
    conditions = [groups.c.is_public == 1]
    if creator_ids is not None:
        conditions.append(groups.c.owner_id.in_(creator_ids))
    if q:
        conditions.append(groups.c.name.ilike(f"%{q.strip()}%"))
    rows = await _q(select(groups).where(and_(*conditions)).order_by(groups.c.updated.desc()))
    return [dict(r) for r in rows]


async def list_public_for_char(char_id: str) -> list[dict]:
    rows = await _q(
        select(groups)
        .select_from(groups.join(group_characters, groups.c.id == group_characters.c.group_id))
        .where(and_(group_characters.c.char_id == char_id, groups.c.is_public == 1))
        .order_by(groups.c.updated.desc()))
    return [dict(r) for r in rows]


async def list_by_owner(owner_id: str) -> list[dict]:
    rows = await _q(select(groups).where(groups.c.owner_id == owner_id)
                    .order_by(groups.c.updated.desc()))
    return [dict(r) for r in rows]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_repo.py -q"`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/groups.py backend/tests/test_groups_repo.py
git commit -m "Add groups repository with CRUD, cast, and discovery queries"
```

---

### Task 3: Publish/edit request schemas

**Files:**
- Modify: `backend/schemas.py` (after `GroupCreateIn`, ~line 600)

**Interfaces:**
- Produces: `GroupPublishIn(session_id: str)`, `GroupEditIn(name: str, opening: str = "", char_ids: list[str] = [], mode: str = "roleplay")`.

- [ ] **Step 1: Add the schemas**

```python
class GroupPublishIn(BaseModel):
    session_id: str


class GroupEditIn(BaseModel):
    name: str = "Group"
    opening: str = ""
    char_ids: list[str] = []
    mode: str = "roleplay"
```

- [ ] **Step 2: Verify import**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -c 'from backend.schemas import GroupPublishIn, GroupEditIn; print(\"ok\")'"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/schemas.py
git commit -m "Add GroupPublishIn and GroupEditIn schemas"
```

---

### Task 4: Rename the ad-hoc session endpoint to `/api/group-chats`

**Files:**
- Modify: `backend/routers/sessions.py:53` (`@api.post("/groups")` → `@api.post("/group-chats")`)
- Modify: `new_ui/js/group-create.js` (`create()` fetch), `new_ui/js/chat.js` (`startNewChat` group recreate)

**Interfaces:**
- Produces: `POST /api/group-chats` (same body `GroupCreateIn`, same `{session_id}` response). Frees `POST /api/groups` for Task 5.

- [ ] **Step 1: Change the backend route decorator**

In `backend/routers/sessions.py`, change:

```python
@api.post("/groups")
async def create_group_session(body: GroupCreateIn, current_user: dict = Depends(get_current_user)):
```
to:
```python
@api.post("/group-chats")
async def create_group_session(body: GroupCreateIn, current_user: dict = Depends(get_current_user)):
```

- [ ] **Step 2: Update the two frontend callers**

In `new_ui/js/group-create.js`, in `create()`:
```javascript
const r = await api("/api/group-chats", { method: "POST", body: JSON.stringify({ name, opening, char_ids, mode: this.mode }) });
```
In `new_ui/js/chat.js`, in the `startNewChat` group branch:
```javascript
const r = await api("/api/group-chats", { method: "POST", body: JSON.stringify({ name: this.session.title || "Group", opening, char_ids, mode: this.session.group_mode || "roleplay" }) });
```

- [ ] **Step 3: Verify live (server auto-reloads)**

Run (expects `{"session_id": ...}`):
```bash
J=$(mktemp); B=https://storyhavenai.sillysillysupersillydomain.win
curl -s -c $J -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"username":"test","password":"11111111"}' -o /dev/null
IDS=$(curl -s -b $J "$B/api/characters?scope=community" | ./venv/bin/python -c "import sys,json;d=json.load(sys.stdin);print(json.dumps([c['id'] for c in d if c.get('mode')!='rpg'][:2]))")
curl -s -b $J -X POST $B/api/group-chats -H 'Content-Type: application/json' -d "{\"name\":\"Rn\",\"opening\":\"x\",\"char_ids\":$IDS,\"mode\":\"roleplay\"}"
```
Expected: JSON with `session_id`.

- [ ] **Step 4: Commit**

```bash
git add backend/routers/sessions.py new_ui/js/group-create.js new_ui/js/chat.js
git commit -m "Rename ad-hoc group session creation to POST /api/group-chats"
```

---

### Task 5: Groups router — publish endpoint + registration

**Files:**
- Create: `backend/routers/groups.py`
- Modify: `server.py` (add `import backend.routers.groups` near line 198)
- Test: `backend/tests/test_groups_router.py`

**Interfaces:**
- Consumes: `groups` repo (Task 2), `characters` repo, `chat_sessions` repo, `session_characters` repo, `GroupPublishIn` (Task 3), shared `api` router, `get_current_user`.
- Produces: `POST /api/groups` (body `GroupPublishIn`) → `{"id": gid}`; helper `_own_private_char_ids(char_ids, owner_id) -> list[str]` returning the owner's cast chars that are NOT public (the publish blockers), reused by Task 7.

- [ ] **Step 1: Write the failing tests**

```python
import pytest
from httpx import AsyncClient, ASGITransport
from server import app
from backend.repositories import characters, chat_sessions, session_characters as scr
pytestmark = pytest.mark.asyncio


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _login(client):
    await client.post("/api/auth/login", json={"username": "test", "password": "11111111"})


async def test_publish_blocks_owned_private_char(db_conn):
    # Arrange: a group session whose cast has a private char owned by the user.
    async with await _client() as c:
        await _login(c)
        me = (await c.get("/api/auth/me")).json()
        priv = await characters.create({"name": "Secret", "is_public": False}, me["id"])
        pub = await characters.create({"name": "Open", "is_public": True}, me["id"])
        sid = await chat_sessions.create_group(me["id"], "G", [priv["id"], pub["id"]],
                                               persona_id=None, user_name="You", mode="roleplay")
        await scr.set_cast(sid, [{"char_id": priv["id"]}, {"char_id": pub["id"]}])
        r = await c.post("/api/groups", json={"session_id": sid})
        assert r.status_code == 400
        assert priv["id"] in r.text or "Secret" in r.text


async def test_publish_succeeds_when_owned_chars_public(db_conn):
    async with await _client() as c:
        await _login(c)
        me = (await c.get("/api/auth/me")).json()
        a = await characters.create({"name": "A", "is_public": True}, me["id"])
        b = await characters.create({"name": "B", "is_public": True}, me["id"])
        sid = await chat_sessions.create_group(me["id"], "Duo", [a["id"], b["id"]],
                                               persona_id=None, user_name="You", mode="chat")
        await scr.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
        r = await c.post("/api/groups", json={"session_id": sid})
        assert r.status_code == 200
        assert r.json()["id"].startswith("g")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py -q"`
Expected: FAIL (404 on `POST /api/groups`, route not registered)

- [ ] **Step 3: Implement the publish endpoint + helper**

Create `backend/routers/groups.py`:

```python
from __future__ import annotations
from fastapi import Depends, HTTPException

from backend.state import api, log
from backend.auth import get_current_user
from backend.schemas import GroupPublishIn, GroupEditIn
from backend.repositories import groups as groups_repo
from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import session_characters as session_char_repo


async def _own_private_char_ids(char_ids: list[str], owner_id: str) -> list[str]:
    blockers = []
    for cid in char_ids:
        c = await characters.get(cid)
        if c and c.get("owner_id") == owner_id and not c.get("is_public"):
            blockers.append(cid)
    return blockers


@api.post("/groups")
async def publish_group(body: GroupPublishIn, current_user: dict = Depends(get_current_user)):
    s = await chat_sessions.get(body.session_id)
    if not s or s.get("user_id") != current_user["id"]:
        raise HTTPException(404, "session not found")
    if not s.get("is_group"):
        raise HTTPException(400, "only a group chat can be published")
    cast = await session_char_repo.list_cast(body.session_id)
    char_ids = [row["char_id"] for row in cast]
    if not (2 <= len(char_ids) <= 4):
        raise HTTPException(400, "a group needs 2 to 4 characters")
    blockers = await _own_private_char_ids(char_ids, current_user["id"])
    if blockers:
        raise HTTPException(400, f"publish these characters first: {', '.join(blockers)}")
    msgs = await chat_sessions.list_messages(body.session_id)
    opening = next((m["content"] for m in msgs
                    if m["role"] == "assistant" and not m.get("char_id")), "")
    gid = await groups_repo.create(current_user["id"], s.get("title") or "Group", opening,
                                   s.get("group_mode") or "roleplay", 1, char_ids)
    log.info("group published: id=%s from_session=%s owner=%s", gid, body.session_id, current_user["id"])
    return {"id": gid}
```

In `server.py`, add next to the other router imports (~line 198):
```python
import backend.routers.groups   # noqa: F401
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py -q"`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/routers/groups.py server.py backend/tests/test_groups_router.py
git commit -m "Add group publish endpoint with owned-private-char gate"
```

---

### Task 6: Groups router — detail endpoint

**Files:**
- Modify: `backend/routers/groups.py`
- Modify: `backend/tests/test_groups_router.py`

**Interfaces:**
- Consumes: `groups` repo, `characters` repo, `users` repo (for owner attribution).
- Produces: `GET /api/groups/{gid}` → `{id, name, opening, group_mode, is_public, owner, is_owner, cast:[{char_id,name,avatar,is_public,linkable}]}`. `404` if not public and caller is not owner.

- [ ] **Step 1: Write the failing test**

```python
async def test_get_detail_visibility_and_cast(db_conn):
    async with await _client() as c:
        await _login(c)
        me = (await c.get("/api/auth/me")).json()
        a = await characters.create({"name": "Aa", "is_public": True}, me["id"])
        b = await characters.create({"name": "Bb", "is_public": True}, me["id"])
        sid = await chat_sessions.create_group(me["id"], "Vis", [a["id"], b["id"]],
                                               persona_id=None, user_name="You", mode="roleplay")
        await scr.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
        gid = (await c.post("/api/groups", json={"session_id": sid})).json()["id"]
        d = (await c.get(f"/api/groups/{gid}")).json()
        assert d["name"] == "Vis" and d["is_owner"] is True
        assert {m["char_id"] for m in d["cast"]} == {a["id"], b["id"]}
        assert all(m["linkable"] for m in d["cast"])
        r404 = await c.get("/api/groups/gdoesnotexist")
        assert r404.status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py::test_get_detail_visibility_and_cast -q"`
Expected: FAIL (405/404 — no GET route)

- [ ] **Step 3: Implement the detail endpoint**

Add to `backend/routers/groups.py` (add imports `from backend.auth import get_current_user_optional` and `from backend.repositories import users as users_repo` at top):

```python
async def _cast_view(gid: str, viewer_id: str | None) -> list[dict]:
    out = []
    for row in await groups_repo.list_cast(gid):
        c = await characters.get(row["char_id"])
        if not c:
            continue
        public = bool(c.get("is_public"))
        out.append({"char_id": row["char_id"], "name": c["name"], "avatar": c.get("avatar"),
                    "is_public": public, "linkable": public})
    return out


@api.get("/groups/{gid}")
async def get_group(gid: str, current_user: dict | None = Depends(get_current_user_optional)):
    g = await groups_repo.get(gid)
    if not g:
        raise HTTPException(404, "group not found")
    viewer_id = current_user["id"] if current_user else None
    is_owner = viewer_id is not None and g["owner_id"] == viewer_id
    if not g["is_public"] and not is_owner:
        raise HTTPException(404, "group not found")
    owner = await users_repo.get(g["owner_id"])
    return {"id": g["id"], "name": g["name"], "opening": g["opening"],
            "group_mode": g["group_mode"], "is_public": bool(g["is_public"]),
            "is_owner": is_owner,
            "owner": {"username": (owner or {}).get("username"),
                      "display_name": (owner or {}).get("display_name"),
                      "avatar": (owner or {}).get("avatar")},
            "cast": await _cast_view(gid, viewer_id)}
```

Note: confirm `backend.repositories.users` exposes `get(user_id)`; if the accessor differs (e.g. `by_id`), use that name.

- [ ] **Step 4: Run to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py::test_get_detail_visibility_and_cast -q"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routers/groups.py backend/tests/test_groups_router.py
git commit -m "Add group detail endpoint with cast and owner attribution"
```

---

### Task 7: Groups router — edit + delete

**Files:**
- Modify: `backend/routers/groups.py`
- Modify: `backend/tests/test_groups_router.py`

**Interfaces:**
- Produces: `PUT /api/groups/{gid}` (body `GroupEditIn`) → `{"ok": True}`; `DELETE /api/groups/{gid}` → `{"ok": True}`. Both owner-only. Edit re-validates 2–4 cast, owned-chars-public, characters exist and non-RPG.

- [ ] **Step 1: Write the failing tests**

```python
async def test_edit_revalidates_and_updates(db_conn):
    async with await _client() as c:
        await _login(c)
        me = (await c.get("/api/auth/me")).json()
        a = await characters.create({"name": "Ae", "is_public": True}, me["id"])
        b = await characters.create({"name": "Be", "is_public": True}, me["id"])
        d = await characters.create({"name": "De", "is_public": True}, me["id"])
        sid = await chat_sessions.create_group(me["id"], "E", [a["id"], b["id"]],
                                               persona_id=None, user_name="You", mode="roleplay")
        await scr.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
        gid = (await c.post("/api/groups", json={"session_id": sid})).json()["id"]
        ok = await c.put(f"/api/groups/{gid}", json={"name": "E2", "opening": "o",
                         "char_ids": [a["id"], b["id"], d["id"]], "mode": "chat"})
        assert ok.status_code == 200
        detail = (await c.get(f"/api/groups/{gid}")).json()
        assert detail["name"] == "E2" and detail["group_mode"] == "chat"
        assert len(detail["cast"]) == 3
        toosmall = await c.put(f"/api/groups/{gid}", json={"name": "E2", "opening": "o",
                               "char_ids": [a["id"]], "mode": "chat"})
        assert toosmall.status_code == 400


async def test_delete_owner_only(db_conn):
    async with await _client() as c:
        await _login(c)
        me = (await c.get("/api/auth/me")).json()
        a = await characters.create({"name": "Ad", "is_public": True}, me["id"])
        b = await characters.create({"name": "Bd", "is_public": True}, me["id"])
        sid = await chat_sessions.create_group(me["id"], "D", [a["id"], b["id"]],
                                               persona_id=None, user_name="You", mode="roleplay")
        await scr.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
        gid = (await c.post("/api/groups", json={"session_id": sid})).json()["id"]
        assert (await c.delete(f"/api/groups/{gid}")).status_code == 200
        assert (await c.get(f"/api/groups/{gid}")).status_code == 404
```

- [ ] **Step 2: Run to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py -k 'edit or delete' -q"`
Expected: FAIL (405 — no PUT/DELETE routes)

- [ ] **Step 3: Implement edit + delete**

Add to `backend/routers/groups.py`:

```python
async def _validate_cast(char_ids: list[str], owner_id: str) -> list[str]:
    seen, ordered = set(), []
    for cid in char_ids:
        if cid not in seen:
            seen.add(cid)
            ordered.append(cid)
    if not (2 <= len(ordered) <= 4):
        raise HTTPException(400, "a group needs 2 to 4 characters")
    for cid in ordered:
        c = await characters.get(cid)
        if not c:
            raise HTTPException(404, "character not found")
        if (c.get("mode") or "character") == "rpg":
            raise HTTPException(400, "RPG characters cannot join a group")
    blockers = await _own_private_char_ids(ordered, owner_id)
    if blockers:
        raise HTTPException(400, f"publish these characters first: {', '.join(blockers)}")
    return ordered


async def _own_group_or_404(gid: str, current_user: dict) -> dict:
    g = await groups_repo.get(gid)
    if not g or g["owner_id"] != current_user["id"]:
        raise HTTPException(404, "group not found")
    return g


@api.put("/groups/{gid}")
async def edit_group(gid: str, body: GroupEditIn, current_user: dict = Depends(get_current_user)):
    await _own_group_or_404(gid, current_user)
    if not (body.name or "").strip():
        raise HTTPException(400, "a group needs a name")
    mode = "chat" if body.mode == "chat" else "roleplay"
    char_ids = await _validate_cast(body.char_ids or [], current_user["id"])
    await groups_repo.update(gid, body.name.strip(), (body.opening or "").strip(), mode, char_ids)
    log.info("group edited: id=%s owner=%s", gid, current_user["id"])
    return {"ok": True}


@api.delete("/groups/{gid}")
async def delete_group(gid: str, current_user: dict = Depends(get_current_user)):
    await _own_group_or_404(gid, current_user)
    await groups_repo.delete(gid)
    log.info("group deleted by owner: id=%s owner=%s", gid, current_user["id"])
    return {"ok": True}
```

- [ ] **Step 4: Run to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py -k 'edit or delete' -q"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routers/groups.py backend/tests/test_groups_router.py
git commit -m "Add group template edit and delete endpoints"
```

---

### Task 8: Groups router — start chat from template

**Files:**
- Modify: `backend/routers/sessions.py` (extract `start_group_from_cast` helper from `create_group_session`)
- Modify: `backend/routers/groups.py`
- Modify: `backend/tests/test_groups_router.py`

**Interfaces:**
- Consumes: a reusable helper that builds a group session from a cast/name/opening/mode + persona.
- Produces: `POST /api/groups/{gid}/sessions` → `{"session_id": sid}`. Creates a session from the template for the caller.

- [ ] **Step 1: Extract a shared helper in `backend/routers/sessions.py`**

Refactor the body of `create_group_session` so the session-building part becomes a module-level function (keep behavior identical — this is the code already at ~lines 71-82 that builds the session, sets cast, and writes the opening):

```python
async def start_group_from_cast(owner_id: str, name: str, opening: str, mode: str,
                                char_ids: list[str], chars: list[dict]) -> str:
    persona = await personas.default(owner_id)
    user_name = persona["name"] if persona else "You"
    chat_mode = mode == "chat"
    sid = await chat_sessions.create_group(owner_id, name or "Group", char_ids,
                                           persona_id=persona["id"] if persona else None,
                                           user_name=user_name, mode="chat" if chat_mode else "roleplay")
    await session_char_repo.set_cast(sid, [{"char_id": cid} for cid in char_ids])
    if chat_mode:
        names = ", ".join(c["name"] for c in chars)
        scene = f"{user_name} and {names} are now together in a text chatroom, not physically in the same place."
        await chat_sessions.add_message(sid, "assistant", scene)
    else:
        primary = chars[0]
        opening_msg = macro(opening, primary["name"], user_name)
        await chat_sessions.add_message(sid, "assistant", opening_msg)
    return sid
```

Then in `create_group_session`, replace the inlined build with:
```python
    sid = await start_group_from_cast(current_user["id"], body.name or "Group",
                                      (body.opening or "").strip(),
                                      "chat" if chat_mode else "roleplay", char_ids, chars)
    log.info("group session created: id=%s chars=%d by=%s", sid, len(char_ids), current_user["username"])
    return {"session_id": sid}
```

- [ ] **Step 2: Write the failing test**

```python
async def test_start_chat_from_template(db_conn):
    async with await _client() as c:
        await _login(c)
        me = (await c.get("/api/auth/me")).json()
        a = await characters.create({"name": "As", "is_public": True}, me["id"])
        b = await characters.create({"name": "Bs", "is_public": True}, me["id"])
        sid0 = await chat_sessions.create_group(me["id"], "Tmpl", [a["id"], b["id"]],
                                                persona_id=None, user_name="You", mode="roleplay")
        await scr.set_cast(sid0, [{"char_id": a["id"]}, {"char_id": b["id"]}])
        gid = (await c.post("/api/groups", json={"session_id": sid0})).json()["id"]
        r = await c.post(f"/api/groups/{gid}/sessions")
        assert r.status_code == 200
        new_sid = r.json()["session_id"]
        cast = await scr.list_cast(new_sid)
        assert {m["char_id"] for m in cast} == {a["id"], b["id"]}
```

- [ ] **Step 3: Run to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py::test_start_chat_from_template -q"`
Expected: FAIL (405 — no route)

- [ ] **Step 4: Implement the start-chat endpoint**

Add to `backend/routers/groups.py` (import the helper: `from backend.routers.sessions import start_group_from_cast`):

```python
@api.post("/groups/{gid}/sessions")
async def start_group_chat(gid: str, current_user: dict = Depends(get_current_user)):
    g = await groups_repo.get(gid)
    if not g or (not g["is_public"] and g["owner_id"] != current_user["id"]):
        raise HTTPException(404, "group not found")
    cast = await groups_repo.list_cast(gid)
    char_ids, chars = [], []
    for row in cast:
        c = await characters.get(row["char_id"])
        if c:
            char_ids.append(row["char_id"])
            chars.append(c)
    if not (2 <= len(char_ids) <= 4):
        raise HTTPException(400, "group cast is no longer valid")
    sid = await start_group_from_cast(current_user["id"], g["name"], g["opening"],
                                      g["group_mode"], char_ids, chars)
    log.info("group chat started from template: template=%s session=%s by=%s",
             gid, sid, current_user["id"])
    return {"session_id": sid}
```

- [ ] **Step 5: Run to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py::test_start_chat_from_template -q"`
Expected: PASS

- [ ] **Step 6: Run the whole group router suite + confirm no regression in sessions**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py backend/tests/test_group.py -q"`
Expected: PASS (all)

- [ ] **Step 7: Commit**

```bash
git add backend/routers/sessions.py backend/routers/groups.py backend/tests/test_groups_router.py
git commit -m "Add start-chat-from-template endpoint and shared group-session helper"
```

---

### Task 9: Discovery — merge groups into community feed + featuring endpoint

**Files:**
- Modify: `backend/routers/characters.py` (`list_characters`, ~line 31; add `GET /api/characters/{cid}/groups`)
- Modify: `backend/tests/test_groups_router.py`

**Interfaces:**
- Consumes: `groups` repo `list_public`, `list_public_for_char`, `list_cast`.
- Produces:
  - `GET /api/characters?scope=community` response additionally contains group items shaped `{id, kind:"group", name, group_mode, cast_preview:[{char_id,name,avatar}], creator}`; character items unchanged (implicitly `kind:"character"`, no key added to avoid churn — the frontend treats missing `kind` as character).
  - `GET /api/characters/{cid}/groups` → list of `{id, name, group_mode, cast_preview}`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_community_feed_includes_groups(db_conn):
    async with await _client() as c:
        await _login(c)
        me = (await c.get("/api/auth/me")).json()
        a = await characters.create({"name": "Af", "is_public": True}, me["id"])
        b = await characters.create({"name": "Bf", "is_public": True}, me["id"])
        sid = await chat_sessions.create_group(me["id"], "FeedG", [a["id"], b["id"]],
                                               persona_id=None, user_name="You", mode="roleplay")
        await scr.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
        gid = (await c.post("/api/groups", json={"session_id": sid})).json()["id"]
        feed = (await c.get("/api/characters?scope=community")).json()
        groups_in = [x for x in feed if x.get("kind") == "group"]
        assert gid in [x["id"] for x in groups_in]
        one = next(x for x in groups_in if x["id"] == gid)
        assert one["name"] == "FeedG" and len(one["cast_preview"]) == 2


async def test_char_featuring_groups(db_conn):
    async with await _client() as c:
        await _login(c)
        me = (await c.get("/api/auth/me")).json()
        a = await characters.create({"name": "Ag", "is_public": True}, me["id"])
        b = await characters.create({"name": "Bg", "is_public": True}, me["id"])
        sid = await chat_sessions.create_group(me["id"], "FeatG", [a["id"], b["id"]],
                                               persona_id=None, user_name="You", mode="roleplay")
        await scr.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
        gid = (await c.post("/api/groups", json={"session_id": sid})).json()["id"]
        featuring = (await c.get(f"/api/characters/{a['id']}/groups")).json()
        assert gid in [x["id"] for x in featuring]
```

- [ ] **Step 2: Run to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py -k 'feed or featuring' -q"`
Expected: FAIL (no `kind` key; 404 on featuring route)

- [ ] **Step 3: Implement a shared group-item shaper + wire both endpoints**

In `backend/routers/characters.py`, add near the top (after imports) a helper and import the groups repo (`from backend.repositories import groups as groups_repo`):

```python
async def _group_feed_item(g: dict) -> dict:
    preview = []
    for row in (await groups_repo.list_cast(g["id"]))[:4]:
        c = await characters.get(row["char_id"])
        if c:
            preview.append({"char_id": c["id"], "name": c["name"], "avatar": c.get("avatar")})
    creator = None
    owner = await users_repo.get(g["owner_id"])
    if owner:
        creator = {"username": owner.get("username"), "display_name": owner.get("display_name")}
    return {"id": g["id"], "kind": "group", "name": g["name"],
            "group_mode": g["group_mode"], "cast_preview": preview, "creator": creator}
```

Confirm `users_repo` is imported in this file (add `from backend.repositories import users as users_repo` if missing).

At the end of `list_characters`, when `scope == "community"`, append group items before returning. Change the two community return points so that after building `rows`, you do:

```python
    if scope == "community":
        for g in await groups_repo.list_public(q, None):
            rows.append(await _group_feed_item(g))
    return rows
```

(For the unauthenticated branch that returns `characters.list_all(...)` directly, assign it to `rows` first, then run the same append, then return `rows`.)

Add the featuring endpoint after `list_characters`:

```python
@api.get("/characters/{cid}/groups")
async def character_groups(cid: str, current_user: dict | None = Depends(get_current_user_optional)):
    return [await _group_feed_item(g) for g in await groups_repo.list_public_for_char(cid)]
```

- [ ] **Step 4: Run to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py -k 'feed or featuring' -q"`
Expected: PASS

- [ ] **Step 5: Run the full backend group + character suites**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_groups_router.py backend/tests/test_groups_repo.py backend/tests/test_characters_router.py -q"`
Expected: PASS (adapt the character test module name if it differs; discover with `ls backend/tests | grep charact`)

- [ ] **Step 6: Commit**

```bash
git add backend/routers/characters.py backend/tests/test_groups_router.py
git commit -m "Merge published groups into community feed and add char-featuring endpoint"
```

---

### Task 10: Frontend — `/g/{id}` route + `GroupDetailView` (functional, unstyled)

**Files:**
- Create: `new_ui/js/group-detail.js`
- Modify: `new_ui/index.html` (add script tag near `/js/group-create.js`, line 344)
- Modify: `new_ui/js/router.js` (path→name at ~line 214; `routes` map at ~line 112; `PUBLIC_ROUTES` at line 127)

**Interfaces:**
- Consumes: `GET /api/groups/{gid}`, `POST /api/groups/{gid}/sessions`, `DELETE /api/groups/{gid}`, `api`, `navigate`, `t`, `_esc`.
- Produces: `window.GroupDetailView`; routes `group` (`/g/{id}`).

- [ ] **Step 1: Create `new_ui/js/group-detail.js`**

```javascript
"use strict";

class GroupDetailView {
  constructor(gid) { this.gid = gid; }

  async mount(main) {
    this.main = main;
    try {
      this.group = await api(`/api/groups/${encodeURIComponent(this.gid)}`);
    } catch (err) {
      main.innerHTML = `<p style="color:var(--color-warn);font-size:13px;padding:24px">${_esc(err.message || t("group_detail_not_found", "That group couldn't be found."))}</p>`;
      return;
    }
    this.render();
  }

  render() {
    const g = this.group;
    const modeLabel = g.group_mode === "chat" ? t("group_mode_chat", "Chat") : t("group_mode_roleplay", "Roleplay");
    const cast = (g.cast || []).map((m) => {
      const inner = `<span class="gd-cast-name">${_esc(m.name)}</span>`;
      return m.linkable
        ? `<a class="gd-cast" href="/c/${encodeURIComponent(m.char_id)}" onclick="event.preventDefault();navigate('/c/${encodeURIComponent(m.char_id)}')">${inner}</a>`
        : `<span class="gd-cast gd-cast-off">${inner}</span>`;
    }).join("");
    const owner = g.owner?.display_name || g.owner?.username || "";
    this.main.innerHTML = `
      <div class="gd-wrap">
        <div class="gd-head">
          <h1 class="gd-title">${_esc(g.name)}</h1>
          <span class="gd-badge">${modeLabel}</span>
        </div>
        ${owner ? `<div class="gd-owner">${t("group_detail_by", "by")} ${_esc(owner)}</div>` : ""}
        <div class="gd-cast-row">${cast}</div>
        ${g.opening ? `<p class="gd-opening">${_esc(g.opening)}</p>` : ""}
        <div class="gd-actions">
          <button type="button" id="gdStart" class="pe-gen-btn">${t("group_detail_start", "Start chat")}</button>
          ${g.is_owner ? `<button type="button" id="gdDelete" class="chat-composer-btn">${t("group_detail_delete", "Delete")}</button>` : ""}
        </div>
      </div>`;
    this.main.querySelector("#gdStart").onclick = () => this.start();
    const del = this.main.querySelector("#gdDelete");
    if (del) del.onclick = () => this.remove();
  }

  async start() {
    if (!ME) { navigate("/login"); return; }
    const btn = this.main.querySelector("#gdStart");
    btn.disabled = true;
    try {
      const r = await api(`/api/groups/${encodeURIComponent(this.gid)}/sessions`, { method: "POST" });
      navigate(`/chats/${r.session_id}`);
    } catch (err) {
      errorToast(err.message || t("group_detail_start_failed", "Couldn't start that chat."));
      btn.disabled = false;
    }
  }

  async remove() {
    if (!(await confirmDialog(t("group_detail_delete_confirm", "Delete this published group?"), { danger: true }))) return;
    try {
      await api(`/api/groups/${encodeURIComponent(this.gid)}`, { method: "DELETE" });
      navigate("/explore/characters");
    } catch (err) {
      errorToast(err.message || t("group_detail_delete_failed", "Couldn't delete that group."));
    }
  }
}

if (typeof window !== "undefined") window.GroupDetailView = GroupDetailView;
```

- [ ] **Step 2: Register the route in `new_ui/js/router.js`**

In the `routes` object (near the `character` entry, ~line 112) add:
```javascript
  group: (main) => {
    const gid = location.pathname.split("/").filter(Boolean)[1];
    return new GroupDetailView(gid).mount(main);
  },
```
In the path→name resolver (near line 214, alongside the `seg === "c"` checks) add:
```javascript
  if (seg === "g" && parts[1]) return "group";
```
Add `"group"` to `PUBLIC_ROUTES` (line 127):
```javascript
const PUBLIC_ROUTES = new Set([...UNAUTHENTICATED_ROUTE_NAMES, "shared-image", "character", "creator-profile", "explore/characters", "group"]);
```
And to the anon chrome branch near line 421 add `|| routeName === "group"` so anon visitors keep padding.

- [ ] **Step 3: Add the script tag in `new_ui/index.html`**

After line 344 (`<script src="/js/group-create.js" defer></script>`):
```html
  <script src="/js/group-detail.js" defer></script>
```

- [ ] **Step 4: Verify live**

Publish a group via curl (reuse the Task 8 flow) to get a `gid`, then:
```bash
curl -s "https://storyhavenai.sillysillysupersillydomain.win/js/group-detail.js" | grep -c "GroupDetailView"
```
Expected: ≥1. Then load `https://storyhavenai.sillysillysupersillydomain.win/g/<gid>` in a browser (or Playwright, navigating via `navigate('/g/<gid>')` after login) and confirm the name, cast, and Start chat render, and Start chat lands in `/chats/...`.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/group-detail.js new_ui/index.html new_ui/js/router.js
git commit -m "Add /g/{id} route and functional GroupDetailView"
```

---

### Task 11: Frontend — Explore grid renders group tiles

**Files:**
- Modify: `new_ui/js/explore-characters.js` (the card/tile render for community items)

**Interfaces:**
- Consumes: community feed items with `kind:"group"` (Task 9).
- Produces: group tiles that route to `/g/{id}`.

- [ ] **Step 1: Locate the item render**

Find where each community item becomes a card (grep for `navigate(\`/c/` or the card template in `new_ui/js/explore-characters.js`). Identify the per-item map that builds a character card.

- [ ] **Step 2: Branch on `kind` in that map**

At the top of the per-item render function, add:
```javascript
if (item.kind === "group") return this.groupTileHtml(item);
```
And add the method (cast collage of up to 4 avatars + name + mode badge, routing to `/g/{id}`):
```javascript
groupTileHtml(g) {
  const avatars = (g.cast_preview || []).slice(0, 4).map((m) =>
    m.avatar
      ? `<span class="grp-collage-av" style="background-image:url('${_attr(m.avatar)}')"></span>`
      : `<span class="grp-collage-av grp-collage-fallback">${_esc((m.name || "?")[0].toUpperCase())}</span>`
  ).join("");
  const modeLabel = g.group_mode === "chat" ? t("group_mode_chat", "Chat") : t("group_mode_roleplay", "Roleplay");
  return `
    <button type="button" class="char-card grp-card" onclick="navigate('/g/${encodeURIComponent(g.id)}')">
      <div class="grp-collage">${avatars}</div>
      <div class="grp-card-meta">
        <span class="grp-card-name">${_esc(g.name)}</span>
        <span class="grp-card-badge">${modeLabel}</span>
      </div>
    </button>`;
}
```
Ensure the containing render uses `.map((item) => ...)` where `item` is passed (adjust variable name to the file's actual one). If the grid filters by a data shape that assumes character fields (e.g. reads `item.avatar` unconditionally before the map), guard those with `item.kind !== "group"`.

- [ ] **Step 3: Add minimal tile CSS in `new_ui/css/cards.css`** (final styling in Task 15)

```css
.grp-collage { display:flex; gap:-6px; }
.grp-collage-av { width:34px; height:34px; border-radius:50%; background-size:cover; background-position:center; border:2px solid var(--color-paper); margin-left:-8px; display:grid; place-items:center; }
.grp-collage-av:first-child { margin-left:0; }
.grp-card-name { font-weight:600; color:var(--color-ink); }
.grp-card-badge { font-size:11px; color:var(--color-sec); }
```
Run: `./rebuild.sh --once` is NOT needed (cards.css is served directly), but confirm cards.css is a hand-written source per CLAUDE.md.

- [ ] **Step 4: Verify live**

Load `https://storyhavenai.sillysillysupersillydomain.win/explore/characters` logged in as `test` after publishing a group; confirm a group tile appears in the grid and clicking it routes to `/g/{id}`.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/explore-characters.js new_ui/css/cards.css
git commit -m "Render published group tiles in the community grid"
```

---

### Task 12: Frontend — "Publish as group" + owner controls in the chat header

**Files:**
- Modify: `new_ui/js/chat.js` (group header menu)

**Interfaces:**
- Consumes: `POST /api/groups {session_id}`.
- Produces: a header action that publishes the current group session and navigates to `/g/{id}`.

- [ ] **Step 1: Find the group header menu**

In `new_ui/js/chat.js`, locate the group chat header dropdown/menu construction (grep for `groupReassign` / roster / `headerHtml` group branch — the menu that already holds group controls).

- [ ] **Step 2: Add the publish action**

Add a menu item shown only for group sessions:
```javascript
{ label: t("group_publish_action", "Publish as group"), onClick: () => this.publishGroup() },
```
And the method:
```javascript
async publishGroup() {
  try {
    const r = await api("/api/groups", { method: "POST", body: JSON.stringify({ session_id: this.sid }) });
    toast(t("group_publish_done", "Published. Anyone can start this group now."));
    navigate(`/g/${r.id}`);
  } catch (err) {
    errorToast(err.message || t("group_publish_failed", "Couldn't publish that group."));
  }
}
```
The backend already returns the own-chars-public blocker message in `err.message`, so no extra handling is needed beyond surfacing it.

- [ ] **Step 3: Verify live**

In a group chat (as `test`) whose characters are public, open the header menu, click Publish, confirm it navigates to `/g/{id}`. In a group containing one of your own private characters, confirm the toast shows the "publish these characters first" message.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/chat.js
git commit -m "Add Publish as group action to the group chat header"
```

---

### Task 13: Frontend — "Appears in these groups" on the character page

**Files:**
- Modify: `new_ui/js/character.js`

**Interfaces:**
- Consumes: `GET /api/characters/{cid}/groups`.
- Produces: a section on `/c/{id}` listing featuring groups, each routing to `/g/{id}`.

- [ ] **Step 1: Fetch featuring groups in the character view**

In `new_ui/js/character.js`, where the character detail loads (after the character is fetched), add:
```javascript
this.featuringGroups = await api(`/api/characters/${encodeURIComponent(this.cid)}/groups`).catch(() => []);
```
(Use the file's actual id field for the character; adjust `this.cid`.)

- [ ] **Step 2: Render the section**

Where the character page composes its sections, add (only when `this.featuringGroups?.length`):
```javascript
featuringGroupsHtml() {
  if (!this.featuringGroups?.length) return "";
  const items = this.featuringGroups.map((g) =>
    `<button type="button" class="cg-item" onclick="navigate('/g/${encodeURIComponent(g.id)}')">${_esc(g.name)}</button>`).join("");
  return `<section class="cg-section"><h3 class="cg-title">${t("character_appears_in_groups", "Appears in these groups")}</h3><div class="cg-list">${items}</div></section>`;
}
```
Insert `${this.featuringGroupsHtml()}` into the character page markup.

- [ ] **Step 3: Verify live**

On `/c/{id}` for a character that is in a published group, confirm the section lists the group and clicking routes to `/g/{id}`.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/character.js
git commit -m "Show Appears in these groups on the character page"
```

---

### Task 14: Frontend — group template full edit modal

**Files:**
- Modify: `new_ui/js/group-detail.js` (add Edit button + modal)
- Modify: `new_ui/js/group-create.js` (export the picker/grid building so it can be reused, or duplicate the minimal picker)

**Interfaces:**
- Consumes: `GET /api/groups/{gid}` (current values), `PUT /api/groups/{gid}`.
- Produces: an owner-only Edit flow that saves name/opening/mode/cast.

- [ ] **Step 1: Add an Edit button for owners in `render()`**

In `GroupDetailView.render()`, within `.gd-actions` when `g.is_owner`:
```javascript
`<button type="button" id="gdEdit" class="chat-composer-btn">${t("group_detail_edit", "Edit")}</button>`
```
Wire it:
```javascript
const edit = this.main.querySelector("#gdEdit");
if (edit) edit.onclick = () => this.openEdit();
```

- [ ] **Step 2: Implement `openEdit()` reusing the group picker**

Reuse `GroupCreateModal`'s picker by instantiating an edit variant. Add a method that opens a modal pre-filled with the current name/opening/mode and cast selected, then on save calls `PUT`:
```javascript
async openEdit() {
  const modal = new GroupCreateModal();
  modal.editGid = this.gid;
  modal.presetName = this.group.name;
  modal.presetOpening = this.group.opening;
  modal.mode = this.group.group_mode;
  modal.presetSelected = new Set((this.group.cast || []).map((m) => m.char_id));
  await modal.open();
}
```
In `new_ui/js/group-create.js`, honor these presets: in `open()`, if `this.editGid` is set, prefill `#grpName`/`#grpOpening`, seed `this.selected = this.presetSelected || new Set()`, and set the confirm label to `t("group_detail_save", "Save changes")`. In `create()`, branch: if `this.editGid`, call `api(\`/api/groups/${this.editGid}\`, { method: "PUT", body: JSON.stringify({ name, opening, char_ids, mode: this.mode }) })`, then `closeTopModal()` and `navigate(\`/g/${this.editGid}\`)`; otherwise keep the existing `POST /api/group-chats` session-creation path.

- [ ] **Step 3: Verify live**

As the owner on `/g/{id}`, click Edit, change the name and swap a cast member, save, confirm the detail page reflects the change and the cast size stays 2–4 (try 1 char → blocked, try a 5th → picker caps at 4).

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/group-detail.js new_ui/js/group-create.js
git commit -m "Add owner full-edit flow for published group templates"
```

---

### Task 15: frontend-design pass on the `/g/{id}` page and group tiles

**Files:**
- Modify: `new_ui/js/group-detail.js` (markup/classes only), `new_ui/css/cards.css`

**Interfaces:** none new — visual only.

- [ ] **Step 1: Invoke the frontend-design skill**

Use the `frontend-design` skill with the brief: "Design the `/g/{id}` group detail page and the community group tile for StoryHaven, matching the existing token-based brand (`var(--color-*)`, themes.css). The detail page shows a group name, a Roleplay/Chat mode badge, creator attribution, a cast lineup of 2–4 character avatars+names (linked when public), an opening preview, and a primary Start chat action plus owner Edit/Delete. The tile is a cast-avatar collage with name and mode badge." Apply its output to the markup classes and `cards.css`, keeping all colors as CSS custom properties (never hardcoded hex) so themes work, and all copy through `t()` following PROSE_STYLE_GUARD.

- [ ] **Step 2: Verify both themes**

Load `/g/{id}` and `/explore/characters`, toggle the theme, confirm the page and tile recolor correctly (no hardcoded hex leaking through) and are responsive on mobile width.

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/group-detail.js new_ui/css/cards.css
git commit -m "Style the group detail page and community group tiles"
```

---

### Task 16: Translations + final full-suite run

**Files:**
- Modify: `new_ui/js/translations.js`

- [ ] **Step 1: Add every new key with its English default**

Add these keys to the `UI_STRINGS` object (verbatim, PROSE_STYLE_GUARD-compliant):
```javascript
  group_publish_action: "Publish as group",
  group_publish_done: "Published. Anyone can start this group now.",
  group_publish_failed: "Couldn't publish that group.",
  group_detail_not_found: "That group couldn't be found.",
  group_detail_by: "by",
  group_detail_start: "Start chat",
  group_detail_start_failed: "Couldn't start that chat.",
  group_detail_delete: "Delete",
  group_detail_delete_confirm: "Delete this published group?",
  group_detail_delete_failed: "Couldn't delete that group.",
  group_detail_edit: "Edit",
  group_detail_save: "Save changes",
  character_appears_in_groups: "Appears in these groups",
```

- [ ] **Step 2: Full backend suite (excluding the Playwright UI tests)**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/ tests/memory/ -q --ignore=tests/new_ui"`
Expected: PASS except the 9 pre-existing unrelated OAuth failures noted in project history (confirm no NEW failures in groups/characters/sessions/memory).

- [ ] **Step 3: Health + served-asset sanity**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health
curl -s https://storyhavenai.sillysillysupersillydomain.win/js/group-detail.js | grep -c GroupDetailView
```
Expected: `401` (up) and `≥1`.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/translations.js
git commit -m "Add group publishing UI strings"
```

---

## Self-review notes

- **Spec coverage:** data model (Task 1), repo (Task 2), publish + gate (Task 5), detail (Task 6), edit/delete (Task 7), start-chat (Task 8), same-feed discovery + featuring (Task 9), `/g/{id}` page (Tasks 10, 15), community tiles (Task 11), publish action (Task 12), character-page cross-link (Task 13), full edit (Task 14), rename to free `groups` (Task 4), translations/logging (throughout, Task 16). All spec sections map to a task.
- **Verify-before-use:** Tasks 6/9 note confirming the exact `users` repo accessor name (`get` vs `by_id`) and the character-listing test module name before relying on them.
- **Frontend testing:** the repo's Playwright harness is flaky against the SPA auth guard, so frontend tasks verify live (curl for served assets, browser/Playwright-via-`navigate()` for behavior), consistent with how this codebase is actually verified.
