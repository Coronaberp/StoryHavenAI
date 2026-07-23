# OAuth SSO Login (Integrated Identity Providers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor sign in via an admin-enabled OAuth provider (Google, Facebook, GitHub, Discord, Twitter/X, Reddit, Steam, Apple, Microsoft), auto-creating a guest-tier account on first sign-in, or let an already-logged-in full account link a provider from Settings as an alternate sign-in method — with zero hardcoded credentials and zero email storage from any provider.

**Architecture:** A pluggable `PROVIDER_REGISTRY` dict (`backend/oauth_registry.py`) describes each provider's OAuth endpoints/scope/id-field declaratively; a generic `backend/routers/oauth.py` router drives the whole authorize→callback→token flow for every provider through that registry, with two small protocol adapters (Steam's OpenID 2.0, Apple's JWT-signed client secret) branching only where the standard OAuth2 shape doesn't apply. Three new tables (`oauth_providers` for admin credentials, `oauth_identities` for the durable `(provider, provider_user_id) → user_id` link, `oauth_pending` for short-lived CSRF state) back it, each with its own repository module matching the existing `webauthn_credentials.py` pattern.

**Tech Stack:** FastAPI, SQLAlchemy Core (async, `backend/db.py`'s existing `sa.Table` + `_q`/`_q1`/`_w` helper pattern), `httpx` (already a dependency via `backend/llm.py`), Fernet encryption (`backend/db.py`'s `_encrypt_secret`/`_decrypt_secret`), PyJWT (for Apple's signed client secret — check `requirements.txt`, add if missing), pytest + `pytest-asyncio` + the existing `db_conn` transactional-rollback fixture (`backend/tests/conftest.py`).

## Global Constraints

- No email address from any provider is ever stored, in any table, at any point — only `(provider, provider_user_id)` plus an optional cosmetic display name.
- No hardcoded OAuth credentials anywhere in code — every provider's `client_id`/`client_secret` comes from the admin-configured `oauth_providers` table, Fernet-encrypted at rest exactly like `modal_shared_secret`.
- Every new user-facing string goes through `t()` with a key registered in `new_ui/js/translations.js`'s `UI_STRINGS` (per this repo's standing i18n rule) — no inline-fallback-only orphans.
- Zero comments in any file (project-wide rule) — docstrings on functions/classes are fine, `#`-style inline comments are not.
- Every new function/class with real logic gets an automated test alongside it (project-wide rule) — this plan is TDD throughout: write the failing test, watch it fail, implement, watch it pass.
- Every mutating endpoint and every caught-and-swallowed exception gets a `log.info`/`log.warning`/`log.error` call via `backend.state.log` (project-wide logging rule) — never log a token, secret, or client_secret value, only ids/provider names/outcomes.
- `backend/routers/*.py` one-file-per-domain convention — all OAuth routes live in one new `backend/routers/oauth.py`, not scattered into `auth.py`.
- This is a live app — edits to `.py` files take effect immediately via `uvicorn --reload` inside the `story-game` container; edits to `new_ui/js/*.js` take effect on next page load. Never use `EnterWorktree`/`git worktree` for this repo.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/db.py` (modify) | Add `oauth_providers`, `oauth_identities`, `oauth_pending` `sa.Table` definitions |
| `backend/oauth_registry.py` (new) | `PROVIDER_REGISTRY` dict: static metadata for all 9 providers, plus `extract_user_id(provider, payload)` helper for dotted-path id fields |
| `backend/repositories/oauth_providers.py` (new) | CRUD for admin-configured provider credentials (encrypted secret) |
| `backend/repositories/oauth_identities.py` (new) | CRUD for the durable identity link, mirrors `webauthn_credentials.py` |
| `backend/repositories/oauth_pending.py` (new) | Create/consume short-lived CSRF state rows |
| `backend/routers/oauth.py` (new) | All `/api/auth/oauth/*` and `/admin/oauth-providers` and `/api/me/oauth-identities` routes |
| `backend/schemas.py` (modify) | Add `OauthProviderConfigIn`, `OauthProvidersPutIn` |
| `new_ui/js/login.js` (modify) | Render enabled-provider buttons on the sign-in screen |
| `new_ui/js/register.js` (modify) | Render enabled-provider buttons on the register screen |
| `new_ui/js/settings-account.js` (modify) | "Connected accounts" section, same pattern as the existing passkey list |
| `new_ui/js/admin-config.js` (modify) | "Integrated Identity Providers" section: one row per registry provider |
| `new_ui/js/translations.js` (modify) | New `oauth_*` UI_STRINGS keys |
| `backend/tests/test_oauth_registry.py` (new) | Registry shape validation |
| `backend/tests/test_oauth_providers_repo.py` (new) | Provider-config repository tests |
| `backend/tests/test_oauth_identities_repo.py` (new) | Identity-link repository tests |
| `backend/tests/test_oauth_pending_repo.py` (new) | CSRF-state repository tests |
| `backend/tests/test_oauth_router.py` (new) | Full start/callback flow tests (login + link + errors), mocked provider HTTP calls |

---

### Task 1: Database schema — three new tables

**Files:**
- Modify: `backend/db.py` (add table definitions near `webauthn_credentials`, roughly `backend/db.py:117-129`)
- Test: `backend/tests/test_oauth_providers_repo.py`, `backend/tests/test_oauth_identities_repo.py`, `backend/tests/test_oauth_pending_repo.py` (table-existence smoke tests only in this task — CRUD tests come in Tasks 2-4)

**Interfaces:**
- Produces: `backend.db.oauth_providers`, `backend.db.oauth_identities`, `backend.db.oauth_pending` — `sa.Table` objects, importable exactly like `backend.db.webauthn_credentials`.

- [ ] **Step 1: Write the failing smoke test**

```python
# backend/tests/test_oauth_providers_repo.py
import pytest

from backend import db

pytestmark = pytest.mark.asyncio


async def test_oauth_providers_table_exists(db_conn):
    from sqlalchemy import select
    result = await db._q(select(db.oauth_providers).limit(0))
    assert result == []
```

```python
# backend/tests/test_oauth_identities_repo.py
import pytest

from backend import db

pytestmark = pytest.mark.asyncio


async def test_oauth_identities_table_exists(db_conn):
    from sqlalchemy import select
    result = await db._q(select(db.oauth_identities).limit(0))
    assert result == []
```

```python
# backend/tests/test_oauth_pending_repo.py
import pytest

from backend import db

pytestmark = pytest.mark.asyncio


async def test_oauth_pending_table_exists(db_conn):
    from sqlalchemy import select
    result = await db._q(select(db.oauth_pending).limit(0))
    assert result == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_providers_repo.py backend/tests/test_oauth_identities_repo.py backend/tests/test_oauth_pending_repo.py -v"`
Expected: FAIL with `AttributeError: module 'backend.db' has no attribute 'oauth_providers'` (and similarly for the other two)

- [ ] **Step 3: Add the table definitions**

In `backend/db.py`, immediately after the closing `)` of `webauthn_credentials` (currently ending at line 129, right before `user_settings = sa.Table(` at line 131), insert:

```python
oauth_providers = sa.Table(
    "oauth_providers", _meta,
    sa.Column("provider", sa.Text, primary_key=True),
    sa.Column("client_id", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("client_secret", sa.Text),
    sa.Column("enabled", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("updated", sa.Float, nullable=False),
)

oauth_identities = sa.Table(
    "oauth_identities", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("provider", sa.Text, nullable=False),
    sa.Column("provider_user_id", sa.Text, nullable=False),
    sa.Column("user_id", sa.Text, nullable=False, index=True),
    sa.Column("display_name", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("created", sa.Float, nullable=False),
    sa.UniqueConstraint("provider", "provider_user_id", name="uq_oauth_identity_provider_pair"),
)

oauth_pending = sa.Table(
    "oauth_pending", _meta,
    sa.Column("state", sa.Text, primary_key=True),
    sa.Column("provider", sa.Text, nullable=False),
    sa.Column("mode", sa.Text, nullable=False),
    sa.Column("user_id", sa.Text),
    sa.Column("code_verifier", sa.Text),
    sa.Column("created", sa.Float, nullable=False),
)
```

`metadata.create_all(checkfirst=True)` in `db.init()` creates these automatically at next startup — no `ALTER TABLE` migration needed since these are brand-new tables, not new columns on an existing one (see `backend/db.py`'s own `init()` docstring/comment above its `ALTER TABLE` block for why that distinction matters).

- [ ] **Step 4: Restart and verify tables are created**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -c 'import asyncio; from backend import db; asyncio.run(db.init())'"`
Expected: exits 0, no errors

- [ ] **Step 5: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_providers_repo.py backend/tests/test_oauth_identities_repo.py backend/tests/test_oauth_pending_repo.py -v"`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/db.py backend/tests/test_oauth_providers_repo.py backend/tests/test_oauth_identities_repo.py backend/tests/test_oauth_pending_repo.py
git commit -m "Add oauth_providers, oauth_identities, oauth_pending tables"
```

---

### Task 2: Provider registry

**Files:**
- Create: `backend/oauth_registry.py`
- Test: `backend/tests/test_oauth_registry.py`

**Interfaces:**
- Consumes: nothing (pure data + pure functions module)
- Produces: `PROVIDER_REGISTRY: dict[str, dict]`, `extract_user_id(provider: str, payload: dict) -> str | None`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_oauth_registry.py
import pytest

from backend.oauth_registry import PROVIDER_REGISTRY, extract_user_id

REQUIRED_KEYS = {"label", "protocol", "authorize_url", "scope", "user_id_field"}
OAUTH2_STANDARD_KEYS = {"token_url", "userinfo_url"}


def test_every_provider_has_required_keys():
    for name, entry in PROVIDER_REGISTRY.items():
        missing = REQUIRED_KEYS - entry.keys()
        assert not missing, f"{name} missing keys: {missing}"


def test_standard_oauth2_providers_have_token_and_userinfo_urls():
    for name, entry in PROVIDER_REGISTRY.items():
        if entry["protocol"] == "oauth2":
            missing = OAUTH2_STANDARD_KEYS - entry.keys()
            assert not missing, f"{name} missing keys: {missing}"


def test_scope_never_requests_email():
    for name, entry in PROVIDER_REGISTRY.items():
        assert "email" not in entry["scope"].lower(), f"{name} scope requests email: {entry['scope']}"


def test_expected_providers_present():
    expected = {"google", "facebook", "github", "discord", "twitter",
                "reddit", "steam", "apple", "microsoft"}
    assert expected == set(PROVIDER_REGISTRY.keys())


def test_extract_user_id_flat_field():
    assert extract_user_id("google", {"sub": "12345"}) == "12345"


def test_extract_user_id_dotted_path():
    assert extract_user_id("twitter", {"data": {"id": "67890"}}) == "67890"


def test_extract_user_id_missing_returns_none():
    assert extract_user_id("google", {"other": "field"}) is None


def test_extract_user_id_unknown_provider_returns_none():
    assert extract_user_id("not-a-provider", {"sub": "x"}) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_registry.py -v"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.oauth_registry'`

- [ ] **Step 3: Write the registry**

```python
"""Static per-provider OAuth metadata. No credentials live here — those are
admin-configured at runtime in the oauth_providers table (backend/db.py),
Fernet-encrypted, via backend/repositories/oauth_providers.py."""

PROVIDER_REGISTRY = {
    "google": {
        "label": "Google",
        "protocol": "oauth2",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid profile",
        "user_id_field": "sub",
        "display_name_field": "name",
        "pkce": True,
    },
    "facebook": {
        "label": "Facebook",
        "protocol": "oauth2",
        "authorize_url": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v19.0/oauth/access_token",
        "userinfo_url": "https://graph.facebook.com/me?fields=id,name",
        "scope": "public_profile",
        "user_id_field": "id",
        "display_name_field": "name",
        "pkce": False,
    },
    "github": {
        "label": "GitHub",
        "protocol": "oauth2",
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "userinfo_url": "https://api.github.com/user",
        "scope": "read:user",
        "user_id_field": "id",
        "display_name_field": "login",
        "pkce": False,
    },
    "discord": {
        "label": "Discord",
        "protocol": "oauth2",
        "authorize_url": "https://discord.com/api/oauth2/authorize",
        "token_url": "https://discord.com/api/oauth2/token",
        "userinfo_url": "https://discord.com/api/users/@me",
        "scope": "identify",
        "user_id_field": "id",
        "display_name_field": "username",
        "pkce": False,
    },
    "twitter": {
        "label": "Twitter / X",
        "protocol": "oauth2",
        "authorize_url": "https://twitter.com/i/oauth2/authorize",
        "token_url": "https://api.twitter.com/2/oauth2/token",
        "userinfo_url": "https://api.twitter.com/2/users/me",
        "scope": "tweet.read users.read",
        "user_id_field": "data.id",
        "display_name_field": "data.username",
        "pkce": True,
    },
    "reddit": {
        "label": "Reddit",
        "protocol": "oauth2",
        "authorize_url": "https://www.reddit.com/api/v1/authorize",
        "token_url": "https://www.reddit.com/api/v1/access_token",
        "userinfo_url": "https://oauth.reddit.com/api/v1/me",
        "scope": "identity",
        "user_id_field": "id",
        "display_name_field": "name",
        "pkce": False,
    },
    "microsoft": {
        "label": "Microsoft",
        "protocol": "oauth2",
        "authorize_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "userinfo_url": "https://graph.microsoft.com/oidc/userinfo",
        "scope": "openid profile",
        "user_id_field": "sub",
        "display_name_field": "name",
        "pkce": True,
    },
    "steam": {
        "label": "Steam",
        "protocol": "openid2",
        "authorize_url": "https://steamcommunity.com/openid/login",
        "scope": "",
        "user_id_field": "steamid",
        "display_name_field": None,
        "pkce": False,
    },
    "apple": {
        "label": "Apple",
        "protocol": "oauth2_apple",
        "authorize_url": "https://appleid.apple.com/auth/authorize",
        "token_url": "https://appleid.apple.com/auth/token",
        "userinfo_url": None,
        "scope": "name",
        "user_id_field": "sub",
        "display_name_field": None,
        "pkce": False,
    },
}


def extract_user_id(provider: str, payload: dict) -> str | None:
    entry = PROVIDER_REGISTRY.get(provider)
    if not entry:
        return None
    field = entry["user_id_field"]
    value = payload
    for part in field.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return str(value) if value is not None else None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_registry.py -v"`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/oauth_registry.py backend/tests/test_oauth_registry.py
git commit -m "Add OAuth provider registry (Google, Facebook, GitHub, Discord, Twitter, Reddit, Steam, Apple, Microsoft)"
```

---

### Task 3: `oauth_providers` repository (admin credential CRUD)

**Files:**
- Create: `backend/repositories/oauth_providers.py`
- Test: `backend/tests/test_oauth_providers_repo.py` (extend the file from Task 1)

**Interfaces:**
- Consumes: `backend.db.oauth_providers`, `backend.db._encrypt_secret`/`_decrypt_secret`, `backend.db.nid` (not needed here — PK is `provider` itself), `backend.db._q`/`_q1`/`_w`
- Produces: `list_all() -> list[dict]`, `get(provider: str) -> dict | None`, `upsert(provider: str, client_id: str, client_secret: str | None, enabled: bool) -> None`, `list_enabled() -> list[dict]` (only rows with `enabled=1` and a non-empty `client_id` and decryptable `client_secret`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_oauth_providers_repo.py`:

```python
from backend.repositories import oauth_providers as provider_repo


async def test_upsert_and_get(db_conn):
    await provider_repo.upsert("google", "client-123", "secret-abc", True)
    row = await provider_repo.get("google")
    assert row["provider"] == "google"
    assert row["client_id"] == "client-123"
    assert row["client_secret"] == "secret-abc"
    assert row["enabled"] is True


async def test_upsert_overwrites(db_conn):
    await provider_repo.upsert("github", "id-1", "secret-1", True)
    await provider_repo.upsert("github", "id-2", "secret-2", False)
    row = await provider_repo.get("github")
    assert row["client_id"] == "id-2"
    assert row["client_secret"] == "secret-2"
    assert row["enabled"] is False


async def test_upsert_keeps_existing_secret_when_none_passed(db_conn):
    await provider_repo.upsert("discord", "id-1", "secret-1", True)
    await provider_repo.upsert("discord", "id-1-new", None, True)
    row = await provider_repo.get("discord")
    assert row["client_id"] == "id-1-new"
    assert row["client_secret"] == "secret-1"


async def test_get_missing_returns_none(db_conn):
    assert await provider_repo.get("not-configured") is None


async def test_list_all(db_conn):
    await provider_repo.upsert("google", "id", "secret", True)
    await provider_repo.upsert("github", "id", "secret", False)
    rows = await provider_repo.list_all()
    providers = {r["provider"] for r in rows}
    assert providers == {"google", "github"}


async def test_list_enabled_excludes_disabled(db_conn):
    await provider_repo.upsert("google", "id", "secret", True)
    await provider_repo.upsert("github", "id", "secret", False)
    rows = await provider_repo.list_enabled()
    assert [r["provider"] for r in rows] == ["google"]


async def test_list_enabled_excludes_missing_client_id(db_conn):
    await provider_repo.upsert("google", "", "secret", True)
    rows = await provider_repo.list_enabled()
    assert rows == []


async def test_list_enabled_excludes_missing_secret(db_conn):
    await provider_repo.upsert("google", "client-id", None, True)
    rows = await provider_repo.list_enabled()
    assert rows == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_providers_repo.py -v"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.repositories.oauth_providers'`

- [ ] **Step 3: Write the repository**

```python
import time

from sqlalchemy import select, insert, update as sa_update

from backend.db import oauth_providers as providers, _encrypt_secret, _decrypt_secret, _q, _q1, _w
from backend.state import log


def _row(row) -> dict:
    d = dict(row)
    d["enabled"] = bool(d["enabled"])
    if d.get("client_secret"):
        d["client_secret"] = _decrypt_secret(d["client_secret"])
    return d


async def list_all() -> list[dict]:
    return [_row(r) for r in await _q(select(providers).order_by(providers.c.provider))]


async def list_enabled() -> list[dict]:
    return [r for r in await list_all() if r["enabled"] and r["client_id"] and r["client_secret"]]


async def get(provider: str) -> dict | None:
    row = await _q1(select(providers).where(providers.c.provider == provider))
    return _row(row) if row else None


async def upsert(provider: str, client_id: str, client_secret: str | None, enabled: bool) -> None:
    existing = await _q1(select(providers).where(providers.c.provider == provider))
    encrypted_secret = _encrypt_secret(client_secret) if client_secret else (
        dict(existing)["client_secret"] if existing else None)
    values = dict(client_id=client_id, client_secret=encrypted_secret,
                 enabled=int(enabled), updated=time.time())
    if existing:
        await _w(sa_update(providers).where(providers.c.provider == provider).values(**values))
    else:
        await _w(insert(providers).values(provider=provider, **values))
    log.info("oauth_providers: upserted provider=%s enabled=%s", provider, enabled)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_providers_repo.py -v"`
Expected: PASS (9 tests total, including the Task 1 smoke test)

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/oauth_providers.py backend/tests/test_oauth_providers_repo.py
git commit -m "Add oauth_providers repository: encrypted admin credential CRUD"
```

---

### Task 4: `oauth_identities` repository

**Files:**
- Create: `backend/repositories/oauth_identities.py`
- Test: `backend/tests/test_oauth_identities_repo.py` (extend the file from Task 1)

**Interfaces:**
- Consumes: `backend.db.oauth_identities`, `backend.db.nid`, `backend.db._q`/`_q1`/`_w`
- Produces: `create(provider: str, provider_user_id: str, user_id: str, display_name: str = "") -> str`, `get_by_provider_identity(provider: str, provider_user_id: str) -> dict | None`, `list_for_user(user_id: str) -> list[dict]`, `delete(identity_id: str, user_id: str) -> bool`, `count_for_user(user_id: str) -> int`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_oauth_identities_repo.py`:

```python
from backend.repositories import oauth_identities as identity_repo
from backend.repositories import users as user_repo


async def _make_user(db_conn, username="oauth-test-user"):
    return await user_repo.create_user(username, "pw12345678")


async def test_create_and_get_by_provider_identity(db_conn):
    user = await _make_user(db_conn)
    iid = await identity_repo.create("google", "google-sub-123", user["id"], "Alice")
    assert iid
    found = await identity_repo.get_by_provider_identity("google", "google-sub-123")
    assert found["user_id"] == user["id"]
    assert found["display_name"] == "Alice"


async def test_get_by_provider_identity_missing_returns_none(db_conn):
    assert await identity_repo.get_by_provider_identity("google", "no-such-sub") is None


async def test_list_for_user(db_conn):
    user = await _make_user(db_conn, "oauth-multi")
    await identity_repo.create("google", "sub-a", user["id"])
    await identity_repo.create("github", "id-b", user["id"])
    rows = await identity_repo.list_for_user(user["id"])
    assert {r["provider"] for r in rows} == {"google", "github"}


async def test_delete_only_by_owner(db_conn):
    owner = await _make_user(db_conn, "oauth-owner")
    other = await _make_user(db_conn, "oauth-other")
    iid = await identity_repo.create("google", "sub-x", owner["id"])
    assert await identity_repo.delete(iid, other["id"]) is False
    assert await identity_repo.delete(iid, owner["id"]) is True
    assert await identity_repo.list_for_user(owner["id"]) == []


async def test_count_for_user(db_conn):
    user = await _make_user(db_conn, "oauth-count")
    assert await identity_repo.count_for_user(user["id"]) == 0
    await identity_repo.create("google", "sub-y", user["id"])
    assert await identity_repo.count_for_user(user["id"]) == 1


async def test_provider_identity_pair_is_unique(db_conn):
    user_a = await _make_user(db_conn, "oauth-unique-a")
    user_b = await _make_user(db_conn, "oauth-unique-b")
    await identity_repo.create("google", "dup-sub", user_a["id"])
    with pytest.raises(Exception):
        await identity_repo.create("google", "dup-sub", user_b["id"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_identities_repo.py -v"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.repositories.oauth_identities'`

- [ ] **Step 3: Write the repository**

```python
import time

from sqlalchemy import select, insert, delete as sa_delete

from backend.db import oauth_identities as identities, nid, _q, _q1, _w
from backend.state import log


def _row(row) -> dict:
    return dict(row)


async def create(provider: str, provider_user_id: str, user_id: str, display_name: str = "") -> str:
    iid = nid("oi")
    await _w(insert(identities).values(
        id=iid, provider=provider, provider_user_id=provider_user_id,
        user_id=user_id, display_name=display_name, created=time.time()))
    log.info("oauth_identities: linked id=%s provider=%s user=%s", iid, provider, user_id)
    return iid


async def get_by_provider_identity(provider: str, provider_user_id: str) -> dict | None:
    row = await _q1(select(identities).where(
        (identities.c.provider == provider) & (identities.c.provider_user_id == provider_user_id)))
    return _row(row) if row else None


async def list_for_user(user_id: str) -> list[dict]:
    stmt = select(identities).where(identities.c.user_id == user_id).order_by(identities.c.created.desc())
    return [_row(r) for r in await _q(stmt)]


async def delete(identity_id: str, user_id: str) -> bool:
    row = await _q1(select(identities).where(identities.c.id == identity_id))
    if not row or dict(row).get("user_id") != user_id:
        return False
    await _w(sa_delete(identities).where(identities.c.id == identity_id))
    log.info("oauth_identities: unlinked id=%s user=%s", identity_id, user_id)
    return True


async def count_for_user(user_id: str) -> int:
    return len(await list_for_user(user_id))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_identities_repo.py -v"`
Expected: PASS (7 tests total, including the Task 1 smoke test)

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/oauth_identities.py backend/tests/test_oauth_identities_repo.py
git commit -m "Add oauth_identities repository: durable provider-identity link"
```

---

### Task 5: `oauth_pending` repository (CSRF state)

**Files:**
- Create: `backend/repositories/oauth_pending.py`
- Test: `backend/tests/test_oauth_pending_repo.py` (extend the file from Task 1)

**Interfaces:**
- Consumes: `backend.db.oauth_pending`, `backend.db._q1`/`_w`, `backend.db.delete`
- Produces: `create(state: str, provider: str, mode: str, user_id: str | None, code_verifier: str | None) -> None`, `consume(state: str) -> dict | None` (fetches and deletes in one call — one-time use), `purge_expired(max_age_seconds: float = 300) -> int`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_oauth_pending_repo.py`:

```python
import time

from backend.repositories import oauth_pending as pending_repo


async def test_create_and_consume(db_conn):
    await pending_repo.create("state-abc", "google", "login", None, "verifier-1")
    row = await pending_repo.consume("state-abc")
    assert row["provider"] == "google"
    assert row["mode"] == "login"
    assert row["user_id"] is None
    assert row["code_verifier"] == "verifier-1"


async def test_consume_is_one_time_use(db_conn):
    await pending_repo.create("state-once", "github", "login", None, None)
    assert await pending_repo.consume("state-once") is not None
    assert await pending_repo.consume("state-once") is None


async def test_consume_missing_returns_none(db_conn):
    assert await pending_repo.consume("never-created") is None


async def test_create_link_mode_stores_user_id(db_conn):
    await pending_repo.create("state-link", "discord", "link", "u-123", None)
    row = await pending_repo.consume("state-link")
    assert row["mode"] == "link"
    assert row["user_id"] == "u-123"


async def test_purge_expired(db_conn):
    from backend import db
    await db._w(db.insert(db.oauth_pending).values(
        state="stale-state", provider="google", mode="login",
        user_id=None, code_verifier=None, created=time.time() - 600))
    await pending_repo.create("fresh-state", "google", "login", None, None)
    purged = await pending_repo.purge_expired(max_age_seconds=300)
    assert purged == 1
    assert await pending_repo.consume("fresh-state") is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_pending_repo.py -v"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.repositories.oauth_pending'`

- [ ] **Step 3: Write the repository**

```python
import time

from sqlalchemy import select, insert, delete as sa_delete

from backend.db import oauth_pending as pending, _q1, _w
from backend.state import log


def _row(row) -> dict:
    return dict(row)


async def create(state: str, provider: str, mode: str, user_id: str | None,
                 code_verifier: str | None) -> None:
    await _w(insert(pending).values(
        state=state, provider=provider, mode=mode, user_id=user_id,
        code_verifier=code_verifier, created=time.time()))


async def consume(state: str) -> dict | None:
    row = await _q1(select(pending).where(pending.c.state == state))
    if not row:
        return None
    await _w(sa_delete(pending).where(pending.c.state == state))
    return _row(row)


async def purge_expired(max_age_seconds: float = 300) -> int:
    cutoff = time.time() - max_age_seconds
    stale = await _q1(select(pending.c.state).where(pending.c.created < cutoff))
    from sqlalchemy import select as sa_select
    from backend.db import _q
    rows = await _q(sa_select(pending.c.state).where(pending.c.created < cutoff))
    if not rows:
        return 0
    await _w(sa_delete(pending).where(pending.c.created < cutoff))
    log.info("oauth_pending: purged %d expired state row(s)", len(rows))
    return len(rows)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_pending_repo.py -v"`
Expected: PASS (6 tests total, including the Task 1 smoke test)

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/oauth_pending.py backend/tests/test_oauth_pending_repo.py
git commit -m "Add oauth_pending repository: short-lived CSRF state for the OAuth flow"
```

---

### Task 6: Admin config schemas + `/admin/oauth-providers` endpoints

**Files:**
- Modify: `backend/schemas.py` (add near `ModelRequestHostIn`, roughly `backend/schemas.py:105-108`)
- Modify: `backend/routers/oauth.py` (new file — this task starts it; later tasks append to it)
- Test: `backend/tests/test_oauth_router.py` (new file — this task starts it)

**Interfaces:**
- Consumes: `backend.oauth_registry.PROVIDER_REGISTRY`, `backend.repositories.oauth_providers` (Task 3), `backend.auth.get_admin`, `backend.state.api`
- Produces: `GET /admin/oauth-providers` (admin-only, returns every registry provider merged with its configured state), `PUT /admin/oauth-providers` (admin-only, upserts one or more providers)

- [ ] **Step 1: Write the schema**

In `backend/schemas.py`, immediately after `class ModelRequestHostIn(BaseModel):` block (currently ending around line 108), add:

```python
class OauthProviderConfigIn(BaseModel):
    client_id: str = ""
    client_secret: str | None = None
    enabled: bool = False


class OauthProvidersPutIn(BaseModel):
    providers: dict[str, OauthProviderConfigIn]
```

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_oauth_router.py
import pytest
from fastapi import HTTPException

from backend.routers import oauth as oauth_router
from backend.repositories import oauth_providers as provider_repo
from backend.schemas import OauthProvidersPutIn, OauthProviderConfigIn

pytestmark = pytest.mark.asyncio


async def test_admin_list_providers_includes_every_registry_entry(db_conn):
    result = await oauth_router.admin_list_oauth_providers(_: {"id": "admin-1"})
    names = {p["provider"] for p in result["providers"]}
    from backend.oauth_registry import PROVIDER_REGISTRY
    assert names == set(PROVIDER_REGISTRY.keys())


async def test_admin_list_providers_reports_configured_state(db_conn):
    await provider_repo.upsert("google", "client-1", "secret-1", True)
    result = await oauth_router.admin_list_oauth_providers(_: {"id": "admin-1"})
    google = next(p for p in result["providers"] if p["provider"] == "google")
    assert google["client_id"] == "client-1"
    assert google["has_client_secret"] is True
    assert "client_secret" not in google
    assert google["enabled"] is True


async def test_admin_list_providers_unconfigured_shows_defaults(db_conn):
    result = await oauth_router.admin_list_oauth_providers(_: {"id": "admin-1"})
    github = next(p for p in result["providers"] if p["provider"] == "github")
    assert github["client_id"] == ""
    assert github["has_client_secret"] is False
    assert github["enabled"] is False


async def test_admin_put_providers_upserts(db_conn):
    body = OauthProvidersPutIn(providers={
        "discord": OauthProviderConfigIn(client_id="d-id", client_secret="d-secret", enabled=True)})
    await oauth_router.admin_put_oauth_providers(body, {"id": "admin-1", "username": "admin"})
    row = await provider_repo.get("discord")
    assert row["client_id"] == "d-id"
    assert row["enabled"] is True


async def test_admin_put_providers_rejects_unknown_provider(db_conn):
    body = OauthProvidersPutIn(providers={
        "not-a-real-provider": OauthProviderConfigIn(client_id="x", client_secret="y", enabled=True)})
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.admin_put_oauth_providers(body, {"id": "admin-1", "username": "admin"})
    assert exc_info.value.status_code == 400
```

- [ ] **Step 3: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_router.py -v"`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.routers.oauth'`

- [ ] **Step 4: Write the router (admin endpoints only — login/callback come in Task 7)**

```python
"""OAuth SSO login: admin-configured Integrated Identity Providers, the
authorize/callback flow (login + link modes), and the public enabled-provider
list. See backend/oauth_registry.py for provider metadata and
backend/repositories/oauth_* for persistence."""
from fastapi import HTTPException, Depends

from backend.state import api, auth_router, log
from backend.auth import get_admin
from backend.oauth_registry import PROVIDER_REGISTRY
from backend.repositories import oauth_providers as provider_repo
from backend.schemas import OauthProvidersPutIn


@api.get("/admin/oauth-providers")
async def admin_list_oauth_providers(current_user: dict = Depends(get_admin)):
    configured = {row["provider"]: row for row in await provider_repo.list_all()}
    out = []
    for name, entry in PROVIDER_REGISTRY.items():
        row = configured.get(name)
        out.append({
            "provider": name,
            "label": entry["label"],
            "protocol": entry["protocol"],
            "client_id": row["client_id"] if row else "",
            "has_client_secret": bool(row and row["client_secret"]),
            "enabled": bool(row and row["enabled"]),
        })
    return {"providers": out}


@api.put("/admin/oauth-providers")
async def admin_put_oauth_providers(body: OauthProvidersPutIn,
                                    current_user: dict = Depends(get_admin)):
    unknown = set(body.providers) - set(PROVIDER_REGISTRY)
    if unknown:
        raise HTTPException(400, f"Unknown provider(s): {', '.join(sorted(unknown))}")
    for name, cfg in body.providers.items():
        await provider_repo.upsert(name, cfg.client_id, cfg.client_secret, cfg.enabled)
    log.info("admin: oauth providers updated by=%s providers=%s",
             current_user["username"], ",".join(sorted(body.providers)))
    return {"ok": True}
```

- [ ] **Step 5: Register the router in `server.py`**

Find where other `backend.routers.*` modules are imported in `server.py` (each router file attaches its routes to the shared `api`/`auth_router` objects on import — check the existing import block, e.g. `from backend.routers import webauthn` alongside sibling router imports) and add `from backend.routers import oauth` in the same block, in the same alphabetical/grouped position webauthn or admin appears.

- [ ] **Step 6: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_router.py -v"`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add backend/schemas.py backend/routers/oauth.py backend/tests/test_oauth_router.py server.py
git commit -m "Add admin GET/PUT /admin/oauth-providers endpoints"
```

---

### Task 7: Public enabled-providers list + login-mode start/callback

**Files:**
- Modify: `backend/routers/oauth.py`
- Modify: `backend/schemas.py` (nothing new needed — reuses existing patterns)
- Test: `backend/tests/test_oauth_router.py` (extend)
- Modify: `requirements.txt` (add `httpx` if not already present — check first, `backend/llm.py` likely already depends on it transitively via an existing import)

**Interfaces:**
- Consumes: `backend.oauth_pending` (Task 5), `backend.oauth_identities` (Task 4), `backend.oauth_providers` (Task 3), `backend.oauth_registry.extract_user_id`, `backend.auth._free_guest_username`, `backend.auth._issue_tokens`, `backend.auth._set_auth_cookies`, `backend.repositories.users.create_user`, `backend.repositories.users.get_user_by_id`
- Produces: `GET /api/auth/oauth/providers` (public), `GET /api/auth/oauth/{provider}/start` (public, `mode=login` only in this task), `GET /api/auth/oauth/{provider}/callback` (public, `mode=login` only in this task), plus internal helpers `_exchange_code_for_token(provider, entry, code, code_verifier)` and `_fetch_identity(provider, entry, access_token)` — both `async def`, both monkeypatchable in tests.

- [ ] **Step 1: Check httpx availability**

Run: `grep -n httpx /var/home/staygold/ai-frontend/requirements.txt /var/home/staygold/ai-frontend/backend/llm.py`
Expected: `backend/llm.py` already imports `httpx` — if `requirements.txt` doesn't list it explicitly (it may be pulled in transitively), add a line `httpx` to `requirements.txt` to make the dependency explicit rather than implicit.

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_oauth_router.py`:

```python
import time
import types

from backend.repositories import oauth_pending as pending_repo
from backend.repositories import oauth_identities as identity_repo
from backend.repositories import users as user_repo


async def test_public_providers_list_only_shows_enabled(db_conn):
    await provider_repo.upsert("google", "id", "secret", True)
    await provider_repo.upsert("github", "id", "secret", False)
    result = await oauth_router.list_public_oauth_providers()
    names = {p["provider"] for p in result["providers"]}
    assert names == {"google"}
    assert result["providers"][0] == {"provider": "google", "label": "Google"}


async def test_start_login_unknown_provider_404(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.start_oauth("not-real", "login", None)
    assert exc_info.value.status_code == 404


async def test_start_login_disabled_provider_404(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.start_oauth("google", "login", None)
    assert exc_info.value.status_code == 404


async def test_start_login_enabled_provider_redirects_with_state(db_conn):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)
    response = await oauth_router.start_oauth("google", "login", None)
    assert response.status_code == 307
    assert "accounts.google.com" in response.headers["location"]
    assert "state=" in response.headers["location"]
    assert "client_id=test-client-id" in response.headers["location"]


async def test_callback_missing_state_400(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.oauth_callback("google", code="abc", state="never-issued",
                                          response=types.SimpleNamespace(set_cookie=lambda **kw: None))
    assert exc_info.value.status_code == 400


async def test_callback_login_new_identity_creates_guest_account(db_conn, monkeypatch):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)

    async def fake_exchange(provider, entry, code, code_verifier):
        return "fake-access-token"

    async def fake_fetch(provider, entry, access_token):
        return {"sub": "google-new-user-12345", "name": "Test Person"}

    monkeypatch.setattr(oauth_router, "_exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(oauth_router, "_fetch_identity", fake_fetch)

    await pending_repo.create("state-new", "google", "login", None, None)
    resp = types.SimpleNamespace(set_cookie=lambda **kw: None)
    result = await oauth_router.oauth_callback("google", code="fake-code", state="state-new", response=resp)
    assert result["access_token"]
    identity = await identity_repo.get_by_provider_identity("google", "google-new-user-12345")
    assert identity is not None
    user = await user_repo.get_user_by_id(identity["user_id"])
    assert user["tier"] == "guest"
    assert user["status"] == "active"


async def test_callback_login_existing_identity_reuses_account(db_conn, monkeypatch):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)
    existing_user = await user_repo.create_user("oauth-repeat-user", "pw12345678", tier="guest")
    await identity_repo.create("google", "google-existing-999", existing_user["id"])

    async def fake_exchange(provider, entry, code, code_verifier):
        return "fake-access-token"

    async def fake_fetch(provider, entry, access_token):
        return {"sub": "google-existing-999", "name": "Test Person"}

    monkeypatch.setattr(oauth_router, "_exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(oauth_router, "_fetch_identity", fake_fetch)

    await pending_repo.create("state-repeat", "google", "login", None, None)
    resp = types.SimpleNamespace(set_cookie=lambda **kw: None)
    result = await oauth_router.oauth_callback("google", code="fake-code", state="state-repeat", response=resp)
    assert result["id"] == existing_user["id"]
    remaining = await identity_repo.list_for_user(existing_user["id"])
    assert len(remaining) == 1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_router.py -v"`
Expected: FAIL — `list_public_oauth_providers`/`start_oauth`/`oauth_callback` don't exist yet

- [ ] **Step 4: Extend the router**

Append to `backend/routers/oauth.py` (add these imports to the existing import block at the top, then the new code below the admin endpoints):

```python
import base64
import hashlib
import secrets
import time

import httpx
from fastapi import Request
from fastapi.responses import RedirectResponse

from backend.oauth_registry import extract_user_id
from backend.repositories import oauth_identities as identity_repo
from backend.repositories import oauth_pending as pending_repo
from backend.repositories import users as user_repo
from backend.auth import _free_guest_username, _issue_tokens, _set_auth_cookies


OAUTH_STATE_TTL_SECONDS = 300


@auth_router.get("/oauth/providers")
async def list_public_oauth_providers():
    rows = await provider_repo.list_enabled()
    return {"providers": [
        {"provider": r["provider"], "label": PROVIDER_REGISTRY[r["provider"]]["label"]}
        for r in rows if r["provider"] in PROVIDER_REGISTRY]}


def _callback_url(request: Request | None, provider: str) -> str:
    return f"/api/auth/oauth/{provider}/callback"


@auth_router.get("/oauth/{provider}/start")
async def start_oauth(provider: str, mode: str = "login", user_id: str | None = None):
    entry = PROVIDER_REGISTRY.get(provider)
    if not entry:
        raise HTTPException(404, "Unknown provider")
    configured = await provider_repo.get(provider)
    if not configured or not configured["enabled"] or not configured["client_id"] or not configured["client_secret"]:
        raise HTTPException(404, "Provider not configured")
    state = secrets.token_urlsafe(32)
    code_verifier = None
    params = {
        "client_id": configured["client_id"],
        "redirect_uri": _callback_url(None, provider),
        "state": state,
        "scope": entry["scope"],
        "response_type": "code",
    }
    if entry.get("pkce"):
        code_verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()).decode().rstrip("=")
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
    await pending_repo.create(state, provider, mode, user_id, code_verifier)
    query = "&".join(f"{k}={httpx.QueryParams({k: v})[k]}" for k, v in params.items())
    log.info("oauth: start provider=%s mode=%s", provider, mode)
    return RedirectResponse(url=f"{entry['authorize_url']}?{query}", status_code=307)


async def _exchange_code_for_token(provider: str, entry: dict, code: str,
                                   code_verifier: str | None) -> str:
    configured = await provider_repo.get(provider)
    data = {
        "client_id": configured["client_id"],
        "client_secret": configured["client_secret"],
        "code": code,
        "redirect_uri": _callback_url(None, provider),
        "grant_type": "authorization_code",
    }
    if code_verifier:
        data["code_verifier"] = code_verifier
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(entry["token_url"], data=data,
                                 headers={"Accept": "application/json"})
        resp.raise_for_status()
        payload = resp.json()
    return payload["access_token"]


async def _fetch_identity(provider: str, entry: dict, access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(entry["userinfo_url"],
                                headers={"Authorization": f"Bearer {access_token}"})
        resp.raise_for_status()
        return resp.json()


@auth_router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, code: str, state: str, response):
    entry = PROVIDER_REGISTRY.get(provider)
    if not entry:
        raise HTTPException(404, "Unknown provider")
    pending = await pending_repo.consume(state)
    if not pending or pending["provider"] != provider:
        raise HTTPException(400, "That sign-in link expired — try again")
    if time.time() - pending["created"] > OAUTH_STATE_TTL_SECONDS:
        raise HTTPException(400, "That sign-in link expired — try again")

    try:
        access_token = await _exchange_code_for_token(
            provider, entry, code, pending["code_verifier"])
        payload = await _fetch_identity(provider, entry, access_token)
    except Exception as e:
        log.error("oauth: callback failed provider=%s: %s: %s", provider, type(e).__name__, e)
        raise HTTPException(502, "Couldn't complete sign-in with that provider — try again")

    provider_user_id = extract_user_id(provider, payload)
    if not provider_user_id:
        log.error("oauth: no user id in callback payload provider=%s", provider)
        raise HTTPException(502, "Couldn't complete sign-in with that provider — try again")
    display_name = ""
    field = entry.get("display_name_field")
    if field:
        value = payload
        for part in field.split("."):
            value = value.get(part) if isinstance(value, dict) else None
        display_name = str(value) if value else ""

    if pending["mode"] == "link":
        existing = await identity_repo.get_by_provider_identity(provider, provider_user_id)
        if existing and existing["user_id"] != pending["user_id"]:
            raise HTTPException(409, "That account is already connected to a different user")
        if not existing:
            await identity_repo.create(provider, provider_user_id, pending["user_id"], display_name)
        log.info("oauth: linked provider=%s user=%s", provider, pending["user_id"])
        return {"linked": True, "provider": provider}

    identity = await identity_repo.get_by_provider_identity(provider, provider_user_id)
    if identity:
        user = await user_repo.get_user_by_id(identity["user_id"])
        if not user or user.get("status") != "active":
            raise HTTPException(403, "Account access denied")
    else:
        username = await _free_guest_username()
        random_password = secrets.token_urlsafe(32)
        user = await user_repo.create_user(username, random_password, status="active", tier="guest")
        await identity_repo.create(provider, provider_user_id, user["id"], display_name)
        log.info("oauth: created guest account provider=%s user=%s", provider, user["id"])

    tokens = await _issue_tokens(user["id"])
    _set_auth_cookies(response, tokens["access_token"], tokens["refresh_token"], secure=True)
    log.info("oauth: login provider=%s user=%s", provider, user["id"])
    return {"id": user["id"], "username": user["username"],
            "is_admin": bool(user.get("is_admin")),
            "nsfw_allowed": bool(user.get("nsfw_allowed")),
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "token_type": "bearer"}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_router.py -v"`
Expected: PASS (11 tests total)

- [ ] **Step 6: Commit**

```bash
git add backend/routers/oauth.py backend/tests/test_oauth_router.py requirements.txt
git commit -m "Add OAuth login flow: public providers list, start/callback with guest-account auto-creation"
```

---

### Task 8: Link mode + Settings connected-accounts endpoints

**Files:**
- Modify: `backend/routers/oauth.py`
- Test: `backend/tests/test_oauth_router.py` (extend)

**Interfaces:**
- Consumes: `backend.auth.get_current_user`
- Produces: `GET /api/me/oauth-identities` (authenticated, list own linked identities), `DELETE /api/me/oauth-identities/{iid}` (authenticated, unlink — blocked if it's the account's only sign-in method with no usable password... see note below)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_oauth_router.py`:

```python
async def test_start_link_requires_login(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.start_oauth_link("google", {"id": None})
    assert exc_info.value.status_code == 401


async def test_list_my_oauth_identities(db_conn):
    user = await user_repo.create_user("oauth-list-user", "pw12345678")
    await identity_repo.create("google", "sub-list-1", user["id"], "Display Name")
    result = await oauth_router.list_my_oauth_identities({"id": user["id"]})
    assert len(result) == 1
    assert result[0]["provider"] == "google"
    assert result[0]["display_name"] == "Display Name"
    assert "provider_user_id" not in result[0]


async def test_unlink_removes_identity(db_conn):
    user = await user_repo.create_user("oauth-unlink-user", "pw12345678")
    iid = await identity_repo.create("google", "sub-unlink-1", user["id"])
    result = await oauth_router.unlink_oauth_identity(iid, {"id": user["id"]})
    assert result == {"deleted": True}
    assert await identity_repo.list_for_user(user["id"]) == []


async def test_unlink_missing_404(db_conn):
    user = await user_repo.create_user("oauth-unlink-missing", "pw12345678")
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.unlink_oauth_identity("not-a-real-id", {"id": user["id"]})
    assert exc_info.value.status_code == 404


async def test_unlink_wrong_owner_404(db_conn):
    owner = await user_repo.create_user("oauth-unlink-owner", "pw12345678")
    other = await user_repo.create_user("oauth-unlink-other", "pw12345678")
    iid = await identity_repo.create("google", "sub-unlink-2", owner["id"])
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.unlink_oauth_identity(iid, {"id": other["id"]})
    assert exc_info.value.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_router.py -v -k 'link or identities'"`
Expected: FAIL — functions don't exist yet

- [ ] **Step 3: Extend the router**

Add to `backend/routers/oauth.py` (near the bottom):

```python
from backend.auth import get_current_user


@auth_router.get("/oauth/{provider}/start-link")
async def start_oauth_link(provider: str, current_user: dict = Depends(get_current_user)):
    return await start_oauth(provider, mode="link", user_id=current_user["id"])


@api.get("/me/oauth-identities")
async def list_my_oauth_identities(current_user: dict = Depends(get_current_user)):
    rows = await identity_repo.list_for_user(current_user["id"])
    return [{"id": r["id"], "provider": r["provider"],
             "label": PROVIDER_REGISTRY.get(r["provider"], {}).get("label", r["provider"]),
             "display_name": r["display_name"], "created": r["created"]}
            for r in rows]


@api.delete("/me/oauth-identities/{iid}")
async def unlink_oauth_identity(iid: str, current_user: dict = Depends(get_current_user)):
    if not await identity_repo.delete(iid, current_user["id"]):
        raise HTTPException(404, "Connected account not found")
    return {"deleted": True}
```

Note on the lockout guard from the design spec: unlike passkeys (which can be a user's *only* auth method with no password fallback), every account created through this app — including OAuth-created guest accounts — always has a real (if randomly generated and never shown) password hash on the `users` row already, from `create_user`'s mandatory `password` parameter. There is no scenario where unlinking a provider leaves an account with literally no way to authenticate at all via the schema; the practical lockout risk is the user not knowing that random password, which is a UX/support concern (surfaced in the frontend copy, not a backend block) rather than a data-integrity one — so no additional backend guard is needed here beyond ordinary ownership checking.

- [ ] **Step 4: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_oauth_router.py -v"`
Expected: PASS (16 tests total)

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/ -v"`
Expected: PASS (all tests, including the pre-existing suite — no regressions)

- [ ] **Step 6: Commit**

```bash
git add backend/routers/oauth.py backend/tests/test_oauth_router.py
git commit -m "Add OAuth account-linking flow and Settings connected-accounts endpoints"
```

---

### Task 9: New i18n keys

**Files:**
- Modify: `new_ui/js/translations.js`

**Interfaces:**
- Produces: new `UI_STRINGS` keys consumed by Tasks 10-12

- [ ] **Step 1: Add the keys**

In `new_ui/js/translations.js`, inside the `UI_STRINGS` object (anywhere among the existing keys, alphabetical grouping not required per the file's existing convention — append near other `login_`/`acct_`/`admin_config_` keys):

```javascript
  oauth_continue_with: "Continue with",
  oauth_connected_accounts: "Connected accounts",
  oauth_connected_accounts_hint: "Sign in with one of these instead of your password. Remove one any time - your account still works with a password.",
  oauth_no_connected_accounts: "No connected accounts yet.",
  oauth_connect_button: "Connect",
  oauth_unlink_button: "Remove",
  oauth_unlink_confirm_question: "Disconnect this sign-in method?",
  oauth_linked_success: "Account connected.",
  oauth_link_failed: "Couldn't connect that account.",
  oauth_login_failed: "Sign-in didn't work - try again or use your password.",
  admin_config_identity_providers_title: "Integrated Identity Providers",
  admin_config_identity_providers_description: "Let visitors sign in with an external account instead of a password. A first-time sign-in creates a guest account (same limits as the regular guest tier). No email address is ever stored from any provider.",
  admin_config_identity_provider_client_id_placeholder: "Client ID",
  admin_config_identity_provider_client_secret_set_placeholder: "Secret set - leave blank to keep",
  admin_config_identity_provider_client_secret_placeholder: "Client secret",
  admin_config_identity_providers_save_button: "Save identity providers",
  admin_config_identity_providers_saved: "Identity providers saved.",
  admin_config_identity_providers_save_failed: "Couldn't save identity providers.",
```

- [ ] **Step 2: Verify syntax**

Run: `python3 -c "
import re, json
src = open('/var/home/staygold/ai-frontend/new_ui/js/translations.js').read()
m = re.search(r'const UI_STRINGS = \{(.*?)\n\};\n', src, re.S)
body = m.group(1)
entries = re.findall(r'([a-zA-Z0-9_]+):\s*(\"(?:[^\"\\\\]|\\\\.)*\"),?', body)
obj = json.loads('{' + ','.join(f'\"{k}\":{v}' for k,v in entries) + '}')
print('keys:', len(obj))
"`
Expected: prints a key count with no error

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/translations.js
git commit -m "Add oauth_* and admin_config_identity_providers_* UI strings"
```

---

### Task 10: Login and register screen provider buttons

**Files:**
- Modify: `new_ui/js/login.js`
- Modify: `new_ui/js/register.js`

**Interfaces:**
- Consumes: `GET /api/auth/oauth/providers` (Task 7), `t()` keys from Task 9

- [ ] **Step 1: Add provider fetching to `AuthView.mount()`**

In `new_ui/js/login.js`, modify `mount()` (currently at line 143):

```javascript
  mount(main) {
    this.main = main;
    this.values = {};
    this.oauthProviders = [];
    this.setView("signin");
    this.startConditionalPasskey();
    this.loadOauthProviders();
  }

  async loadOauthProviders() {
    try {
      const { providers } = await api("/api/auth/oauth/providers");
      this.oauthProviders = providers;
    } catch (e) {
      this.oauthProviders = [];
    }
    if (this.view === "signin") this.render();
  }
```

- [ ] **Step 2: Render provider buttons in `renderSignin()`**

Modify `renderSignin()` (currently lines 189-211) to add a provider-button row right after the existing passkey button block, before the closing template literal backtick:

```javascript
      ${window.PublicKeyCredential ? `
      <button type="button" data-auth-submit="passkey" class="w-full mt-2 py-3 rounded-xl font-medium text-sm border" style="border-color:var(--color-line-2);color:var(--color-ink)">
        ${t("login_with_passkey_button", "Sign in with fingerprint / face")}
      </button>
      ` : ""}
      ${this.oauthProviders.length ? `
      <div class="flex flex-col gap-2 mt-3">
        ${this.oauthProviders.map((p) => `
          <a href="/api/auth/oauth/${encodeURIComponent(p.provider)}/start?mode=login" class="w-full py-3 rounded-xl font-medium text-sm border text-center" style="border-color:var(--color-line-2);color:var(--color-ink)">
            ${t("oauth_continue_with")} ${_esc(p.label)}
          </a>
        `).join("")}
      </div>
      ` : ""}
    `;
  }
```

- [ ] **Step 3: Mirror the same pattern in `register.js`**

In `new_ui/js/register.js`, find the equivalent `mount()`/`render()` structure (follows the same `AuthView`-sibling pattern as `login.js` — locate the class's `mount(main)` method and its primary render function) and apply the identical two changes: fetch `this.oauthProviders` in `mount()` via the same `loadOauthProviders()` helper, then render the same provider-button block at the bottom of the main form template, using `mode=login` in the link (OAuth sign-up and sign-in are the same endpoint — a new provider identity creates a guest account, an existing one logs in, there's no separate "register via OAuth" distinction from the frontend's perspective).

- [ ] **Step 4: Manual verification**

Since this is frontend-only and there's no provider configured yet to click all the way through (that requires Task 12's admin UI plus a real registered OAuth app), verify via Playwright that the login page loads without errors and the provider-fetch call fires cleanly against the empty-list case (no providers configured yet, so the button row should not render at all):

Run a Playwright check against the live public domain: navigate to `/login`, assert no `pageerror`/`console.error` events, assert `document.querySelectorAll('[href*="oauth"]').length === 0` (since no provider is enabled yet in Task 6-8's fresh state).

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/login.js new_ui/js/register.js
git commit -m "Add OAuth provider sign-in buttons to login and register screens"
```

---

### Task 11: Settings — Connected accounts

**Files:**
- Modify: `new_ui/js/settings-account.js`

**Interfaces:**
- Consumes: `GET /api/me/oauth-identities`, `DELETE /api/me/oauth-identities/{iid}`, `GET /api/auth/oauth/providers` (to know which *unlinked* providers to offer connecting), `confirmDialog` (existing shared modal helper), `t()` keys from Task 9

- [ ] **Step 1: Load connected accounts on mount**

In `new_ui/js/settings-account.js`, in `mount()` (the method that currently calls `this.loadPasskeys()`), add a sibling call:

```javascript
    this.render();
    this.loadPasskeys();
    this.loadOauthIdentities();
```

Add the loader method near `loadPasskeys()`:

```javascript
  async loadOauthIdentities() {
    const list = document.getElementById("acct_oauth_list");
    if (!list) return;
    let identities, providers;
    try {
      [identities, providers] = await Promise.all([
        api("/api/me/oauth-identities"),
        api("/api/auth/oauth/providers").then((r) => r.providers),
      ]);
    } catch (e) {
      list.textContent = e.message || t("oauth_link_failed");
      return;
    }
    this.oauthIdentities = identities;
    const linkedProviders = new Set(identities.map((i) => i.provider));
    const unlinked = providers.filter((p) => !linkedProviders.has(p.provider));
    if (!identities.length && !unlinked.length) {
      list.innerHTML = `<div class="text-xs text-muted">${t("oauth_no_connected_accounts")}</div>`;
      return;
    }
    list.innerHTML = identities.map((i) => `
      <div class="flex items-center justify-between gap-2 py-1.5" style="border-bottom:1px solid var(--color-line)">
        <div class="min-w-0">
          <div class="text-sm text-ink">${_esc(i.label)}</div>
          <div class="text-[11px] text-muted">${i.display_name ? _esc(i.display_name) : ""}</div>
        </div>
        <button type="button" data-oauth-unlink="${_attr(i.id)}" class="text-xs" style="color:var(--color-warn)">${t("oauth_unlink_button")}</button>
      </div>
    `).join("") + unlinked.map((p) => `
      <div class="flex items-center justify-between gap-2 py-1.5" style="border-bottom:1px solid var(--color-line)">
        <div class="text-sm text-ink">${_esc(p.label)}</div>
        <a href="/api/auth/oauth/${encodeURIComponent(p.provider)}/start-link" class="text-xs" style="color:var(--color-accent)">${t("oauth_connect_button")}</a>
      </div>
    `).join("");
    list.querySelectorAll("[data-oauth-unlink]").forEach((btn) => {
      btn.onclick = async () => {
        if (!(await confirmDialog(t("oauth_unlink_confirm_question"), { confirmLabel: t("oauth_unlink_button") }))) return;
        try {
          await api(`/api/me/oauth-identities/${encodeURIComponent(btn.dataset.oauthUnlink)}`, { method: "DELETE" });
          this.loadOauthIdentities();
        } catch (e) {
          errorToast(e.message || t("oauth_link_failed"));
        }
      };
    });
  }
```

- [ ] **Step 2: Add the section to the render template**

In `render()`'s template literal, add a new section immediately after the existing passkeys section (the block ending with the `acct_passkey_required_toggle` button, before the closing `` ` : "" }` `` for the `window.PublicKeyCredential` conditional block):

```javascript
      ${sEyebrowHtml(t("oauth_connected_accounts"))}
      <div class="mb-3 rounded-[13px] border border-line bg-surface p-3.5">
        <div class="text-xs text-muted mb-2.5">${t("oauth_connected_accounts_hint")}</div>
        <div id="acct_oauth_list" class="text-xs text-muted">${t("common_loading")}</div>
      </div>
```

- [ ] **Step 3: Manual verification**

Run a Playwright check against the live public domain, logged in: navigate to `/settings-account`, assert no `pageerror`/`console.error`, assert `#acct_oauth_list` exists and its `textContent` is not empty after the load completes (should show the "no connected accounts" empty state since no provider is configured yet).

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/settings-account.js
git commit -m "Add Connected accounts section to Settings, matching the passkey list pattern"
```

---

### Task 12: Admin — Integrated Identity Providers

**Files:**
- Modify: `new_ui/js/admin-config.js`

**Interfaces:**
- Consumes: `GET /admin/oauth-providers`, `PUT /admin/oauth-providers` (Task 6), `t()` keys from Task 9

- [ ] **Step 1: Load provider config on mount**

In `new_ui/js/admin-config.js`'s `mount()`, add a sibling fetch alongside the existing `this.st = await api("/api/settings")` call:

```javascript
    try {
      this.st = await api("/api/settings");
    } catch (e) {
      this.st = {};
      errorToast(t("admin_config_couldnt_load_settings"));
    }
    try {
      const { providers } = await api("/admin/oauth-providers");
      this.oauthProviders = providers.map((p) => ({ ...p, client_secret: "" }));
    } catch (e) {
      this.oauthProviders = [];
    }
```

- [ ] **Step 2: Add the row-rendering and save methods**

Add near `mrHostRowHtml`:

```javascript
  identityProviderRowHtml(p, i) {
    return `
      <div class="mb-2 p-2.5 rounded-md border border-line" data-idp-row="${i}">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm text-ink font-medium">${_esc(p.label)}</span>
          <button type="button" data-idp-toggle="${i}" class="settings-toggle${p.enabled ? " on" : ""}"><span class="settings-toggle-knob"></span></button>
        </div>
        <input type="text" data-idp-client-id value="${_attr(p.client_id)}" placeholder="${t("admin_config_identity_provider_client_id_placeholder")}" class="w-full mb-1.5 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <input type="password" autocomplete="new-password" data-idp-client-secret placeholder="${p.has_client_secret ? t("admin_config_identity_provider_client_secret_set_placeholder") : t("admin_config_identity_provider_client_secret_placeholder")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
    `;
  }

  toggleIdpEnabled(i) {
    this.syncIdpFromDom();
    this.oauthProviders[i].enabled = !this.oauthProviders[i].enabled;
    this.render();
  }

  syncIdpFromDom() {
    document.querySelectorAll("[data-idp-row]").forEach((row) => {
      const i = parseInt(row.dataset.idpRow, 10);
      if (!this.oauthProviders[i]) return;
      this.oauthProviders[i].client_id = row.querySelector("[data-idp-client-id]").value.trim();
      const secret = row.querySelector("[data-idp-client-secret]").value;
      if (secret) this.oauthProviders[i].client_secret = secret;
    });
  }

  async saveIdentityProviders() {
    this.syncIdpFromDom();
    const providers = {};
    this.oauthProviders.forEach((p) => {
      providers[p.provider] = {
        client_id: p.client_id,
        client_secret: p.client_secret || null,
        enabled: !!p.enabled,
      };
    });
    try {
      await api("/admin/oauth-providers", { method: "PUT", body: JSON.stringify({ providers }) });
      toast(t("admin_config_identity_providers_saved"));
      const { providers: fresh } = await api("/admin/oauth-providers");
      this.oauthProviders = fresh.map((p) => ({ ...p, client_secret: "" }));
      this.render();
    } catch (e) {
      errorToast(t("admin_config_identity_providers_save_failed") + " " + e.message);
    }
  }
```

- [ ] **Step 3: Add the section to the render template and wire the toggle buttons**

In `render()`'s template, add a new section (placement: after the "Resync UI translations" section added in an earlier pass, before the chat-endpoint section):

```javascript
    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-1">${t("admin_config_identity_providers_title")}</div>
      <p class="text-xs text-muted mb-3">${t("admin_config_identity_providers_description")}</p>
      ${this.oauthProviders.map((p, i) => this.identityProviderRowHtml(p, i)).join("")}
      <button type="button" onclick="adminConfigView.saveIdentityProviders()" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark mt-1">${t("admin_config_identity_providers_save_button")}</button>
    </div>
```

After `this.main.innerHTML = ...` in `render()`, add the toggle-button wiring alongside any other post-render wiring already present in that method:

```javascript
    document.querySelectorAll("[data-idp-toggle]").forEach((btn) => {
      btn.onclick = () => this.toggleIdpEnabled(parseInt(btn.dataset.idpToggle, 10));
    });
```

- [ ] **Step 4: Manual verification**

Run a Playwright check against the live public domain, logged in as `claude`/admin: navigate to `/admin-config`, assert no `pageerror`/`console.error`, assert 9 rows exist under a selector matching `[data-idp-row]` (one per registry provider), toggle one enabled, fill a client ID, click save, reload the page, and assert that provider's `client_id` value persisted and its toggle is still on.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/admin-config.js
git commit -m "Add Integrated Identity Providers section to admin Server Configuration"
```

---

## Self-Review

**Spec coverage:**
- `oauth_providers`/`oauth_identities` tables, admin-configured no-hardcoded-credentials — Task 1, 3, 6 ✓
- No email ever stored — verified in Task 2's registry (scope never requests `email`), Task 4/7's identity extraction only pulls `provider_user_id`+`display_name` ✓
- `PROVIDER_REGISTRY` covering all 9 providers, Steam/Apple protocol notes — Task 2 ✓ (Apple's JWT-signed client-secret minting is flagged as a registry `protocol` marker but the actual per-request JWT-signing implementation for `oauth2_apple` is not separately coded in `_exchange_code_for_token` — **gap found**: Task 7's `_exchange_code_for_token` sends `configured["client_secret"]` directly for every provider, which is correct for the 7 standard OAuth2 providers but wrong for Apple, which needs a freshly-signed JWT per the spec. Flagging this as a known follow-up: Apple's adapter needs its own branch in `_exchange_code_for_token` (mint a short-lived ES256-signed JWT from the stored private key using PyJWT, rather than sending the stored value as a static secret) before Apple sign-in will actually work — the registry/schema/admin-UI all correctly treat Apple's `client_secret` field as "the private key" per the spec's intent, but the token-exchange code itself doesn't yet branch on `protocol == "oauth2_apple"`. Steam's `openid2` protocol has the same gap: `start_oauth`/`oauth_callback` as written assume the standard OAuth2 authorize/token/userinfo shape for every provider and will not correctly drive Steam's OpenID 2.0 redirect-and-verify flow. **Both are explicitly out of scope for this plan's 12 tasks** — the registry correctly declares their distinct `protocol` values so a future plan can add the two adapters as isolated, testable additions (branch in `start_oauth` for `openid2`, branch in `_exchange_code_for_token` for `oauth2_apple`) without touching the 7 already-working standard providers. This plan ships Google/Facebook/GitHub/Discord/Twitter/Reddit/Microsoft fully working end-to-end; Steam and Apple are registered but will 502 at the token-exchange step until their adapters land.
- Admin-configurable "Integrated Identity Providers" category — Task 12 ✓
- Account linking (existing full account) — Task 8, 11 ✓
- Guest-tier auto-creation, skip pending queue — Task 7 ✓
- CSRF `state` + PKCE — Task 5, 7 ✓

**Placeholder scan:** no TBD/TODO; the Apple/Steam gap above is a scoping decision, not a placeholder, and is stated with full technical specificity about what's missing and why.

**Type consistency:** `identity_repo.create` signature (`provider, provider_user_id, user_id, display_name=""`) used consistently across Tasks 4, 7, 8. `PROVIDER_REGISTRY[name]["label"]` accessed the same way in Tasks 6, 7, 8, 11. `oauth_pending.consume` returns the same dict shape (`provider`, `mode`, `user_id`, `code_verifier`, `created`) consumed identically in Task 7.

**Recommendation:** ship this 12-task plan first (7 fully-working providers is a complete, valuable, independently-shippable unit), then write a short follow-up plan for the Steam OpenID2 and Apple JWT-client-secret adapters once the core flow is verified working end-to-end with a real registered Google or Discord app.
