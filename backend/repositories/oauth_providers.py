import time

from sqlalchemy import select, insert, update as sa_update

from backend.db import oauth_providers as providers, _encrypt_secret, _decrypt_secret, _q, _q1, _w
from backend.state import log


def _row(row) -> dict:
    d = dict(row)
    d["enabled"] = bool(d["enabled"])
    if d.get("client_secret"):
        d["client_secret"] = _decrypt_secret(d["client_secret"])
    return d


async def list_all() -> list[dict]:
    return [_row(r) for r in await _q(select(providers).order_by(providers.c.provider))]


async def list_enabled() -> list[dict]:
    return [r for r in await list_all() if r["enabled"] and r["client_id"] and r["client_secret"]]


async def get(provider: str) -> dict | None:
    row = await _q1(select(providers).where(providers.c.provider == provider))
    return _row(row) if row else None


async def upsert(provider: str, client_id: str, client_secret: str | None, enabled: bool) -> None:
    existing = await _q1(select(providers).where(providers.c.provider == provider))
    encrypted_secret = _encrypt_secret(client_secret) if client_secret else (
        dict(existing)["client_secret"] if existing else None)
    values = dict(
        client_id=client_id,
        client_secret=encrypted_secret,
        enabled=int(enabled),
        updated=time.time(),
    )
    if existing:
        await _w(sa_update(providers).where(providers.c.provider == provider).values(**values))
    else:
        await _w(insert(providers).values(provider=provider, **values))
    log.info("oauth_providers: upserted provider=%s enabled=%s", provider, enabled)
