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


async def test_set_persona_updates_id_and_name(db_conn):
    sid = await _make_session(db_conn, persona_id=None, user_name="You")
    await chat_sessions.set_persona(sid, "persona-1", "Tarion")
    s = await chat_sessions.get(sid)
    assert s["persona_id"] == "persona-1"
    assert s["user_name"] == "Tarion"


async def test_add_message_persists_mood(db_conn):
    sid = await _make_session(db_conn)
    await chat_sessions.add_message(sid, "user", "I didn't have a choice.")
    msg = await chat_sessions.add_message(sid, "assistant", "There's always a choice.", mood="seething")
    msgs = await chat_sessions.list_messages(sid)
    assert msg["mood"] == "seething"
    assert msgs[-1]["mood"] == "seething"


async def test_user_message_snapshots_persona_at_send_time(db_conn):
    sid = await _make_session(db_conn, user_name="Tarion")
    await chat_sessions.add_message(sid, "user", "Line one.", user_name="Tarion",
                                    persona_avatar="/media/tarion.png")
    await chat_sessions.set_persona(sid, "persona-2", "Ryoshu")
    await chat_sessions.add_message(sid, "user", "Line two.", user_name="Ryoshu",
                                    persona_avatar="/media/ryoshu.png")
    msgs = [m for m in await chat_sessions.list_messages(sid) if m["role"] == "user"]
    assert msgs[0]["user_name"] == "Tarion"
    assert msgs[0]["persona_avatar"] == "/media/tarion.png"
    assert msgs[1]["user_name"] == "Ryoshu"
    assert msgs[1]["persona_avatar"] == "/media/ryoshu.png"


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


async def test_new_session_defaults_to_epic_length(db_conn):
    sid = await _make_session(db_conn)
    s = await chat_sessions.get(sid)
    assert s["length_key"] == "epic"


async def test_set_length(db_conn):
    sid = await _make_session(db_conn)
    await chat_sessions.set_length(sid, "brief")
    s = await chat_sessions.get(sid)
    assert s["length_key"] == "brief"


async def test_branch_copies_length_key(db_conn):
    sid = await _make_session(db_conn)
    await chat_sessions.set_length(sid, "brief")
    msg = await chat_sessions.add_message(sid, "assistant", "hi")
    new_sid = await chat_sessions.branch(sid, msg["id"], user_id=None)
    branched = await chat_sessions.get(new_sid)
    assert branched["length_key"] == "brief"


async def test_new_session_defaults_to_explicit_mode_off(db_conn):
    sid = await _make_session(db_conn)
    s = await chat_sessions.get(sid)
    assert s["explicit_mode"] == 0


async def test_set_explicit_mode(db_conn):
    sid = await _make_session(db_conn)
    await chat_sessions.set_explicit_mode(sid, True)
    s = await chat_sessions.get(sid)
    assert s["explicit_mode"] == 1
    await chat_sessions.set_explicit_mode(sid, False)
    s = await chat_sessions.get(sid)
    assert s["explicit_mode"] == 0
