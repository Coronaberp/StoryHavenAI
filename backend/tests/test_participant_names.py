import pytest

from backend.chat_service import participant_display_name
from backend.repositories import persona_claims

pytestmark = pytest.mark.asyncio


def test_persona_name_wins():
    assert participant_display_name({"name": "Kaelen"}, {"display_name": "Dana", "username": "dana1"}) == "Kaelen"


def test_display_name_when_no_persona():
    assert participant_display_name(None, {"display_name": "Dana", "username": "dana1"}) == "Dana"


def test_username_when_display_name_empty():
    assert participant_display_name(None, {"display_name": "", "username": "dana1"}) == "dana1"


def test_you_when_no_user_row():
    assert participant_display_name(None, None) == "You"


def test_empty_persona_name_falls_through():
    assert participant_display_name({"name": ""}, {"display_name": "", "username": "dana1"}) == "dana1"


from backend.chat_service import _resolve_sender_persona
from backend.repositories import chat_sessions, characters, session_participants


async def _multiplayer_session(host_id="host-1"):
    char = await characters.create({"owner_id": host_id, "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "You", user_id=host_id)
    await session_participants.add(sid, host_id, "host")
    return await chat_sessions.get(sid)


async def test_personaless_participant_uses_account_name(db_conn):
    session = await _multiplayer_session()
    current_user = {"id": "host-1", "username": "dana1", "display_name": "Dana"}
    persona, name = await _resolve_sender_persona(session, current_user)
    assert persona is None
    assert name == "Dana"


async def test_personaless_participant_falls_back_to_username(db_conn):
    session = await _multiplayer_session()
    current_user = {"id": "host-1", "username": "dana1", "display_name": ""}
    persona, name = await _resolve_sender_persona(session, current_user)
    assert name == "dana1"


async def test_deleted_persona_row_falls_back_to_account_name(db_conn):
    char = await characters.create({"owner_id": "host-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "You", user_id="host-1")
    await session_participants.add(sid, "host-1", "host")
    await persona_claims.claim(sid, "p-gone", "host-1")
    session = await chat_sessions.get(sid)
    current_user = {"id": "host-1", "username": "dana1", "display_name": "Dana"}
    persona, name = await _resolve_sender_persona(session, current_user)
    assert persona is None
    assert name == "Dana"


async def test_solo_session_still_you(db_conn):
    char = await characters.create({"owner_id": "solo-1", "name": "Char", "mode": "character"})
    sid = await chat_sessions.create(char["id"], None, "Solo", "You", user_id="solo-1")
    session = await chat_sessions.get(sid)
    current_user = {"id": "solo-1", "username": "dana1", "display_name": "Dana"}
    persona, name = await _resolve_sender_persona(session, current_user)
    assert name == "You"


from backend.chat_service import _other_player_names
from backend.repositories import users as user_repo


async def test_other_player_names_includes_personaless(db_conn):
    await user_repo.create_user("mira", "pw12345678")
    mira = await user_repo.get_user_by_username("mira")
    rows = [
        {"user_id": "sender-1", "session_id": "irrelevant-sid"},
        {"user_id": mira["id"], "session_id": "irrelevant-sid"},
    ]
    names = await _other_player_names(rows, "sender-1")
    assert names == ["mira"]


from backend.routers import multiplayer as mp


async def test_participants_endpoint_returns_resolved_name(db_conn):
    await user_repo.create_user("theo", "pw12345678")
    theo = await user_repo.get_user_by_username("theo")
    char = await characters.create({"owner_id": theo["id"], "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "You", user_id=theo["id"])
    await session_participants.add(sid, theo["id"], "host")
    rows = await mp.list_participants(sid, current_user=theo)
    assert rows[0]["name"] == "theo"


from backend.chat_service import _session_persona_names
from backend.repositories import personas


async def test_session_persona_names_excludes_unclaimed_session_persona(db_conn):
    session = await _multiplayer_session()
    persona = await personas.create({"name": "Andrea Von Humboldt", "session_id": session["id"]}, user_id="someone-else")
    names = await _session_persona_names(session, None)
    assert "Andrea Von Humboldt" not in names


async def test_session_persona_names_includes_actively_claimed_persona(db_conn):
    session = await _multiplayer_session()
    persona = await personas.create({"name": "Alexander Von Humboldt", "session_id": session["id"]}, user_id="host-1")
    await persona_claims.claim(session["id"], persona["id"], "host-1")
    names = await _session_persona_names(session, None)
    assert "Alexander Von Humboldt" in names


async def test_session_persona_names_excludes_persona_abandoned_by_departed_player(db_conn):
    session = await _multiplayer_session()
    persona = await personas.create({"name": "Faye", "session_id": session["id"]}, user_id="wanderer-1")
    await session_participants.add(session["id"], "wanderer-1", "member")
    await persona_claims.claim(session["id"], persona["id"], "wanderer-1")
    await session_participants.remove(session["id"], "wanderer-1")
    await persona_claims.vacate_by_user(session["id"], "wanderer-1")
    names = await _session_persona_names(session, None)
    assert "Faye" not in names


async def test_session_persona_names_excludes_current_speakers_own_persona(db_conn):
    session = await _multiplayer_session()
    persona = await personas.create({"name": "Alexander Von Humboldt", "session_id": session["id"]}, user_id="host-1")
    await persona_claims.claim(session["id"], persona["id"], "host-1")
    names = await _session_persona_names(session, persona)
    assert "Alexander Von Humboldt" not in names
