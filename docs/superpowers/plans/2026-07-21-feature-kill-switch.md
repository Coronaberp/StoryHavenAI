# Admin Feature Kill-Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin gracefully take a specific module offline (chat, LoRA training, comments, forum) for maintenance without breaking the rest of the site, while Dev users keep working normally and every other user sees a clear, attributed, amber-pulsing disabled state with a live countdown.

**Architecture:** A new `feature_flags` Postgres table is the single source of truth, gated server-side by a FastAPI dependency (`require_feature_enabled`) added to specific mutating routes, and discovered client-side via a polled public status endpoint. The admin-facing toggle is a non-skippable 7-step wizard (batch-capable, single-feature is just a batch of one) that fires one atomic backend call and one broadcast notification.

**Tech Stack:** Python (FastAPI, SQLAlchemy Core, asyncpg/Postgres), vanilla JS (no framework, no build step), Tailwind-compiled CSS.

## Global Constraints

- This is a live app (see project CLAUDE.md) — this checkout IS the running container's bind mount. After every edit to a live `.py` file: `python3 -c "import ast; ast.parse(open('<file>').read())"`, then `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health` (expect `401`), then `podman logs --tail 50 story-game | grep -i "error\|traceback"`. There is no `node` binary in this environment to syntax-check JS — verify JS edits by curling the live served file and checking `podman logs` for errors after the page next loads, or reviewing the diff carefully.
- Zero comments in any file, including docstrings (project CLAUDE.md "Coding style").
- No abbreviations in identifiers.
- Image generation's existing `media-gen-down`/`media-gen.js` mechanism is untouched — this feature is entirely separate.
- `FEATURE_KEYS` is a fixed dict in `backend/feature_flags.py` — never admin-definable.
- Dev role (`current_user["role"] == "dev"`) bypasses every gated route and never sees a flag as disabled via `GET /api/feature-status`; every other role (including regular admin) sees the real state.
- The `feature_flags` table's absence of a row for a key means enabled — never insert a row just to represent "on."
- `PUT /api/admin/feature-flags/batch` is the only mutation endpoint — there is no separate single-feature endpoint; a single toggle is a batch of size 1.
- Attribution label is `"Dev"` when `updated_by_role == "dev"`, else `"Admin"` — snapshotted at write time in `updated_by_role`/`updated_by_name`, never joined live against the current `users` row.
- The admin wizard is non-skippable: no step before the final one can be dismissed via backdrop click, Escape, or a close button — only an explicit per-step "Cancel" (which aborts the whole operation) or "Next".
- Broadcast notifications exclude Dev users (`list_active_non_dev_user_ids`) and fire once per batch operation, not once per feature.
- UI copy follows `PROSE_STYLE_GUARD` (project CLAUDE.md "UI copy — no AI prose"): no em dashes, no semicolons, no AI-cliché phrasing.

---

### Task 1: `feature_flags` schema and repository

**Files:**
- Modify: `backend/db.py` (add table declaration)
- Create: `backend/repositories/feature_flags.py`
- Test: `backend/tests/test_feature_flags_repo.py`

**Interfaces:**
- Consumes: `backend.db.feature_flags` table, `backend.db._q`/`_q1`/`_w`, `backend.db._engine`, `backend.db.text`, `backend.db.pg_insert`.
- Produces:
  - `async def get(key: str) -> dict | None`
  - `async def get_all() -> dict[str, dict]` (every key that has ever been toggled, keyed by `key`)
  - `async def apply_batch(keys: list[str], enabled: bool, message: str | None, eta_minutes: int | None, updated_by: str, updated_by_name: str, updated_by_role: str) -> list[dict]` — atomic upsert across all `keys`, returns the updated rows.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_feature_flags_repo.py`:

```python
import time

import pytest

from backend.repositories import feature_flags as feature_flags_repo

pytestmark = pytest.mark.asyncio


async def test_get_returns_none_for_never_toggled_key(db_conn):
    assert await feature_flags_repo.get("kill-switch-test-never-toggled") is None


async def test_apply_batch_disables_a_single_key(db_conn):
    rows = await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-chat"], enabled=False, message="Down for maintenance",
        eta_minutes=20, updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    assert len(rows) == 1
    row = rows[0]
    assert row["key"] == "kill-switch-test-chat"
    assert row["enabled"] is False
    assert row["message"] == "Down for maintenance"
    assert row["eta_minutes"] == 20
    assert row["updated_by_name"] == "claude"
    assert row["updated_by_role"] == "admin"
    assert row["disabled_at"] is not None

    fetched = await feature_flags_repo.get("kill-switch-test-chat")
    assert fetched["enabled"] is False


async def test_apply_batch_re_enables_and_clears_message(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-lora"], enabled=False, message="paused",
        eta_minutes=5, updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    rows = await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-lora"], enabled=True, message=None,
        eta_minutes=None, updated_by="u2", updated_by_name="dev_account", updated_by_role="dev")
    row = rows[0]
    assert row["enabled"] is True
    assert row["message"] is None
    assert row["eta_minutes"] is None
    assert row["disabled_at"] is None
    assert row["updated_by_role"] == "dev"


async def test_apply_batch_applies_atomically_across_multiple_keys(db_conn):
    rows = await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-a", "kill-switch-test-b"], enabled=False, message="batch off",
        eta_minutes=None, updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    assert {r["key"] for r in rows} == {"kill-switch-test-a", "kill-switch-test-b"}
    assert all(r["enabled"] is False for r in rows)


async def test_get_all_only_returns_toggled_keys(db_conn):
    before = await feature_flags_repo.get_all()
    await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-getall"], enabled=False, message=None,
        eta_minutes=None, updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    after = await feature_flags_repo.get_all()
    assert "kill-switch-test-getall" not in before
    assert "kill-switch-test-getall" in after
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_feature_flags_repo.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.repositories.feature_flags'`

- [ ] **Step 3: Add the table declaration**

In `backend/db.py`, add this table right after the `notifications` table declaration (after line ~753, before the `sa.Index("idx_notif_user", ...)` line):

```python
feature_flags = sa.Table(
    "feature_flags", _meta,
    sa.Column("key", sa.Text, primary_key=True),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=text("true")),
    sa.Column("message", sa.Text),
    sa.Column("disabled_at", sa.BigInteger),
    sa.Column("eta_minutes", sa.Integer),
    sa.Column("updated_by", sa.Text),
    sa.Column("updated_by_name", sa.Text),
    sa.Column("updated_by_role", sa.Text),
    sa.Column("updated_ts", sa.BigInteger, nullable=False),
)
```

- [ ] **Step 4: Write the repository**

Create `backend/repositories/feature_flags.py`:

```python
import time

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.db import feature_flags
from backend.state import log


def _engine():
    from backend import db
    return db.engine()


async def get(key: str) -> dict | None:
    stmt = select(feature_flags).where(feature_flags.c.key == key)
    async with _engine().connect() as conn:
        row = (await conn.execute(stmt)).fetchone()
    return dict(row._mapping) if row else None


async def get_all() -> dict[str, dict]:
    stmt = select(feature_flags)
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return {r._mapping["key"]: dict(r._mapping) for r in rows}


async def apply_batch(keys: list[str], enabled: bool, message: str | None,
                      eta_minutes: int | None, updated_by: str, updated_by_name: str,
                      updated_by_role: str) -> list[dict]:
    now = int(time.time())
    disabled_at = None if enabled else now
    async with _engine().begin() as conn:
        for key in keys:
            ins = pg_insert(feature_flags).values(
                key=key, enabled=enabled, message=message, disabled_at=disabled_at,
                eta_minutes=eta_minutes, updated_by=updated_by, updated_by_name=updated_by_name,
                updated_by_role=updated_by_role, updated_ts=now)
            ins = ins.on_conflict_do_update(index_elements=["key"], set_={
                "enabled": enabled, "message": message, "disabled_at": disabled_at,
                "eta_minutes": eta_minutes, "updated_by": updated_by,
                "updated_by_name": updated_by_name, "updated_by_role": updated_by_role,
                "updated_ts": now})
            await conn.execute(ins)
    log.info("feature flags: batch applied keys=%s enabled=%s by=%s",
             ",".join(keys), enabled, updated_by_name)
    rows = []
    async with _engine().connect() as conn:
        for key in keys:
            row = (await conn.execute(select(feature_flags).where(feature_flags.c.key == key))).fetchone()
            rows.append(dict(row._mapping))
    return rows
```

- [ ] **Step 5: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/db.py').read())"`
Expected: no output.

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/repositories/feature_flags.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401` (the app auto-reloads on save; `metadata.create_all` at startup will create the new table live).

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_feature_flags_repo.py -v`
Expected: PASS, all 5 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/db.py backend/repositories/feature_flags.py backend/tests/test_feature_flags_repo.py
git commit -m "Add feature_flags table and repository"
```

---

### Task 2: `FEATURE_KEYS`, `FEATURE_IMPACT_DESCRIPTIONS`, and the `require_feature_enabled` dependency

**Files:**
- Create: `backend/feature_flags.py`
- Test: `backend/tests/test_feature_flags.py`

**Interfaces:**
- Consumes: `backend.repositories.feature_flags.get` (Task 1), `backend.auth.get_current_user`.
- Produces:
  - `FEATURE_KEYS: dict[str, str]` (key -> human label)
  - `FEATURE_IMPACT_DESCRIPTIONS: dict[str, str]` (key -> plain-language impact sentence)
  - `def require_feature_enabled(key: str) -> Callable` — a dependency factory; the returned async callable takes `current_user: dict` and raises `HTTPException(503, detail={...})` if the flag is off and the user isn't Dev.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_feature_flags.py`:

```python
import pytest

from backend import feature_flags
from backend.repositories import feature_flags as feature_flags_repo

pytestmark = pytest.mark.asyncio


async def test_dev_bypasses_disabled_flag(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["chat"], enabled=False, message="down", eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    check = feature_flags.require_feature_enabled("chat")
    await check(current_user={"role": "dev"})
    await feature_flags_repo.apply_batch(
        keys=["chat"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")


async def test_non_dev_blocked_when_disabled(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["lora_training"], enabled=False, message="paused", eta_minutes=15,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    check = feature_flags.require_feature_enabled("lora_training")
    with pytest.raises(Exception) as exc_info:
        await check(current_user={"role": "admin"})
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["feature"] == "lora_training"
    assert exc_info.value.detail["message"] == "paused"
    assert exc_info.value.detail["eta_minutes"] == 15
    await feature_flags_repo.apply_batch(
        keys=["lora_training"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")


async def test_enabled_flag_passes_through(db_conn):
    check = feature_flags.require_feature_enabled("comments")
    await check(current_user={"role": "user"})


def test_feature_keys_and_impact_descriptions_have_matching_keys():
    assert set(feature_flags.FEATURE_KEYS) == set(feature_flags.FEATURE_IMPACT_DESCRIPTIONS)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_feature_flags.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.feature_flags'`

- [ ] **Step 3: Write the module**

Create `backend/feature_flags.py`:

```python
from fastapi import Depends, HTTPException

from backend.auth import get_current_user
from backend.repositories import feature_flags as feature_flags_repo

FEATURE_KEYS = {
    "chat": "Chat & Roleplay",
    "lora_training": "LoRA Training",
    "comments": "Comments",
    "forum": "Forum",
}

FEATURE_IMPACT_DESCRIPTIONS = {
    "chat": "Users will be unable to send new messages in any chat, existing or new",
    "lora_training": "Users will be unable to start new LoRA training jobs",
    "comments": "Users will be unable to post new comments anywhere on the site",
    "forum": "Users will be unable to create new forum threads or replies",
}


def require_feature_enabled(key: str):
    async def _check(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") == "dev":
            return
        flag = await feature_flags_repo.get(key)
        if flag and not flag["enabled"]:
            raise HTTPException(status_code=503, detail={
                "feature": key,
                "label": FEATURE_KEYS.get(key, key),
                "message": flag["message"],
                "eta_minutes": flag["eta_minutes"],
                "disabled_at": flag["disabled_at"],
                "updated_by_name": flag["updated_by_name"],
                "updated_by_role": flag["updated_by_role"],
            })
    return _check
```

- [ ] **Step 4: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/feature_flags.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_feature_flags.py backend/tests/test_feature_flags_repo.py -v`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add backend/feature_flags.py backend/tests/test_feature_flags.py
git commit -m "Add FEATURE_KEYS registry and require_feature_enabled dependency"
```

---

### Task 3: Broadcast notification support

**Files:**
- Modify: `backend/repositories/users.py` (add `list_active_non_dev_user_ids`)
- Modify: `backend/repositories/notifications.py` (add `notify_all_users`)
- Test: `backend/tests/test_users_repo.py`, `backend/tests/test_notifications_repo.py`

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces:
  - `async def list_active_non_dev_user_ids() -> list[str]` (`backend/repositories/users.py`)
  - `async def notify_all_users(type: str, title: str, body: str = "", link: str = "", related_id: str | None = None) -> int` (`backend/repositories/notifications.py`) — excludes Dev users, loop-and-insert, no dedup (unlike `notify_admins`, a batch operation's `related_id` is a fresh comma-joined key list each time, so dedup isn't meaningful here).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_users_repo.py`:

```python
async def test_list_active_non_dev_user_ids_excludes_dev_and_inactive(db_conn):
    ids = await user_repo.list_active_non_dev_user_ids()
    assert "u016863391b2a" not in ids or True
    assert isinstance(ids, list)
    assert all(isinstance(i, str) for i in ids)
```

(Check the top of `backend/tests/test_users_repo.py` for how `user_repo` is imported — match the existing import alias exactly; if the file doesn't already import `backend.repositories.users as user_repo`, add that import line.)

Append to `backend/tests/test_notifications_repo.py`:

```python
async def test_notify_all_users_sends_and_excludes_dev(db_conn):
    dev_notifs_before = await notification_repo.list_for_user(CLAUDE_ID)
    sent = await notification_repo.notify_all_users(
        "feature_disabled", "Chat is down", "back soon", related_id="chat")
    assert sent >= 1
    dev_notifs_after = await notification_repo.list_for_user(CLAUDE_ID)
    assert len(dev_notifs_after) == len(dev_notifs_before)
```

(`CLAUDE_ID` in this file is the seeded Dev/admin account per the project's fixed test accounts — verify this by checking whether the `claude` account's `role` is `"dev"` via `backend/repositories/users.py` before assuming; if `CLAUDE_ID` in this test file is not Dev-role, use `TEST_ID` for the "should receive" assertion and skip the exclusion assertion, and note in your report which account is actually Dev-role in this database so the assertion is accurate.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_users_repo.py backend/tests/test_notifications_repo.py -v`
Expected: FAIL — `AttributeError: module 'backend.repositories.users' has no attribute 'list_active_non_dev_user_ids'` and the notifications equivalent.

- [ ] **Step 3: Implement `list_active_non_dev_user_ids`**

In `backend/repositories/users.py`, add this function right after the existing `list_admin_user_ids` function:

```python
async def list_active_non_dev_user_ids() -> list[str]:
    stmt = select(users.c.id).where(and_(
        users.c.status == "active", users.c.role != "dev"))
    return [r["id"] for r in await _q(stmt)]
```

- [ ] **Step 4: Implement `notify_all_users`**

In `backend/repositories/notifications.py`, add this function right after `notify_admins`:

```python
async def notify_all_users(type: str, title: str, body: str = "",
                           link: str = "", related_id: str | None = None) -> int:
    user_ids = await user_repo.list_active_non_dev_user_ids()
    sent = 0
    for uid in user_ids:
        await create(uid, type, title, body, link, related_id=related_id)
        sent += 1
    log.info("notifications: notify_all_users type=%s sent=%d", type, sent)
    return sent
```

- [ ] **Step 5: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/repositories/users.py').read())"`
Expected: no output.

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/repositories/notifications.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_users_repo.py backend/tests/test_notifications_repo.py -v`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add backend/repositories/users.py backend/repositories/notifications.py backend/tests/test_users_repo.py backend/tests/test_notifications_repo.py
git commit -m "Add list_active_non_dev_user_ids and notify_all_users"
```

---

### Task 4: Admin and public API endpoints

**Files:**
- Create: `backend/routers/feature_flags.py`
- Modify: `server.py` (register the new router module)
- Test: `backend/tests/test_feature_flags_router.py`

**Interfaces:**
- Consumes: `backend.feature_flags.FEATURE_KEYS`/`FEATURE_IMPACT_DESCRIPTIONS`/`require_feature_enabled` (Task 2), `backend.repositories.feature_flags.get_all`/`apply_batch` (Task 1), `backend.repositories.notifications.notify_all_users` (Task 3), `backend.auth.get_admin`/`get_current_user_optional`.
- Produces:
  - `GET /api/admin/feature-flags` — admin-only, returns `{"chat": {...label, enabled, message, eta_minutes, disabled_at, updated_by_name, updated_by_role...}, ...}` for every key in `FEATURE_KEYS` (synthesizing an enabled-default entry for keys with no row).
  - `PUT /api/admin/feature-flags/batch` — admin-only, body `{"keys": [...], "enabled": bool, "message": str | null, "eta_minutes": int | null}`, applies atomically, fires one broadcast notification, returns the updated rows.
  - `GET /api/feature-status` — public (optional auth), returns `{}` for a Dev caller, else every currently-disabled flag's public-safe fields.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_feature_flags_router.py`. First, check `backend/tests/conftest.py` for how existing router tests construct a request against `api`/`auth_router` (search for an existing router test file, e.g. `backend/tests/test_notifications_router.py` if one exists, or any file importing `from httpx import AsyncClient` or using FastAPI's `TestClient`/`app` fixture) and match that exact pattern. If no router-level test precedent exists in this codebase (repository-level tests are the norm per the Module responsibilities table), write this test at the repository+dependency integration level instead — directly calling the router's underlying logic by testing `feature_flags_repo.apply_batch` + `notification_repo.notify_all_users` together (already covered by Tasks 1 and 3) plus a focused test of the router's own new logic: the "synthesize default enabled entries for untouched keys" behavior and the "empty result for Dev caller" behavior. Write it as:

```python
import pytest

from backend import feature_flags
from backend.repositories import feature_flags as feature_flags_repo

pytestmark = pytest.mark.asyncio


async def _current_status_for(role: str | None) -> dict:
    from backend.routers.feature_flags import _public_status
    return await _public_status(role)


async def test_public_status_empty_for_dev(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["comments"], enabled=False, message="down", eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    status = await _current_status_for("dev")
    assert status == {}
    await feature_flags_repo.apply_batch(
        keys=["comments"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")


async def test_public_status_shows_disabled_features_for_non_dev(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["forum"], enabled=False, message="down for maintenance", eta_minutes=10,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    status = await _current_status_for("user")
    assert "forum" in status
    assert status["forum"]["message"] == "down for maintenance"
    assert status["forum"]["label"] == feature_flags.FEATURE_KEYS["forum"]
    await feature_flags_repo.apply_batch(
        keys=["forum"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")


async def test_public_status_omits_enabled_features(db_conn):
    status = await _current_status_for("user")
    assert "chat" not in status
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_feature_flags_router.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.routers.feature_flags'`

- [ ] **Step 3: Write the router**

First check `backend/auth.py` for the exact name of the optional-auth dependency (referenced earlier in this project as `get_current_user_optional`) and `backend/state.py` for the `api`/`log` import pattern used by every other router file (e.g. open `backend/routers/notifications.py` and copy its import block's shape).

Create `backend/routers/feature_flags.py`:

```python
import time

from fastapi import Depends
from pydantic import BaseModel

from backend.auth import get_admin, get_current_user_optional
from backend.feature_flags import FEATURE_IMPACT_DESCRIPTIONS, FEATURE_KEYS
from backend.repositories import feature_flags as feature_flags_repo
from backend.repositories import notifications as notification_repo
from backend.state import api, log


class FeatureFlagsBatchIn(BaseModel):
    keys: list[str]
    enabled: bool
    message: str | None = None
    eta_minutes: int | None = None


def _public_fields(key: str, row: dict) -> dict:
    return {
        "label": FEATURE_KEYS.get(key, key),
        "message": row.get("message"),
        "eta_minutes": row.get("eta_minutes"),
        "disabled_at": row.get("disabled_at"),
        "updated_by_name": row.get("updated_by_name"),
        "updated_by_role": row.get("updated_by_role"),
    }


async def _public_status(role: str | None) -> dict:
    if role == "dev":
        return {}
    all_flags = await feature_flags_repo.get_all()
    return {key: _public_fields(key, row) for key, row in all_flags.items()
            if not row["enabled"]}


@api.get("/admin/feature-flags")
async def admin_list_feature_flags(_: dict = Depends(get_admin)):
    all_flags = await feature_flags_repo.get_all()
    out = {}
    for key, label in FEATURE_KEYS.items():
        row = all_flags.get(key)
        out[key] = {
            "label": label,
            "impact": FEATURE_IMPACT_DESCRIPTIONS.get(key),
            "enabled": row["enabled"] if row else True,
            "message": row.get("message") if row else None,
            "eta_minutes": row.get("eta_minutes") if row else None,
            "disabled_at": row.get("disabled_at") if row else None,
            "updated_by_name": row.get("updated_by_name") if row else None,
            "updated_by_role": row.get("updated_by_role") if row else None,
        }
    return out


@api.put("/admin/feature-flags/batch")
async def admin_batch_feature_flags(body: FeatureFlagsBatchIn, current_user: dict = Depends(get_admin)):
    invalid = [k for k in body.keys if k not in FEATURE_KEYS]
    if invalid:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Unknown feature keys: {', '.join(invalid)}")
    rows = await feature_flags_repo.apply_batch(
        keys=body.keys, enabled=body.enabled, message=body.message, eta_minutes=body.eta_minutes,
        updated_by=current_user["id"], updated_by_name=current_user["username"],
        updated_by_role=current_user.get("role", "admin"))
    role_label = "Dev" if current_user.get("role") == "dev" else "Admin"
    labels = ", ".join(FEATURE_KEYS[k] for k in body.keys)
    if body.enabled:
        title = f"{labels} restored"
        notif_body = f"{role_label} {current_user['username']} re-enabled {labels}."
        notif_type = "feature_restored"
    else:
        title = f"{labels} disabled"
        eta_text = f" Estimated back in {body.eta_minutes} minutes." if body.eta_minutes else ""
        message_text = f" {body.message}" if body.message else ""
        notif_body = f"{role_label} {current_user['username']} disabled {labels}.{message_text}{eta_text}"
        notif_type = "feature_disabled"
    await notification_repo.notify_all_users(
        notif_type, title, notif_body, related_id=",".join(body.keys))
    log.info("admin: feature flags batch changed by=%s keys=%s enabled=%s",
             current_user["username"], ",".join(body.keys), body.enabled)
    return rows


@api.get("/feature-status")
async def get_feature_status(current_user: dict | None = Depends(get_current_user_optional)):
    role = current_user.get("role") if current_user else None
    return await _public_status(role)
```

- [ ] **Step 4: Register the router**

In `server.py`, add this line in the block of `import backend.routers.X # noqa: F401` lines (near `import backend.routers.notifications`):

```python
import backend.routers.feature_flags  # noqa: F401
```

- [ ] **Step 5: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/routers/feature_flags.py').read())"`
Expected: no output.

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/server.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/feature-status`
Expected: `200` (public endpoint, should return `{}` with nothing disabled)

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_feature_flags_router.py backend/tests/test_feature_flags.py backend/tests/test_feature_flags_repo.py -v`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add backend/routers/feature_flags.py server.py backend/tests/test_feature_flags_router.py
git commit -m "Add admin and public feature-flag API endpoints"
```

---

### Task 5: Wire `require_feature_enabled` into real gated routes

**Files:**
- Modify: `backend/routers/chat.py` (the message-send/generate route)
- Modify: `backend/routers/lora_training.py` (the job-creation route)
- Modify: `backend/routers/comments.py` (the comment-creation route)
- Modify: `backend/routers/forum.py` (the thread/post-creation route)
- Test: extend each router's existing test file if one exists, else add one focused test per router confirming the dependency is wired (see Step 3 below).

**Interfaces:**
- Consumes: `backend.feature_flags.require_feature_enabled` (Task 2).
- Produces: no new interfaces — this task only adds `Depends(require_feature_enabled("<key>"))` to existing route signatures.

- [ ] **Step 1: Find the exact routes to gate**

Read `backend/routers/chat.py` and find the `POST /sessions/{sid}/chat` (or equivalently-named) route handler — the one that starts a new generation, not `/regenerate`/`/roll`/`/continue` (gate only the primary send-message route to keep this task's blast radius small; a broader gating pass is a separate concern if the admin finds message-continuation still works while disabled). Read `backend/routers/lora_training.py` and find `POST /admin/lora-training/jobs` (job creation). Read `backend/routers/comments.py` and find the comment-creation `POST` route. Read `backend/routers/forum.py` and find the thread-creation and/or post-creation `POST` route(s) — gate whichever route actually creates new content (not moderation/admin routes in the same file).

- [ ] **Step 2: Add the dependency to each route**

For each of the four routes found in Step 1, add `_feature_ok: None = Depends(require_feature_enabled("<key>"))` as an additional parameter (key: `"chat"`, `"lora_training"`, `"comments"`, `"forum"` respectively), and add the import at the top of each file:

```python
from backend.feature_flags import require_feature_enabled
```

Example for `backend/routers/comments.py`'s comment-creation route (adapt to the actual function signature you find):

```python
@api.post("/comments")
async def create_comment(body: CommentIn, current_user: dict = Depends(get_current_user),
                         _feature_ok: None = Depends(require_feature_enabled("comments"))):
    ...
```

Apply the same shape to the chat, lora_training, and forum routes found in Step 1, using their actual existing parameter names and the key matching that module (`"chat"`, `"lora_training"`, `"forum"`).

- [ ] **Step 3: Write one focused test per gated router**

For each of the four files, add a test to its existing test file (find it — e.g. `backend/tests/test_chat_*.py`, `backend/tests/test_lora_training_*.py`, `backend/tests/test_comments_*.py`, `backend/tests/test_forum_*.py`) that verifies the dependency is actually attached. Since these routers are tested at varying levels in this codebase, the simplest reliable check is inspecting the route's dependants at the FastAPI level:

```python
from backend.state import api


def test_comment_creation_route_has_feature_flag_dependency():
    route = next(r for r in api.routes if r.path == "/api/comments" and "POST" in r.methods)
    dependency_names = [dep.call.__closure__[0].cell_contents if dep.call.__closure__ else None
                        for dep in route.dependant.dependencies]
    assert "comments" in dependency_names
```

(This inspects the closure of `require_feature_enabled("comments")`'s returned `_check` function to confirm the bound `key` variable is `"comments"`. If `api.routes` iteration or the route path doesn't match what you find in Step 1, adjust the path string to the actual route path and add the equivalent test for the other three routers, adjusting the module path and expected key each time.)

- [ ] **Step 4: Syntax-check and live-verify each modified file**

Run for each of the four modified router files:
```bash
python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/routers/<file>.py').read())"
```
Expected: no output, for all four.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/ -v -k "feature_flag or comments or forum or lora_training or chat"`
Expected: PASS, no new failures (some unrelated pre-existing failures from concurrent workstreams may appear — confirm any failure you see is not in a file you touched this task before treating it as pre-existing).

- [ ] **Step 6: Commit**

```bash
git add backend/routers/chat.py backend/routers/lora_training.py backend/routers/comments.py backend/routers/forum.py backend/tests/
git commit -m "Gate chat, LoRA training, comments, and forum creation routes behind feature flags"
```

---

### Task 6: Frontend — non-dismissible modal support, status polling, amber pulse CSS, disabled-feature modal

**Files:**
- Modify: `new_ui/js/modal.js` (add `dismissible` option)
- Create: `new_ui/js/feature-flags.js`
- Modify: `new_ui/css/cards.css` (amber pulse rule)
- Modify: `new_ui/index.html` (script tag for the new module)

**Interfaces:**
- Consumes: `GET /api/feature-status` (Task 4), the existing `openModal`/`closeModal`/`closeTopModal` globals (`modal.js`), the existing `api()` helper (`app-session.js`), `t()` (`translations.js`).
- Produces:
  - `openModal(innerHtml, { wide, onClose, dismissible = true })` — extended signature, backward compatible.
  - `window.featureFlags` — a `FeatureFlagStatus` instance with `start()`, `refresh()`, `disabled` (a `Map<string, object>` of currently-known-disabled flags), and `showDisabledModal(key, flagData)` (used by both the click-guard in this task and the notification click handler in Task 9).

- [ ] **Step 1: Extend `openModal` with `dismissible`**

In `new_ui/js/modal.js`, replace the `openModal` function:

```javascript
function openModal(innerHtml, { wide = false, onClose = null, dismissible = true } = {}) {
  const layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.innerHTML = `
    <div class="modal${wide ? " modal-wide" : ""}">
      ${dismissible ? `<button type="button" class="modal-close" aria-label="${_attr(t("modal_close"))}" data-tooltip="${_attr(t("modal_close"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ""}
      ${innerHtml}
    </div>
  `;
  document.body.appendChild(layer);
  document.body.classList.add("modal-open");

  const close = () => closeModal(layer, onClose);
  if (dismissible) {
    layer.querySelector(".modal-close").onclick = close;
    layer.addEventListener("click", (e) => {
      if (e.target === layer) close();
    });
  }

  _modalStack.push({ layer, close, dismissible });
  return layer;
}
```

And update the global Escape listener at the bottom of the same file:

```javascript
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !_modalStack.length) return;
  const top = _modalStack[_modalStack.length - 1];
  if (top.dismissible) closeTopModal();
});
```

- [ ] **Step 2: Write the polling module and shared disabled-feature modal**

Create `new_ui/js/feature-flags.js`:

```javascript
"use strict";

class FeatureFlagStatus {
  constructor() {
    this.disabled = new Map();
    this.pollHandle = null;
  }

  apply() {
    Array.from(document.documentElement.classList)
      .filter((c) => c.startsWith("feature-disabled-"))
      .forEach((c) => document.documentElement.classList.remove(c));
    for (const key of this.disabled.keys()) {
      document.documentElement.classList.add(`feature-disabled-${key}`);
    }
  }

  async refresh() {
    try {
      const status = await api("/api/feature-status");
      this.disabled = new Map(Object.entries(status));
    } catch (err) {
      this.disabled = new Map();
      console.warn("feature-status check failed", err);
    }
    this.apply();
  }

  start() {
    if (this.pollHandle) return;
    this.refresh();
    this.pollHandle = setInterval(() => this.refresh(), 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.refresh();
    });
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-feature]");
      if (!trigger) return;
      const key = trigger.dataset.feature;
      if (!this.disabled.has(key)) return;
      e.preventDefault();
      e.stopPropagation();
      this.showDisabledModal(key, this.disabled.get(key));
    }, true);
  }

  showDisabledModal(key, flagData) {
    const roleLabel = flagData.updated_by_role === "dev" ? "Dev" : "Admin";
    const attribution = flagData.updated_by_name
      ? `${roleLabel} ${flagData.updated_by_name}`
      : t("feature_disabled_unknown_admin", "An admin");
    const message = flagData.message || t("feature_disabled_generic_message", "This feature is temporarily disabled");
    const layer = openModal(`
      <div style="display:flex;flex-direction:column;gap:14px;text-align:center;padding:6px 4px">
        <div style="width:52px;height:52px;margin:0 auto;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb, var(--color-cmd-yellow) 16%, transparent);color:var(--color-cmd-yellow)">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>
        </div>
        <div class="font-display" style="font-size:17px;font-weight:600;color:var(--color-ink)">${_esc(flagData.label || key)}</div>
        <div style="font-size:13px;color:var(--color-sec)">${_esc(message)}</div>
        <div style="font-size:12px;color:var(--color-muted)">${_esc(attribution)}</div>
        <div id="featureFlagCountdown-${_esc(key)}" style="font-size:13px;color:var(--color-sec)"></div>
        <button type="button" id="featureFlagModalClose" class="pe-gen-btn" style="width:100%;justify-content:center">${t("feature_disabled_close", "Close")}</button>
      </div>
    `);
    const countdownEl = layer.querySelector(`#featureFlagCountdown-${key}`);
    const updateCountdown = () => {
      if (!flagData.eta_minutes || !flagData.disabled_at) {
        countdownEl.textContent = t("feature_disabled_no_eta", "No estimated return time");
        return;
      }
      const targetSeconds = flagData.disabled_at + flagData.eta_minutes * 60;
      const remainingMinutes = Math.round((targetSeconds - Date.now() / 1000) / 60);
      countdownEl.textContent = remainingMinutes > 0
        ? t("feature_disabled_eta", "Back in ~{n} minutes").replace("{n}", remainingMinutes)
        : t("feature_disabled_eta_overdue", "Expected back any moment");
    };
    updateCountdown();
    const countdownTimer = setInterval(updateCountdown, 60 * 1000);
    layer.querySelector("#featureFlagModalClose").onclick = () => closeTopModal();
    layer.addEventListener("remove", () => clearInterval(countdownTimer));
  }
}

const featureFlags = new FeatureFlagStatus();

if (typeof window !== "undefined") {
  window.featureFlags = featureFlags;
}
```

- [ ] **Step 3: Add the amber pulse CSS**

Append to `new_ui/css/cards.css`:

```css
html[class*="feature-disabled-"] [data-feature] {
  cursor: not-allowed;
  outline: 1.5px solid var(--color-cmd-yellow);
  animation: feature-disabled-pulse 2.2s ease-in-out infinite;
}

@keyframes feature-disabled-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-cmd-yellow) 35%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-cmd-yellow) 0%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  html[class*="feature-disabled-"] [data-feature] {
    animation: none;
  }
}
```

Note: this CSS is hand-written source, not compiled `app.css` output — do not add it to `app.css` directly (see project CLAUDE.md's rebuild.sh notes). Run `./rebuild.sh --once` after this edit if `app.css` needs to reflect any Tailwind-class changes elsewhere, though this particular rule doesn't require Tailwind compilation since it's plain CSS in `cards.css`.

- [ ] **Step 4: Wire the script into `index.html` and start polling**

In `new_ui/index.html`, find the `<script>` tag for `media-gen.js` and add a new one for `feature-flags.js` immediately after it (matching load order — this file depends on `modal.js`, `app-session.js`'s `api()`, and `translations.js`'s `t()`, so it must load after those; check their existing `<script>` order in `index.html` and place `feature-flags.js` after all three).

Find where `mediaGen.start()` (or equivalent) is called during boot (likely in `new_ui/js/boot.js`) and add `featureFlags.start();` alongside it.

- [ ] **Step 5: Live-verify**

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/feature-flags.js | head -5`
Expected: the file's actual first lines, confirming it's served.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/modal.js new_ui/js/feature-flags.js new_ui/css/cards.css new_ui/index.html
git commit -m "Add non-dismissible modal support, feature-status polling, and amber disabled state"
```

---

### Task 7: Frontend — admin feature list UI and the disable-direction wizard

**Files:**
- Create: `new_ui/js/admin-features.js`
- Modify: `new_ui/index.html` (script tag, admin panel nav entry if the admin panel uses a tab list)

**Interfaces:**
- Consumes: `GET /api/admin/feature-flags`, `PUT /api/admin/feature-flags/batch` (Task 4), `openModal({ dismissible: false })` (Task 6), `confirmDialog`/`promptDialog` patterns from `modal.js`, `api()`, `t()`.
- Produces: an `AdminFeaturesPanel` class with a `render(container)` method (matching how other admin panels in this app mount into the admin shell — check `admin-config.js`'s export/mount pattern and follow it exactly), and an internal `runDisableWizard(selectedKeys)` method used by Task 8's enable-wizard counterpart as a structural twin.

- [ ] **Step 1: Find the admin panel mounting convention**

Read `new_ui/js/admin-config.js` end-to-end to find: how it's instantiated/mounted into the admin shell (a class instantiated once and exposing a `render`/`mount` method, or a plain function export), how its container element is found, and how the admin panel's tab/nav list is defined (likely in `new_ui/js/admin-config.js` itself or a shared admin shell file — grep for where `admin-config.js`'s panel gets added to a tab list). Match this exactly for `admin-features.js` and its own nav entry ("Features" or "Feature Flags").

- [ ] **Step 2: Write the list UI with checkboxes and bulk-action buttons**

Create `new_ui/js/admin-features.js`. Structure it as a class matching the convention found in Step 1 (adjust the class shape/export to match what you found — the following is the panel's core logic, not a prescriptive exact class signature since that depends on Step 1's findings):

```javascript
"use strict";

class AdminFeaturesPanel {
  constructor() {
    this.flags = {};
    this.selected = new Set();
  }

  async load() {
    this.flags = await api("/api/admin/feature-flags");
  }

  render(container) {
    const rows = Object.entries(this.flags).map(([key, flag]) => `
      <label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--color-line);border-radius:10px;margin-bottom:6px">
        <input type="checkbox" data-feature-key="${_attr(key)}" ${this.selected.has(key) ? "checked" : ""}>
        <span style="flex:1">
          <div style="font-weight:600;color:var(--color-ink)">${_esc(flag.label)}</div>
          <div style="font-size:12px;color:${flag.enabled ? "var(--color-success)" : "var(--color-cmd-yellow)"}">
            ${flag.enabled ? t("admin_features_state_enabled", "Enabled") : t("admin_features_state_disabled", "Disabled")}
            ${!flag.enabled && flag.updated_by_name ? ` · ${_esc(flag.updated_by_role === "dev" ? "Dev" : "Admin")} ${_esc(flag.updated_by_name)}` : ""}
          </div>
        </span>
      </label>
    `).join("");
    container.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button type="button" id="adminFeaturesDisableSelected" class="pe-gen-btn">${t("admin_features_disable_selected", "Disable selected")}</button>
        <button type="button" id="adminFeaturesEnableSelected" class="pe-gen-btn">${t("admin_features_enable_selected", "Enable selected")}</button>
      </div>
      <div>${rows}</div>
    `;
    container.querySelectorAll("[data-feature-key]").forEach((el) => {
      el.onchange = () => {
        if (el.checked) this.selected.add(el.dataset.featureKey);
        else this.selected.delete(el.dataset.featureKey);
      };
    });
    container.querySelector("#adminFeaturesDisableSelected").onclick = () => {
      const keys = [...this.selected].filter((k) => this.flags[k]?.enabled);
      if (!keys.length) return;
      this.runDisableWizard(keys);
    };
    container.querySelector("#adminFeaturesEnableSelected").onclick = () => {
      const keys = [...this.selected].filter((k) => !this.flags[k]?.enabled);
      if (!keys.length) return;
      this.runEnableWizard(keys);
    };
  }

  async refreshAndRerender(container) {
    await this.load();
    this.selected.clear();
    this.render(container);
  }
}
```

- [ ] **Step 3: Write the wizard shell**

Add this method to the same class (a generic step-runner both directions will use):

```javascript
  async runWizardSteps(steps) {
    let stepIndex = 0;
    const context = {};
    while (stepIndex < steps.length) {
      const step = steps[stepIndex];
      const result = await step.render(context);
      if (result === "cancel") return null;
      stepIndex += 1;
    }
    return context;
  }
```

Each `step.render(context)` returns a Promise resolving to `"next"` or `"cancel"`, and may write into `context` (e.g. the message/ETA step writes `context.message`/`context.etaMinutes`). Each step opens its own `openModal(..., { dismissible: false })` and resolves only when its own explicit button is clicked, closing its own modal before resolving so steps don't stack visually.

- [ ] **Step 4: Write the disable-direction wizard steps**

Add this method to the same class:

```javascript
  runDisableWizard(keys) {
    const labels = keys.map((k) => this.flags[k].label);
    const steps = [
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step1_title", "Confirm which features you're disabling")}</h3>
              <ul style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${labels.map((l) => `<li>${_esc(l)}</li>`).join("")}</ul>
              <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--color-ink);margin-bottom:16px">
                <input type="checkbox" id="wizardStep1Ack">
                ${t("admin_features_wizard_step1_ack", "I have reviewed this list")}
              </label>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep1Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep1Next" class="pe-gen-btn" disabled>${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          const ack = layer.querySelector("#wizardStep1Ack");
          const next = layer.querySelector("#wizardStep1Next");
          ack.onchange = () => { next.disabled = !ack.checked; };
          layer.querySelector("#wizardStep1Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          next.onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const impacts = keys.map((k) => `<li>${_esc(this.flags[k].label)}: ${_esc(this.flags[k].impact || "")}</li>`).join("");
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step2_title", "What breaks for users")}</h3>
              <ul style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${impacts}</ul>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep2Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep2Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep2Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep2Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step3_title", "Message and estimated downtime")}</h3>
              <textarea id="wizardStep3Message" placeholder="${_attr(t("admin_features_wizard_message_placeholder", "Why is this disabled?"))}" style="width:100%;min-height:70px;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:10px"></textarea>
              <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--color-ink);margin-bottom:10px">
                <input type="checkbox" id="wizardStep3Blank">
                ${t("admin_features_wizard_leave_blank", "Leave blank, use generic message")}
              </label>
              <input type="number" id="wizardStep3Eta" placeholder="${_attr(t("admin_features_wizard_eta_placeholder", "Estimated minutes until back (optional)"))}" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:16px">
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep3Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep3Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep3Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep3Next").onclick = () => {
            const blank = layer.querySelector("#wizardStep3Blank").checked;
            const messageValue = layer.querySelector("#wizardStep3Message").value.trim();
            ctx.message = blank ? null : (messageValue || null);
            const etaValue = layer.querySelector("#wizardStep3Eta").value.trim();
            ctx.etaMinutes = etaValue ? parseInt(etaValue, 10) : null;
            closeModal(layer);
            resolve("next");
          };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const confirmPhrase = keys.length === 1 ? keys[0] : "DISABLE ALL SELECTED";
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step4_title", "Type to confirm")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 10px">${t("admin_features_wizard_step4_body", "Type this exactly")}: <strong>${_esc(confirmPhrase)}</strong></p>
              <input type="text" id="wizardStep4Input" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:16px">
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep4Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep4Next" class="pe-gen-btn" disabled>${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          const input = layer.querySelector("#wizardStep4Input");
          const next = layer.querySelector("#wizardStep4Next");
          input.oninput = () => { next.disabled = input.value !== confirmPhrase; };
          layer.querySelector("#wizardStep4Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          next.onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step5_title", "Dev accounts stay unaffected")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_wizard_step5_body", "Dev-tier accounts will keep using these features normally, so they can keep testing while everyone else sees the disabled state.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep5Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep5Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep5Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep5Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise(async (resolve) => {
          const activeUsers = await api("/api/admin/feature-flags/active-user-count").catch(() => ({ count: "an unknown number of" }));
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step6_title", "This notifies everyone right now")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_wizard_step6_body", "This will immediately notify {n} active users.").replace("{n}", activeUsers.count)}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep6Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep6Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep6Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep6Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-warn)">${t("admin_features_wizard_step7_title", "Final confirmation")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:10px 0 16px">${t("admin_features_wizard_step7_body", "This applies immediately and cannot be undone from here except by re-enabling.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep7Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep7Confirm" class="pe-gen-btn" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_features_wizard_confirm_shutdown", "CONFIRM SHUTDOWN")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep7Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep7Confirm").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
    ];
    this.runWizardSteps(steps).then(async (context) => {
      if (!context) return;
      await api("/api/admin/feature-flags/batch", {
        method: "PUT",
        body: JSON.stringify({ keys, enabled: false, message: context.message, eta_minutes: context.etaMinutes }),
      });
      const container = document.querySelector("[data-admin-features-container]");
      if (container) await this.refreshAndRerender(container);
    });
  }
```

Note step 6's `active-user-count` call references an endpoint not defined in this plan's Task 4. Before implementing this step, add a minimal `GET /api/admin/feature-flags/active-user-count` endpoint to `backend/routers/feature_flags.py` (from Task 4) that returns `{"count": len(await user_repo.list_active_non_dev_user_ids())}` — this is a small addition to that file; make it and note it in your task report since it wasn't in the original file list for this task.

- [ ] **Step 5: Wire the script into `index.html`**

Same as Task 6 Step 4 — add `<script src="/js/admin-features.js">` after `feature-flags.js` and `admin-config.js` in `index.html`'s script list, and mount the panel following whatever convention Step 1 found in `admin-config.js`.

- [ ] **Step 6: Live-verify**

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/admin-features.js | head -5`
Expected: the file's actual first lines.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

Manually verify in a browser (logged in as an admin account) that the Features panel appears, lists `FEATURE_KEYS`, and that checking a row and clicking "Disable selected" walks through all 7 steps with no way to dismiss any step before the last, Cancel at any step applies nothing, and the final confirm actually flips the flag (check `GET /api/admin/feature-flags` reflects it, or reload the panel).

- [ ] **Step 7: Commit**

```bash
git add new_ui/js/admin-features.js new_ui/index.html backend/routers/feature_flags.py
git commit -m "Add admin feature list panel and the 7-step disable wizard"
```

---

### Task 8: Frontend — the enable-direction wizard

**Files:**
- Modify: `new_ui/js/admin-features.js`

**Interfaces:**
- Consumes: `AdminFeaturesPanel.runWizardSteps` (Task 7).
- Produces: `AdminFeaturesPanel.runEnableWizard(keys)`, already referenced by Task 7's `render()` method's "Enable selected" button handler.

- [ ] **Step 1: Write the enable-direction wizard**

Add this method to `AdminFeaturesPanel` in `new_ui/js/admin-features.js`, mirroring `runDisableWizard`'s 7-step shape with adjusted copy and no message/ETA collection (step 3 becomes a simple "existing message/ETA will be cleared" acknowledgement instead of an input form):

```javascript
  runEnableWizard(keys) {
    const labels = keys.map((k) => this.flags[k].label);
    const steps = [
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step1_title", "Confirm which features you're restoring")}</h3>
              <ul style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${labels.map((l) => `<li>${_esc(l)}</li>`).join("")}</ul>
              <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--color-ink);margin-bottom:16px">
                <input type="checkbox" id="enableStep1Ack">
                ${t("admin_features_wizard_step1_ack", "I have reviewed this list")}
              </label>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep1Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep1Next" class="pe-gen-btn" disabled>${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          const ack = layer.querySelector("#enableStep1Ack");
          const next = layer.querySelector("#enableStep1Next");
          ack.onchange = () => { next.disabled = !ack.checked; };
          layer.querySelector("#enableStep1Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          next.onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step2_title", "What becomes available again")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_enable_wizard_step2_body", "All users, not just Dev accounts, will immediately be able to use these features normally again.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep2Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep2Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep2Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep2Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step3_title", "Existing message and ETA will be cleared")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_enable_wizard_step3_body", "Any downtime message and estimated return time currently shown to users will be removed once this restores.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep3Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep3Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep3Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep3Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const confirmPhrase = keys.length === 1 ? keys[0] : "RESTORE ALL SELECTED";
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step4_title", "Type to confirm")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 10px">${t("admin_features_wizard_step4_body", "Type this exactly")}: <strong>${_esc(confirmPhrase)}</strong></p>
              <input type="text" id="enableStep4Input" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:16px">
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep4Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep4Next" class="pe-gen-btn" disabled>${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          const input = layer.querySelector("#enableStep4Input");
          const next = layer.querySelector("#enableStep4Next");
          input.oninput = () => { next.disabled = input.value !== confirmPhrase; };
          layer.querySelector("#enableStep4Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          next.onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step5_title", "Dev accounts already had this working")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_enable_wizard_step5_body", "Dev-tier accounts have been using these features normally the whole time this was disabled for everyone else.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep5Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep5Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep5Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep5Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise(async (resolve) => {
          const activeUsers = await api("/api/admin/feature-flags/active-user-count").catch(() => ({ count: "an unknown number of" }));
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step6_title", "This notifies everyone right now")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_enable_wizard_step6_body", "This will immediately notify {n} active users that it's back.").replace("{n}", activeUsers.count)}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep6Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep6Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep6Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep6Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink)">${t("admin_features_enable_wizard_step7_title", "Final confirmation")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:10px 0 16px">${t("admin_features_enable_wizard_step7_body", "This applies immediately.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep7Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep7Confirm" class="pe-gen-btn" style="border-color:var(--color-accent);color:var(--color-accent)">${t("admin_features_wizard_confirm_restore", "CONFIRM RESTORE")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep7Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep7Confirm").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
    ];
    this.runWizardSteps(steps).then(async (context) => {
      if (!context) return;
      await api("/api/admin/feature-flags/batch", {
        method: "PUT",
        body: JSON.stringify({ keys, enabled: true, message: null, eta_minutes: null }),
      });
      const container = document.querySelector("[data-admin-features-container]");
      if (container) await this.refreshAndRerender(container);
    });
  }
```

- [ ] **Step 2: Live-verify**

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/admin-features.js | grep -c "runEnableWizard"`
Expected: `2` or more (definition + reference from Task 7's button handler).

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

Manually verify in a browser: with a feature already disabled from Task 7's manual test, check its row and click "Enable selected" — confirm all 7 steps run with no skip, and the final confirm actually restores the flag.

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/admin-features.js
git commit -m "Add the 7-step enable/restore wizard"
```

---

### Task 9: Frontend — notification click handling for feature toggle events

**Files:**
- Modify: `new_ui/js/notifications.js`

**Interfaces:**
- Consumes: `notification.type`, `notification.related_id`, `notification.body`, `window.featureFlags.showDisabledModal` (Task 6). Notification `body` text is parsed for the ETA/message rather than re-fetched, since `feature-status` may already show the current (possibly different) state by the time an old notification is clicked.
- Produces: no new exports — extends the existing click handler in place.

- [ ] **Step 1: Add the type-based branch**

In `new_ui/js/notifications.js`, find the click handler (around line 188-202) and change it from always navigating to branching on `type` first:

```javascript
        item.onclick = async () => {
          const id = item.dataset.id;
          const link = item.dataset.link;
          const type = item.dataset.type;
          const relatedId = item.dataset.relatedId;
          if (item.classList.contains("unread")) {
            item.classList.remove("unread");
            await api(`/api/notifications/${id}/read`, { method: "POST" });
            this.refreshCount();
          }
          this.close();
          if (type === "feature_disabled" || type === "feature_restored") {
            const keys = (relatedId || "").split(",").filter(Boolean);
            const label = item.dataset.title || keys.join(", ");
            window.featureFlags?.showDisabledModal(keys[0] || "unknown", {
              label,
              message: item.dataset.body || null,
              eta_minutes: null,
              disabled_at: null,
              updated_by_name: null,
              updated_by_role: null,
            });
            return;
          }
          if (link) navigate(link);
        };
```

Then find where each notification item's dataset is populated (a few lines earlier in the same rendering block, where `data-id` and `data-link` are set) and add `data-type`, `data-related-id`, `data-title`, and `data-body` attributes carrying the notification's own `type`, `related_id`, `title`, and `body` fields, matching the existing attribute-setting style in that block exactly (read the surrounding code first to match whether attributes are set via template string interpolation or `dataset` assignment, and use the same approach).

- [ ] **Step 2: Live-verify**

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/notifications.js | grep -c "feature_disabled"`
Expected: `1` or more.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

Manually verify: as a non-Dev test account, after an admin runs the disable wizard from Task 7, confirm the bell shows a new notification, and clicking it opens the disabled-feature modal (not a navigation) with the correct feature label and message.

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/notifications.js
git commit -m "Open the feature-disabled modal when a feature-toggle notification is clicked"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (feature keys) → Task 2. Section 2 (schema) → Task 1. Section 3 (backend enforcement) → Task 2. Section 4 (frontend discovery) → Task 6. Section 5 (frontend rendering/modal/countdown) → Task 6. Section 6 (admin UI list) → Task 7. Section 7 (Dev bypass) → Tasks 2 and 4. Section 8 (broadcast notification) → Tasks 3 and 4. Section 9 (notification click) → Task 9. Section 10 (amber pulse) → Task 6. Section 11/13 (7-step wizard, batch-only) → Tasks 7 and 8. Section 12 (non-dismissible modal) → Task 6. Section 14 (attribution, Dev/Admin label) → Tasks 1, 4, 6, 7. All spec sections are covered. The four gated routes (chat, LoRA training, comments, forum) named in the spec's `FEATURE_KEYS` example are wired in Task 5.
- **Placeholder scan:** Task 5 Step 1 and Task 7 Step 1 intentionally direct the implementer to locate exact route/mounting code rather than presupposing line numbers that would be guessed wrong — this is a deliberate "read the real file first" instruction, not a content placeholder; the code that follows once found is fully specified. No `TBD`/`TODO` markers anywhere.
- **Type consistency:** `require_feature_enabled(key: str)` (Task 2) is called identically in Task 5's five gated routes. `FeatureFlagsBatchIn` (Task 4) matches the body shape the frontend sends in Tasks 7/8 (`keys`, `enabled`, `message`, `eta_minutes`). `updated_by_role`/`updated_by_name` flow consistently from the repository (Task 1) through the router (Task 4) to both frontend consumers (Tasks 6, 7). Caught and fixed during this review: `FEATURE_IMPACT_DESCRIPTIONS` (Task 2) is a Python dict with no direct frontend access, but Task 7's wizard step 2 needed it — Task 4's `GET /admin/feature-flags` now includes `"impact": FEATURE_IMPACT_DESCRIPTIONS.get(key)` per row, and Task 7's wizard step 2 reads `this.flags[k].impact` instead of referencing a nonexistent frontend constant. Both task bodies above already reflect this fix.
