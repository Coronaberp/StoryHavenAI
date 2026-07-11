"""Chat session and message repositories — encapsulates CRUD for the
`sessions` and `messages` tables."""
from __future__ import annotations
import json
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, func

from backend.db import (
    sessions, messages,
    nid, _q, _q1, _w, _preview, _encrypt_secret, _decrypt_secret, engine,
)
from backend.state import log


async def _with_preview(rows) -> list[dict]:
    """Attach a plain-text preview of the last message to each session row."""
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


async def set_language(sid: str, language: str | None):
    await _w(sa_update(sessions).where(sessions.c.id == sid).values(language=language))
    log.info("chat_sessions: language set id=%s language=%s", sid, language)


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


async def add_message(sid: str, role: str, content: str, lang: str | None = None) -> dict:
    mid = nid("m")
    ts = int(time.time())
    async with engine().begin() as conn:
        await conn.execute(insert(messages).values(
            id=mid, session_id=sid, role=role,
            content=_encrypt_secret(content or ""), ts=ts, lang=lang))
        await conn.execute(sa_update(sessions).where(sessions.c.id == sid)
                           .values(updated=time.time()))
    return {"id": mid, "role": role, "content": content, "ts": ts, "lang": lang}


async def list_messages(sid: str) -> list[dict]:
    stmt = (select(messages.c.id, messages.c.role, messages.c.content,
                   messages.c.ts, messages.c.image, messages.c.lang)
            .where(messages.c.session_id == sid).order_by(messages.c.seq.asc()))
    rows = await _q(stmt)
    for r in rows:
        r["content"] = _decrypt_secret(r.get("content") or "")
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


async def pop_trailing_assistant(sid: str):
    async with engine().begin() as conn:
        popped = 0
        while True:
            res = await conn.execute(
                select(messages.c.seq, messages.c.role)
                .where(messages.c.session_id == sid)
                .order_by(messages.c.seq.desc()).limit(1))
            row = res.fetchone()
            if not row or row._mapping["role"] != "assistant":
                break
            await conn.execute(sa_delete(messages).where(
                messages.c.seq == row._mapping["seq"]))
            popped += 1
    if popped:
        log.info("chat_sessions: popped %d trailing assistant message(s) session=%s", popped, sid)
