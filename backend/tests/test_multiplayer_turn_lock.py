import os

import pytest
from fastapi import HTTPException

from backend import chat_service
from backend.repositories import chat_sessions, characters, session_participants as sp, memory_facts

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "1024"))

@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(_EMBED_DIM)

async def _make_rpg_session():
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, "friend-1", None, "member")
    return sid

async def test_run_rejects_new_action_while_generation_active_for_multiplayer(db_conn):
    sid = await _make_rpg_session()
    handle = chat_service.GenHandle(sid)
    chat_service._active_gen[sid] = handle
    try:
        with pytest.raises(HTTPException) as exc_info:
            await chat_service._run(sid, user_content="I act.", current_user={"id": "friend-1"})
        assert exc_info.value.status_code == 409
    finally:
        chat_service._active_gen.pop(sid, None)

async def test_run_allows_action_when_no_active_generation(db_conn):
    sid = await _make_rpg_session()
    assert sid not in chat_service._active_gen

async def test_run_allows_action_after_generation_marked_done(db_conn, monkeypatch):
    sid = await _make_rpg_session()
    handle = chat_service.GenHandle(sid)
    handle.done = True
    chat_service._active_gen[sid] = handle
    reached_turn = {}

    async def fake_run_turn(session, participant_rows, is_multiplayer, *args, **kwargs):
        reached_turn["multiplayer"] = is_multiplayer
        return "streamed"

    monkeypatch.setattr(chat_service, "_run_turn", fake_run_turn)
    try:
        result = await chat_service._run(sid, user_content="I act.", current_user={"id": "friend-1"})
        assert result == "streamed"
        assert reached_turn["multiplayer"] is True
        assert chat_service._active_gen[sid] is not handle
    finally:
        chat_service._active_gen.pop(sid, None)
