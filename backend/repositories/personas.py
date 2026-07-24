from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, or_

from backend.db import (
    personas, characters,
    nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret, engine,
)
from backend.repositories.characters import _char_row
from backend.state import log

def _persona_row(row) -> dict:
    d = dict(row)
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["description"] = _decrypt_secret(d.get("description") or "")
    d["gender"] = _decrypt_secret(d.get("gender") or "")
    d["is_draft"] = bool(d.get("is_draft"))
    return d

async def create(data: dict, user_id: str = None) -> dict:
    pid = nid("p")
    async with engine().begin() as conn:
        if data.get("is_default"):
            await conn.execute(sa_update(personas)
                               .where(personas.c.owner_id == user_id)
                               .values(is_default=0))
        await conn.execute(insert(personas).values(
            id=pid, name=_encrypt_secret(data.get("name") or "You"),
            description=_encrypt_secret(data.get("description") or ""),
            gender=_encrypt_secret(data.get("gender") or ""),
            avatar=data.get("avatar") or "",
            is_default=1 if data.get("is_default") else 0,
            is_draft=1 if data.get("is_draft") else 0,
            session_id=data.get("session_id") or None,
            owner_id=user_id, created=time.time()))
    log.info("personas: created id=%s owner=%s draft=%s session=%s",
              pid, user_id, bool(data.get("is_draft")), data.get("session_id"))
    return await get(pid)

async def get(pid: str) -> dict | None:
    row = await _q1(select(personas).where(personas.c.id == pid))
    return _persona_row(row) if row else None

async def list_all(user_id: str = None) -> list[dict]:
    stmt = (select(personas).where(personas.c.owner_id == user_id)
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return [_persona_row(r) for r in await _q(stmt)]

async def list_own(user_id: str = None) -> list[dict]:
    stmt = (select(personas)
            .where(and_(personas.c.owner_id == user_id,
                        personas.c.is_draft == 0,
                        personas.c.session_id.is_(None)))
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return [_persona_row(r) for r in await _q(stmt)]

async def list_own_for_session(user_id: str, session_id: str) -> list[dict]:
    stmt = (select(personas)
            .where(and_(personas.c.owner_id == user_id,
                        personas.c.is_draft == 0,
                        or_(personas.c.session_id.is_(None),
                            personas.c.session_id == session_id)))
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return [_persona_row(r) for r in await _q(stmt)]

async def list_drafts(user_id: str = None) -> list[dict]:
    stmt = (select(personas)
            .where(and_(personas.c.owner_id == user_id,
                        personas.c.source_char_id.is_(None),
                        personas.c.is_draft == 1))
            .order_by(personas.c.created.desc()))
    return [_persona_row(r) for r in await _q(stmt)]

async def list_pool_characters(user_id: str = None, is_admin: bool = False) -> list[dict]:
    conditions = [characters.c.can_be_persona == 1]
    if user_id:
        conditions.append(or_(characters.c.is_public == 1,
                              characters.c.owner_id == user_id))
    else:
        conditions.append(characters.c.is_public == 1)
    stmt = select(characters).where(and_(*conditions))
    rows = [_char_row(r) for r in await _q(stmt)]
    rows.sort(key=lambda c: (c.get("name") or "").lower())
    return rows

async def get_or_create_from_character(char: dict, user_id: str = None) -> dict:
    row = await _q1(select(personas).where(and_(
        personas.c.source_char_id == char["id"], personas.c.owner_id == user_id)))
    if row:
        return _persona_row(row)
    pid = nid("p")
    await _w(insert(personas).values(
        id=pid, name=_encrypt_secret(char["name"]),
        description=_encrypt_secret(char.get("persona") or ""),
        avatar=char.get("avatar") or "",
        is_default=0, owner_id=user_id, source_char_id=char["id"],
        created=time.time()))
    log.info("personas: created id=%s from character char=%s owner=%s", pid, char["id"], user_id)
    return await get(pid)

async def get_or_create_from_lore(entry: dict, user_id: str = None) -> dict:
    row = await _q1(select(personas).where(and_(
        personas.c.source_lore_id == entry["id"], personas.c.owner_id == user_id)))
    if row:
        return _persona_row(row)
    pid = nid("p")
    await _w(insert(personas).values(
        id=pid, name=_encrypt_secret(entry.get("name") or "Unnamed"),
        description=_encrypt_secret(entry.get("content") or ""),
        avatar=entry.get("image") or "",
        is_default=0, owner_id=user_id, source_lore_id=entry["id"],
        created=time.time()))
    log.info("personas: created id=%s from lore entry=%s owner=%s", pid, entry["id"], user_id)
    return await get(pid)

async def default(user_id: str = None) -> dict | None:
    row = await _q1(select(personas).where(and_(
        personas.c.is_default == 1, personas.c.owner_id == user_id)).limit(1))
    return _persona_row(row) if row else None

async def update(pid: str, data: dict, user_id: str = None) -> dict | None:
    p = await get(pid)
    if not p:
        log.warning("personas: update failed, id=%s not found", pid)
        return None
    async with engine().begin() as conn:
        if data.get("is_default"):
            await conn.execute(sa_update(personas)
                               .where(personas.c.owner_id == user_id)
                               .values(is_default=0))
        vals = dict(
            name=_encrypt_secret(data.get("name", p["name"])),
            description=_encrypt_secret(data.get("description", p["description"]) or ""),
            gender=_encrypt_secret(data.get("gender", p["gender"]) or ""),
            avatar=data.get("avatar", p["avatar"]) or "",
            is_default=1 if data.get("is_default") else p["is_default"])
        if "is_draft" in data:
            vals["is_draft"] = 1 if data.get("is_draft") else 0
        await conn.execute(sa_update(personas).where(personas.c.id == pid).values(**vals))
    log.info("personas: updated id=%s", pid)
    return await get(pid)

async def delete(pid: str):
    await _w(sa_delete(personas).where(personas.c.id == pid))
    log.info("personas: deleted id=%s", pid)
