import pytest

from backend import chat_service
from backend.repositories import chat_sessions, session_participants as sp

pytestmark = pytest.mark.asyncio

async def test_own_session_still_works_for_solo_owner(db_conn):
    sid = await chat_sessions.create("char-1", None, "Solo", "You", user_id="owner-1")
    session = await chat_service._own_session(sid, {"id": "owner-1"})
    assert session["id"] == sid

async def test_own_session_rejects_non_owner_non_participant(db_conn):
    from fastapi import HTTPException
    sid = await chat_sessions.create("char-1", None, "Solo", "You", user_id="owner-1")
    with pytest.raises(HTTPException) as exc_info:
        await chat_service._own_session(sid, {"id": "stranger"})
    assert exc_info.value.status_code == 404

async def test_own_session_allows_multiplayer_participant(db_conn):
    sid = await chat_sessions.create("char-1", None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, "friend-1", None, "member")
    session = await chat_service._own_session(sid, {"id": "friend-1"})
    assert session["id"] == sid
