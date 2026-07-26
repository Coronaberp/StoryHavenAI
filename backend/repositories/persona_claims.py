from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, and_

from backend.db import session_persona_claims, personas, _q, _q1, _w, _decrypt_secret
from backend.state import log

def _row(row) -> dict:
    return {
        "session_id": row["session_id"], "persona_id": row["persona_id"],
        "user_id": row["user_id"], "status": row["status"],
        "claimed_at": row["claimed_at"], "vacated_at": row["vacated_at"],
    }

async def claim(session_id: str, persona_id: str, user_id: str) -> None:
    await vacate_by_user(session_id, user_id)
    now = time.time()
    existing = await _q1(select(session_persona_claims).where(and_(
        session_persona_claims.c.session_id == session_id,
        session_persona_claims.c.persona_id == persona_id)))
    if existing:
        await _w(sa_update(session_persona_claims).where(and_(
            session_persona_claims.c.session_id == session_id,
            session_persona_claims.c.persona_id == persona_id,
        )).values(user_id=user_id, status="claimed", claimed_at=now, vacated_at=None))
    else:
        await _w(insert(session_persona_claims).values(
            session_id=session_id, persona_id=persona_id, user_id=user_id,
            status="claimed", claimed_at=now, vacated_at=None))
    log.info("persona_claims: claimed session=%s persona=%s user=%s", session_id, persona_id, user_id)

async def vacate_by_user(session_id: str, user_id: str) -> None:
    row = await get_claim_for_user(session_id, user_id)
    if not row:
        return
    await _w(sa_update(session_persona_claims).where(and_(
        session_persona_claims.c.session_id == session_id,
        session_persona_claims.c.persona_id == row["persona_id"],
    )).values(status="vacated", vacated_at=time.time()))
    log.info("persona_claims: vacated session=%s persona=%s user=%s", session_id, row["persona_id"], user_id)

async def restore_on_rejoin(session_id: str, user_id: str) -> bool:
    rows = await _q(select(session_persona_claims).where(and_(
        session_persona_claims.c.session_id == session_id,
        session_persona_claims.c.user_id == user_id,
        session_persona_claims.c.status == "vacated",
    )).order_by(session_persona_claims.c.vacated_at.desc()))
    if not rows:
        return False
    target = rows[0]
    await _w(sa_update(session_persona_claims).where(and_(
        session_persona_claims.c.session_id == session_id,
        session_persona_claims.c.persona_id == target["persona_id"],
    )).values(status="claimed", claimed_at=time.time(), vacated_at=None))
    log.info("persona_claims: restored session=%s persona=%s user=%s",
             session_id, target["persona_id"], user_id)
    return True

async def get_claim_for_user(session_id: str, user_id: str) -> dict | None:
    row = await _q1(select(session_persona_claims).where(and_(
        session_persona_claims.c.session_id == session_id,
        session_persona_claims.c.user_id == user_id,
        session_persona_claims.c.status == "claimed",
    )))
    return _row(row) if row else None

async def list_claimed(session_id: str) -> list[dict]:
    rows = await _q(select(session_persona_claims).where(and_(
        session_persona_claims.c.session_id == session_id,
        session_persona_claims.c.status == "claimed")))
    return [_row(r) for r in rows]

async def _persona_names_by_status(session_id: str, status: str) -> list[str]:
    rows = await _q(select(session_persona_claims.c.persona_id).where(and_(
        session_persona_claims.c.session_id == session_id,
        session_persona_claims.c.status == status)))
    persona_ids = [r["persona_id"] for r in rows]
    if not persona_ids:
        return []
    persona_rows = await _q(select(personas.c.id, personas.c.name).where(personas.c.id.in_(persona_ids)))
    return [_decrypt_secret(r["name"]) for r in persona_rows if r["name"]]

async def list_protected_names(session_id: str, exclude_persona_id: str | None = None) -> list[str]:
    claimed_rows = await _q(select(session_persona_claims).where(and_(
        session_persona_claims.c.session_id == session_id,
        session_persona_claims.c.status == "claimed")))
    persona_ids = [r["persona_id"] for r in claimed_rows if r["persona_id"] != exclude_persona_id]
    if not persona_ids:
        return []
    persona_rows = await _q(select(personas.c.id, personas.c.name).where(personas.c.id.in_(persona_ids)))
    return [_decrypt_secret(r["name"]) for r in persona_rows if r["name"]]

async def list_absent_names(session_id: str) -> list[str]:
    return await _persona_names_by_status(session_id, "vacated")
