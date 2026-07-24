from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update

from backend.db import content_reports, users, nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret
from backend.state import log

async def create(kind: str, label: str, target_id: str, image: str,
                  reporter_id: str, note: str = "") -> dict:
    rid = nid("cr")
    created = time.time()
    await _w(insert(content_reports).values(
        id=rid, kind=kind, label=label, target_id=target_id or "", image=image or "",
        reporter_id=reporter_id, note=_encrypt_secret(note or ""), status="pending", created=created))
    log.info("content_reports: created id=%s kind=%s reporter=%s", rid, kind, reporter_id)
    return {"id": rid, "kind": kind, "label": label, "target_id": target_id or "", "image": image or "",
            "reporter_id": reporter_id, "note": note or "", "status": "pending", "created": created}

async def list(pending_only: bool = True) -> list[dict]:
    j = content_reports.join(users, users.c.id == content_reports.c.reporter_id, isouter=True)
    stmt = select(content_reports, users.c.username.label("reporter_username"))
    stmt = stmt.select_from(j)
    if pending_only:
        stmt = stmt.where(content_reports.c.status == "pending")
    stmt = stmt.order_by(content_reports.c.created.desc())
    rows = await _q(stmt)
    for r in rows:
        r["note"] = _decrypt_secret(r.get("note") or "")
    return rows

async def get_pending_for(reporter_id: str, kind: str, target_id: str) -> dict | None:
    row = await _q1(select(content_reports).where(
        content_reports.c.reporter_id == reporter_id,
        content_reports.c.kind == kind,
        content_reports.c.target_id == target_id,
        content_reports.c.status == "pending"))
    if row:
        row["note"] = _decrypt_secret(row.get("note") or "")
    return row

async def get(rid: str) -> dict | None:
    row = await _q1(select(content_reports).where(content_reports.c.id == rid))
    if row:
        row["note"] = _decrypt_secret(row.get("note") or "")
    return row

async def resolve(rid: str):
    await _w(sa_update(content_reports).where(content_reports.c.id == rid)
             .values(status="resolved", resolved_at=time.time()))
    log.info("content_reports: id=%s resolved", rid)

async def list_title_requests() -> list[dict]:
    stmt = (select(users.c.id, users.c.username, users.c.display_name,
                   users.c.title, users.c.title_status, users.c.created)
            .where(users.c.title_status == "pending")
            .order_by(users.c.created.desc()))
    rows = await _q(stmt)
    for r in rows:
        r["display_name"] = _decrypt_secret(r.get("display_name") or "")
    return rows

async def set_title_status(uid: str, status: str):
    await _w(sa_update(users).where(users.c.id == uid).values(title_status=status))
    log.info("content_reports: title request user=%s status=%s", uid, status)
