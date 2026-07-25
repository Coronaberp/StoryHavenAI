from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, or_

from backend.db import (
    personas, characters,
    nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret, engine,
)
from backend.repositories.characters import _char_row
from backend.repositories import session_participants
from backend.state import log

def _persona_row(row) -> dict:
    d = dict(row)
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["description"] = _decrypt_secret(d.get("description") or "")
    d["gender"] = _decrypt_secret(d.get("gender") or "")
    d["is_draft"] = bool(d.get("is_draft"))
    return d

async def _attach_linked_char_info(rows: list[dict]) -> list[dict]:
    char_ids = {r["linked_char_id"] for r in rows if r.get("linked_char_id")}
    if not char_ids:
        for r in rows:
            r["linked_char_name"] = None
            r["linked_char_avatar"] = None
        return rows
    char_rows = await _q(select(characters.c.id, characters.c.name, characters.c.avatar)
                         .where(characters.c.id.in_(char_ids)))
    by_id = {c["id"]: c for c in char_rows}
    for r in rows:
        char = by_id.get(r.get("linked_char_id"))
        r["linked_char_name"] = _decrypt_secret(char["name"]) if char else None
        r["linked_char_avatar"] = char["avatar"] if char else None
    return rows

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
            linked_char_id=data.get("linked_char_id") or None,
            owner_id=user_id, created=time.time()))
    log.info("personas: created id=%s owner=%s draft=%s session=%s",
              pid, user_id, bool(data.get("is_draft")), data.get("session_id"))
    return await get(pid)

async def get(pid: str) -> dict | None:
    row = await _q1(select(personas).where(personas.c.id == pid))
    if not row:
        return None
    rows = await _attach_linked_char_info([_persona_row(row)])
    return rows[0]

async def list_all(user_id: str = None) -> list[dict]:
    stmt = (select(personas).where(personas.c.owner_id == user_id)
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return await _attach_linked_char_info([_persona_row(r) for r in await _q(stmt)])

async def list_own(user_id: str = None) -> list[dict]:
    stmt = (select(personas)
            .where(and_(personas.c.owner_id == user_id,
                        personas.c.is_draft == 0,
                        personas.c.session_id.is_(None)))
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return await _attach_linked_char_info([_persona_row(r) for r in await _q(stmt)])

async def list_own_for_session(user_id: str, session_id: str) -> list[dict]:
    stmt = (select(personas)
            .where(and_(personas.c.owner_id == user_id,
                        personas.c.is_draft == 0,
                        or_(personas.c.session_id.is_(None),
                            personas.c.session_id == session_id)))
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return await _attach_linked_char_info([_persona_row(r) for r in await _q(stmt)])

async def list_selectable_for_session(user_id: str, session_id: str) -> list[dict]:
    stmt = (select(personas)
            .where(and_(
                personas.c.is_draft == 0,
                or_(
                    and_(personas.c.owner_id == user_id, personas.c.session_id.is_(None)),
                    personas.c.session_id == session_id,
                ),
            ))
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    rows = await _attach_linked_char_info([_persona_row(r) for r in await _q(stmt)])
    claim_rows = await session_participants.list_for_session(session_id)
    claimed_by_persona_id = {r["persona_id"]: r["user_id"] for r in claim_rows if r.get("persona_id")}
    for row in rows:
        row["claimed_by_user_id"] = claimed_by_persona_id.get(row["id"]) if row.get("session_id") else None
    return rows

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
    if not row:
        return None
    rows = await _attach_linked_char_info([_persona_row(row)])
    return rows[0]

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
            linked_char_id=data.get("linked_char_id", p["linked_char_id"]) or None,
            is_default=1 if data.get("is_default") else p["is_default"])
        if "is_draft" in data:
            vals["is_draft"] = 1 if data.get("is_draft") else 0
        await conn.execute(sa_update(personas).where(personas.c.id == pid).values(**vals))
    log.info("personas: updated id=%s", pid)
    return await get(pid)

async def delete(pid: str):
    await _w(sa_delete(personas).where(personas.c.id == pid))
    log.info("personas: deleted id=%s", pid)
