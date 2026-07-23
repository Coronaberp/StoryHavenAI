from __future__ import annotations
import json
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, func

from backend.db import (
    sessions, messages,
    nid, _q, _q1, _w, _preview, _encrypt_secret, _decrypt_secret, engine,
    _encrypt_json_list, _decrypt_json_list,
)
from backend.repositories import session_characters as session_char_repo
from backend.state import log


async def _with_preview(rows) -> list[dict]:
    out = [dict(row) for row in rows]
    if not out:
        return out
    sids = [s["id"] for s in out]
    crows = await _q(select(messages.c.session_id, func.count().label("n"))
                     .where(messages.c.session_id.in_(sids))
                     .group_by(messages.c.session_id))
    counts = {r["session_id"]: r["n"] for r in crows}
    maxseq = (select(messages.c.session_id, func.max(messages.c.seq).label("mseq"))
              .where(messages.c.session_id.in_(sids))
              .group_by(messages.c.session_id).subquery())
    lrows = await _q(select(messages.c.session_id, messages.c.content)
                     .join(maxseq, and_(messages.c.session_id == maxseq.c.session_id,
                                        messages.c.seq == maxseq.c.mseq)))
    last = {r["session_id"]: _decrypt_secret(r["content"] or "") for r in lrows}
    for s in out:
        s["title"] = _decrypt_secret(s.get("title") or "")
        if "user_name" in s:
            s["user_name"] = _decrypt_secret(s.get("user_name") or "")
        if "char_doing" in s:
            s["char_doing"] = _decrypt_secret(s.get("char_doing") or "") or None
        if "char_location" in s:
            s["char_location"] = _decrypt_secret(s.get("char_location") or "") or None
        if "known_names" in s:
            s["known_names"] = _decrypt_secret(s.get("known_names") or "") or "[]"
        if "style_prompt" in s:
            s["style_prompt"] = _decrypt_secret(s.get("style_prompt") or "") or None
        if "author_note" in s:
            s["author_note"] = _decrypt_secret(s.get("author_note") or "") or None
        if "glossary" in s:
            s["glossary"] = _decrypt_secret(s.get("glossary") or "") or None
        s["preview"] = _preview(last[s["id"]]) if s["id"] in last else ""
        s["message_count"] = counts.get(s["id"], 0)
    return out


async def create(char_id, persona_id, title, user_name, user_id=None) -> str:
    sid = nid("s")
    now = time.time()
    await _w(insert(sessions).values(
        id=sid, char_id=char_id, persona_id=persona_id,
        title=_encrypt_secret(title or ""),
        user_name=_encrypt_secret(user_name or "You"), user_id=user_id,
        created=now, updated=now))
    log.info("chat_sessions: created id=%s char=%s user=%s", sid, char_id, user_id)
    return sid


async def create_group(user_id, name, char_ids, persona_id=None, user_name="You", mode="roleplay",
                       source_group_id=None) -> str:
    sid = nid("s")
    now = time.time()
    primary = char_ids[0] if char_ids else None
    await _w(insert(sessions).values(
        id=sid, char_id=primary, persona_id=persona_id,
        title=_encrypt_secret(name or "Group"),
        user_name=_encrypt_secret(user_name or "You"), user_id=user_id,
        created=now, updated=now, is_group=1,
        group_mode=("chat" if mode == "chat" else "roleplay"),
        source_group_id=source_group_id))
    log.info("chat_sessions: created GROUP id=%s chars=%d mode=%s user=%s", sid, len(char_ids), mode, user_id)
    return sid


async def get(sid: str) -> dict | None:
    s = await _q1(select(sessions).where(sessions.c.id == sid))
    if not s:
        return None
    s["title"] = _decrypt_secret(s.get("title") or "")
    s["author_note"] = _decrypt_secret(s.get("author_note") or "")
    s["glossary"] = _decrypt_secret(s.get("glossary") or "")
    s["style_prompt"] = _decrypt_secret(s.get("style_prompt") or "")
    s["user_name"] = _decrypt_secret(s.get("user_name") or "")
    s["char_doing"] = _decrypt_secret(s.get("char_doing") or "") or None
    s["char_location"] = _decrypt_secret(s.get("char_location") or "") or None
    s["known_names"] = _decrypt_secret(s.get("known_names") or "") or "[]"
    s["messages"] = await list_messages(sid)
    return s


async def list_all(limit: int = 40, user_id: str | None = None,
                    char_id: str | None = None) -> list[dict]:
    conditions = []
    if user_id:
        conditions.append(sessions.c.user_id == user_id)
    else:
        conditions.append(sessions.c.user_id.is_(None))
    if char_id:
        conditions.append(sessions.c.char_id == char_id)
    stmt = (select(sessions).where(and_(*conditions))
            .order_by(sessions.c.updated.desc()).limit(limit))
    return await _with_preview(await _q(stmt))


async def list_for_char(cid: str) -> list[dict]:
    stmt = (select(sessions).where(sessions.c.char_id == cid)
            .order_by(sessions.c.updated.desc()))
    return await _with_preview(await _q(stmt))


async def touch(sid: str):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(updated=time.time()))


async def rename(sid: str, title: str):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(
        title=_encrypt_secret(title or "")))
    log.info("chat_sessions: renamed id=%s", sid)


async def set_style(sid: str, key: str, prompt: str | None):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(
        style_key=key, style_prompt=_encrypt_secret(prompt or "") or None))
    log.info("chat_sessions: style set id=%s key=%s", sid, key)


async def set_length(sid: str, key: str):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(length_key=key))
    log.info("chat_sessions: length set id=%s key=%s", sid, key)


async def set_explicit_mode(sid: str, enabled: bool):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(explicit_mode=1 if enabled else 0))
    log.info("chat_sessions: explicit_mode set id=%s enabled=%s", sid, enabled)


async def set_language(sid: str, language: str | None):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(language=language))
    log.info("chat_sessions: language set id=%s language=%s", sid, language)


async def set_persona(sid: str, persona_id: str | None, user_name: str):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(
        persona_id=persona_id, user_name=_encrypt_secret(user_name)))
    log.info("chat_sessions: persona switched id=%s persona=%s", sid, persona_id)


async def set_glossary(sid: str, glossary: str):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(
        glossary=_encrypt_secret(glossary or "")))
    log.info("chat_sessions: glossary set id=%s", sid)


async def set_author_note(sid: str, note: str | None):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(
        author_note=_encrypt_secret(note) if note else note))
    log.info("chat_sessions: author note set id=%s", sid)


async def set_char_state(sid: str, doing: str | None, location: str | None,
                          known_names: list[str]):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(
        char_doing=_encrypt_secret(doing or "") or None,
        char_location=_encrypt_secret(location or "") or None,
        known_names=_encrypt_secret(json.dumps(known_names))))
    log.info("chat_sessions: char state set id=%s", sid)


async def delete(sid: str):
    async with engine().begin() as conn:
        await conn.execute(sa_delete(messages).where(messages.c.session_id == sid))
        await conn.execute(sa_delete(sessions).where(sessions.c.id == sid))
    log.info("chat_sessions: deleted id=%s", sid)


async def add_message(sid: str, role: str, content: str, lang: str | None = None,
                      mood: str | None = None, user_name: str | None = None,
                      persona_avatar: str | None = None, char_id: str | None = None,
                      turn_group: str | None = None, sender_user_id: str | None = None) -> dict:
    mid = nid("m")
    ts = int(time.time())
    async with engine().begin() as conn:
        await conn.execute(insert(messages).values(
            id=mid, session_id=sid, role=role,
            content=_encrypt_secret(content or ""), ts=ts, lang=lang, mood=mood,
            user_name=user_name, persona_avatar=persona_avatar,
            char_id=char_id, turn_group=turn_group, sender_user_id=sender_user_id))
        await conn.execute(sa_update(sessions).where(sessions.c.id == sid)
                           .values(updated=time.time()))
    return {"id": mid, "role": role, "content": content, "ts": ts, "lang": lang, "mood": mood,
            "user_name": user_name, "persona_avatar": persona_avatar,
            "char_id": char_id, "turn_group": turn_group, "sender_user_id": sender_user_id}


async def branch(sid: str, mid: str, user_id: str | None) -> str | None:
    src = await get(sid)
    if not src:
        return None
    idx = next((i for i, m in enumerate(src["messages"]) if m["id"] == mid), None)
    if idx is None:
        return None
    new_sid = await _branch_destination(src, user_id)
    await set_glossary(new_sid, src["glossary"])
    if src["author_note"]:
        await set_author_note(new_sid, src["author_note"])
    if src["style_key"]:
        await set_style(new_sid, src["style_key"], src["style_prompt"])
    if src.get("length_key"):
        await set_length(new_sid, src["length_key"])
    if src["language"]:
        await set_language(new_sid, src["language"])
    await set_char_state(new_sid, src["char_doing"], src["char_location"],
                         json.loads(src["known_names"] or "[]"))
    for m in src["messages"][:idx + 1]:
        await add_message(new_sid, m["role"], m["content"], lang=m.get("lang"), mood=m.get("mood"),
                          user_name=m.get("user_name"), persona_avatar=m.get("persona_avatar"),
                          char_id=m.get("char_id"), turn_group=m.get("turn_group"))
    log.info("chat_sessions: branched id=%s from=%s at=%s", new_sid, sid, mid)
    return new_sid


async def _branch_destination(src: dict, user_id: str | None) -> str:
    title = f'{src["title"]} (branch)'
    if not src.get("is_group"):
        return await create(src["char_id"], src["persona_id"], title, src["user_name"], user_id)
    cast = await session_char_repo.list_cast(src["id"])
    char_ids = [member["char_id"] for member in cast]
    mode = "chat" if src.get("group_mode") == "chat" else "roleplay"
    new_sid = await create_group(user_id, title, char_ids, persona_id=src["persona_id"],
                                 user_name=src["user_name"], mode=mode)
    await session_char_repo.set_cast(new_sid, [
        {"char_id": member["char_id"], "muted": member.get("muted"),
         "is_narrator": member.get("is_narrator")}
        for member in cast])
    return new_sid


async def list_messages(sid: str) -> list[dict]:
    stmt = (select(messages.c.id, messages.c.role, messages.c.content,
                   messages.c.ts, messages.c.image, messages.c.lang, messages.c.mood,
                   messages.c.user_name, messages.c.persona_avatar, messages.c.swipes,
                   messages.c.char_id, messages.c.turn_group, messages.c.sender_user_id)
            .where(messages.c.session_id == sid).order_by(messages.c.seq.asc()))
    rows = await _q(stmt)
    for r in rows:
        r["content"] = _decrypt_secret(r.get("content") or "")
        swipes = _decrypt_json_list(r.get("swipes"))
        r["swipe_count"] = len(swipes) if swipes else 1
        r["swipe_index"] = swipes.index(r["content"]) if r["content"] in swipes else 0
        del r["swipes"]
    return rows


async def set_message_image(sid: str, mid: str, url: str, positive: str = None,
                             negative: str = None, is_explicit: bool = False):
    await _w(sa_update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)).values(
        image=url, image_positive=positive, image_negative=negative,
        image_ts=int(time.time()) if url else None,
        image_is_explicit=1 if (url and is_explicit) else 0))
    log.info("chat_sessions: message image set session=%s message=%s", sid, mid)


async def set_message_image_explicit(sid: str, mid: str):
    await _w(sa_update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)).values(image_is_explicit=1))
    log.info("chat_sessions: message image marked explicit session=%s message=%s", sid, mid)


async def edit_message(sid: str, mid: str, content: str):
    await _w(sa_update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)).values(
        content=_encrypt_secret(content or "")))
    log.info("chat_sessions: message edited session=%s message=%s", sid, mid)


async def delete_message(sid: str, mid: str):
    await _w(sa_delete(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)))
    log.info("chat_sessions: message deleted session=%s message=%s", sid, mid)


async def add_swipe(sid: str, mid: str, new_content: str) -> dict:
    row = await _q1(select(messages.c.content, messages.c.swipes).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)))
    if not row:
        raise ValueError(f"message {mid} not found in session {sid}")
    swipes = _decrypt_json_list(row.get("swipes")) or [_decrypt_secret(row.get("content") or "")]
    swipes.append(new_content)
    await _w(sa_update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)).values(
        content=_encrypt_secret(new_content), swipes=_encrypt_json_list(swipes)))
    log.info("chat_sessions: swipe added session=%s message=%s count=%d", sid, mid, len(swipes))
    return {"index": len(swipes) - 1, "count": len(swipes)}


async def swipe(sid: str, mid: str, direction: str) -> dict:
    row = await _q1(select(messages.c.content, messages.c.swipes).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)))
    if not row:
        raise ValueError(f"message {mid} not found in session {sid}")
    current = _decrypt_secret(row.get("content") or "")
    swipes = _decrypt_json_list(row.get("swipes")) or [current]
    if len(swipes) < 2:
        raise ValueError("this message has no alternate swipes")
    cur_idx = swipes.index(current) if current in swipes else 0
    new_idx = (cur_idx + (1 if direction == "next" else -1)) % len(swipes)
    await edit_message(sid, mid, swipes[new_idx])
    log.info("chat_sessions: swiped session=%s message=%s index=%d", sid, mid, new_idx)
    return {"index": new_idx, "count": len(swipes)}


async def prune_last_swipes(sid: str) -> None:
    row = await _q1(select(messages.c.seq, messages.c.id, messages.c.swipes)
                    .where(messages.c.session_id == sid)
                    .order_by(messages.c.seq.desc()).limit(1))
    if not row or not row.get("swipes"):
        return
    await _w(sa_update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == row["id"])).values(swipes=None))
    log.info("chat_sessions: swipes pruned session=%s message=%s", sid, row["id"])


