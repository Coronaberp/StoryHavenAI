import asyncio

from sqlalchemy import select, update as sa_update, and_, or_

from backend.db import init, engine, sessions, messages
from backend.repositories import personas
from backend.state import log


async def main():
    await init()
    async with engine().begin() as conn:
        session_rows = (await conn.execute(
            select(sessions.c.id, sessions.c.user_id))).mappings().all()

    persona_maps: dict[str, dict[str, str]] = {}
    updated = 0
    for s in session_rows:
        user_id = s["user_id"]
        if not user_id:
            continue
        if user_id not in persona_maps:
            own = await personas.list_all(user_id)
            persona_maps[user_id] = {p["name"]: p["avatar"] for p in own if p.get("avatar")}
        name_to_avatar = persona_maps[user_id]
        if not name_to_avatar:
            continue

        async with engine().begin() as conn:
            msg_rows = (await conn.execute(
                select(messages.c.seq, messages.c.user_name)
                .where(and_(messages.c.session_id == s["id"], messages.c.role == "user",
                            or_(messages.c.persona_avatar.is_(None), messages.c.persona_avatar == ""))))
                ).mappings().all()
            for m in msg_rows:
                name = m["user_name"] or None
                avatar = name_to_avatar.get(name) if name else None
                if not avatar:
                    continue
                result = await conn.execute(
                    sa_update(messages).where(messages.c.seq == m["seq"]).values(persona_avatar=avatar))
                updated += result.rowcount

    log.info("backfill_message_persona_avatars: done sessions=%d messages_updated=%d",
             len(session_rows), updated)
    print(f"done: {len(session_rows)} sessions scanned, {updated} messages backfilled")


if __name__ == "__main__":
    asyncio.run(main())
