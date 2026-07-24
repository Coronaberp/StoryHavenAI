from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update

from backend.db import model_requests, users, nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret
from backend.state import log

async def create(user_id: str, model_name: str, source_url: str, note: str,
                  request_type: str = "checkpoint", host_allowed: int = 1,
                  vae_url: str | None = None, text_encoder_url: str | None = None) -> dict:
    rid = nid("mr")
    created = time.time()
    await _w(insert(model_requests).values(
        id=rid, user_id=user_id, model_name=model_name, source_url=source_url,
        note=_encrypt_secret(note or ""), request_type=request_type, status="pending",
        created=created, host_allowed=host_allowed,
        vae_url=vae_url, text_encoder_url=text_encoder_url))
    log.info("model_requests: created id=%s user=%s type=%s", rid, user_id, request_type)
    return {"id": rid, "user_id": user_id, "model_name": model_name, "source_url": source_url,
            "note": note, "request_type": request_type, "status": "pending",
            "created": created, "resolved": None, "host_allowed": host_allowed,
            "local_path": None, "error": "", "vae_url": vae_url,
            "text_encoder_url": text_encoder_url}

async def list(user_id: str | None = None, pending_only: bool = False) -> list[dict]:
    j = model_requests.join(users, users.c.id == model_requests.c.user_id, isouter=True)
    stmt = select(model_requests, users.c.username.label("username")).select_from(j)
    if user_id:
        stmt = stmt.where(model_requests.c.user_id == user_id)
    if pending_only:

        stmt = stmt.where(model_requests.c.status.in_(("pending", "downloading", "failed")))
    stmt = stmt.order_by(model_requests.c.created.desc())
    rows = await _q(stmt)
    for r in rows:
        r["note"] = _decrypt_secret(r.get("note") or "")
    return rows

async def get(rid: str) -> dict | None:
    r = await _q1(select(model_requests).where(model_requests.c.id == rid))
    if r:
        r["note"] = _decrypt_secret(r.get("note") or "")
    return r

async def set_status(rid: str, status: str, local_path: str | None = None,
                      error: str | None = None):
    values = {"status": status, "resolved": time.time()}
    if local_path is not None:
        values["local_path"] = local_path
    if error is not None:
        values["error"] = error
    await _w(sa_update(model_requests).where(model_requests.c.id == rid).values(**values))
    log.info("model_requests: id=%s status=%s", rid, status)
