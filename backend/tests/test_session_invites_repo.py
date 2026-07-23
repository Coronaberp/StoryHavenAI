import pytest

from backend.repositories import session_invites as si

pytestmark = pytest.mark.asyncio


async def test_create_and_resolve(db_conn):
    token = await si.create_link("sess-1", "owner-1")
    resolved = await si.resolve(token)
    assert resolved is not None
    assert resolved["session_id"] == "sess-1"
    assert resolved["created_by"] == "owner-1"


async def test_resolve_unknown_token_returns_none(db_conn):
    assert await si.resolve("not-a-real-token") is None


async def test_revoke_all_for_session_invalidates_token(db_conn):
    token = await si.create_link("sess-2", "owner-1")
    await si.revoke_all_for_session("sess-2")
    assert await si.resolve(token) is None


async def test_revoke_does_not_affect_other_sessions(db_conn):
    token_a = await si.create_link("sess-3", "owner-1")
    token_b = await si.create_link("sess-4", "owner-1")
    await si.revoke_all_for_session("sess-3")
    assert await si.resolve(token_a) is None
    assert await si.resolve(token_b) is not None
