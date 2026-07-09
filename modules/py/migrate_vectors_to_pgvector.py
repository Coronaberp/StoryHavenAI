"""One-time Redis -> pgvector data migration.

HISTORICAL: for a one-time SQLite/Redis -> Postgres/pgvector cutover only. The
live deployment already runs on pgvector and does not need this — kept for
reference and for anyone migrating an old Redis-based install from scratch.
(Requires the `redis` package, which is no longer in requirements.txt.)

Reads the raw float32 embedding bytes out of every mem:* / lorevec:* Redis hash
(the exact encoding vectors.py writes with numpy tobytes) and inserts them into
the memory_vectors / lore_vectors pgvector tables — no re-embedding, so the
original vectors are preserved bit-for-bit.

Usage (inside the story-game container):
    DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/dbname \
    REDIS_URL=redis://roleplay-redis:6379 EMBED_DIM=768 \
    venv/bin/python3 migrate_vectors_to_pgvector.py
"""
import os
import asyncio
import numpy as np
import redis.asyncio as redis
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

MEM_PREFIX, LORE_PREFIX = "mem:", "lorevec:"


def _vec_literal(raw: bytes) -> str:
    arr = np.frombuffer(raw, dtype=np.float32)
    return "[" + ",".join(repr(float(x)) for x in arr) + "]"


async def main():
    dst_url = os.environ.get("DATABASE_URL", "").strip()
    if not dst_url:
        raise SystemExit("DATABASE_URL must be set to the target Postgres DSN")
    redis_url = os.environ.get("REDIS_URL", "redis://roleplay-redis:6379")
    dim = int(os.environ.get("EMBED_DIM", "768"))

    # decode_responses=False: embeddings are raw bytes, must not be UTF-8 decoded.
    r = redis.from_url(redis_url, decode_responses=False)
    dst = create_async_engine(dst_url)

    async with dst.begin() as conn:
        await conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.execute(sa.text(
            f"CREATE TABLE IF NOT EXISTS memory_vectors("
            f"id TEXT PRIMARY KEY, session_id TEXT NOT NULL, char_id TEXT, "
            f"text TEXT NOT NULL, ts BIGINT NOT NULL, embedding vector({dim}))"))
        await conn.execute(sa.text(
            f"CREATE TABLE IF NOT EXISTS lore_vectors("
            f"lore_id TEXT PRIMARY KEY, char_id TEXT, embedding vector({dim}))"))
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_memvec_hnsw ON memory_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_lorevec_hnsw ON lore_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))

    def dec(v):
        return v.decode() if isinstance(v, bytes) else v

    mem_rows = 0
    async for key in r.scan_iter(match=(MEM_PREFIX + "*").encode()):
        h = await r.hgetall(key)
        h = {dec(k): v for k, v in h.items()}
        mid = dec(key)[len(MEM_PREFIX):]
        chartag = dec(h.get("chartag"))
        async with dst.begin() as conn:
            await conn.execute(sa.text(
                "INSERT INTO memory_vectors(id, session_id, char_id, text, ts, embedding) "
                "VALUES (:id,:sid,:cid,:txt,:ts, CAST(:emb AS vector)) "
                "ON CONFLICT (id) DO UPDATE SET session_id=EXCLUDED.session_id, "
                "char_id=EXCLUDED.char_id, text=EXCLUDED.text, ts=EXCLUDED.ts, "
                "embedding=EXCLUDED.embedding"),
                {"id": mid, "sid": dec(h.get("session")) or "",
                 "cid": chartag if chartag not in (None, "_global") else None,
                 "txt": dec(h.get("text")) or "", "ts": int(dec(h.get("ts")) or 0),
                 "emb": _vec_literal(h["embedding"])})
        mem_rows += 1

    lore_rows = 0
    async for key in r.scan_iter(match=(LORE_PREFIX + "*").encode()):
        h = await r.hgetall(key)
        h = {dec(k): v for k, v in h.items()}
        lid = dec(key)[len(LORE_PREFIX):]
        chartag = dec(h.get("chartag"))
        async with dst.begin() as conn:
            await conn.execute(sa.text(
                "INSERT INTO lore_vectors(lore_id, char_id, embedding) "
                "VALUES (:lid,:cid, CAST(:emb AS vector)) "
                "ON CONFLICT (lore_id) DO UPDATE SET char_id=EXCLUDED.char_id, "
                "embedding=EXCLUDED.embedding"),
                {"lid": lid,
                 "cid": chartag if chartag not in (None, "_global") else None,
                 "emb": _vec_literal(h["embedding"])})
        lore_rows += 1

    async with dst.connect() as conn:
        m = (await conn.execute(sa.text("SELECT count(*) FROM memory_vectors"))).scalar()
        l = (await conn.execute(sa.text("SELECT count(*) FROM lore_vectors"))).scalar()

    print(f"memory_vectors: migrated={mem_rows}  in_db={m}")
    print(f"lore_vectors:   migrated={lore_rows}  in_db={l}")

    await r.aclose()
    await dst.dispose()


if __name__ == "__main__":
    asyncio.run(main())
