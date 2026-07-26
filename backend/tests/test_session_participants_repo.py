import pytest

pytestmark = pytest.mark.asyncio

async def test_session_participants_table_exists():
    from backend.db import session_participants
    assert session_participants.name == "session_participants"
    cols = {c.name for c in session_participants.columns}
    assert cols == {
        "session_id", "user_id", "persona_id", "role", "joined_at",
        "chat_proxy_override_id", "left_at",
    }

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

async def test_rejoin_restores_persona_when_none_supplied(db_conn):
    await sp.add("sess-9", "user-a", "persona-1", "member")
    await sp.remove("sess-9", "user-a")
    await sp.add("sess-9", "user-a", None, "member")
    rows = await sp.list_for_session("sess-9")
    row = next(r for r in rows if r["user_id"] == "user-a")
    assert row["persona_id"] == "persona-1"

async def test_rejoin_with_new_persona_overrides_remembered_one(db_conn):
    await sp.add("sess-10", "user-a", "persona-1", "member")
    await sp.remove("sess-10", "user-a")
    await sp.add("sess-10", "user-a", "persona-2", "member")
    rows = await sp.list_for_session("sess-10")
    row = next(r for r in rows if r["user_id"] == "user-a")
    assert row["persona_id"] == "persona-2"

async def test_left_participant_excluded_from_active_roster(db_conn):
    await sp.add("sess-11", "user-a", None, "host")
    await sp.add("sess-11", "user-b", None, "member")
    await sp.remove("sess-11", "user-b")
    rows = await sp.list_for_session("sess-11")
    assert {r["user_id"] for r in rows} == {"user-a"}
    assert await sp.is_participant("sess-11", "user-b") is False

async def test_left_participant_does_not_occupy_capacity_slot(db_conn):
    await sp.add("sess-12", "user-0", None, "host")
    for i in range(1, 8):
        await sp.add("sess-12", f"user-{i}", None, "member")
    await sp.remove("sess-12", "user-1")
    await sp.add("sess-12", "user-8", None, "member")
    rows = await sp.list_for_session("sess-12")
    assert {r["user_id"] for r in rows} == {"user-0", "user-2", "user-3", "user-4", "user-5", "user-6", "user-7", "user-8"}
