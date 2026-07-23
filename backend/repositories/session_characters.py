from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, func

from backend.db import session_characters, nid, _q, _q1, _w
from backend.state import log


async def set_cast(session_id: str, members: list[dict]) -> None:
    await _w(sa_delete(session_characters).where(session_characters.c.session_id == session_id))
    now = time.time()
    for position, member in enumerate(members):
        await _w(insert(session_characters).values(
            id=nid("sc"), session_id=session_id, char_id=member["char_id"],
            position=position, muted=1 if member.get("muted") else 0,
            is_narrator=1 if member.get("is_narrator") else 0, added=now))
    log.info("session_characters: set cast session=%s members=%d", session_id, len(members))


async def list_cast(session_id: str) -> list[dict]:
    rows = await _q(select(session_characters)
                    .where(session_characters.c.session_id == session_id)
                    .order_by(session_characters.c.position))
    return [dict(row) for row in rows]


async def add_member(session_id: str, char_id: str, is_narrator: bool = False) -> None:
    existing = await _q1(select(session_characters.c.id).where(and_(
        session_characters.c.session_id == session_id,
        session_characters.c.char_id == char_id)))
    if existing:
        return
    nextpos = await _q1(select(func.coalesce(func.max(session_characters.c.position), -1).label("m"))
                        .where(session_characters.c.session_id == session_id))
    await _w(insert(session_characters).values(
        id=nid("sc"), session_id=session_id, char_id=char_id,
        position=(nextpos["m"] + 1) if nextpos else 0,
        muted=0, is_narrator=1 if is_narrator else 0, added=time.time()))
    log.info("session_characters: added session=%s char=%s narrator=%s", session_id, char_id, is_narrator)


async def remove_member(session_id: str, char_id: str) -> None:
    await _w(sa_delete(session_characters).where(and_(
        session_characters.c.session_id == session_id,
        session_characters.c.char_id == char_id)))
    log.info("session_characters: removed session=%s char=%s", session_id, char_id)


async def set_muted(session_id: str, char_id: str, muted: bool) -> None:
    await _w(sa_update(session_characters).where(and_(
        session_characters.c.session_id == session_id,
        session_characters.c.char_id == char_id)).values(muted=1 if muted else 0))
    log.info("session_characters: %s session=%s char=%s", "muted" if muted else "unmuted", session_id, char_id)
