from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_

from backend.db import groups, group_characters, nid, _q, _q1, _w
from backend.state import log


async def _write_cast(gid: str, char_ids: list[str]) -> None:
    await _w(sa_delete(group_characters).where(group_characters.c.group_id == gid))
    for position, char_id in enumerate(char_ids):
        await _w(insert(group_characters).values(
            id=nid("gc"), group_id=gid, char_id=char_id, position=position))


async def create(owner_id: str, name: str, opening: str, group_mode: str,
                 is_public: int, char_ids: list[str]) -> str:
    gid = nid("g")
    now = time.time()
    await _w(insert(groups).values(
        id=gid, owner_id=owner_id, name=name, opening=opening,
        group_mode=group_mode, is_public=1 if is_public else 0, created=now, updated=now))
    await _write_cast(gid, char_ids)
    log.info("group template created: id=%s owner=%s cast=%d public=%s",
             gid, owner_id, len(char_ids), bool(is_public))
    return gid


async def get(gid: str) -> dict | None:
    row = await _q1(select(groups).where(groups.c.id == gid))
    return dict(row) if row else None


async def update(gid: str, name: str, opening: str, group_mode: str, char_ids: list[str]) -> None:
    await _w(sa_update(groups).where(groups.c.id == gid).values(
        name=name, opening=opening, group_mode=group_mode, updated=time.time()))
    await _write_cast(gid, char_ids)
    log.info("group template updated: id=%s cast=%d", gid, len(char_ids))


async def set_public(gid: str, is_public: int) -> None:
    await _w(sa_update(groups).where(groups.c.id == gid).values(
        is_public=1 if is_public else 0, updated=time.time()))
    log.info("group template visibility: id=%s public=%s", gid, bool(is_public))


async def delete(gid: str) -> None:
    await _w(sa_delete(group_characters).where(group_characters.c.group_id == gid))
    await _w(sa_delete(groups).where(groups.c.id == gid))
    log.info("group template deleted: id=%s", gid)


async def set_cast(gid: str, char_ids: list[str]) -> None:
    await _write_cast(gid, char_ids)
    log.info("group template cast set: id=%s cast=%d", gid, len(char_ids))


async def list_cast(gid: str) -> list[dict]:
    rows = await _q(select(group_characters)
                    .where(group_characters.c.group_id == gid)
                    .order_by(group_characters.c.position))
    return [dict(r) for r in rows]


async def list_public(q: str | None, creator_ids: list[str] | None) -> list[dict]:
    conditions = [groups.c.is_public == 1]
    if creator_ids is not None:
        conditions.append(groups.c.owner_id.in_(creator_ids))
    if q:
        conditions.append(groups.c.name.ilike(f"%{q.strip()}%"))
    rows = await _q(select(groups).where(and_(*conditions)).order_by(groups.c.updated.desc()))
    return [dict(r) for r in rows]


async def list_public_for_char(char_id: str) -> list[dict]:
    rows = await _q(
        select(groups)
        .select_from(groups.join(group_characters, groups.c.id == group_characters.c.group_id))
        .where(and_(group_characters.c.char_id == char_id, groups.c.is_public == 1))
        .order_by(groups.c.updated.desc()))
    return [dict(r) for r in rows]


async def list_by_owner(owner_id: str) -> list[dict]:
    rows = await _q(select(groups).where(groups.c.owner_id == owner_id)
                    .order_by(groups.c.updated.desc()))
    return [dict(r) for r in rows]
