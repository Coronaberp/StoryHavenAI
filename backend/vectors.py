"""
vectors.py — vector storage + similarity search (PostgreSQL + pgvector).

Embeddings live in two tables (memory_vectors/lore_vectors) with HNSW cosine
indexes, sharing db.py's engine. Postgres owns the readable relational data;
this module owns the embeddings. Cosine distance is the metric (pgvector <=>),
so the max_dist thresholds are plain cosine distances.
"""
import time
import hashlib
import logging
import numpy as np

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

log = logging.getLogger("personae")

MEM_INDEX, LORE_INDEX = "mem_idx", "lore_idx"

_dim = 768
_meta = sa.MetaData()
_mem_tbl = None
_lore_tbl = None


def _engine():
    from backend import db
    return db.engine()


def _build_tables(dim: int):
    """(Re)build the vector Table objects for the given embedding dimension."""
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
        await conn.run_sync(_meta.create_all)
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_memvec_hnsw ON memory_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_lorevec_hnsw ON lore_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))


async def reset_indexes(dim: int):
    """Drop and recreate both vector tables — used when the embedding dimension
    changes, since vectors of different sizes can't coexist in one index."""
    async with _engine().begin() as conn:
        await conn.execute(sa.text("DROP TABLE IF EXISTS memory_vectors"))
        await conn.execute(sa.text("DROP TABLE IF EXISTS lore_vectors"))
    await ensure_indexes(dim)


# --------------------------------------------------------------------------
# Memory
# --------------------------------------------------------------------------
async def store_memory(char_id: str, session_id: str, text: str, vec, mem_id: str | None = None):
    # char_id is kept for character-level cleanup; retrieval is scoped to session.
    # When mem_id (the triggering user message id) is given, the key is stable, so
    # regenerating a reply overwrites that turn's memory rather than duplicating it.
    base = mem_id or hashlib.sha1((session_id + "|" + text).encode()).hexdigest()[:20]
    ins = pg_insert(_mem_tbl).values(
        id=base, session_id=session_id, char_id=char_id, text=text,
        ts=int(time.time()), embedding=_to_list(vec))
    ins = ins.on_conflict_do_update(index_elements=["id"], set_={
        "session_id": ins.excluded.session_id, "char_id": ins.excluded.char_id,
        "text": ins.excluded.text, "ts": ins.excluded.ts,
        "embedding": ins.excluded.embedding})
    async with _engine().begin() as conn:
        await conn.execute(ins)


async def search_memory(session_id: str, vec, k: int, max_dist: float, exclude_id: str | None = None):
    out = []
    try:
        dist = _mem_tbl.c.embedding.cosine_distance(_to_list(vec))
        stmt = (sa.select(_mem_tbl.c.text, dist.label("score"))
                .where(_mem_tbl.c.session_id == session_id))
        if exclude_id:
            stmt = stmt.where(_mem_tbl.c.id != exclude_id)
        stmt = stmt.order_by(sa.text("score")).limit(k)
        async with _engine().connect() as conn:
            for r in (await conn.execute(stmt)).fetchall():
                if float(r._mapping["score"]) <= max_dist:
                    out.append(r._mapping["text"] or "")
    except Exception as e:
        # Without this log line, a down/misconfigured store is indistinguishable
        # from "no relevant memories this turn" — silently degrading retrieval.
        log.warning("memory search failed (session=%s): %s: %s", session_id, type(e).__name__, e)
    return out[:k]


async def delete_memory(mem_id: str):
    """Delete a single turn's memory (keyed by the triggering user message id)."""
    try:
        async with _engine().begin() as conn:
            await conn.execute(sa.delete(_mem_tbl).where(_mem_tbl.c.id == mem_id))
    except Exception as e:
        log.warning("delete_memory failed (id=%s): %s: %s", mem_id, type(e).__name__, e)


async def list_memory(session_id: str, k: int = 30):
    stmt = (sa.select(_mem_tbl.c.id, _mem_tbl.c.text, _mem_tbl.c.ts)
            .where(_mem_tbl.c.session_id == session_id)
            .order_by(_mem_tbl.c.ts.desc()).limit(k))
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [{"id": r._mapping["id"], "text": r._mapping["text"] or "",
             "ts": int(r._mapping["ts"] or 0)} for r in rows]


async def search_memory_scored(session_id: str, vec, k: int = 20):
    dist = _mem_tbl.c.embedding.cosine_distance(_to_list(vec))
    stmt = (sa.select(_mem_tbl.c.text, dist.label("score"), _mem_tbl.c.ts)
            .where(_mem_tbl.c.session_id == session_id)
            .order_by(sa.text("score")).limit(k))
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [{"text": r._mapping["text"] or "", "score": round(float(r._mapping["score"]), 3),
             "ts": int(r._mapping["ts"] or 0)} for r in rows]


# --------------------------------------------------------------------------
# Lore vectors (content lives in the relational DB; we store id -> vector only)
# --------------------------------------------------------------------------
async def store_lore_vector(lore_id: str, char_id: str | None, vec):
    ins = pg_insert(_lore_tbl).values(
        lore_id=lore_id, char_id=char_id, embedding=_to_list(vec))
    ins = ins.on_conflict_do_update(index_elements=["lore_id"], set_={
        "char_id": ins.excluded.char_id, "embedding": ins.excluded.embedding})
    async with _engine().begin() as conn:
        await conn.execute(ins)


async def search_lore_ids(char_id: str, vec, k: int, max_dist: float):
    ids = []
    try:
        dist = _lore_tbl.c.embedding.cosine_distance(_to_list(vec))
        stmt = (sa.select(_lore_tbl.c.lore_id, dist.label("score"))
                .where(sa.or_(_lore_tbl.c.char_id == char_id,
                              _lore_tbl.c.char_id.is_(None)))
                .order_by(sa.text("score")).limit(k))
        async with _engine().connect() as conn:
            for r in (await conn.execute(stmt)).fetchall():
                if float(r._mapping["score"]) <= max_dist:
                    ids.append(r._mapping["lore_id"])
    except Exception as e:
        log.warning("lore search failed (char=%s): %s: %s", char_id, type(e).__name__, e)
    return ids


async def delete_lore_vector(lore_id: str):
    async with _engine().begin() as conn:
        await conn.execute(sa.delete(_lore_tbl).where(_lore_tbl.c.lore_id == lore_id))


async def delete_by_tag(index: str, field: str, value: str):
    """Bulk-delete vectors matching a scope tag — a single scoped DELETE.
    `field` is 'session' or 'chartag' as used by callers."""
    try:
        tbl = _mem_tbl if index == MEM_INDEX else _lore_tbl
        col = tbl.c.session_id if field == "session" else tbl.c.char_id
        async with _engine().begin() as conn:
            await conn.execute(sa.delete(tbl).where(col == value))
    except Exception as e:
        log.warning("delete_by_tag(%s, %s=%s) failed: %s", index, field, value, e)


async def stats():
    try:
        async with _engine().connect() as conn:
            m = (await conn.execute(sa.select(sa.func.count()).select_from(_mem_tbl))).scalar()
            l = (await conn.execute(sa.select(sa.func.count()).select_from(_lore_tbl))).scalar()
        return {"memories": int(m), "lore_vectors": int(l), "ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
