import logging
import numpy as np

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

log = logging.getLogger("storyhavenai")

_dim = 768
_meta = sa.MetaData()
_mem_tbl = None
_lore_tbl = None

def _engine():
    from backend import db
    return db.engine()

def _encrypt_secret(s: str) -> str:
    from backend import db
    return db._encrypt_secret(s)

def _decrypt_secret(s: str) -> str:
    from backend import db
    return db._decrypt_secret(s)

def _build_tables(dim: int):
    global _mem_tbl, _lore_tbl, _meta, _dim
    from pgvector.sqlalchemy import Vector
    _dim = dim
    _meta = sa.MetaData()
    _mem_tbl = sa.Table(
        "memory_vectors", _meta,
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("session_id", sa.Text, nullable=False),
        sa.Column("char_id", sa.Text),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("ts", sa.BigInteger, nullable=False),
        sa.Column("embedding", Vector(dim)),
    )
    _lore_tbl = sa.Table(
        "lore_vectors", _meta,
        sa.Column("lore_id", sa.Text, primary_key=True),
        sa.Column("part_id", sa.Integer, primary_key=True, server_default=sa.text("0")),
        sa.Column("char_id", sa.Text),
        sa.Column("embedding", Vector(dim)),
    )

def connect():
    pass

async def close():
    pass

def _to_list(vec):
    return np.asarray(vec, dtype=np.float32).tolist()

async def ensure_indexes(dim: int):
    _build_tables(dim)
    async with _engine().begin() as conn:
        await conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
        table_exists = await conn.scalar(sa.text(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'lore_vectors')"))
        if table_exists:
            await conn.execute(sa.text(
                "ALTER TABLE lore_vectors ADD COLUMN IF NOT EXISTS part_id INTEGER NOT NULL DEFAULT 0"))
            await conn.execute(sa.text(
                "ALTER TABLE lore_vectors DROP CONSTRAINT IF EXISTS lore_vectors_pkey"))
            await conn.execute(sa.text(
                "ALTER TABLE lore_vectors ADD PRIMARY KEY (lore_id, part_id)"))
        await conn.run_sync(_meta.create_all)
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_memvec_hnsw ON memory_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_lorevec_hnsw ON lore_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))
    from backend.repositories import memory_facts
    await memory_facts.ensure_tables(dim)

async def reset_indexes(dim: int):
    async with _engine().begin() as conn:
        await conn.execute(sa.text("DROP TABLE IF EXISTS memory_vectors"))
        await conn.execute(sa.text("DROP TABLE IF EXISTS lore_vectors"))
    from backend.repositories import memory_facts
    await memory_facts.drop_tables()
    await ensure_indexes(dim)

async def delete_memory(mem_id: str):
    try:
        async with _engine().begin() as conn:
            await conn.execute(sa.delete(_mem_tbl).where(_mem_tbl.c.id == mem_id))
    except Exception as e:
        log.warning("delete_memory failed (id=%s): %s: %s", mem_id, type(e).__name__, e)

async def store_lore_vector(lore_id: str, char_id: str | None, vec, part_id: int = 0):
    ins = pg_insert(_lore_tbl).values(
        lore_id=lore_id, part_id=part_id, char_id=char_id, embedding=_to_list(vec))
    ins = ins.on_conflict_do_update(index_elements=["lore_id", "part_id"], set_={
        "char_id": ins.excluded.char_id, "embedding": ins.excluded.embedding})
    async with _engine().begin() as conn:
        await conn.execute(ins)

async def search_lore_ids(char_id: str, vec, k: int, max_dist: float):
    best_by_lore_id: dict[str, float] = {}
    try:
        dist = _lore_tbl.c.embedding.cosine_distance(_to_list(vec))
        stmt = (sa.select(_lore_tbl.c.lore_id, dist.label("score"))
                .where(sa.or_(_lore_tbl.c.char_id == char_id,
                              _lore_tbl.c.char_id.is_(None)))
                .order_by(sa.text("score")).limit(k * 4))
        async with _engine().connect() as conn:
            for r in (await conn.execute(stmt)).fetchall():
                score = float(r._mapping["score"])
                if score > max_dist:
                    continue
                lore_id = r._mapping["lore_id"]
                if lore_id not in best_by_lore_id or score < best_by_lore_id[lore_id]:
                    best_by_lore_id[lore_id] = score
    except Exception as e:
        log.warning("lore search failed (char=%s): %s: %s", char_id, type(e).__name__, e)
    ranked = sorted(best_by_lore_id.items(), key=lambda item: item[1])
    return [lore_id for lore_id, _ in ranked[:k]]

async def search_lore_chunks(char_id: str, vec, k: int, max_dist: float) -> list[dict]:
    hits = []
    try:
        dist = _lore_tbl.c.embedding.cosine_distance(_to_list(vec))
        stmt = (sa.select(_lore_tbl.c.lore_id, _lore_tbl.c.part_id, dist.label("score"))
                .where(sa.or_(_lore_tbl.c.char_id == char_id,
                              _lore_tbl.c.char_id.is_(None)))
                .order_by(sa.text("score")).limit(k))
        async with _engine().connect() as conn:
            for r in (await conn.execute(stmt)).fetchall():
                score = float(r._mapping["score"])
                if score <= max_dist:
                    hits.append({"lore_id": r._mapping["lore_id"],
                                "part_id": r._mapping["part_id"], "distance": score})
    except Exception as e:
        log.warning("lore chunk search failed (char=%s): %s: %s", char_id, type(e).__name__, e)
    return hits

async def delete_lore_vector(lore_id: str):
    async with _engine().begin() as conn:
        await conn.execute(sa.delete(_lore_tbl).where(_lore_tbl.c.lore_id == lore_id))

async def delete_lore_vectors_by_char(char_id: str):
    try:
        async with _engine().begin() as conn:
            await conn.execute(sa.delete(_lore_tbl).where(_lore_tbl.c.char_id == char_id))
    except Exception as e:
        log.warning("delete_lore_vectors_by_char(%s) failed: %s", char_id, e)

async def stats():
    try:
        async with _engine().connect() as conn:
            m = (await conn.execute(sa.select(sa.func.count()).select_from(_mem_tbl))).scalar()
            l = (await conn.execute(sa.select(sa.func.count()).select_from(_lore_tbl))).scalar()
        return {"memories": int(m), "lore_vectors": int(l), "ok": True}
    except Exception as e:
        log.warning("vectors stats query failed: %s: %s", type(e).__name__, e)
        return {"ok": False, "error": str(e)}
