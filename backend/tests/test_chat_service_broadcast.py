import asyncio
import json
import os

import pytest

from backend import chat_service, live_broadcast, llm, memory_service
from backend.repositories import chat_sessions, characters, personas, session_participants as sp, memory_facts

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

async def test_gen_handle_finish_broadcasts_done():
    sid = "sess-finish-1"
    gen = live_broadcast.stream(sid)
    task = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0)
    handle = chat_service.GenHandle(sid)
    chat_service._active_gen[sid] = handle
    handle.finish()
    payload = await asyncio.wait_for(task, timeout=1)
    assert json.loads(payload.removeprefix("data: ").strip())["type"] == "done"
    await gen.aclose()

async def _make_rpg_session():
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, "friend-1", None, "member")
    return sid

async def test_run_broadcasts_generating_with_sender_before_any_failure(db_conn, monkeypatch):
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("The scene continues."))
    sid = await _make_rpg_session()
    gen = live_broadcast.stream(sid)
    task = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0)
    await chat_service._run(sid, user_content="I act.", current_user={"id": "friend-1"})
    payload = await asyncio.wait_for(task, timeout=1)
    event = json.loads(payload.removeprefix("data: ").strip())
    assert event["type"] == "generating"
    assert event["sender_user_id"] == "friend-1"
    await chat_service._active_gen[sid].task
    await gen.aclose()

async def test_run_attributes_message_to_acting_participants_own_persona(db_conn, monkeypatch):
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("The scene continues."))
    host_persona = await personas.create({"name": "Tomio"}, user_id="owner-1")
    friend_persona = await personas.create({"name": "Tanaki"}, user_id="friend-1")
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], host_persona["id"], "Party", "Tomio", user_id="owner-1")
    await sp.add(sid, "owner-1", host_persona["id"], "host")
    await sp.add(sid, "friend-1", friend_persona["id"], "member")
    await chat_service._run(sid, user_content="I act.", current_user={"id": "friend-1"})
    await chat_service._active_gen[sid].task
    messages = await chat_sessions.list_messages(sid)
    user_msgs = [m for m in messages if m["role"] == "user"]
    assert user_msgs
    last = user_msgs[-1]
    assert last["user_name"] == "Tanaki"
    assert last["sender_user_id"] == "friend-1"
