import pytest
from fastapi import HTTPException

from backend.routers import multiplayer as mp
from backend.repositories import chat_sessions, characters, session_participants as sp
from backend.schemas import MultiplayerJoinIn, MultiplayerAcceptIn, PartyChatIn

pytestmark = pytest.mark.asyncio


async def _make_rpg_char():
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    return char["id"]


async def _make_character_mode_char():
    char = await characters.create({"owner_id": "owner-1", "name": "Firstperson", "mode": "character"})
    return char["id"]


def _user(uid):
    return {"id": uid, "username": uid, "experimental_features_enabled": True}


async def test_create_invite_link_requires_rpg_mode(db_conn):
    char_id = await _make_character_mode_char()
    sid = await chat_sessions.create(char_id, None, "Solo", "Host", user_id="owner-1")
    with pytest.raises(HTTPException) as exc_info:
        await mp.create_invite_link(sid, _user("owner-1"))
    assert exc_info.value.status_code == 400


async def test_create_invite_link_promotes_owner_to_host_and_returns_token(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    result = await mp.create_invite_link(sid, _user("owner-1"))
    assert "token" in result
    participants = await sp.list_for_session(sid)
    assert any(p["user_id"] == "owner-1" and p["role"] == "host" for p in participants)


async def test_join_via_link_adds_member(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    link = await mp.create_invite_link(sid, _user("owner-1"))
    result = await mp.join_via_link(sid, MultiplayerJoinIn(token=link["token"], persona_id=None), _user("friend-1"))
    assert result == {"ok": True}
    participants = await sp.list_for_session(sid)
    assert any(p["user_id"] == "friend-1" and p["role"] == "member" for p in participants)


async def test_join_via_link_rejects_revoked_token(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    link = await mp.create_invite_link(sid, _user("owner-1"))
    await mp.revoke_invite_link(sid, _user("owner-1"))
    with pytest.raises(HTTPException) as exc_info:
        await mp.join_via_link(sid, MultiplayerJoinIn(token=link["token"], persona_id=None), _user("friend-1"))
    assert exc_info.value.status_code == 404


async def test_join_via_link_rejects_ninth_participant(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    link = await mp.create_invite_link(sid, _user("owner-1"))
    for i in range(7):
        await mp.join_via_link(sid, MultiplayerJoinIn(token=link["token"], persona_id=None), _user(f"friend-{i}"))
    with pytest.raises(HTTPException) as exc_info:
        await mp.join_via_link(sid, MultiplayerJoinIn(token=link["token"], persona_id=None), _user("friend-9"))
    assert exc_info.value.status_code == 409


async def test_remove_participant_requires_host(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    link = await mp.create_invite_link(sid, _user("owner-1"))
    await mp.join_via_link(sid, MultiplayerJoinIn(token=link["token"], persona_id=None), _user("friend-1"))
    with pytest.raises(HTTPException) as exc_info:
        await mp.remove_participant(sid, "friend-1", _user("friend-1"))
    assert exc_info.value.status_code == 403


async def test_remove_participant_by_host_succeeds(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    link = await mp.create_invite_link(sid, _user("owner-1"))
    await mp.join_via_link(sid, MultiplayerJoinIn(token=link["token"], persona_id=None), _user("friend-1"))
    await mp.remove_participant(sid, "friend-1", _user("owner-1"))
    participants = await sp.list_for_session(sid)
    assert not any(p["user_id"] == "friend-1" for p in participants)


async def test_accept_invite_adds_member(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    await mp.accept_invite(sid, MultiplayerAcceptIn(persona_id=None), _user("friend-1"))
    participants = await sp.list_for_session(sid)
    assert any(p["user_id"] == "friend-1" for p in participants)


async def test_invite_by_username_creates_notification(db_conn):
    from backend.repositories import users as user_repo, notifications as notif_repo
    invitee = await user_repo.create_user("repo_test_invitee_1", "s3cret-password")
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    result = await mp.invite_by_username(sid, "repo_test_invitee_1", _user("owner-1"))
    assert result == {"ok": True}
    unread = await notif_repo.unread_count(invitee["id"])
    assert unread >= 1


async def test_invite_by_username_requires_host(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    with pytest.raises(HTTPException) as exc_info:
        await mp.invite_by_username(sid, "nobody", _user("stranger"))
    assert exc_info.value.status_code == 404


async def test_post_and_get_party_chat(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    link = await mp.create_invite_link(sid, _user("owner-1"))
    await mp.join_via_link(sid, MultiplayerJoinIn(token=link["token"], persona_id=None), _user("friend-1"))
    await mp.post_party_chat(sid, PartyChatIn(content="go ahead, I'm typing"), _user("owner-1"))
    await mp.post_party_chat(sid, PartyChatIn(content="ok waiting"), _user("friend-1"))
    messages = await mp.get_party_chat(sid, _user("friend-1"))
    assert [m["content"] for m in messages] == ["go ahead, I'm typing", "ok waiting"]


async def test_list_participants_includes_real_display_names(db_conn):
    from backend.repositories import users as user_repo
    friend = await user_repo.create_user("repo_test_display_1", "s3cret-password")
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, friend["id"], None, "member")
    participants = await mp.list_participants(sid, _user("owner-1"))
    friend_row = next(p for p in participants if p["user_id"] == friend["id"])
    assert friend_row["username"] == "repo_test_display_1"
    assert friend_row["user_display_name"] == "repo_test_display_1"
    assert friend_row["persona_name"] is None
    assert friend_row["avatar"] is None


async def test_list_participants_prefers_persona_name_and_avatar(db_conn):
    from backend.repositories import users as user_repo, personas
    friend = await user_repo.create_user("repo_test_display_2", "s3cret-password")
    persona = await personas.create({"name": "Mira the Bold", "avatar": "/media/mira.png"}, user_id=friend["id"])
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, friend["id"], persona["id"], "member")
    participants = await mp.list_participants(sid, _user("owner-1"))
    friend_row = next(p for p in participants if p["user_id"] == friend["id"])
    assert friend_row["user_display_name"] == "repo_test_display_2"
    assert friend_row["persona_name"] == "Mira the Bold"
    assert friend_row["avatar"] == "/media/mira.png"


async def test_get_participant_persona_returns_full_detail(db_conn):
    from backend.repositories import users as user_repo, personas
    friend = await user_repo.create_user("repo_test_persona_detail", "s3cret-password")
    persona = await personas.create({"name": "Mira the Bold", "description": "A wandering blade.",
                                     "gender": "she/her", "avatar": "/media/mira.png"}, user_id=friend["id"])
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, friend["id"], persona["id"], "member")
    result = await mp.get_participant_persona(sid, friend["id"], _user("owner-1"))
    assert result["name"] == "Mira the Bold"
    assert result["description"] == "A wandering blade."
    assert result["gender"] == "she/her"
    assert result["avatar"] == "/media/mira.png"


async def test_get_participant_persona_404s_when_no_persona_selected(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, "friend-1", None, "member")
    with pytest.raises(HTTPException) as exc_info:
        await mp.get_participant_persona(sid, "friend-1", _user("owner-1"))
    assert exc_info.value.status_code == 404


async def test_list_my_personas_for_session_includes_session_exclusive(db_conn):
    from backend.repositories import personas
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    global_persona = await personas.create({"name": "Global"}, "owner-1")
    session_persona = await personas.create({"name": "SessionOnly", "session_id": sid}, "owner-1")
    result = await mp.list_my_personas_for_session(sid, _user("owner-1"))
    ids = {p["id"] for p in result}
    assert global_persona["id"] in ids
    assert session_persona["id"] in ids


async def test_create_persona_rejects_session_id_for_non_participant(db_conn):
    from backend.routers import personas as personas_router
    from backend.schemas import PersonaIn
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    with pytest.raises(HTTPException) as exc_info:
        await personas_router.create_persona(
            PersonaIn(name="Sneaky", session_id=sid), _user("intruder"), None)
    assert exc_info.value.status_code == 403


async def test_post_party_chat_rejects_empty_message(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    with pytest.raises(HTTPException) as exc_info:
        await mp.post_party_chat(sid, PartyChatIn(content="   "), _user("owner-1"))
    assert exc_info.value.status_code == 400


async def test_post_party_chat_allows_image_only_message(db_conn):
    char_id = await _make_rpg_char()
    sid = await chat_sessions.create(char_id, None, "Party", "Host", user_id="owner-1")
    result = await mp.post_party_chat(
        sid, PartyChatIn(content="", image="/media/gif1.gif", attachment_kind="image"), _user("owner-1"))
    assert result["image"] == "/media/gif1.gif"
    assert result["attachment_kind"] == "image"
