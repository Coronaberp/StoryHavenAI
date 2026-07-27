import json
import os

import pytest

from backend import chat_service, llm, memory_service
from backend.routers import chat as chat_router
from backend.schemas import ChatIn
from backend.repositories import chat_sessions, characters, memory_facts, session_characters

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "1024"))

@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(_EMBED_DIM)

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

@pytest.fixture()
def routed(monkeypatch):
    calls = {}

    async def fake_own_session(sid, current_user):
        return {"id": sid}

    def fake_check(*args, **kwargs):
        return None

    async def fake_run_group_speak(sid, char_id, current_user, think=None, replace_mid=None, direction=None):
        calls.update(sid=sid, char_id=char_id, think=think, replace_mid=replace_mid, direction=direction)
        return {"ok": True}

    monkeypatch.setattr(chat_router, "_own_session", fake_own_session)
    monkeypatch.setattr(chat_router.guest_quota, "check", fake_check)
    monkeypatch.setattr(chat_router, "run_group_speak", fake_run_group_speak)
    return calls

async def test_group_speak_route_forwards_direction(routed):
    await chat_router.group_speak("sid1", "char1", ChatIn(content="be sarcastic"),
                                  current_user={"id": "u1", "username": "u"})
    assert routed["direction"] == "be sarcastic"

async def test_group_speak_route_without_body_sends_no_direction(routed):
    await chat_router.group_speak("sid1", "char1", None, current_user={"id": "u1", "username": "u"})
    assert routed["direction"] is None

async def test_group_speak_route_blank_direction_is_none(routed):
    await chat_router.group_speak("sid1", "char1", ChatIn(content="   "),
                                  current_user={"id": "u1", "username": "u"})
    assert routed["direction"] is None

async def test_group_reassign_route_forwards_direction(routed):
    await chat_router.group_reassign("sid1", "mid1", "char1", ChatIn(content="be gentler"),
                                     current_user={"id": "u1", "username": "u"})
    assert routed["direction"] == "be gentler"
    assert routed["replace_mid"] == "mid1"

async def test_group_reassign_route_without_body_sends_no_direction(routed):
    await chat_router.group_reassign("sid1", "mid1", "char1", None,
                                     current_user={"id": "u1", "username": "u"})
    assert routed["direction"] is None

def _capture_stream(captured, reply_text):
    async def _stream(messages, model, params=None, parse_think=False,
                      base_url=None, api_key=None, pin_host=False):
        captured.append(messages)
        yield ("content", reply_text)
    return _stream

async def _drain(sid):
    handle = chat_service._active_gen[sid]
    await handle.task
    return [json.loads(raw.removeprefix("data: ").strip()) for raw in handle._buf]

async def _make_group(owner_id, count=1):
    char_ids = []
    for index in range(count):
        char = await characters.create({"owner_id": owner_id, "name": f"Char{index}", "mode": "character"})
        char_ids.append(char["id"])
    sid = await chat_sessions.create_group(owner_id, "Party", char_ids)
    for char_id in char_ids:
        await session_characters.add_member(sid, char_id)
    return sid, char_ids

async def test_run_group_speak_direction_reaches_the_prompt(monkeypatch, db_conn):
    sid, char_ids = await _make_group("owner-speak-direction", count=1)
    await chat_sessions.add_message(sid, "user", "Hello all.")
    captured = []
    monkeypatch.setattr(llm, "chat_stream_with_fallback",
                        lambda *args, **kwargs: _fallback_stream(captured, "A reply.", *args, **kwargs))
    await chat_service.run_group_speak(sid, char_ids[0], {"id": "owner-speak-direction"},
                                       direction="be sarcastic")
    await _drain(sid)
    steering = [m for m in captured[-1]
                if m["role"] == "system" and "be sarcastic" in m["content"]]
    assert steering
    assert "rewritten" in steering[0]["content"]

async def test_run_group_speak_without_direction_adds_no_steering(monkeypatch, db_conn):
    sid, char_ids = await _make_group("owner-speak-direction-2", count=1)
    await chat_sessions.add_message(sid, "user", "Hello all.")
    captured = []
    monkeypatch.setattr(llm, "chat_stream_with_fallback",
                        lambda *args, **kwargs: _fallback_stream(captured, "A reply.", *args, **kwargs))
    await chat_service.run_group_speak(sid, char_ids[0], {"id": "owner-speak-direction-2"})
    await _drain(sid)
    assert not [m for m in captured[-1] if "author directs this new reply" in (m["content"] or "")]

async def _fallback_stream(captured, reply_text, oai, profiles, params, parse_think=False, pin_host=False):
    captured.append(oai)
    yield ("content", reply_text)
