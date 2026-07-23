import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete

from backend.db import webauthn_credentials as creds, nid, _q, _q1, _w
from backend.state import log


def _row(row) -> dict:
    return dict(row)


async def create(user_id: str, credential_id: str, public_key: str,
                 sign_count: int, transports: str, aaguid: str, nickname: str) -> str:
    cid = nid("wac")
    await _w(insert(creds).values(
        id=cid, user_id=user_id, credential_id=credential_id, public_key=public_key,
        sign_count=sign_count, transports=transports, aaguid=aaguid,
        nickname=nickname, created=time.time()))
    log.info("webauthn: credential registered id=%s user=%s", cid, user_id)
    return cid


async def list_for_user(user_id: str) -> list[dict]:
    stmt = select(creds).where(creds.c.user_id == user_id).order_by(creds.c.created.desc())
    return [_row(r) for r in await _q(stmt)]


async def get_by_credential_id(credential_id: str) -> dict | None:
    row = await _q1(select(creds).where(creds.c.credential_id == credential_id))
    return _row(row) if row else None


async def mark_used(cid: str, sign_count: int) -> None:
    await _w(sa_update(creds).where(creds.c.id == cid)
             .values(sign_count=sign_count, last_used=time.time()))
    log.info("webauthn: credential used id=%s", cid)


async def delete(cid: str, user_id: str) -> bool:
    row = await _q1(select(creds).where(creds.c.id == cid))
    if not row or dict(row).get("user_id") != user_id:
        return False
    await _w(sa_delete(creds).where(creds.c.id == cid))
    log.info("webauthn: credential deleted id=%s user=%s", cid, user_id)
    return True


async def count_for_user(user_id: str) -> int:
    return len(await list_for_user(user_id))
