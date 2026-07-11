"""Lorebook repository — encapsulates CRUD for the `lore` table."""
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, or_

from backend.db import lore, nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret
from backend.state import log


def _row(row) -> dict:
    d = dict(row)
    d["content"] = _decrypt_secret(d.get("content") or "")
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["appearance_tags"] = _decrypt_secret(d.get("appearance_tags") or "")
    d["appearance_tags_negative"] = _decrypt_secret(d.get("appearance_tags_negative") or "")
    d["keys"] = [k for k in _decrypt_secret(d.get("keys") or "").split(",") if k]
    d["always"] = bool(d.get("always"))
    d["hidden"] = bool(d.get("hidden"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    d["global"] = d.get("char_id") is None
    return d


def _keys_str(keys) -> str:
    if isinstance(keys, list):
        return ",".join(k.strip() for k in keys if k.strip())
    return ",".join(k.strip() for k in str(keys or "").split(",") if k.strip())


async def create(char_id, keys, content, always, image="", category="", hidden=False, name="",
                  appearance_tags="", appearance_tags_negative="", is_explicit=False) -> str:
    lid = nid("l")
    await _w(insert(lore).values(
        id=lid, char_id=char_id, keys=_encrypt_secret(_keys_str(keys)),
        content=_encrypt_secret(content or ""), always=1 if always else 0,
        image=image, category=category, hidden=1 if hidden else 0,
        name=_encrypt_secret(name or ""),
        appearance_tags=_encrypt_secret(appearance_tags or ""),
        appearance_tags_negative=_encrypt_secret(appearance_tags_negative or ""),
        is_explicit=1 if is_explicit else 0, created=time.time()))
    log.info("lore: created id=%s char=%s always=%s hidden=%s", lid, char_id, bool(always), bool(hidden))
    return lid


async def get(lid: str) -> dict | None:
    row = await _q1(select(lore).where(lore.c.id == lid))
    return _row(row) if row else None


async def list_for_character(char_id: str) -> list[dict]:
    stmt = (select(lore)
            .where(or_(lore.c.char_id == char_id, lore.c.char_id.is_(None)))
            .order_by(lore.c.always.desc(), lore.c.created.desc()))
    return [_row(r) for r in await _q(stmt)]


async def by_ids(ids: list[str]) -> list[dict]:
    if not ids:
        return []
    return [_row(r) for r in await _q(select(lore).where(lore.c.id.in_(ids)))]


async def update(lid: str, keys, content, always, image=None, category=None, hidden=None, name=None,
                  appearance_tags=None, appearance_tags_negative=None, is_explicit=None) -> bool:
    cur = await get(lid)
    if not cur:
        log.warning("lore: update failed, id=%s not found", lid)
        return False
    await _w(sa_update(lore).where(lore.c.id == lid).values(
        keys=_encrypt_secret(_keys_str(keys)), content=_encrypt_secret(content or ""),
        always=1 if always else 0,
        image=cur["image"] if image is None else image,
        category=cur["category"] if category is None else category,
        hidden=(1 if cur["hidden"] else 0) if hidden is None else (1 if hidden else 0),
        name=_encrypt_secret(cur["name"] if name is None else name),
        appearance_tags=_encrypt_secret(cur["appearance_tags"] if appearance_tags is None else appearance_tags),
        appearance_tags_negative=_encrypt_secret(cur["appearance_tags_negative"] if appearance_tags_negative is None else appearance_tags_negative),
        is_explicit=(1 if cur.get("is_explicit") else 0) if is_explicit is None else (1 if is_explicit else 0)))
    log.info("lore: updated id=%s", lid)
    return True


async def delete(lid: str) -> None:
    await _w(sa_delete(lore).where(lore.c.id == lid))
    log.info("lore: deleted id=%s", lid)


async def set_explicit(lid: str, explicit: bool = True):
    await _w(sa_update(lore).where(lore.c.id == lid).values(is_explicit=1 if explicit else 0))
    log.info("lore: set_explicit id=%s explicit=%s", lid, explicit)
