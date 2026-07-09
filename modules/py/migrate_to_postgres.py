"""One-time SQLite -> PostgreSQL data migration.

HISTORICAL: for a one-time SQLite/Redis -> Postgres/pgvector cutover only. The
live deployment already runs on Postgres and does not need this — kept for
reference and for anyone migrating an old SQLite-based install from scratch.

Reads every row from the live SQLite database and inserts it unchanged into the
Postgres database, using db.py's own SQLAlchemy Table metadata for both sides so
column names/types line up exactly. Fernet-encrypted columns are copied
byte-for-byte (ciphertext is portable; the key does not change).

Usage (inside the story-game container):
    DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/dbname \
    DB_PATH=./personae.db venv/bin/python3 migrate_to_postgres.py
"""
import os
import asyncio
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

import db

# FK-safe dependency order.
TABLES = [
    db.users, db.auth_sessions, db.user_settings, db.characters, db.personas,
    db.lore, db.sessions, db.messages, db.standalone_images,
    db.flagged_endpoints, db.localization, db.settings,
]


async def main():
    src_path = os.environ.get("DB_PATH", "./personae.db")
    dst_url = os.environ.get("DATABASE_URL", "").strip()
    if not dst_url:
        raise SystemExit("DATABASE_URL must be set to the target Postgres DSN")

    src = create_async_engine("sqlite+aiosqlite:///" + src_path)
    dst = create_async_engine(dst_url)

    async with dst.begin() as conn:
        await conn.run_sync(db._meta.create_all)

    mismatches = []
    for table in TABLES:
        async with src.connect() as sconn:
            info = (await sconn.execute(
                sa.text(f"PRAGMA table_info({table.name})"))).fetchall()
            live_cols = {r._mapping["name"] for r in info}
            cols = [c for c in table.c if c.name in live_cols]
            rows = [dict(r._mapping)
                    for r in (await sconn.execute(sa.select(*cols))).fetchall()]
        async with dst.begin() as dconn:
            await dconn.execute(sa.delete(table))
            if rows:
                await dconn.execute(sa.insert(table), rows)
            dst_count = (await dconn.execute(
                sa.select(sa.func.count()).select_from(table))).scalar()
        ok = dst_count == len(rows)
        if not ok:
            mismatches.append(table.name)
        print(f"{table.name:22} src={len(rows):6}  dst={dst_count:6}  {'OK' if ok else 'MISMATCH'}")

    # messages.seq is a Postgres SERIAL/IDENTITY; explicit inserts above bypassed
    # the sequence, so advance it past the max copied value or new inserts collide.
    async with dst.begin() as dconn:
        maxseq = (await dconn.execute(
            sa.select(sa.func.max(db.messages.c.seq)))).scalar()
        if maxseq:
            await dconn.execute(sa.text(
                "SELECT setval(pg_get_serial_sequence('messages','seq'), :m)"),
                {"m": maxseq})
            print(f"messages seq set to {maxseq}")

    await src.dispose()
    await dst.dispose()
    if mismatches:
        raise SystemExit(f"ROW COUNT MISMATCH: {mismatches}")
    print("all tables migrated with matching row counts")


if __name__ == "__main__":
    asyncio.run(main())
