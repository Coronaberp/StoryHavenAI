import asyncio

from sqlalchemy import select, update as sa_update, and_

from backend.db import init, engine, sessions, messages, _decrypt_secret
from backend.repositories import personas
from backend.state import log

async def main():
    await init()
    async with engine().begin() as conn:
        session_rows = (await conn.execute(select(sessions.c.id, sessions.c.persona_id,
                                                   sessions.c.user_name))).mappings().all()
    updated = 0
    for s in session_rows:
        user_name = _decrypt_secret(s["user_name"] or "") or "You"
        avatar = None
        if s["persona_id"]:
            persona = await personas.get(s["persona_id"])
            avatar = (persona or {}).get("avatar") or None
        async with engine().begin() as conn:
            result = await conn.execute(
                sa_update(messages)
                .where(and_(messages.c.session_id == s["id"], messages.c.role == "user",
                            messages.c.user_name.is_(None)))
                .values(user_name=user_name, persona_avatar=avatar))
            if result.rowcount:
                updated += result.rowcount
    log.info("backfill_persona_snapshot: done sessions=%d messages_updated=%d",
             len(session_rows), updated)
    print(f"done: {len(session_rows)} sessions scanned, {updated} messages backfilled")

if __name__ == "__main__":
    asyncio.run(main())
