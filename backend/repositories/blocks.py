from __future__ import annotations
import time

from sqlalchemy import select, insert, update, delete, and_, or_

from backend import db
from backend.db import user_blocks, users, _q, _q1, _w, _decrypt_secret
from backend.state import log

async def block_user(blocker_id: str, blocked_id: str, reason: str = ""):
    async with db._engine.begin() as conn:
        exists = (await conn.execute(select(user_blocks).where(and_(
            user_blocks.c.blocker_id == blocker_id,
            user_blocks.c.blocked_id == blocked_id)))).fetchone()
        if exists:
            await conn.execute(update(user_blocks).where(and_(
                user_blocks.c.blocker_id == blocker_id,
                user_blocks.c.blocked_id == blocked_id)).values(reason=reason or ""))
        else:
            await conn.execute(insert(user_blocks).values(
                blocker_id=blocker_id, blocked_id=blocked_id,
                reason=reason or "", created=time.time()))
    log.info(f"user block set blocker={blocker_id} blocked={blocked_id}")

async def unblock_user(blocker_id: str, blocked_id: str):
    await _w(delete(user_blocks).where(and_(
        user_blocks.c.blocker_id == blocker_id,
        user_blocks.c.blocked_id == blocked_id)))
    log.info(f"user block removed blocker={blocker_id} blocked={blocked_id}")

async def has_blocked(blocker_id: str, blocked_id: str) -> bool:
    r = await _q1(select(user_blocks.c.blocker_id).where(and_(
        user_blocks.c.blocker_id == blocker_id,
        user_blocks.c.blocked_id == blocked_id)))
    return bool(r)

async def is_block_between(a: str, b: str) -> bool:
    r = await _q1(select(user_blocks.c.blocker_id).where(or_(
        and_(user_blocks.c.blocker_id == a, user_blocks.c.blocked_id == b),
        and_(user_blocks.c.blocker_id == b, user_blocks.c.blocked_id == a))))
    return bool(r)

async def blocked_ids(blocker_id: str) -> set:
    rows = await _q(select(user_blocks.c.blocked_id).where(
        user_blocks.c.blocker_id == blocker_id))
    return {r["blocked_id"] for r in rows}

async def hidden_user_ids(viewer_id: str) -> set:
    rows = await _q(select(user_blocks).where(or_(
        user_blocks.c.blocker_id == viewer_id,
        user_blocks.c.blocked_id == viewer_id)))
    out = set()
    for r in rows:
        out.add(r["blocked_id"] if r["blocker_id"] == viewer_id else r["blocker_id"])
    return out

async def list_blocked(blocker_id: str) -> list[dict]:
    j = user_blocks.join(users, users.c.id == user_blocks.c.blocked_id)
    rows = await _q(select(users.c.id, users.c.username, users.c.display_name,
                          users.c.avatar, user_blocks.c.reason, user_blocks.c.created)
                    .select_from(j)
                    .where(user_blocks.c.blocker_id == blocker_id)
                    .order_by(user_blocks.c.created.desc()))
    return [{"id": r["id"], "username": r["username"],
             "display_name": _decrypt_secret(r.get("display_name") or ""),
             "avatar": r.get("avatar") or "", "reason": r.get("reason") or ""}
            for r in rows]
