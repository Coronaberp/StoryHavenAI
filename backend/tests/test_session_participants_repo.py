import pytest

pytestmark = pytest.mark.asyncio


async def test_session_participants_table_exists():
    from backend.db import session_participants
    assert session_participants.name == "session_participants"
    cols = {c.name for c in session_participants.columns}
    assert cols == {"session_id", "user_id", "persona_id", "role", "joined_at"}


async def test_messages_table_has_sender_user_id():
    from backend.db import messages
    cols = {c.name for c in messages.columns}
    assert "sender_user_id" in cols


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


async def test_list_session_ids_for_user(db_conn):
    await sp.add("sess-5", "user-a", None, "member")
    await sp.add("sess-6", "user-a", None, "host")
    await sp.add("sess-7", "user-b", None, "host")
    ids = await sp.list_session_ids_for_user("user-a")
    assert set(ids) == {"sess-5", "sess-6"}


async def test_set_persona_updates_only_that_participant(db_conn):
    await sp.add("sess-8", "user-a", None, "host")
    await sp.add("sess-8", "user-b", None, "member")
    await sp.set_persona("sess-8", "user-b", "persona-xyz")
    rows = await sp.list_for_session("sess-8")
    a_row = next(r for r in rows if r["user_id"] == "user-a")
    b_row = next(r for r in rows if r["user_id"] == "user-b")
    assert a_row["persona_id"] is None
    assert b_row["persona_id"] == "persona-xyz"


async def test_add_rejects_ninth_participant(db_conn):
    for i in range(8):
        await sp.add("sess-4", f"user-{i}", None, "host" if i == 0 else "member")
    with pytest.raises(ValueError, match="session full"):
        await sp.add("sess-4", "user-9", None, "member")
