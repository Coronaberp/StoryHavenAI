import time

from sqlalchemy import select, insert, delete as sa_delete

from backend.db import oauth_pending as pending, _q, _q1, _w
from backend.state import log

async def create(state: str, provider: str, mode: str, user_id: str | None,
                 code_verifier: str | None) -> None:
    await _w(insert(pending).values(
        state=state, provider=provider, mode=mode, user_id=user_id,
        code_verifier=code_verifier, created=time.time()))
    log.info("oauth_pending: created provider=%s mode=%s user=%s", provider, mode, user_id)

async def consume(state: str) -> dict | None:
    row = await _q1(select(pending).where(pending.c.state == state))
    if not row:
        return None
    await _w(sa_delete(pending).where(pending.c.state == state))
    return dict(row)

async def purge_expired(max_age_seconds: float = 300) -> int:
    cutoff = time.time() - max_age_seconds
    rows = await _q(select(pending.c.state).where(pending.c.created < cutoff))
    if not rows:
        return 0
    await _w(sa_delete(pending).where(pending.c.created < cutoff))
    log.info("oauth_pending: purged %d expired state row(s)", len(rows))
    return len(rows)
