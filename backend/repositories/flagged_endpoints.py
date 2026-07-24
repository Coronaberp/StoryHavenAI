from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update

from backend.db import flagged_endpoints, users, nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret
from backend.state import log

async def create(user_id: str, url: str, api_key: str, reason: str, detail: str = "") -> str:
    fid = nid("fe")
    await _w(insert(flagged_endpoints).values(
        id=fid, user_id=user_id, url=url,
        api_key=_encrypt_secret(api_key) if api_key else "",
        reason=_encrypt_secret(reason or ""), detail=_encrypt_secret(detail or ""),
        created=time.time()))
    log.info("flagged_endpoints: created id=%s user=%s", fid, user_id)
    return fid

async def list(pending_only: bool = True) -> list[dict]:
    j = flagged_endpoints.join(users, users.c.id == flagged_endpoints.c.user_id, isouter=True)
    stmt = select(flagged_endpoints, users.c.username.label("username")).select_from(j)
    if pending_only:
        stmt = stmt.where(flagged_endpoints.c.status == "pending")
    stmt = stmt.order_by(flagged_endpoints.c.created.desc())
    out = []
    for d in await _q(stmt):
        d["has_api_key"] = bool(d.pop("api_key", None))
        d["reason"] = _decrypt_secret(d.get("reason") or "")
        d["detail"] = _decrypt_secret(d.get("detail") or "")
        out.append(d)
    return out

async def get(fid: str) -> dict | None:
    d = await _q1(select(flagged_endpoints).where(flagged_endpoints.c.id == fid))
    if not d:
        return None
    if d.get("api_key"):
        d["api_key"] = _decrypt_secret(d["api_key"])
    d["reason"] = _decrypt_secret(d.get("reason") or "")
    d["detail"] = _decrypt_secret(d.get("detail") or "")
    return d

async def set_status(fid: str, status: str):
    await _w(sa_update(flagged_endpoints).where(flagged_endpoints.c.id == fid)
             .values(status=status))
    log.info("flagged_endpoints: id=%s status=%s", fid, status)
