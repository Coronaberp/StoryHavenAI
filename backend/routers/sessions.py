"""Session CRUD, message edit/delete, char-state, and public-session milestone
notifications. Chat/regenerate/roll/continue and memory retrieval live in
chat.py; in-chat and standalone image generation live in imagegen.py; model
preview/metadata administration lives in model_previews.py."""
import re
import json

from fastapi import HTTPException, Depends

from backend import db
from backend.repositories import characters
from backend.repositories import personas
from backend.repositories import chat_sessions
from backend.repositories import session_participants
from backend.repositories import session_characters as session_char_repo
from backend.repositories import groups as groups_repo
from backend.repositories import notifications as notification_repo
from backend.repositories import memory_facts
from backend import vectors
from backend import live_broadcast
from backend.state import api, log
from backend.auth import get_current_user
from backend.feature_flags import require_feature_enabled
from backend.media import _delete_media_file
from backend.chat_service import _own_session, _ui_language, _localize_texts, _eff_cfg, _endpoints, group_narrate_edit
from backend.prompt import macro, apply_directive, apply_inline_directives
from backend.dice import resolve_inline_rolls, roll_dice, format_roll
from backend.sampling import RESPONSE_LENGTH_PRESETS
from backend.state import CFG
from backend.routers.misc import translate_text_live
from backend.schemas import (SessionIn, RenameIn, StyleIn, LengthIn, ExplicitModeIn, GlossaryIn,
                     LanguageIn, AuthorNoteIn, MessageEdit, PersonaSwitchIn, GroupCreateIn, MuteIn)

MILESTONES = [10, 50, 100, 500, 1000]


async def _maybe_notify_milestone(char: dict):
    """First public session-count crossing of each threshold notifies the owner
    exactly once (deduped by a related_id of '{cid}:{threshold}')."""
    owner_id = char.get("owner_id")
    if not owner_id or not char.get("is_public"):
        return
    count = await db.count_char_sessions(char["id"])
    for threshold in MILESTONES:
        if count < threshold:
            break
        related_id = f"{char['id']}:{threshold}"
        if await notification_repo.exists(owner_id, "milestone", related_id):
            continue
        await notification_repo.create(
            owner_id, "milestone",
            f"{char['name']} reached {threshold} chats",
            f"Your character {char['name']} has been started in {threshold} chats.",
            f"/c/{char['id']}", related_id=related_id)


async def start_group_from_cast(owner_id: str, name: str, opening: str, mode: str,
                                char_ids: list[str], chars: list[dict],
                                expand_opening: bool = True, source_group_id: str | None = None) -> str:
    persona = await personas.default(owner_id)
    user_name = persona["name"] if persona else "You"
    language = _ui_language(await db.get_user_settings(owner_id))
    chat_mode = mode == "chat"
    sid = await chat_sessions.create_group(owner_id, name or "Group", char_ids,
                                           persona_id=persona["id"] if persona else None,
                                           user_name=user_name, mode="chat" if chat_mode else "roleplay",
                                           source_group_id=source_group_id)
    await session_char_repo.set_cast(sid, [{"char_id": cid} for cid in char_ids])
    if chat_mode:
        names = ", ".join(c["name"] for c in chars)
        scene = f"{user_name} and {names} are now together in a text chatroom, not physically in the same place."
        await chat_sessions.add_message(sid, "assistant", scene, lang=language)
    else:
        primary = chars[0]
        opening_msg = macro(opening, primary["name"], user_name) if expand_opening else opening
        await chat_sessions.add_message(sid, "assistant", opening_msg, lang=language)
    return sid


@api.post("/group-chats")
async def create_group_session(body: GroupCreateIn, current_user: dict = Depends(get_current_user),
                                _feature: None = Depends(require_feature_enabled("group_chats"))):
    seen, char_ids = set(), []
    for cid in (body.char_ids or []):
        if cid not in seen:
            seen.add(cid)
            char_ids.append(cid)
    if len(char_ids) > 4:
        raise HTTPException(400, "a group chat allows at most 4 characters")
    if len(char_ids) < 2:
        raise HTTPException(400, "a group chat needs at least 2 characters")
    chat_mode = body.mode == "chat"
    if not (body.name or "").strip():
        raise HTTPException(400, "a group chat needs a name")
    if not chat_mode and not (body.opening or "").strip():
        raise HTTPException(400, "a roleplay group needs an opening message")
    chars = []
    for cid in char_ids:
        c = await characters.get(cid)
        if not c:
            raise HTTPException(404, "character not found")
        if (c.get("mode") or "character") == "rpg":
            raise HTTPException(400, "RPG characters cannot join a group chat")
        chars.append(c)
    gid = await groups_repo.create(current_user["id"], body.name or "Group", (body.opening or "").strip(),
                                   "chat" if chat_mode else "roleplay", 0, char_ids)
    sid = await start_group_from_cast(current_user["id"], body.name or "Group",
                                      (body.opening or "").strip(),
                                      "chat" if chat_mode else "roleplay", char_ids, chars, source_group_id=gid)
    log.info("group session created: id=%s group=%s chars=%d by=%s", sid, gid, len(char_ids), current_user["username"])
    return {"session_id": sid}


@api.put("/sessions/{sid}/cast/{char_id}/mute")
async def set_cast_mute(sid: str, char_id: str, body: MuteIn,
                        current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await session_char_repo.set_muted(sid, char_id, body.muted)
    return {"ok": True}


@api.post("/characters/{cid}/sessions")
async def new_session(cid: str, body: SessionIn,
                      current_user: dict = Depends(get_current_user),
                      _feature: None = Depends(require_feature_enabled("chat"))):
    char = await characters.get(cid)
    if not char:
        raise HTTPException(404, "character not found")
    persona = await personas.get(body.persona_id) if body.persona_id else await personas.default(current_user["id"])
    user_name = persona["name"] if persona else "You"
    sid = await chat_sessions.create(cid, persona["id"] if persona else None,
                                  char["name"], user_name, user_id=current_user["id"])
    if body.language:
        await chat_sessions.set_language(sid, body.language)
    greetings = [char.get("greeting", ""), *char.get("alt_greetings", [])]
    selected_greeting = greetings[body.greeting_index] if 0 <= body.greeting_index < len(greetings) else greetings[0]
    greeting = macro(selected_greeting, char["name"], user_name)
    if greeting:
        user_overrides = await db.get_user_settings(current_user["id"])
        if body.language:
            # The caller explicitly picked a reply language for this session up
            # front, so the greeting needs a real live translation, not just a
            # cache lookup that silently no-ops on a miss (_localize_texts never
            # calls the LLM — it only serves what /api/localize has pre-warmed).
            language = body.language
            eff = _eff_cfg(user_overrides)
            ep = await _endpoints(user_overrides, current_user["id"], current_user["is_admin"])
            try:
                greeting_disp = await translate_text_live(
                    greeting, language, eff.get("chat_model") or CFG["chat_model"], ep)
                if not greeting_disp:
                    greeting_disp = greeting
            except Exception:
                log.warning("greeting live translation failed: session=%s", sid)
                greeting_disp = greeting
        else:
            # No explicit language chosen: falls back to the user's interface
            # language (or the instance default). The greeting is character-authored
            # text, localized for display via the same persistent cache as
            # scenarios/personas (see /api/localize) — a pure cache lookup, not a
            # live LLM call.
            language = _ui_language(user_overrides)
            try:
                [greeting_disp] = await _localize_texts([greeting], language)
            except Exception:
                log.warning("greeting localization failed: session=%s", sid)
                greeting_disp = greeting
        await chat_sessions.add_message(sid, "assistant", greeting_disp, lang=language)
    await _maybe_notify_milestone(char)
    return await chat_sessions.get(sid)


@api.post("/sessions/{sid}/greeting/{direction}")
async def swap_greeting(sid: str, direction: str, current_user: dict = Depends(get_current_user)):
    """Cycles the session's opening greeting between the character's authored
    variants (greeting + alt_greetings). Only valid while the greeting is
    still the session's only message — once the conversation has moved on,
    swapping it out from under the model's own history would desync what the
    model has already seen from what's displayed."""
    if direction not in ("next", "prev"):
        raise HTTPException(400, "direction must be next or prev")
    s = await _own_session(sid, current_user)
    char = await characters.get(s["char_id"])
    if not char:
        raise HTTPException(404, "character not found")
    greetings = [g for g in [char.get("greeting", ""), *char.get("alt_greetings", [])] if (g or "").strip()]
    if len(greetings) < 2:
        raise HTTPException(400, "this character has no alternate greetings")
    msgs = await chat_sessions.list_messages(sid)
    if len(msgs) != 1 or msgs[0]["role"] != "assistant":
        raise HTTPException(400, "the greeting can only be swapped before the conversation continues")
    persona = await personas.get(s["persona_id"]) if s.get("persona_id") else await personas.default(current_user["id"])
    user_name = persona["name"] if persona else "You"
    substituted = [macro(g, char["name"], user_name) for g in greetings]
    first = msgs[0]
    try:
        cur_idx = substituted.index(first["content"])
    except ValueError:
        cur_idx = 0
    new_idx = (cur_idx + (1 if direction == "next" else -1)) % len(greetings)
    user_overrides = await db.get_user_settings(current_user["id"])
    language = first.get("lang") or _ui_language(user_overrides)
    try:
        [greeting_disp] = await _localize_texts([substituted[new_idx]], language)
    except Exception:
        log.warning("greeting localization failed: session=%s", sid)
        greeting_disp = substituted[new_idx]
    await chat_sessions.edit_message(sid, first["id"], greeting_disp)
    log.info("sessions: greeting swapped session=%s index=%s", sid, new_idx)
    live_broadcast.broadcast(sid, "session_updated", {})
    return {"greeting_index": new_idx, "greeting_count": len(greetings)}


@api.get("/sessions")
async def list_sessions(limit: int = 40, char_id: str | None = None,
                        current_user: dict = Depends(get_current_user)):
    owned = await chat_sessions.list_all(limit, user_id=current_user["id"], char_id=char_id)
    owned_ids = {s["id"] for s in owned}
    participant_ids = await session_participants.list_session_ids_for_user(current_user["id"])
    joined = []
    for sid in participant_ids:
        if sid in owned_ids:
            continue
        s = await chat_sessions.get(sid)
        if s and (not char_id or s.get("char_id") == char_id):
            joined.append(s)
    sessions = sorted(owned + joined, key=lambda s: s.get("updated") or 0, reverse=True)[:limit]
    for s in sessions:
        participants = await session_participants.list_for_session(s["id"])
        s["is_multiplayer"] = len(participants) > 0
        s["participant_count"] = len(participants)
        if not s.get("is_group"):
            continue
        cast_avatars = []
        for row in await session_char_repo.list_cast(s["id"]):
            if row["is_narrator"]:
                continue
            c = await characters.get(row["char_id"])
            if not c:
                continue
            cast_avatars.append({"name": c["name"], "avatar": c.get("avatar")})
            if len(cast_avatars) >= 4:
                break
        s["cast_avatars"] = cast_avatars
    return sessions


@api.get("/sessions/{sid}")
async def get_session(sid: str, current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    if s.get("is_group"):
        cast = []
        for row in await session_char_repo.list_cast(sid):
            c = await characters.get(row["char_id"])
            if not c:
                continue
            cast.append({"char_id": row["char_id"], "name": c["name"], "avatar": c.get("avatar"),
                         "sprites": (c.get("assets") or {}).get("sprites"),
                         "mode": c.get("mode"), "muted": bool(row["muted"]),
                         "is_narrator": bool(row["is_narrator"]), "position": row["position"]})
        s["cast"] = cast
    return s


@api.patch("/sessions/{sid}")
async def rename_session(sid: str, body: RenameIn,
                         current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await chat_sessions.rename(sid, body.title)
    return {"ok": True}


@api.put("/sessions/{sid}/style")
async def set_session_style(sid: str, body: StyleIn,
                            current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await chat_sessions.set_style(sid, body.key, body.prompt or None)
    live_broadcast.broadcast(sid, "session_updated", {})
    return {"ok": True}


@api.put("/sessions/{sid}/length")
async def set_session_length(sid: str, body: LengthIn,
                             current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    if body.key not in RESPONSE_LENGTH_PRESETS:
        raise HTTPException(400, "unknown response length")
    await chat_sessions.set_length(sid, body.key)
    live_broadcast.broadcast(sid, "session_updated", {})
    return {"ok": True}


@api.put("/sessions/{sid}/explicit-mode")
async def set_session_explicit_mode(sid: str, body: ExplicitModeIn,
                                    current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    if body.enabled and not current_user.get("nsfw_allowed"):
        log.warning("explicit mode blocked: user=%s not nsfw_allowed", current_user["username"])
        raise HTTPException(403, "Explicit mode requires an adult-verified account")
    await chat_sessions.set_explicit_mode(sid, body.enabled)
    live_broadcast.broadcast(sid, "session_updated", {})
    return {"ok": True}


@api.put("/sessions/{sid}/persona")
async def set_session_persona(sid: str, body: PersonaSwitchIn,
                              current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    persona = None
    if body.persona_id:
        persona = await personas.get(body.persona_id)
        if not persona or persona.get("owner_id") != current_user["id"]:
            raise HTTPException(404, "persona not found")
    user_name = persona["name"] if persona else "You"
    is_multiplayer = bool(await session_participants.list_for_session(sid))
    if is_multiplayer:
        await session_participants.set_persona(sid, current_user["id"], body.persona_id)
        live_broadcast.broadcast(sid, "participant_updated", {"user_id": current_user["id"]})
    else:
        await chat_sessions.set_persona(sid, body.persona_id, user_name)
        live_broadcast.broadcast(sid, "session_updated", {})
    log.info("sessions: persona switched session=%s persona=%s multiplayer=%s", sid, body.persona_id, is_multiplayer)
    return {"ok": True, "user_name": user_name}


@api.put("/sessions/{sid}/glossary")
async def set_session_glossary(sid: str, body: GlossaryIn,
                               current_user: dict = Depends(get_current_user)):
    """Per-session terminology pins: {source term: exact rendering}. Injected into
    every translation prompt for this session so class names, spells, ranks etc.
    are always rendered exactly as the player wants — the vocabulary counterpart
    of known_names."""
    await _own_session(sid, current_user)
    gl = {k.strip(): v.strip() for k, v in (body.glossary or {}).items()
          if k.strip() and v.strip()}
    if len(gl) > 200:
        raise HTTPException(400, "glossary too large")
    await chat_sessions.set_glossary(sid, json.dumps(gl, ensure_ascii=False))
    return {"ok": True, "glossary": gl}


@api.put("/sessions/{sid}/language")
async def set_session_language(sid: str, body: LanguageIn,
                               current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    lang = (body.language or "").strip() or None
    await chat_sessions.set_language(sid, lang)
    return {"ok": True, "language": lang}


@api.put("/sessions/{sid}/note")
async def set_session_author_note(sid: str, body: AuthorNoteIn,
                                  current_user: dict = Depends(get_current_user)):
    """Persistent Author's Note: re-injected as the last message before every
    generation (see the author_note block in _run) so it survives long
    conversations instead of scrolling out of the history window."""
    await _own_session(sid, current_user)
    note = (body.note or "").strip() or None
    await chat_sessions.set_author_note(sid, note)
    return {"ok": True, "note": note}


@api.get("/sessions/{sid}/state")
async def get_char_state(sid: str, current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    doing, location = s.get("char_doing") or "", s.get("char_location") or ""
    known_names = json.loads(s.get("known_names") or "[]")
    display_names = known_names
    if known_names:
        try:
            user_overrides = await db.get_user_settings(current_user["id"])
            display_names = await _localize_texts(known_names, _ui_language(user_overrides))
        except Exception as e:
            log.warning("char-state name localization failed (session=%s): %s: %s",
                        sid, type(e).__name__, e)
    return {
        "doing": doing,
        "location": location,
        "known_names": display_names,
    }


@api.delete("/sessions/{sid}")
async def delete_session(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await chat_sessions.delete(sid)
    await memory_facts.purge_session(sid)
    return {"deleted": True}


_EDIT_SLASH_RE = re.compile(r'^/(ooc|scene|note|time|as)\b\s*([\s\S]*)$', re.I)
_EDIT_ROLL_RE = re.compile(r'^/roll\s+(\S+)\s*([\s\S]*)$', re.I)


def _reparse_user_edit(content: str) -> str:
    content = content or ""
    roll = _EDIT_ROLL_RE.match(content)
    if roll:
        try:
            return apply_directive(format_roll(roll_dice(roll.group(1)), roll.group(2).strip()), "roll")
        except ValueError:
            pass
    m = _EDIT_SLASH_RE.match(content)
    if m:
        directive, rest, arg = m.group(1).lower(), m.group(2), None
        if directive == "as":
            am = re.match(r'^(\S+)\s*([\s\S]*)$', rest)
            if am:
                arg, rest = am.group(1), am.group(2)
        return apply_directive(resolve_inline_rolls(rest.strip()), directive, arg)
    return apply_inline_directives(resolve_inline_rolls(content))


@api.patch("/sessions/{sid}/messages/{mid}")
async def edit_message(sid: str, mid: str, body: MessageEdit,
                       current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    msgs = await chat_sessions.list_messages(sid)
    target = next((m for m in msgs if m["id"] == mid), None)
    if target and target["role"] == "user" and s.get("is_group"):
        content = await group_narrate_edit(s, body.content, current_user)
    elif target and target["role"] == "user":
        content = _reparse_user_edit(body.content)
    else:
        content = body.content
    await chat_sessions.edit_message(sid, mid, content)
    return {"ok": True}


@api.post("/sessions/{sid}/messages/{mid}/branch")
async def branch_session(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    new_sid = await chat_sessions.branch(sid, mid, current_user["id"])
    if not new_sid:
        raise HTTPException(404, "message not found")
    log.info("sessions: branched id=%s from=%s by=%s", new_sid, sid, current_user["username"])
    return await chat_sessions.get(new_sid)


@api.post("/sessions/{sid}/messages/{mid}/swipe/{direction}")
async def swipe_message(sid: str, mid: str, direction: str,
                        current_user: dict = Depends(get_current_user)):
    if direction not in ("next", "prev"):
        raise HTTPException(400, "direction must be next or prev")
    await _own_session(sid, current_user)
    try:
        result = await chat_sessions.swipe(sid, mid, direction)
    except ValueError as e:
        raise HTTPException(400, str(e))
    log.info("sessions: message swiped session=%s message=%s index=%s", sid, mid, result["index"])
    live_broadcast.broadcast(sid, "session_updated", {})
    return result


@api.delete("/sessions/{sid}/messages/{mid}")
async def delete_message(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    msgs = await chat_sessions.list_messages(sid)
    idx = next((i for i, m in enumerate(msgs) if m["id"] == mid), None)
    if idx == 0 and msgs[0]["role"] == "assistant":
        raise HTTPException(400, "the opening greeting can't be deleted — edit it, or start a new chat instead")
    if idx is not None:
        _delete_media_file(msgs[idx].get("image"))
    await chat_sessions.delete_message(sid, mid)
    if idx is not None:
        if msgs[idx]["role"] == "user":
            # memory is keyed by the triggering user message id
            await vectors.delete_memory(mid)
        else:
            # assistant reply — its memory (if any) is keyed by the user turn before it
            prev_user = next((m for m in reversed(msgs[:idx]) if m["role"] == "user"), None)
            if prev_user:
                await vectors.delete_memory(prev_user["id"])
    live_broadcast.broadcast(sid, "session_updated", {})
    return {"ok": True}
