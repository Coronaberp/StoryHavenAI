import sys
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import sqlalchemy as sa
from backend import db
from backend import vectors
from backend import llm
from backend import memory_service
from backend.chat_service import _chat_language
from backend.repositories import settings as settings_repo
from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import session_characters as session_char_repo
from backend.repositories import memory_facts
from backend.state import CFG, log

ARG = sys.argv[1] if len(sys.argv) > 1 else ""
TARGET_SID = ARG if ARG.startswith("s") else None
LIMIT = int(ARG) if ARG and not TARGET_SID else 0


async def fact_count(sid):
    return await db._scalar(
        sa.select(sa.func.count()).select_from(memory_facts._tbl).where(
            memory_facts._tbl.c.session_id == sid))


async def backfill_session(session):
    sid = session["id"]
    char = await characters.get(session["char_id"]) if session.get("char_id") else None
    names_by_id = None
    cast_names = None
    if session.get("is_group"):
        chars_by_id = {}
        for row in await session_char_repo.list_cast(sid):
            member = await characters.get(row["char_id"])
            if member:
                chars_by_id[row["char_id"]] = member
        if not chars_by_id:
            return 0
        names_by_id = {cid: member["name"] for cid, member in chars_by_id.items()}
        cast_names = [member["name"] for member in chars_by_id.values()]
        if not char:
            char = next(iter(chars_by_id.values()))
    if not char:
        return 0
    user_name = session.get("user_name") or "You"
    language = _chat_language(session, CFG)
    before = await fact_count(sid)
    await memory_service.maybe_extract(
        session, char, user_name, language, CFG["chat_model"],
        names_by_id=names_by_id, cast_names=cast_names)
    return (await fact_count(sid)) - before


async def main():
    await db.init()
    for key, value in (await settings_repo.all_settings()).items():
        if key in CFG and value is not None:
            CFG[key] = value
    vectors.connect()
    await vectors.ensure_indexes(CFG["embed_dim"])
    llm.configure(CFG["base_url"], CFG["api_key"], CFG["embed_base_url"], CFG["embed_api_key"])
    memory_facts.build_tables(CFG["embed_dim"])

    original_chat_stream = llm.chat_stream

    def chat_stream_without_reasoning(messages, model, params=None, **kwargs):
        merged = dict(params or {})
        template_kwargs = dict(merged.get("chat_template_kwargs") or {})
        template_kwargs["thinking"] = False
        merged["chat_template_kwargs"] = template_kwargs
        return original_chat_stream(messages, model, merged, **kwargs)

    llm.chat_stream = chat_stream_without_reasoning

    rows = await db._q(db.select(db.sessions))
    sessions = [dict(row) for row in rows]
    if TARGET_SID:
        sessions = [s for s in sessions if s["id"] == TARGET_SID]
    elif LIMIT:
        sessions = sessions[:LIMIT]
    total = 0
    for index, session in enumerate(sessions):
        try:
            added = await backfill_session(session)
            total += added
            log.info("backfill_memory: %d/%d sid=%s +%d facts (running total %d)",
                     index + 1, len(sessions), session["id"], added, total)
        except Exception as error:
            log.error("backfill_memory: sid=%s failed: %s: %s",
                      session["id"], type(error).__name__, error)
    print(f"DONE: sessions={len(sessions)} facts_extracted={total}")
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
