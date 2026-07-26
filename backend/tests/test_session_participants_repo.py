import pytest

pytestmark = pytest.mark.asyncio

async def test_session_participants_table_exists():
    from backend.db import session_participants
    assert session_participants.name == "session_participants"
    cols = {c.name for c in session_participants.columns}
    assert cols == {"session_id", "user_id", "role", "joined_at", "chat_proxy_override_id", "left_at"}

async def test_messages_table_has_sender_user_id():
    from backend.db import messages
    cols = {c.name for c in messages.columns}
    assert "sender_user_id" in cols

from backend.repositories import session_participants as sp

async def test_add_and_list(db_conn):
    await sp.add("sess-1", "user-a", "host")
    await sp.add("sess-1", "user-b", "member")
    rows = await sp.list_for_session("sess-1")
    assert {r["user_id"] for r in rows} == {"user-a", "user-b"}
    host = next(r for r in rows if r["user_id"] == "user-a")
    assert host["role"] == "host"

async def test_is_participant(db_conn):
    await sp.add("sess-2", "user-a", "host")
    assert await sp.is_participant("sess-2", "user-a") is True
    assert await sp.is_participant("sess-2", "user-z") is False

async def test_remove(db_conn):
    await sp.add("sess-3", "user-a", "host")
    await sp.remove("sess-3", "user-a")
    assert await sp.list_for_session("sess-3") == []

async def test_list_session_ids_for_user(db_conn):
    await sp.add("sess-5", "user-a", "member")
    await sp.add("sess-6", "user-a", "host")
    await sp.add("sess-7", "user-b", "host")
    ids = await sp.list_session_ids_for_user("user-a")
    assert set(ids) == {"sess-5", "sess-6"}

async def test_add_rejects_ninth_participant(db_conn):
    for i in range(8):
        await sp.add("sess-4", f"user-{i}", "host" if i == 0 else "member")
    with pytest.raises(ValueError, match="session full"):
        await sp.add("sess-4", "user-9", "member")

async def test_add_reactivates_a_left_participant(db_conn):
    await sp.add("sess-9", "user-a", "member")
    await sp.remove("sess-9", "user-a")
    await sp.add("sess-9", "user-a", "member")
    rows = await sp.list_for_session("sess-9")
    assert {r["user_id"] for r in rows} == {"user-a"}
