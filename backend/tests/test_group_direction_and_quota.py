import json
import os

import pytest

from backend import chat_service, guest_quota, llm, memory_service
from backend.repositories import chat_sessions, characters, memory_facts, session_characters, users as user_repo

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

def _fake_chat_stream(reply_text):
    async def _stream(messages, model, params=None, parse_think=False,
                      base_url=None, api_key=None, pin_host=False):
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

async def test_group_regenerate_carries_direction_into_prompt(monkeypatch, db_conn):
    sid, char_ids = await _make_group("owner-direction", count=2)
    await chat_sessions.add_message(sid, "user", "Hello all.")
    await chat_sessions.add_message(sid, "assistant", "Beta speaks first.",
                                    char_id=char_ids[1], turn_group="tg-1")
    captured = []
    async def _stream(messages, model, params=None, parse_think=False,
                      base_url=None, api_key=None, pin_host=False):
        captured.append(messages)
        yield ("content", "Beta speaks again, differently.")
    monkeypatch.setattr(llm, "chat_stream", _stream)
    await chat_service._run(sid, regenerate=True, direction="make her furious",
                            current_user={"id": "owner-direction"})
    await _drain(sid)
    steering = [m for m in captured[-1] if m["role"] == "system" and "make her furious" in m["content"]]
    assert steering
    assert "rewritten" in steering[0]["content"]

async def test_group_regenerate_without_direction_adds_no_steering(monkeypatch, db_conn):
    sid, char_ids = await _make_group("owner-direction-2", count=1)
    await chat_sessions.add_message(sid, "user", "Hello all.")
    await chat_sessions.add_message(sid, "assistant", "First take.",
                                    char_id=char_ids[0], turn_group="tg-1")
    captured = []
    async def _stream(messages, model, params=None, parse_think=False,
                      base_url=None, api_key=None, pin_host=False):
        captured.append(messages)
        yield ("content", "Second take.")
    monkeypatch.setattr(llm, "chat_stream", _stream)
    await chat_service._run(sid, regenerate=True, current_user={"id": "owner-direction-2"})
    await _drain(sid)
    assert not [m for m in captured[-1] if "author directs this new reply" in (m["content"] or "")]

async def test_group_multi_reply_turn_reserves_and_settles_each_reply(monkeypatch, db_conn):
    guest = await user_repo.create_user("group-quota-guest", "pw12345678", tier="guest")
    sid, char_ids = await _make_group(guest["id"], count=2)
    async def _fake_next_speaker(*args, **kwargs):
        return list(char_ids)
    monkeypatch.setattr(chat_service, "next_speaker", _fake_next_speaker)
    monkeypatch.setattr(llm, "chat_stream",
                        _fake_chat_stream("A reasonably long reply for token accounting."))
    await chat_service._run(sid, user_content="Hello all.", current_user=guest)
    await _drain(sid)
    updated = await user_repo.get_user_by_id(guest["id"])
    assert updated["guest_tokens_used"] > 0
    msgs = await chat_sessions.list_messages(sid)
    assistant_msgs = [m for m in msgs if m["role"] == "assistant"]
    assert len(assistant_msgs) == 2

async def test_group_reply_failure_still_settles_reservation(monkeypatch, db_conn):
    sid, char_ids = await _make_group("owner-quota-fail", count=1)
    calls = []
    async def _fake_reserve(user, kind, amount=1):
        calls.append(("reserve", kind, amount))
    async def _fake_refund(user, kind, amount):
        calls.append(("refund", kind, amount))
    async def _fake_record(user, kind, amount=1):
        calls.append(("record", kind, amount))
    monkeypatch.setattr(guest_quota, "reserve", _fake_reserve)
    monkeypatch.setattr(guest_quota, "refund", _fake_refund)
    monkeypatch.setattr(guest_quota, "record", _fake_record)
    async def _boom(*args, **kwargs):
        raise RuntimeError("llm unreachable")
        yield
    monkeypatch.setattr(llm, "chat_stream", _boom)
    current_user = {"id": "owner-quota-fail", "tier": "guest"}
    await chat_service._run(sid, user_content="Hello all.", current_user=current_user)
    await _drain(sid)
    kinds = [call[0] for call in calls]
    assert kinds.count("reserve") == 1
    assert kinds.count("refund") + kinds.count("record") == 1

async def test_group_reply_cancellation_still_settles_reservation(monkeypatch, db_conn):
    import asyncio
    sid, char_ids = await _make_group("owner-quota-cancel", count=1)
    calls = []
    async def _fake_reserve(user, kind, amount=1):
        calls.append(("reserve", kind, amount))
    async def _fake_refund(user, kind, amount):
        calls.append(("refund", kind, amount))
    async def _fake_record(user, kind, amount=1):
        calls.append(("record", kind, amount))
    monkeypatch.setattr(guest_quota, "reserve", _fake_reserve)
    monkeypatch.setattr(guest_quota, "refund", _fake_refund)
    monkeypatch.setattr(guest_quota, "record", _fake_record)
    async def _hangs(*args, **kwargs):
        await asyncio.sleep(10)
        yield ("content", "never reached")
    monkeypatch.setattr(llm, "chat_stream", _hangs)
    current_user = {"id": "owner-quota-cancel", "tier": "guest"}
    await chat_service._run(sid, user_content="Hello all.", current_user=current_user)
    handle = chat_service._active_gen.get(sid) or chat_service._active_gen[sid]
    await asyncio.sleep(0.05)
    handle.task.cancel()
    await handle.task
    kinds = [call[0] for call in calls]
    assert kinds.count("reserve") == 1
    assert kinds.count("refund") + kinds.count("record") == 1
