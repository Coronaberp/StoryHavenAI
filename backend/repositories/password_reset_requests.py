from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update

from backend.db import password_reset_requests, nid, _q, _q1, _w
from backend.state import log

async def create(user_id: str, username: str) -> str:
    rid = nid("pr")
    await _w(insert(password_reset_requests).values(
        id=rid, user_id=user_id, username=username,
        status="pending", created=time.time()))
    log.info("password_reset_requests: created id=%s user=%s", rid, user_id)
    return rid

async def list(pending_only: bool = True) -> list[dict]:
    stmt = select(password_reset_requests)
    if pending_only:
        stmt = stmt.where(password_reset_requests.c.status == "pending")
    stmt = stmt.order_by(password_reset_requests.c.created.desc())
    return await _q(stmt)

async def get(rid: str) -> dict | None:
    return await _q1(select(password_reset_requests).where(
        password_reset_requests.c.id == rid))

async def set_status(rid: str, status: str):
    await _w(sa_update(password_reset_requests).where(
        password_reset_requests.c.id == rid).values(status=status))
    log.info("password_reset_requests: id=%s status=%s", rid, status)
