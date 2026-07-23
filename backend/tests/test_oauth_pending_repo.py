import time

import pytest

from backend import db
from backend.repositories import oauth_pending as pending_repo

pytestmark = pytest.mark.asyncio


async def test_oauth_pending_table_exists(db_conn):
    from sqlalchemy import select
    result = await db._q(select(db.oauth_pending).limit(0))
    assert result == []


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
    await db._w(db.insert(db.oauth_pending).values(
        state="stale-state", provider="google", mode="login",
        user_id=None, code_verifier=None, created=time.time() - 600))
    await pending_repo.create("fresh-state", "google", "login", None, None)
    purged = await pending_repo.purge_expired(max_age_seconds=300)
    assert purged == 1
    assert await pending_repo.consume("fresh-state") is not None
