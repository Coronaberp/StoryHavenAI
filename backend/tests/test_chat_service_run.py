import json
import os

import pytest

from backend import chat_service, llm, memory_service
from backend.repositories import chat_sessions, characters, memory_facts

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

async def _make_session(mode="character"):
    char = await characters.create({"owner_id": "owner-1", "name": "Aria", "mode": mode})
    sid = await chat_sessions.create(char["id"], None, "Chat", "You", user_id="owner-1")
    return sid, char

async def _drain(sid):
    handle = chat_service._active_gen[sid]
    await handle.task
    events = []
    for raw in handle._buf:
        events.append(json.loads(raw.removeprefix("data: ").strip()))
    return events

async def test_run_happy_path_persists_reply_and_emits_done(monkeypatch, db_conn):
    sid, char = await _make_session()
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("Hello there!"))
    await chat_service._run(sid, user_content="Hi!", current_user={"id": "owner-1"})
    events = await _drain(sid)
    done = next(e for e in events if e["type"] == "done")
    assert done["message"]["content"] == "Hello there!"
    messages = await chat_sessions.list_messages(sid)
    assistant_msgs = [m for m in messages if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    assert assistant_msgs[0]["content"] == "Hello there!"

async def test_run_strips_mood_tag_and_reports_it(monkeypatch, db_conn):
    sid, char = await _make_session()
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("Hi! [mood: happy]"))
    await chat_service._run(sid, user_content="Hi!", current_user={"id": "owner-1"})
    events = await _drain(sid)
    done = next(e for e in events if e["type"] == "done")
    assert done["mood"] == "happy"
    assert "[mood:" not in done["message"]["content"]

async def test_run_blanks_leaked_ciphertext(monkeypatch, db_conn):
    sid, char = await _make_session()
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("secret value: enc:abcd1234=="))
    await chat_service._run(sid, user_content="Hi!", current_user={"id": "owner-1"})
    events = await _drain(sid)
    done = next(e for e in events if e["type"] == "done")
    assert "enc:" not in done["message"]["content"]

async def test_run_regenerate_adds_swipe_not_new_message(monkeypatch, db_conn):
    sid, char = await _make_session()
    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("First reply."))
    await chat_service._run(sid, user_content="Hi!", current_user={"id": "owner-1"})
    await _drain(sid)
    messages = await chat_sessions.list_messages(sid)
    assert len([m for m in messages if m["role"] == "assistant"]) == 1

    monkeypatch.setattr(llm, "chat_stream", _fake_chat_stream("Second reply."))
    await chat_service._run(sid, regenerate=True, current_user={"id": "owner-1"})
    events = await _drain(sid)
    done = next(e for e in events if e["type"] == "done")
    assert done["message"]["content"] == "Second reply."
    assert done["message"]["swipe_count"] == 2

    messages = await chat_sessions.list_messages(sid)
    assistant_msgs = [m for m in messages if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    assert assistant_msgs[0]["content"] == "Second reply."

async def test_run_generation_error_still_emits_done_with_empty_reply(monkeypatch, db_conn):
    sid, char = await _make_session()

    async def _boom(*args, **kwargs):
        raise RuntimeError("upstream unreachable")
        yield
    monkeypatch.setattr(llm, "chat_stream", _boom)

    await chat_service._run(sid, user_content="Hi!", current_user={"id": "owner-1"})
    events = await _drain(sid)
    assert any(e["type"] == "error" for e in events)
    done = next(e for e in events if e["type"] == "done")
    assert done["message"]["content"] == ""
