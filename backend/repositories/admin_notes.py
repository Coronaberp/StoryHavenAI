"""Admin notes left on a user's profile — moderation-adjacent text, distinct
from the comments domain."""
from __future__ import annotations
import time

from sqlalchemy import select, insert, delete as sa_delete

from backend.db import admin_notes, users, nid, _q, _w, _encrypt_secret, _decrypt_secret
from backend.state import log


async def create(user_id: str, author_id: str, note: str) -> dict:
    note_id = nid("an")
    created = time.time()
    await _w(insert(admin_notes).values(
        id=note_id, user_id=user_id, author_id=author_id,
        note=_encrypt_secret(note or ""), created=created))
    log.info("admin_notes: note created id=%s user=%s author=%s", note_id, user_id, author_id)
    return {"id": note_id, "user_id": user_id, "author_id": author_id,
            "note": note, "created": created}


async def list_for_user(user_id: str) -> list[dict]:
    j = admin_notes.join(users, users.c.id == admin_notes.c.author_id, isouter=True)
    stmt = (select(admin_notes, users.c.username)
            .select_from(j)
            .where(admin_notes.c.user_id == user_id)
            .order_by(admin_notes.c.created.desc()))
    out = []
    for r in await _q(stmt):
        out.append({
            "id": r["id"], "user_id": r["user_id"], "author_id": r["author_id"],
            "author_username": r.get("username") or "(deleted)",
            "note": _decrypt_secret(r.get("note") or ""), "created": r["created"],
        })
    return out


async def delete(note_id: str):
    await _w(sa_delete(admin_notes).where(admin_notes.c.id == note_id))
    log.info("admin_notes: note deleted id=%s", note_id)
