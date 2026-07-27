import pytest

pytestmark = pytest.mark.asyncio

async def test_role_capabilities_table_exists():
    from backend.db import role_capabilities
    assert role_capabilities.name == "role_capabilities"
    cols = {c.name for c in role_capabilities.columns}
    assert cols == {"role", "capability"}

from backend.repositories import role_capabilities as rc

async def test_grant_and_has(db_conn):
    await rc.grant("member", "comments.delete_any")
    assert await rc.has("member", "comments.delete_any") is True

async def test_has_missing_grant_returns_false(db_conn):
    assert await rc.has("guest", "users.delete") is False

async def test_grant_is_idempotent(db_conn):
    await rc.grant("member", "comments.delete_any")
    await rc.grant("member", "comments.delete_any")
    caps = await rc.list_for_role("member")
    assert caps.count("comments.delete_any") == 1

async def test_revoke(db_conn):
    await rc.grant("member", "comments.delete_any")
    await rc.revoke("member", "comments.delete_any")
    assert await rc.has("member", "comments.delete_any") is False

async def test_revoke_missing_grant_is_a_noop(db_conn):
    await rc.revoke("member", "comments.delete_any")
    assert await rc.has("member", "comments.delete_any") is False

async def test_list_for_role(db_conn):
    # Uses an unseeded role name rather than "admin" — seed_defaults() grants admin
    # every capability currently in CAPABILITY_REGISTRY, which grows as more routers
    # register capabilities at import time, so asserting an exact set for "admin"
    # is order-dependent on how many capabilities happen to be registered this run.
    await rc.grant("moderator_test_role", "users.view")
    await rc.grant("moderator_test_role", "users.delete")
    assert set(await rc.list_for_role("moderator_test_role")) == {"users.view", "users.delete"}

async def test_set_all_replaces_existing_grants(db_conn):
    await rc.grant("member", "comments.delete_any")
    await rc.set_all("member", ["users.view"])
    assert set(await rc.list_for_role("member")) == {"users.view"}

async def test_set_all_empty_list_clears_role(db_conn):
    await rc.grant("member", "comments.delete_any")
    await rc.set_all("member", [])
    assert await rc.list_for_role("member") == []
