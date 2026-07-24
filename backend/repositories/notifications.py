from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, func

from backend.db import notifications, nid, _q, _q1, _w, _scalar, _encrypt_secret, _decrypt_secret
from backend.repositories import users as user_repo
from backend.state import log

def _notif_row(r) -> dict:
    d = dict(r)
    d["read"] = bool(d.get("read"))
    d["title"] = _decrypt_secret(d.get("title") or "")
    d["body"] = _decrypt_secret(d.get("body") or "")
    return d

async def create(user_id: str, type: str, title: str, body: str = "",
                 link: str = "", related_id: str | None = None) -> str:
    nt = nid("nt")
    await _w(insert(notifications).values(
        id=nt, user_id=user_id, type=type,
        title=_encrypt_secret(title or ""), body=_encrypt_secret(body or ""),
        link=link, related_id=related_id, read=0, created=time.time()))
    log.info("notifications: created id=%s user=%s type=%s", nt, user_id, type)
    return nt

async def notify_admins(type: str, title: str, body: str = "",
                        link: str = "", related_id: str | None = None,
                        exclude_user_id: str | None = None) -> int:
    admin_ids = await user_repo.list_admin_user_ids()
    sent = 0
    for aid in admin_ids:
        if aid == exclude_user_id:
            continue
        if related_id is not None and await exists(aid, type, related_id):
            continue
        await create(aid, type, title, body, link, related_id=related_id)
        sent += 1
    log.info("notifications: notify_admins type=%s sent=%d", type, sent)
    return sent

async def notify_all_users(type: str, title: str, body: str = "",
                           link: str = "", related_id: str | None = None,
                           include_devs: bool = False) -> int:
    if include_devs:
        user_ids = await user_repo.list_active_user_ids()
    else:
        user_ids = await user_repo.list_active_non_dev_user_ids()
    sent = 0
    for uid in user_ids:
        await create(uid, type, title, body, link, related_id=related_id)
        sent += 1
    log.info("notifications: notify_all_users type=%s sent=%d", type, sent)
    return sent

async def list_for_user(user_id: str, unread_only: bool = False,
                        limit: int = 50) -> list[dict]:
    conds = [notifications.c.user_id == user_id]
    if unread_only:
        conds.append(notifications.c.read == 0)
    stmt = (select(notifications).where(and_(*conds))
            .order_by(notifications.c.created.desc()).limit(limit))
    return [_notif_row(r) for r in await _q(stmt)]

async def mark_read(nt: str, user_id: str):
    await _w(sa_update(notifications).where(and_(
        notifications.c.id == nt, notifications.c.user_id == user_id)).values(read=1))
    log.info("notifications: marked read id=%s user=%s", nt, user_id)

async def mark_all_read(user_id: str):
    await _w(sa_update(notifications).where(and_(
        notifications.c.user_id == user_id, notifications.c.read == 0)).values(read=1))
    log.info("notifications: marked all read user=%s", user_id)

async def delete_all(user_id: str):
    await _w(sa_delete(notifications).where(notifications.c.user_id == user_id))
    log.info("notifications: deleted all user=%s", user_id)

async def unread_count(user_id: str) -> int:
    return await _scalar(select(func.count()).select_from(notifications).where(and_(
        notifications.c.user_id == user_id, notifications.c.read == 0))) or 0

async def exists(user_id: str, type: str, related_id: str) -> bool:
    r = await _q1(select(notifications.c.id).where(and_(
        notifications.c.user_id == user_id, notifications.c.type == type,
        notifications.c.related_id == related_id)))
    return bool(r)
