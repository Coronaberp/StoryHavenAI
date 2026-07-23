import time

from sqlalchemy import select, insert, delete as sa_delete

from backend.db import oauth_identities as identities, nid, _q, _q1, _w
from backend.state import log


def _row(row) -> dict:
    return dict(row)


async def create(provider: str, provider_user_id: str, user_id: str, display_name: str = "") -> str:
    iid = nid("oi")
    await _w(insert(identities).values(
        id=iid, provider=provider, provider_user_id=provider_user_id,
        user_id=user_id, display_name=display_name, created=time.time()))
    log.info("oauth_identities: linked id=%s provider=%s user=%s", iid, provider, user_id)
    return iid


async def get_by_provider_identity(provider: str, provider_user_id: str) -> dict | None:
    row = await _q1(select(identities).where(
        (identities.c.provider == provider) & (identities.c.provider_user_id == provider_user_id)))
    return _row(row) if row else None


async def list_for_user(user_id: str) -> list[dict]:
    stmt = select(identities).where(identities.c.user_id == user_id).order_by(identities.c.created.desc())
    return [_row(r) for r in await _q(stmt)]


async def delete(identity_id: str, user_id: str) -> bool:
    row = await _q1(select(identities).where(identities.c.id == identity_id))
    if not row or dict(row).get("user_id") != user_id:
        return False
    await _w(sa_delete(identities).where(identities.c.id == identity_id))
    log.info("oauth_identities: unlinked id=%s user=%s", identity_id, user_id)
    return True


async def count_for_user(user_id: str) -> int:
    return len(await list_for_user(user_id))
