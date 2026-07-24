from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, func

from backend.db import session_participants, _q, _q1, _w, _scalar
from backend.state import log

MAX_PARTICIPANTS = 8

async def add(session_id: str, user_id: str, persona_id: str | None, role: str) -> None:
    current_count = await _scalar(
        select(func.count()).select_from(session_participants)
        .where(session_participants.c.session_id == session_id)
    )
    if current_count >= MAX_PARTICIPANTS:
        raise ValueError("session full")
    await _w(insert(session_participants).values(
        session_id=session_id, user_id=user_id, persona_id=persona_id,
        role=role, joined_at=time.time(),
    ))
    log.info("session_participants: added user=%s session=%s role=%s", user_id, session_id, role)

async def list_for_session(session_id: str) -> list[dict]:
    return await _q(
        select(session_participants).where(session_participants.c.session_id == session_id)
    )

async def remove(session_id: str, user_id: str) -> None:
    await _w(sa_delete(session_participants).where(
        session_participants.c.session_id == session_id,
        session_participants.c.user_id == user_id,
    ))
    log.info("session_participants: removed user=%s session=%s", user_id, session_id)

async def list_session_ids_for_user(user_id: str) -> list[str]:
    rows = await _q(
        select(session_participants.c.session_id).where(session_participants.c.user_id == user_id)
    )
    return [r["session_id"] for r in rows]

async def set_persona(session_id: str, user_id: str, persona_id: str | None) -> None:
    await _w(sa_update(session_participants).where(
        session_participants.c.session_id == session_id,
        session_participants.c.user_id == user_id,
    ).values(persona_id=persona_id))
    log.info("session_participants: persona set user=%s session=%s persona=%s", user_id, session_id, persona_id)

async def is_participant(session_id: str, user_id: str) -> bool:
    row = await _q1(
        select(session_participants.c.user_id).where(
            session_participants.c.session_id == session_id,
            session_participants.c.user_id == user_id,
        )
    )
    return row is not None
