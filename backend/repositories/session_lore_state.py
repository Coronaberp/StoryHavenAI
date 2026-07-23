import time

from sqlalchemy import select, insert, update as sa_update, and_

from backend.db import session_lore_state, nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret
from backend.state import log


def _row(row) -> dict:
    return {
        "session_id": row["session_id"],
        "lore_id": row["lore_id"],
        "override_content": _decrypt_secret(row["override_content"]) if row["override_content"] else row["override_content"],
        "override_fact_id": row["override_fact_id"],
    }


async def get_state(session_id: str, lore_id: str) -> dict | None:
    row = await _q1(select(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id, session_lore_state.c.lore_id == lore_id)))
    return _row(row) if row else None


async def set_override(session_id: str, lore_id: str, content: str, fact_id: str) -> None:
    existing = await get_state(session_id, lore_id)
    if existing:
        await _w(sa_update(session_lore_state).where(
            and_(session_lore_state.c.session_id == session_id, session_lore_state.c.lore_id == lore_id)
        ).values(override_content=_encrypt_secret(content), override_fact_id=fact_id, updated=time.time()))
    else:
        await _w(insert(session_lore_state).values(
            id=nid("sls"), session_id=session_id, lore_id=lore_id,
            override_content=_encrypt_secret(content), override_fact_id=fact_id, updated=time.time()))
    log.info("session_lore_state: override set session=%s lore=%s fact=%s", session_id, lore_id, fact_id)


async def clear_override(session_id: str, lore_id: str) -> str | None:
    existing = await get_state(session_id, lore_id)
    if not existing or not existing["override_fact_id"]:
        return None
    fact_id = existing["override_fact_id"]
    await _w(sa_update(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id, session_lore_state.c.lore_id == lore_id)
    ).values(override_content=None, override_fact_id=None, updated=time.time()))
    log.info("session_lore_state: override cleared session=%s lore=%s fact=%s", session_id, lore_id, fact_id)
    return fact_id


async def get_all_overrides_for_session(session_id: str) -> dict[str, str]:
    rows = await _q(select(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id,
             session_lore_state.c.override_content.is_not(None))))
    return {r["lore_id"]: _decrypt_secret(r["override_content"]) for r in rows}
