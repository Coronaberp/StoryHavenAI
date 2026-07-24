from __future__ import annotations
import secrets
import time

from sqlalchemy import select, insert, update as sa_update

from backend.db import session_invite_tokens, _q1, _w
from backend.state import log

def _generate_token() -> str:
    return secrets.token_urlsafe(24)

async def create_link(session_id: str, created_by: str) -> str:
    token = _generate_token()
    await _w(insert(session_invite_tokens).values(
        token=token, session_id=session_id, created_by=created_by,
        created_at=time.time(), revoked=0,
    ))
    log.info("session_invites: link created session=%s by=%s", session_id, created_by)
    return token

async def revoke_all_for_session(session_id: str) -> None:
    await _w(sa_update(session_invite_tokens)
             .where(session_invite_tokens.c.session_id == session_id)
             .values(revoked=1))
    log.info("session_invites: all links revoked session=%s", session_id)

async def resolve(token: str) -> dict | None:
    row = await _q1(select(session_invite_tokens).where(session_invite_tokens.c.token == token))
    if not row or row["revoked"]:
        return None
    return row
