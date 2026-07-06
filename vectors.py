"""
vectors.py — vector storage + similarity search.

Two interchangeable backends behind one identical public API:

  * Redis Stack (HNSW indexes mem_idx/lore_idx) — the original store, used when
    DATABASE_URL is unset.
  * PostgreSQL + pgvector (memory_vectors/lore_vectors tables, HNSW cosine
    indexes) — used when DATABASE_URL is set, sharing db.py's engine.

SQLite/Postgres owns the readable data; this module owns the embeddings.
Cosine distance is the metric in both backends (Redis COSINE / pgvector <=>),
so the same max_dist thresholds carry over unchanged.
"""
import os
import time
import hashlib
import logging
import numpy as np
import redis.asyncio as redis
from redis.commands.search.field import TextField, TagField, NumericField, VectorField
from redis.commands.search.index_definition import IndexDefinition, IndexType
from redis.commands.search.query import Query

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

log = logging.getLogger("personae")

MEM_INDEX, LORE_INDEX = "mem_idx", "lore_idx"
MEM_PREFIX, LORE_PREFIX = "mem:", "lorevec:"

_r: redis.Redis | None = None
_pg = False
_dim = 768
_meta = sa.MetaData()
_mem_tbl = None
_lore_tbl = None


def _use_pg() -> bool:
    return bool(os.environ.get("DATABASE_URL", "").strip())


def _pg_engine():
    import db
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


def connect(url: str):
    global _r, _pg
    _pg = _use_pg()
    if _pg:
        return
    _r = redis.from_url(url, decode_responses=True)


async def close():
    if _r:
        await _r.aclose()


def _to_bytes(vec):
    return np.asarray(vec, dtype=np.float32).tobytes()


def _to_list(vec):
    return np.asarray(vec, dtype=np.float32).tolist()


# --------------------------------------------------------------------------
# Redis index helpers
# --------------------------------------------------------------------------
def _vec_field(dim):
    return VectorField("embedding", "HNSW",
                       {"TYPE": "FLOAT32", "DIM": dim, "DISTANCE_METRIC": "COSINE"})


async def _redis_ensure(dim: int):
    try:
        await _r.ft(MEM_INDEX).info()
    except Exception:
        await _r.ft(MEM_INDEX).create_index(
            (TextField("text"), TagField("chartag"), TagField("session"),
             NumericField("ts"), _vec_field(dim)),
            definition=IndexDefinition(prefix=[MEM_PREFIX], index_type=IndexType.HASH))
    try:
        await _r.ft(LORE_INDEX).info()
    except Exception:
        await _r.ft(LORE_INDEX).create_index(
            (TagField("chartag"), _vec_field(dim)),
            definition=IndexDefinition(prefix=[LORE_PREFIX], index_type=IndexType.HASH))


# --------------------------------------------------------------------------
# pgvector setup
# --------------------------------------------------------------------------
async def _pg_ensure(dim: int):
    _build_tables(dim)
    async with _pg_engine().begin() as conn:
        await conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(_meta.create_all)
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_memvec_hnsw ON memory_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_lorevec_hnsw ON lore_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))


async def ensure_indexes(dim: int):
    if _pg:
        await _pg_ensure(dim)
        return
    await _redis_ensure(dim)


async def reset_indexes(dim: int):
    """Drop and recreate both vector stores — used when the embedding dimension
    changes, since vectors of different sizes can't coexist in one index."""
    if _pg:
        async with _pg_engine().begin() as conn:
            await conn.execute(sa.text("DROP TABLE IF EXISTS memory_vectors"))
            await conn.execute(sa.text("DROP TABLE IF EXISTS lore_vectors"))
        await _pg_ensure(dim)
        return
    for idx in (MEM_INDEX, LORE_INDEX):
        try:
            await _r.ft(idx).dropindex(delete_documents=True)
        except Exception:
            pass
    await _redis_ensure(dim)


# --------------------------------------------------------------------------
# Memory
# --------------------------------------------------------------------------
async def store_memory(char_id: str, session_id: str, text: str, vec, mem_id: str | None = None):
    # chartag/char_id is kept for character-level cleanup; retrieval is scoped to
    # session. When mem_id (the triggering user message id) is given, the key is
    # stable, so regenerating a reply overwrites that turn's memory rather than
    # duplicating it.
    base = mem_id or hashlib.sha1((session_id + "|" + text).encode()).hexdigest()[:20]
    if _pg:
        ins = pg_insert(_mem_tbl).values(
            id=base, session_id=session_id, char_id=char_id, text=text,
            ts=int(time.time()), embedding=_to_list(vec))
        ins = ins.on_conflict_do_update(index_elements=["id"], set_={
            "session_id": ins.excluded.session_id, "char_id": ins.excluded.char_id,
            "text": ins.excluded.text, "ts": ins.excluded.ts,
            "embedding": ins.excluded.embedding})
        async with _pg_engine().begin() as conn:
            await conn.execute(ins)
        return
    key = MEM_PREFIX + base
    await _r.hset(key, mapping={"text": text, "chartag": char_id, "session": session_id,
                               "ts": int(time.time()), "embedding": _to_bytes(vec)})


async def search_memory(session_id: str, vec, k: int, max_dist: float, exclude_id: str | None = None):
    out = []
    if _pg:
        try:
            dist = _mem_tbl.c.embedding.cosine_distance(_to_list(vec))
            stmt = (sa.select(_mem_tbl.c.text, dist.label("score"))
                    .where(_mem_tbl.c.session_id == session_id))
            if exclude_id:
                stmt = stmt.where(_mem_tbl.c.id != exclude_id)
            stmt = stmt.order_by(sa.text("score")).limit(k)
            async with _pg_engine().connect() as conn:
                for r in (await conn.execute(stmt)).fetchall():
                    if float(r._mapping["score"]) <= max_dist:
                        out.append(r._mapping["text"] or "")
        except Exception as e:
            log.warning("memory search failed (session=%s): %s: %s", session_id, type(e).__name__, e)
        return out[:k]
    skip = (MEM_PREFIX + exclude_id) if exclude_id else None
    try:
        # fetch one extra so excluding the current turn still leaves up to k results
        for d in await _knn(MEM_INDEX, f"@session:{{{session_id}}}", vec, k + (1 if skip else 0), ["text"]):
            if skip and d.id == skip:
                continue
            if float(getattr(d, "score", 2)) <= max_dist:
                out.append(getattr(d, "text", ""))
    except Exception as e:
        # Without this log line, a down/misconfigured store is indistinguishable
        # from "no relevant memories this turn" — silently degrading retrieval.
        log.warning("memory search failed (session=%s): %s: %s", session_id, type(e).__name__, e)
    return out[:k]


async def purge_memory(dim: int):
    """Wipe all memory vectors (lore untouched) — used when the memory canon
    language changes and old entries are no longer compatible with new ones."""
    if _pg:
        async with _pg_engine().begin() as conn:
            await conn.execute(sa.text("DELETE FROM memory_vectors"))
        return
    try:
        await _r.ft(MEM_INDEX).dropindex(delete_documents=True)
    except Exception:
        pass
    try:
        await _r.ft(MEM_INDEX).info()
    except Exception:
        await _r.ft(MEM_INDEX).create_index(
            (TextField("text"), TagField("chartag"), TagField("session"),
             NumericField("ts"), _vec_field(dim)),
            definition=IndexDefinition(prefix=[MEM_PREFIX], index_type=IndexType.HASH))


async def delete_memory(mem_id: str):
    """Delete a single turn's memory (keyed by the triggering user message id)."""
    if _pg:
        try:
            async with _pg_engine().begin() as conn:
                await conn.execute(sa.delete(_mem_tbl).where(_mem_tbl.c.id == mem_id))
        except Exception:
            pass
        return
    try:
        await _r.delete(MEM_PREFIX + mem_id)
    except Exception:
        pass


async def list_memory(session_id: str, k: int = 30):
    if _pg:
        stmt = (sa.select(_mem_tbl.c.id, _mem_tbl.c.text, _mem_tbl.c.ts)
                .where(_mem_tbl.c.session_id == session_id)
                .order_by(_mem_tbl.c.ts.desc()).limit(k))
        async with _pg_engine().connect() as conn:
            rows = (await conn.execute(stmt)).fetchall()
        return [{"id": r._mapping["id"], "text": r._mapping["text"] or "",
                 "ts": int(r._mapping["ts"] or 0)} for r in rows]
    res = await _r.ft(MEM_INDEX).search(
        Query(f"@session:{{{session_id}}}").sort_by("ts", asc=False)
        .return_fields("text", "ts").paging(0, k).dialect(2))
    return [{"id": d.id.removeprefix(MEM_PREFIX), "text": getattr(d, "text", ""),
             "ts": int(float(getattr(d, "ts", 0)))} for d in res.docs]


async def search_memory_scored(session_id: str, vec, k: int = 20):
    if _pg:
        dist = _mem_tbl.c.embedding.cosine_distance(_to_list(vec))
        stmt = (sa.select(_mem_tbl.c.text, dist.label("score"), _mem_tbl.c.ts)
                .where(_mem_tbl.c.session_id == session_id)
                .order_by(sa.text("score")).limit(k))
        async with _pg_engine().connect() as conn:
            rows = (await conn.execute(stmt)).fetchall()
        return [{"text": r._mapping["text"] or "", "score": round(float(r._mapping["score"]), 3),
                 "ts": int(r._mapping["ts"] or 0)} for r in rows]
    docs = await _knn(MEM_INDEX, f"@session:{{{session_id}}}", vec, k, ["text", "ts"])
    return [{"text": getattr(d, "text", ""), "score": round(float(getattr(d, "score", 0)), 3),
             "ts": int(float(getattr(d, "ts", 0)))} for d in docs]


# --------------------------------------------------------------------------
# Lore vectors (content lives in the relational DB; we store id -> vector only)
# --------------------------------------------------------------------------
async def store_lore_vector(lore_id: str, char_id: str | None, vec):
    if _pg:
        ins = pg_insert(_lore_tbl).values(
            lore_id=lore_id, char_id=char_id, embedding=_to_list(vec))
        ins = ins.on_conflict_do_update(index_elements=["lore_id"], set_={
            "char_id": ins.excluded.char_id, "embedding": ins.excluded.embedding})
        async with _pg_engine().begin() as conn:
            await conn.execute(ins)
        return
    await _r.hset(LORE_PREFIX + lore_id,
                  mapping={"chartag": char_id or "_global", "embedding": _to_bytes(vec)})


async def search_lore_ids(char_id: str, vec, k: int, max_dist: float):
    ids = []
    if _pg:
        try:
            dist = _lore_tbl.c.embedding.cosine_distance(_to_list(vec))
            stmt = (sa.select(_lore_tbl.c.lore_id, dist.label("score"))
                    .where(sa.or_(_lore_tbl.c.char_id == char_id,
                                  _lore_tbl.c.char_id.is_(None)))
                    .order_by(sa.text("score")).limit(k))
            async with _pg_engine().connect() as conn:
                for r in (await conn.execute(stmt)).fetchall():
                    if float(r._mapping["score"]) <= max_dist:
                        ids.append(r._mapping["lore_id"])
        except Exception as e:
            log.warning("lore search failed (char=%s): %s: %s", char_id, type(e).__name__, e)
        return ids
    try:
        for d in await _knn(LORE_INDEX, f"@chartag:{{{char_id}|_global}}", vec, k, []):
            if float(getattr(d, "score", 2)) <= max_dist:
                ids.append(d.id[len(LORE_PREFIX):])
    except Exception as e:
        log.warning("lore search failed (char=%s): %s: %s", char_id, type(e).__name__, e)
    return ids


async def delete_lore_vector(lore_id: str):
    if _pg:
        async with _pg_engine().begin() as conn:
            await conn.execute(sa.delete(_lore_tbl).where(_lore_tbl.c.lore_id == lore_id))
        return
    await _r.delete(LORE_PREFIX + lore_id)


async def delete_by_tag(index: str, field: str, value: str):
    """Bulk-delete vectors matching a scope tag. Redis pages by tag; Postgres is a
    single scoped DELETE. `field` is 'session' or 'chartag' as used by callers."""
    if _pg:
        try:
            tbl = _mem_tbl if index == MEM_INDEX else _lore_tbl
            col = tbl.c.session_id if field == "session" else tbl.c.char_id
            async with _pg_engine().begin() as conn:
                await conn.execute(sa.delete(tbl).where(col == value))
        except Exception as e:
            log.warning("delete_by_tag(%s, %s=%s) failed: %s", index, field, value, e)
        return
    try:
        while True:   # Redis caps LIMIT at 10000 — page until the tag is empty
            res = await _r.ft(index).search(
                Query(f"@{field}:{{{value}}}").return_fields("ts").paging(0, 10000).dialect(2))
            ids = [d.id for d in res.docs]
            if not ids:
                break
            await _r.delete(*ids)
            if len(ids) < 10000:
                break
    except Exception as e:
        log.warning("delete_by_tag(%s, %s=%s) failed: %s", index, field, value, e)


async def _knn(index, filter_expr, vec, k, return_fields):
    q = (Query(f"({filter_expr})=>[KNN {k} @embedding $vec AS score]")
         .sort_by("score").return_fields("score", *return_fields).paging(0, k).dialect(2))
    res = await _r.ft(index).search(q, query_params={"vec": _to_bytes(vec)})
    return res.docs


async def stats():
    if _pg:
        try:
            async with _pg_engine().connect() as conn:
                m = (await conn.execute(sa.select(sa.func.count()).select_from(_mem_tbl))).scalar()
                l = (await conn.execute(sa.select(sa.func.count()).select_from(_lore_tbl))).scalar()
            return {"memories": int(m), "lore_vectors": int(l), "ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    try:
        m = int((await _r.ft(MEM_INDEX).info())["num_docs"])
        l = int((await _r.ft(LORE_INDEX).info())["num_docs"])
        return {"memories": m, "lore_vectors": l, "ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
