import asyncio
import sys

sys.path.insert(0, "/app/ai-frontend")

import sqlalchemy as sa
from backend import db
from backend.repositories import chat_sessions
from backend.repositories import session_characters
from backend.repositories import groups as groups_repo

async def main():
    await db.init()
    rows = await db._q(sa.select(db.sessions.c.id).where(sa.and_(
        db.sessions.c.is_group == 1, db.sessions.c.source_group_id.is_(None))))
    made, skipped = 0, 0
    for row in rows:
        sid = row["id"]
        s = await chat_sessions.get(sid)
        if not s:
            continue
        cast = await session_characters.list_cast(sid)
        char_ids = [c["char_id"] for c in cast if not c.get("is_narrator")][:4]
        if len(char_ids) < 2:
            skipped += 1
            continue
        msgs = await chat_sessions.list_messages(sid)
        opening = next((m["content"] for m in msgs
                        if m["role"] == "assistant" and not m.get("char_id")), "")
        gid = await groups_repo.create(s["user_id"], s.get("title") or "Group", opening,
                                       s.get("group_mode") or "roleplay", 0, char_ids)
        await db._w(sa.update(db.sessions).where(db.sessions.c.id == sid).values(source_group_id=gid))
        made += 1
    print(f"backfilled {made} group sessions, skipped {skipped} (cast < 2)")

if __name__ == "__main__":
    asyncio.run(main())
