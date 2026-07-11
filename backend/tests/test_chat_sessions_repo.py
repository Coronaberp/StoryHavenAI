import pytest

from backend.repositories import chat_sessions

pytestmark = pytest.mark.asyncio


async def _make_session(db_conn, char_id="char-1", persona_id=None, title="Chat",
                         user_name="You", user_id=None):
    return await chat_sessions.create(char_id, persona_id, title, user_name, user_id)


async def test_create_and_get(db_conn):
    sid = await _make_session(db_conn, title="My Chat")
    s = await chat_sessions.get(sid)
    assert s["id"] == sid
    assert s["title"] == "My Chat"
    assert s["messages"] == []


async def test_get_missing_returns_none(db_conn):
    assert await chat_sessions.get("nonexistent") is None


async def test_list_all_filters_by_user(db_conn):
    mine = await _make_session(db_conn, user_id="user-a")
    other = await _make_session(db_conn, user_id="user-b")
    rows = await chat_sessions.list_all(user_id="user-a")
    ids = {r["id"] for r in rows}
    assert mine in ids
    assert other not in ids


async def test_list_for_char(db_conn):
    sid = await _make_session(db_conn, char_id="char-42")
    rows = await chat_sessions.list_for_char("char-42")
    ids = {r["id"] for r in rows}
    assert sid in ids


async def test_rename(db_conn):
    sid = await _make_session(db_conn, title="Old")
    await chat_sessions.rename(sid, "New")
    s = await chat_sessions.get(sid)
    assert s["title"] == "New"


async def test_set_char_state(db_conn):
    sid = await _make_session(db_conn)
    await chat_sessions.set_char_state(sid, "sleeping", "the tavern", ["Bob"])
    s = await chat_sessions.get(sid)
    assert s["char_doing"] == "sleeping"
    assert s["char_location"] == "the tavern"


async def test_delete(db_conn):
    sid = await _make_session(db_conn)
    await chat_sessions.delete(sid)
    assert await chat_sessions.get(sid) is None


async def test_add_and_list_messages(db_conn):
    sid = await _make_session(db_conn)
    msg = await chat_sessions.add_message(sid, "user", "hello there")
    msgs = await chat_sessions.list_messages(sid)
    assert len(msgs) == 1
    assert msgs[0]["id"] == msg["id"]
    assert msgs[0]["content"] == "hello there"


async def test_edit_message(db_conn):
    sid = await _make_session(db_conn)
    msg = await chat_sessions.add_message(sid, "user", "original")
    await chat_sessions.edit_message(sid, msg["id"], "edited")
    msgs = await chat_sessions.list_messages(sid)
    assert msgs[0]["content"] == "edited"


async def test_delete_message(db_conn):
    sid = await _make_session(db_conn)
    msg = await chat_sessions.add_message(sid, "user", "to delete")
    await chat_sessions.delete_message(sid, msg["id"])
    assert await chat_sessions.list_messages(sid) == []


async def test_pop_trailing_assistant(db_conn):
    sid = await _make_session(db_conn)
    await chat_sessions.add_message(sid, "user", "hi")
    await chat_sessions.add_message(sid, "assistant", "reply one")
    await chat_sessions.add_message(sid, "assistant", "reply two")
    await chat_sessions.pop_trailing_assistant(sid)
    msgs = await chat_sessions.list_messages(sid)
    assert [m["role"] for m in msgs] == ["user"]
