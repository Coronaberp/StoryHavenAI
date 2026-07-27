from __future__ import annotations
import time

from sqlalchemy import select, insert, delete as sa_delete, and_, func

from backend import db
from backend.db import content_likes
from backend.state import log

async def like(target_type: str, target_id: str, user_id: str):
    async with db._engine.begin() as conn:
        exists = (await conn.execute(select(content_likes).where(and_(
            content_likes.c.target_type == target_type,
            content_likes.c.target_id == target_id,
            content_likes.c.user_id == user_id)))).fetchone()
        if not exists:
            await conn.execute(insert(content_likes).values(
                target_type=target_type, target_id=target_id,
                user_id=user_id, created=time.time()))
    log.info("content_likes: target=%s:%s liked by=%s", target_type, target_id, user_id)

async def unlike(target_type: str, target_id: str, user_id: str):
    await db._w(sa_delete(content_likes).where(and_(
        content_likes.c.target_type == target_type,
        content_likes.c.target_id == target_id,
        content_likes.c.user_id == user_id)))
    log.info("content_likes: target=%s:%s unliked by=%s", target_type, target_id, user_id)

async def like_count(target_type: str, target_id: str) -> int:
    return await db._scalar(select(func.count()).select_from(content_likes)
                            .where(and_(content_likes.c.target_type == target_type,
                                        content_likes.c.target_id == target_id))) or 0

async def like_counts_batch(target_type: str, target_ids: list[str]) -> dict[str, int]:
    if not target_ids:
        return {}
    rows = await db._q(select(content_likes.c.target_id, func.count().label("n"))
                       .where(and_(content_likes.c.target_type == target_type,
                                   content_likes.c.target_id.in_(target_ids)))
                       .group_by(content_likes.c.target_id))
    return {r["target_id"]: r["n"] for r in rows}

async def has_liked(target_type: str, target_id: str, user_id: str) -> bool:
    row = await db._q1(select(content_likes).where(and_(
        content_likes.c.target_type == target_type,
        content_likes.c.target_id == target_id,
        content_likes.c.user_id == user_id)))
    return row is not None

async def list_liked_by_user(user_id: str, target_type: str | None = None) -> list[dict]:
    conditions = [content_likes.c.user_id == user_id]
    if target_type is not None:
        conditions.append(content_likes.c.target_type == target_type)
    stmt = (select(content_likes).where(and_(*conditions))
            .order_by(content_likes.c.created.desc()))
    rows = await db._q(stmt)
    return [{"target_type": r["target_type"], "target_id": r["target_id"],
             "created": r["created"]} for r in rows]
