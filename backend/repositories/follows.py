import time

from sqlalchemy import select, insert, delete, and_, func

from backend import db
from backend.db import user_follows, users, _q, _q1, _w, _decrypt_secret
from backend.state import log


async def follow(follower_id: str, followee_id: str) -> bool:
    if follower_id == followee_id:
        return False
    async with db.engine().begin() as conn:
        exists = (await conn.execute(select(user_follows.c.follower_id).where(and_(
            user_follows.c.follower_id == follower_id,
            user_follows.c.followee_id == followee_id)))).fetchone()
        if exists:
            return False
        await conn.execute(insert(user_follows).values(
            follower_id=follower_id, followee_id=followee_id, created=time.time()))
    log.info("follows: %s followed %s", follower_id, followee_id)
    return True


async def unfollow(follower_id: str, followee_id: str) -> None:
    await _w(delete(user_follows).where(and_(
        user_follows.c.follower_id == follower_id,
        user_follows.c.followee_id == followee_id)))
    log.info("follows: %s unfollowed %s", follower_id, followee_id)


async def is_following(follower_id: str, followee_id: str) -> bool:
    return bool(await _q1(select(user_follows.c.follower_id).where(and_(
        user_follows.c.follower_id == follower_id,
        user_follows.c.followee_id == followee_id))))


async def follower_count(user_id: str) -> int:
    return await db._scalar(select(func.count()).select_from(user_follows)
                            .where(user_follows.c.followee_id == user_id)) or 0


async def following_count(user_id: str) -> int:
    return await db._scalar(select(func.count()).select_from(user_follows)
                            .where(user_follows.c.follower_id == user_id)) or 0


async def following_ids(follower_id: str) -> list[str]:
    rows = await _q(select(user_follows.c.followee_id)
                    .where(user_follows.c.follower_id == follower_id))
    return [r["followee_id"] for r in rows]


async def followers(user_id: str) -> list[dict]:
    j = user_follows.join(users, users.c.id == user_follows.c.follower_id)
    stmt = (select(users.c.username, users.c.display_name, users.c.avatar, user_follows.c.created)
            .select_from(j).where(user_follows.c.followee_id == user_id)
            .order_by(user_follows.c.created.desc()))
    return [{"username": r["username"],
             "display_name": _decrypt_secret(r["display_name"] or ""),
             "avatar": r["avatar"] or ""} for r in await _q(stmt)]
