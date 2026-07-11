"""Session CRUD, message edit/delete, char-state, and public-session milestone
notifications. Chat/regenerate/roll/continue and memory retrieval live in
chat.py; in-chat and standalone image generation live in imagegen.py; model
preview/metadata administration lives in model_previews.py."""
import json

from fastapi import HTTPException, Depends

from backend import db
from backend.repositories import characters
from backend.repositories import personas
from backend.repositories import chat_sessions
from backend.repositories import notifications as notification_repo
from backend import vectors
from backend.state import api, log
from backend.auth import get_current_user
from backend.media import _delete_media_file
from backend.chat_service import _own_session, _ui_language, _localize_texts
from backend.prompt import macro
from backend.schemas import (SessionIn, RenameIn, StyleIn, GlossaryIn, LanguageIn,
                     AuthorNoteIn, MessageEdit)

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


@api.post("/characters/{cid}/sessions")
async def new_session(cid: str, body: SessionIn,
                      current_user: dict = Depends(get_current_user)):
    char = await characters.get(cid)
    if not char:
        raise HTTPException(404, "character not found")
    persona = await personas.get(body.persona_id) if body.persona_id else await personas.default(current_user["id"])
    user_name = persona["name"] if persona else "You"
    sid = await chat_sessions.create(cid, persona["id"] if persona else None,
                                  char["name"], user_name, user_id=current_user["id"])
    greeting = macro(char.get("greeting", ""), char["name"], user_name)
    if greeting:
        # A brand-new session has no talk language yet, so this resolves to the
        # user's interface language (or the instance default). The greeting is
        # character-authored text, localized for display via the same persistent
        # cache as scenarios/personas (see /api/localize) — a pure cache lookup,
        # not a live LLM call.
        user_overrides = await db.get_user_settings(current_user["id"])
        language = _ui_language(user_overrides)
        try:
            [greeting_disp] = await _localize_texts([greeting], language)
        except Exception:
            log.warning("greeting localization failed: session=%s", sid)
            greeting_disp = greeting
        await chat_sessions.add_message(sid, "assistant", greeting_disp, lang=language)
    await _maybe_notify_milestone(char)
    return await chat_sessions.get(sid)


@api.get("/sessions")
async def list_sessions(limit: int = 40, char_id: str | None = None,
                        current_user: dict = Depends(get_current_user)):
    return await chat_sessions.list_all(limit, user_id=current_user["id"], char_id=char_id)


@api.get("/sessions/{sid}")
async def get_session(sid: str, current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
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
    return {"ok": True}


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
    await vectors.delete_by_tag(vectors.MEM_INDEX, "session", sid)
    return {"deleted": True}


@api.patch("/sessions/{sid}/messages/{mid}")
async def edit_message(sid: str, mid: str, body: MessageEdit,
                       current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await chat_sessions.edit_message(sid, mid, body.content)
    return {"ok": True}


@api.delete("/sessions/{sid}/messages/{mid}")
async def delete_message(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    msgs = await chat_sessions.list_messages(sid)
    idx = next((i for i, m in enumerate(msgs) if m["id"] == mid), None)
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
    return {"ok": True}
