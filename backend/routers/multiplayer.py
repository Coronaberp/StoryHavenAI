from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse

from backend.state import api, log
from backend.auth import get_experimental_user, get_current_user
from backend.chat_service import _own_session
from backend.repositories import chat_sessions, characters, session_participants, session_invites, notifications, party_chat
from backend.repositories import emojis as custom_emoji_repo
from backend.routers.comments import _COMMENT_IMAGE_RE, _COMMENT_STICKER_RE
from backend.schemas import MultiplayerJoinIn, MultiplayerAcceptIn, PartyChatIn
from backend import live_broadcast

async def _validated_persona_id(persona_id: str | None, current_user: dict) -> str | None:
    if not persona_id:
        return None
    from backend.repositories import personas
    persona = await personas.get(persona_id)
    if not persona or persona.get("owner_id") != current_user["id"]:
        log.warning("multiplayer: persona ownership check failed persona=%s user=%s",
                    persona_id, current_user["id"])
        raise HTTPException(404, "persona not found")
    return persona_id

async def _require_rpg_mode(session: dict) -> None:
    char = await characters.get(session["char_id"])
    if not char or char.get("mode") != "rpg":
        raise HTTPException(400, "Multiplayer sessions require an RPG-mode character")

async def _require_host(session: dict, current_user: dict) -> None:
    if session.get("user_id") == current_user["id"]:
        return
    rows = await session_participants.list_for_session(session["id"])
    if any(r["user_id"] == current_user["id"] and r["role"] == "host" for r in rows):
        return
    raise HTTPException(403, "Only the host can do this")

@api.post("/sessions/{sid}/multiplayer/invite-link")
async def create_invite_link(sid: str, current_user: dict = Depends(get_experimental_user)):
    session = await _own_session(sid, current_user)
    await _require_rpg_mode(session)
    await _require_host(session, current_user)
    if not await session_participants.is_participant(sid, current_user["id"]):
        await session_participants.add(sid, current_user["id"], session.get("persona_id"), "host")
    token = await session_invites.create_link(sid, current_user["id"])
    log.info("multiplayer: invite link created session=%s by=%s", sid, current_user["id"])
    return {"token": token}

@api.post("/sessions/{sid}/multiplayer/invite-link/revoke")
async def revoke_invite_link(sid: str, current_user: dict = Depends(get_experimental_user)):
    session = await _own_session(sid, current_user)
    await _require_host(session, current_user)
    await session_invites.revoke_all_for_session(sid)
    log.info("multiplayer: invite links revoked session=%s by=%s", sid, current_user["id"])
    return {"ok": True}

@api.post("/sessions/{sid}/multiplayer/join")
async def join_via_link(sid: str, body: MultiplayerJoinIn,
                        current_user: dict = Depends(get_current_user)):
    session = await chat_sessions.get(sid)
    if not session:
        raise HTTPException(404, "session not found")
    invite = await session_invites.resolve(body.token)
    if not invite or invite["session_id"] != sid:
        raise HTTPException(404, "invite link not found or revoked")
    persona_id = await _validated_persona_id(body.persona_id, current_user)
    try:
        await session_participants.add(sid, current_user["id"], persona_id, "member")
    except ValueError:
        raise HTTPException(409, "This session is full")
    log.info("multiplayer: user=%s joined session=%s via link", current_user["id"], sid)
    live_broadcast.broadcast(sid, "participant_joined", {"user_id": current_user["id"]})
    return {"ok": True}

@api.post("/sessions/{sid}/multiplayer/invite/{username}")
async def invite_by_username(sid: str, username: str,
                             current_user: dict = Depends(get_experimental_user)):
    session = await _own_session(sid, current_user)
    await _require_rpg_mode(session)
    await _require_host(session, current_user)
    from backend.repositories import users as user_repo
    invitee = await user_repo.get_user_by_username(username)
    if not invitee:
        raise HTTPException(404, "User not found")
    await notifications.create(
        invitee["id"], "multiplayer_invite",
        "You've been invited to a multiplayer session",
        f"{current_user['username']} invited you to join their session.",
        link=f"/chats/{sid}?mpinvite=1", related_id=sid,
    )
    log.info("multiplayer: invite sent session=%s from=%s to=%s", sid, current_user["id"], invitee["id"])
    return {"ok": True}

@api.post("/sessions/{sid}/multiplayer/accept")
async def accept_invite(sid: str, body: MultiplayerAcceptIn,
                        current_user: dict = Depends(get_current_user)):
    session = await chat_sessions.get(sid)
    if not session:
        raise HTTPException(404, "session not found")
    if not await notifications.exists(current_user["id"], "multiplayer_invite", sid):
        log.warning("multiplayer: accept without invite blocked session=%s user=%s",
                    sid, current_user["id"])
        raise HTTPException(403, "You were not invited to this session")
    persona_id = await _validated_persona_id(body.persona_id, current_user)
    try:
        await session_participants.add(sid, current_user["id"], persona_id, "member")
    except ValueError:
        raise HTTPException(409, "This session is full")
    log.info("multiplayer: user=%s accepted invite to session=%s", current_user["id"], sid)
    live_broadcast.broadcast(sid, "participant_joined", {"user_id": current_user["id"]})
    return {"ok": True}

@api.get("/sessions/{sid}/multiplayer/my-personas")
async def list_my_personas_for_session(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    from backend.repositories import personas
    return await personas.list_own_for_session(current_user["id"], sid)

@api.get("/sessions/{sid}/multiplayer/participants")
async def list_participants(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    from backend.repositories import users as user_repo, personas
    rows = await session_participants.list_for_session(sid)
    enriched = []
    for row in rows:
        user = await user_repo.get_user_by_id(row["user_id"])
        persona = await personas.get(row["persona_id"]) if row["persona_id"] else None
        enriched.append({
            **row,
            "username": user["username"] if user else None,
            "user_display_name": (user["display_name"] if user and user.get("display_name") else (user["username"] if user else None)),
            "persona_name": persona["name"] if persona else None,
            "avatar": (persona["avatar"] if persona and persona.get("avatar") else (user["avatar"] if user and user.get("avatar") else None)),
        })
    return enriched

@api.get("/sessions/{sid}/multiplayer/participants/{user_id}/persona")
async def get_participant_persona(sid: str, user_id: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    from backend.repositories import personas
    row = await session_participants.list_for_session(sid)
    participant = next((r for r in row if r["user_id"] == user_id), None)
    if not participant:
        raise HTTPException(404, "Participant not found")
    if not participant.get("persona_id"):
        raise HTTPException(404, "This participant has no persona selected")
    persona = await personas.get(participant["persona_id"])
    if not persona:
        raise HTTPException(404, "Persona not found")
    return persona

@api.delete("/sessions/{sid}/multiplayer/participants/{user_id}")
async def remove_participant(sid: str, user_id: str,
                             current_user: dict = Depends(get_experimental_user)):
    session = await _own_session(sid, current_user)
    await _require_host(session, current_user)
    if user_id == current_user["id"]:
        raise HTTPException(400, "The host cannot remove themselves")
    await session_participants.remove(sid, user_id)
    log.info("multiplayer: user=%s removed from session=%s by=%s", user_id, sid, current_user["id"])
    live_broadcast.broadcast(sid, "participant_left", {"user_id": user_id})
    live_broadcast.disconnect_user(sid, user_id)
    return {"ok": True}

@api.post("/sessions/{sid}/multiplayer/typing")
async def typing_ping(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    live_broadcast.broadcast(sid, "typing", {"user_id": current_user["id"]})
    return {"ok": True}

@api.get("/sessions/{sid}/multiplayer/live")
async def live(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    return StreamingResponse(
        live_broadcast.stream(sid, current_user["id"]),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

@api.get("/sessions/{sid}/multiplayer/party-chat")
async def get_party_chat(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    return await party_chat.list_recent(sid)

async def _validated_party_chat_image(body: PartyChatIn, current_user: dict) -> str | None:
    image = (body.image or "").strip()
    if not image:
        return None
    if body.attachment_kind != "image":
        log.warning("multiplayer: party chat attachment rejected kind=%s user=%s",
                    body.attachment_kind, current_user["id"])
        raise HTTPException(400, "invalid attachment reference")
    if _COMMENT_IMAGE_RE.match(image):
        return image
    if _COMMENT_STICKER_RE.match(image) and await custom_emoji_repo.get_sticker_by_image(image):
        return image
    log.warning("multiplayer: party chat attachment rejected user=%s", current_user["id"])
    raise HTTPException(400, "invalid attachment reference")

@api.post("/sessions/{sid}/multiplayer/party-chat")
async def post_party_chat(sid: str, body: PartyChatIn,
                          current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    content = body.content.strip()
    image = await _validated_party_chat_image(body, current_user)
    if not content and not image:
        raise HTTPException(400, "Message cannot be empty")
    message = await party_chat.add(sid, current_user["id"], content,
                                   image=image, attachment_kind="image" if image else None)
    live_broadcast.broadcast(sid, "party_chat", message)
    return message
