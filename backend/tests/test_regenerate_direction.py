import json
import os

import pytest

from backend import chat_service, llm, memory_service
from backend.routers import chat as chat_router
from backend.schemas import ChatIn
from backend.repositories import chat_sessions, characters, memory_facts

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

    async def fake_run(sid, **kwargs):
        calls.update(kwargs)
        return {"ok": True}

    monkeypatch.setattr(chat_router, "_own_session", fake_own_session)
    monkeypatch.setattr(chat_router, "_run", fake_run)
    return calls

async def test_regenerate_route_forwards_direction(routed):
    await chat_router.regenerate("sid1", ChatIn(content="make her furious"),
                                 current_user={"id": "u1", "username": "u"})
    assert routed["regenerate"] is True
    assert routed["direction"] == "make her furious"

async def test_regenerate_route_without_body_sends_no_direction(routed):
    await chat_router.regenerate("sid1", None, current_user={"id": "u1", "username": "u"})
    assert routed["direction"] is None

async def test_regenerate_route_blank_direction_is_none(routed):
    await chat_router.regenerate("sid1", ChatIn(content="   "),
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

async def test_run_regenerate_direction_reaches_the_prompt(monkeypatch, db_conn):
    char = await characters.create({"owner_id": "owner-1", "name": "Aria", "mode": "character"})
    sid = await chat_sessions.create(char["id"], None, "Chat", "You", user_id="owner-1")
    captured = []
    monkeypatch.setattr(llm, "chat_stream", _capture_stream(captured, "First reply."))
    await chat_service._run(sid, user_content="Hi!", current_user={"id": "owner-1"})
    await _drain(sid)
    await chat_service._run(sid, regenerate=True, direction="make her furious",
                            current_user={"id": "owner-1"})
    await _drain(sid)
    steering = [m for m in captured[-1]
                if m["role"] == "system" and "make her furious" in m["content"]]
    assert steering
    assert "rewritten" in steering[0]["content"]

async def test_run_regenerate_without_direction_adds_no_steering(monkeypatch, db_conn):
    char = await characters.create({"owner_id": "owner-2", "name": "Bex", "mode": "character"})
    sid = await chat_sessions.create(char["id"], None, "Chat", "You", user_id="owner-2")
    captured = []
    monkeypatch.setattr(llm, "chat_stream", _capture_stream(captured, "First reply."))
    await chat_service._run(sid, user_content="Hi!", current_user={"id": "owner-2"})
    await _drain(sid)
    await chat_service._run(sid, regenerate=True, current_user={"id": "owner-2"})
    await _drain(sid)
    assert not [m for m in captured[-1] if "author directs this new reply" in (m["content"] or "")]
