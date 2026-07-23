import time

from sqlalchemy import select, insert, delete as sa_delete, and_

from backend.db import (lore_secrets, session_secret_reveals, nid, _q, _w,
                        _encrypt_secret, _decrypt_secret)
from backend.state import log


def _row(row) -> dict:
    return {"id": row["id"], "text": _decrypt_secret(row["text"] or ""), "position": row["position"]}


async def secrets_for(lore_id: str) -> list[dict]:
    rows = await _q(select(lore_secrets).where(lore_secrets.c.lore_id == lore_id)
                    .order_by(lore_secrets.c.position))
    return [_row(r) for r in rows]


async def set_secrets(lore_id: str, texts: list[str]) -> list[dict]:
    await delete_secrets(lore_id)
    created = time.time()
    rows = [{"id": nid("lsec"), "lore_id": lore_id, "text": _encrypt_secret(t), "position": i,
             "created": created}
            for i, t in enumerate(texts)]
    if rows:
        await _w(insert(lore_secrets).values(rows))
    log.info("lore_secrets: set count=%s lore=%s", len(rows), lore_id)
    return await secrets_for(lore_id)


async def delete_secrets(lore_id: str) -> None:
    await _w(sa_delete(lore_secrets).where(lore_secrets.c.lore_id == lore_id))
    log.info("lore_secrets: deleted lore=%s", lore_id)


async def reveal(session_id: str, secret_id: str) -> None:
    existing = await _q(select(session_secret_reveals).where(
        and_(session_secret_reveals.c.session_id == session_id,
             session_secret_reveals.c.secret_id == secret_id)))
    if existing:
        return
    await _w(insert(session_secret_reveals).values(
        id=nid("ssr"), session_id=session_id, secret_id=secret_id, revealed=time.time()))
    log.info("lore_secrets: revealed session=%s secret=%s", session_id, secret_id)


async def revealed_ids(session_id: str, secret_ids: list[str]) -> set[str]:
    if not secret_ids:
        return set()
    rows = await _q(select(session_secret_reveals.c.secret_id).where(
        and_(session_secret_reveals.c.session_id == session_id,
             session_secret_reveals.c.secret_id.in_(secret_ids))))
    return {r["secret_id"] for r in rows}
