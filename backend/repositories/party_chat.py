from __future__ import annotations
import time

from sqlalchemy import select, insert

from backend.db import party_chat_messages, nid, _q, _w, _encrypt_secret, _decrypt_secret
from backend.state import log

async def add(session_id: str, sender_user_id: str, content: str,
              image: str | None = None, attachment_kind: str | None = None) -> dict:
    mid = nid("pc")
    now = time.time()
    await _w(insert(party_chat_messages).values(
        id=mid, session_id=session_id, sender_user_id=sender_user_id,
        content=_encrypt_secret(content or ""), image=image,
        attachment_kind=attachment_kind, created=now,
    ))
    log.info("party_chat: message added session=%s sender=%s attachment=%s",
              session_id, sender_user_id, attachment_kind)
    return {"id": mid, "session_id": session_id, "sender_user_id": sender_user_id,
            "content": content, "image": image, "attachment_kind": attachment_kind, "created": now}

async def list_recent(session_id: str, limit: int = 50) -> list[dict]:
    rows = await _q(
        select(party_chat_messages)
        .where(party_chat_messages.c.session_id == session_id)
        .order_by(party_chat_messages.c.created.desc())
        .limit(limit)
    )
    result = []
    for row in reversed(rows):
        message = dict(row)
        message["content"] = _decrypt_secret(message.get("content") or "")
        result.append(message)
    return result
