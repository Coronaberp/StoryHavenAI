import time

from sqlalchemy import select, insert, update as sa_update

from backend.db import (
    image_rating_reports, standalone_images, users,
    _q, _q1, _w, nid, _decrypt_secret, _encrypt_secret,
)
from backend.state import log

async def create(image_id: str, reporter_id: str,
                 claimed_explicit: bool, note: str = "",
                 auto_flagged: bool = False) -> dict:
    rid = nid("irr")
    created = time.time()
    await _w(insert(image_rating_reports).values(
        id=rid, image_id=image_id, reporter_id=reporter_id,
        claimed_explicit=1 if claimed_explicit else 0,
        note=_encrypt_secret(note or ""), status="pending", created=created,
        auto_flagged=1 if auto_flagged else 0))
    log.info(f"image_rating_reports: created id={rid} image_id={image_id} auto_flagged={auto_flagged}")
    return {"id": rid, "image_id": image_id, "reporter_id": reporter_id,
            "claimed_explicit": bool(claimed_explicit), "note": note or "",
            "status": "pending", "created": created, "auto_flagged": bool(auto_flagged)}

async def list(pending_only: bool = True) -> list[dict]:
    j = image_rating_reports.join(
        users, users.c.id == image_rating_reports.c.reporter_id, isouter=True)
    stmt = (select(image_rating_reports, users.c.username.label("reporter_username"),
                   standalone_images.c.image.label("image"),
                   standalone_images.c.is_explicit.label("current_explicit"))
            .select_from(j.join(standalone_images,
                                standalone_images.c.id == image_rating_reports.c.image_id,
                                isouter=True)))
    if pending_only:
        stmt = stmt.where(image_rating_reports.c.status == "pending")
    stmt = stmt.order_by(image_rating_reports.c.created.desc())
    rows = await _q(stmt)
    for r in rows:
        r["note"] = _decrypt_secret(r.get("note") or "")
        r["admin_note"] = _decrypt_secret(r.get("admin_note") or "")
        r["claimed_explicit"] = bool(r.get("claimed_explicit"))
        r["current_explicit"] = bool(r.get("current_explicit"))
        r["auto_flagged"] = bool(r.get("auto_flagged"))
    return rows

async def get(rid: str) -> dict | None:
    r = await _q1(select(image_rating_reports).where(image_rating_reports.c.id == rid))
    if r:
        r["note"] = _decrypt_secret(r.get("note") or "")
        r["admin_note"] = _decrypt_secret(r.get("admin_note") or "")
        r["claimed_explicit"] = bool(r.get("claimed_explicit"))
        r["auto_flagged"] = bool(r.get("auto_flagged"))
    return r

async def resolve(rid: str, admin_note: str = ""):
    await _w(sa_update(image_rating_reports).where(image_rating_reports.c.id == rid)
             .values(status="resolved", resolved_at=time.time(),
                     admin_note=_encrypt_secret(admin_note or "")))
    log.info(f"image_rating_reports: resolved id={rid}")
