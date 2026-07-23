import asyncio
import json

import pytest

from backend import live_broadcast
from backend.routers import sessions as sessions_router
from backend.repositories import chat_sessions, characters

pytestmark = pytest.mark.asyncio


async def _make_char_with_alt_greetings():
    char = await characters.create({
        "owner_id": "owner-1", "name": "Narrator", "mode": "rpg",
        "greeting": "Welcome to the tale.",
        "alt_greetings": ["A different opening entirely."],
    })
    return char


async def test_swap_greeting_broadcasts_session_updated(db_conn, monkeypatch):
    async def fake_localize(texts, language):
        return texts
    monkeypatch.setattr(sessions_router, "_localize_texts", fake_localize)

    char = await _make_char_with_alt_greetings()
    sid = await chat_sessions.create(char["id"], None, "Party", "Host", user_id="owner-1")
    await chat_sessions.add_message(sid, "assistant", "Welcome to the tale.")

    gen = live_broadcast.stream(sid)
    task = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0)
    await sessions_router.swap_greeting(sid, "next", {"id": "owner-1", "username": "owner-1"})
    payload = await asyncio.wait_for(task, timeout=1)
    event = json.loads(payload.removeprefix("data: ").strip())
    assert event["type"] == "session_updated"
    await gen.aclose()


async def test_swipe_message_broadcasts_session_updated(db_conn):
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "Host", user_id="owner-1")
    msg = await chat_sessions.add_message(sid, "assistant", "The first reply.")
    await chat_sessions.add_swipe(sid, msg["id"], "A different reply.")

    gen = live_broadcast.stream(sid)
    task = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0)
    await sessions_router.swipe_message(sid, msg["id"], "next", {"id": "owner-1", "username": "owner-1"})
    payload = await asyncio.wait_for(task, timeout=1)
    event = json.loads(payload.removeprefix("data: ").strip())
    assert event["type"] == "session_updated"
    await gen.aclose()
