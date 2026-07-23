import json
import os

import pytest

from backend import chat_service, llm, memory_service
from backend.repositories import chat_sessions, characters, memory_facts

from backend.tests.conftest import db_conn

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "768"))


@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(_EMBED_DIM)


def _fake_chat_stream(reply_text):
    async def _stream(messages, model, params=None, parse_think=False,
                      base_url=None, api_key=None, pin_host=False):
        yield ("content", reply_text)
    return _stream


@pytest.fixture(autouse=True)
def _stub_memory_extraction(monkeypatch):
    async def _noop_maybe_extract(*args, **kwargs):
        return None
    monkeypatch.setattr(memory_service, "maybe_extract", _noop_maybe_extract)


@pytest.fixture(autouse=True)
def _stub_embed(monkeypatch):
    async def _no_embed(*args, **kwargs):
        raise RuntimeError("embed endpoint unreachable in tests")
    monkeypatch.setattr(llm, "embed", _no_embed)


async def _drain(sid):
    handle = chat_service._active_gen[sid]
    await handle.task
    return [json.loads(raw.removeprefix("data: ").strip()) for raw in handle._buf]


async def test_continue_merges_into_previous_message(monkeypatch, db_conn):
    char = await characters.create({"owner_id": "owner-1", "name": "Aria", "mode": "character"})
    sid = await chat_sessions.create(char["id"], None, "Chat", "You", user_id="owner-1")
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("It began at dusk, when the"))
    await chat_service._run(sid, user_content="Tell me a story.", current_user={"id": "owner-1"})
    await _drain(sid)
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("lanterns flickered awake."))
    await chat_service._run(sid, continue_mode=True, current_user={"id": "owner-1"})
    events = await _drain(sid)
    msgs = await chat_sessions.list_messages(sid)
    assistant_msgs = [m for m in msgs if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    assert assistant_msgs[0]["content"] == "It began at dusk, when the\n\nlanterns flickered awake."
    done = next(e for e in events if e["type"] == "done")
    assert done["message"]["id"] == assistant_msgs[0]["id"]
    assert done["message"]["content"] == assistant_msgs[0]["content"]


async def test_group_regenerate_routes_to_authoring_character(monkeypatch, db_conn):
    char_a = await characters.create({"owner_id": "owner-1", "name": "Alpha", "mode": "character"})
    char_b = await characters.create({"owner_id": "owner-1", "name": "Beta", "mode": "character"})
    sid = await chat_sessions.create_group("owner-1", "Party", [char_a["id"], char_b["id"]])
    from backend.repositories import session_characters
    await session_characters.add_member(sid, char_a["id"])
    await session_characters.add_member(sid, char_b["id"])
    await chat_sessions.add_message(sid, "user", "Hello all.")
    await chat_sessions.add_message(sid, "assistant", "Beta speaks first.", char_id=char_b["id"],
                                    turn_group="tg-1")
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("Beta speaks again, differently."))
    await chat_service._run(sid, regenerate=True, current_user={"id": "owner-1"})
    events = await _drain(sid)
    msgs = await chat_sessions.list_messages(sid)
    assistant_msgs = [m for m in msgs if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    assert assistant_msgs[0]["char_id"] == char_b["id"]
    assert "Beta speaks again" in assistant_msgs[0]["content"]
    assert any(e.get("char_id") == char_b["id"] for e in events if e["type"] == "delta")


async def test_group_continue_rejected(db_conn):
    char_a = await characters.create({"owner_id": "owner-1", "name": "Alpha", "mode": "character"})
    sid = await chat_sessions.create_group("owner-1", "Party", [char_a["id"]])
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await chat_service._run(sid, continue_mode=True, current_user={"id": "owner-1"})
    assert exc_info.value.status_code == 400


async def test_multiplayer_gate_registers_before_first_await(monkeypatch, db_conn):
    from backend.repositories import session_participants as sp
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, "friend-1", None, "member")
    seen = {}
    original = chat_service._resolve_sender_persona
    async def _spy(s, current_user):
        seen["registered"] = s["id"] in chat_service._active_gen
        return await original(s, current_user)
    monkeypatch.setattr(chat_service, "_resolve_sender_persona", _spy)
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("The tale unfolds."))
    await chat_service._run(sid, user_content="I act.", current_user={"id": "owner-1"})
    await _drain(sid)
    assert seen["registered"] is True


async def test_multiplayer_gate_placeholder_cleared_on_failure(db_conn):
    from fastapi import HTTPException
    from backend.repositories import session_participants as sp
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, "friend-1", None, "member")
    with pytest.raises(HTTPException):
        await chat_service._run(sid, continue_mode=True, current_user={"id": "owner-1"})
    assert sid not in chat_service._active_gen
