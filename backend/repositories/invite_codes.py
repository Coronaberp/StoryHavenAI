import time
import uuid
import secrets

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, or_

from backend import db
from backend.db import invite_codes, users, nid, _q, _q1, _w
from backend.state import log

CODE_BYTES = 6


def _row(row) -> dict:
    d = dict(row)
    d["disabled"] = bool(d.get("disabled"))
    return d


async def create(created_by: str, max_uses: int = 1, expires_days: float | None = None,
                 note: str = "", tier: str = "full") -> dict:
    cid = nid("inv")
    code = str(uuid.uuid4()) if tier == "guest" else secrets.token_urlsafe(CODE_BYTES)
    expires = time.time() + expires_days * 86400 if expires_days else None
    await _w(insert(invite_codes).values(
        id=cid, code=code, created_by=created_by, note=note[:120], tier=tier,
        max_uses=max(1, max_uses), expires=expires, created=time.time()))
    log.info("invite_codes: created id=%s by=%s tier=%s max_uses=%s expires_days=%s",
             cid, created_by, tier, max_uses, expires_days)
    return await get(cid)


async def get(cid: str) -> dict | None:
    row = await _q1(select(invite_codes).where(invite_codes.c.id == cid))
    return _row(row) if row else None


async def list_all() -> list[dict]:
    rows = await _q(select(invite_codes).order_by(invite_codes.c.created.desc()))
    return [_row(r) for r in rows]


async def redeem(code: str) -> dict | None:
    row = await _q1(select(invite_codes).where(invite_codes.c.code == code.strip()))
    if not row:
        return None
    entry = _row(row)
    if entry["disabled"] or entry["uses"] >= entry["max_uses"]:
        return None
    if entry["expires"] and entry["expires"] < time.time():
        return None
    async with db.engine().begin() as conn:
        claimed = await conn.execute(sa_update(invite_codes).where(and_(
            invite_codes.c.id == entry["id"], invite_codes.c.uses < invite_codes.c.max_uses,
            invite_codes.c.disabled == 0,
            or_(invite_codes.c.expires.is_(None), invite_codes.c.expires > time.time()),
        )).values(uses=invite_codes.c.uses + 1))
    if not claimed.rowcount:
        log.warning("invite_codes: redeem race lost id=%s", entry["id"])
        return None
    log.info("invite_codes: redeemed id=%s use=%s/%s", entry["id"], entry["uses"] + 1, entry["max_uses"])
    return entry


async def disable(cid: str) -> bool:
    if not await get(cid):
        return False
    await _w(sa_update(invite_codes).where(invite_codes.c.id == cid).values(disabled=1))
    log.info("invite_codes: disabled id=%s", cid)
    return True


async def delete(cid: str) -> None:
    await _w(sa_delete(invite_codes).where(invite_codes.c.id == cid))
    log.info("invite_codes: deleted id=%s", cid)


async def redeemer_usernames(cid: str) -> list[str]:
    rows = await _q(select(users.c.username).where(users.c.invite_code_id == cid))
    return [r["username"] for r in rows]
