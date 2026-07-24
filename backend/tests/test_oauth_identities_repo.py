import pytest

from backend import db

pytestmark = pytest.mark.asyncio

async def test_oauth_identities_table_exists(db_conn):
    from sqlalchemy import select
    result = await db._q(select(db.oauth_identities).limit(0))
    assert result == []

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
