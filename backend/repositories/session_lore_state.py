import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_

from backend.db import session_lore_state, nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret
from backend.state import log

def _row(row) -> dict:
    return {
        "session_id": row["session_id"],
        "lore_id": row["lore_id"],
        "override_content": _decrypt_secret(row["override_content"]) if row["override_content"] else row["override_content"],
        "override_fact_id": row["override_fact_id"],
        "batch_id": row["batch_id"],
        "prior_override_content": _decrypt_secret(row["prior_override_content"]) if row["prior_override_content"] else row["prior_override_content"],
        "prior_override_fact_id": row["prior_override_fact_id"],
    }

async def get_state(session_id: str, lore_id: str) -> dict | None:
    row = await _q1(select(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id, session_lore_state.c.lore_id == lore_id)))
    return _row(row) if row else None

def _prior_values(existing: dict | None, batch_id: str | None) -> dict:
    if not batch_id or not existing or existing.get("batch_id") == batch_id:
        return {}
    return {
        "prior_override_content": _encrypt_secret(existing["override_content"]) if existing["override_content"] else None,
        "prior_override_fact_id": existing["override_fact_id"],
    }

async def set_override(session_id: str, lore_id: str, content: str, fact_id: str,
                       batch_id: str | None = None) -> None:
    existing = await get_state(session_id, lore_id)
    values = {"override_content": _encrypt_secret(content), "override_fact_id": fact_id,
              "batch_id": batch_id, "updated": time.time()}
    if not batch_id:
        values.update(prior_override_content=None, prior_override_fact_id=None)
    values.update(_prior_values(existing, batch_id))
    if existing:
        await _w(sa_update(session_lore_state).where(
            and_(session_lore_state.c.session_id == session_id,
                 session_lore_state.c.lore_id == lore_id)).values(**values))
    else:
        await _w(insert(session_lore_state).values(
            id=nid("sls"), session_id=session_id, lore_id=lore_id, **values))
    log.info("session_lore_state: override set session=%s lore=%s fact=%s batch=%s",
             session_id, lore_id, fact_id, batch_id)

async def states_for_batches(session_id: str, batch_ids: list[str]) -> list[dict]:
    if not batch_ids:
        return []
    rows = await _q(select(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id,
             session_lore_state.c.batch_id.in_(batch_ids))))
    return [_row(r) for r in rows]

async def restore_prior(session_id: str, lore_id: str) -> None:
    await _w(sa_update(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id,
             session_lore_state.c.lore_id == lore_id)).values(
        override_content=session_lore_state.c.prior_override_content,
        override_fact_id=session_lore_state.c.prior_override_fact_id,
        prior_override_content=None, prior_override_fact_id=None,
        batch_id=None, updated=time.time()))
    log.info("session_lore_state: prior override restored session=%s lore=%s", session_id, lore_id)

async def delete_state(session_id: str, lore_id: str) -> None:
    await _w(sa_delete(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id,
             session_lore_state.c.lore_id == lore_id)))
    log.info("session_lore_state: state deleted session=%s lore=%s", session_id, lore_id)

async def clear_override(session_id: str, lore_id: str) -> str | None:
    existing = await get_state(session_id, lore_id)
    if not existing or not existing["override_fact_id"]:
        return None
    fact_id = existing["override_fact_id"]
    await _w(sa_update(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id, session_lore_state.c.lore_id == lore_id)
    ).values(override_content=None, override_fact_id=None, batch_id=None,
             prior_override_content=None, prior_override_fact_id=None, updated=time.time()))
    log.info("session_lore_state: override cleared session=%s lore=%s fact=%s", session_id, lore_id, fact_id)
    return fact_id

async def get_all_overrides_for_session(session_id: str) -> dict[str, str]:
    rows = await _q(select(session_lore_state).where(
        and_(session_lore_state.c.session_id == session_id,
             session_lore_state.c.override_content.is_not(None))))
    return {r["lore_id"]: _decrypt_secret(r["override_content"]) for r in rows}
