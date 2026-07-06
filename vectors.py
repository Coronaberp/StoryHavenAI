"""
vectors.py — the only place that touches Redis. Async client (redis.asyncio).

Redis does one job here: vector storage + similarity search. SQLite owns the
readable data; Redis owns the embeddings. Two indexes:

  mem_idx   long-term memory  (text is stored here too, since it's vector-native)
  lore_idx  lore embeddings   (id only -> content is fetched from SQLite)
"""
import time
import hashlib
import logging
import numpy as np
import redis.asyncio as redis
from redis.commands.search.field import TextField, TagField, NumericField, VectorField
from redis.commands.search.index_definition import IndexDefinition, IndexType
from redis.commands.search.query import Query

log = logging.getLogger("personae")

MEM_INDEX, LORE_INDEX = "mem_idx", "lore_idx"
MEM_PREFIX, LORE_PREFIX = "mem:", "lorevec:"

_r: redis.Redis | None = None


def connect(url: str):
    global _r
    _r = redis.from_url(url, decode_responses=True)


async def close():
    if _r:
        await _r.aclose()


def _to_bytes(vec):
    return np.asarray(vec, dtype=np.float32).tobytes()


def _vec_field(dim):
    return VectorField("embedding", "HNSW",
                       {"TYPE": "FLOAT32", "DIM": dim, "DISTANCE_METRIC": "COSINE"})


async def ensure_indexes(dim: int):
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


async def reset_indexes(dim: int):
    """Drop and recreate both indexes (and their vectors) — used when the
    embedding dimension changes, since vectors of different sizes can't coexist."""
    for idx in (MEM_INDEX, LORE_INDEX):
        try:
            await _r.ft(idx).dropindex(delete_documents=True)
        except Exception:
            pass
    await ensure_indexes(dim)


async def _knn(index, filter_expr, vec, k, return_fields):
    q = (Query(f"({filter_expr})=>[KNN {k} @embedding $vec AS score]")
         .sort_by("score").return_fields("score", *return_fields).paging(0, k).dialect(2))
    res = await _r.ft(index).search(q, query_params={"vec": _to_bytes(vec)})
    return res.docs


# --------------------------------------------------------------------------
# Memory
# --------------------------------------------------------------------------
async def store_memory(char_id: str, session_id: str, text: str, vec, mem_id: str | None = None):
    # chartag is kept for character-level cleanup; retrieval is scoped to session.
    # When mem_id is given (the triggering user message id), the key is stable, so
    # regenerating a reply overwrites that turn's memory instead of duplicating it.
    base = mem_id or hashlib.sha1((session_id + "|" + text).encode()).hexdigest()[:20]
    key = MEM_PREFIX + base
    await _r.hset(key, mapping={"text": text, "chartag": char_id, "session": session_id,
                                "ts": int(time.time()), "embedding": _to_bytes(vec)})


async def search_memory(session_id: str, vec, k: int, max_dist: float, exclude_id: str | None = None):
    out = []
    skip = (MEM_PREFIX + exclude_id) if exclude_id else None
    try:
        # fetch one extra so excluding the current turn still leaves up to k results
        for d in await _knn(MEM_INDEX, f"@session:{{{session_id}}}", vec, k + (1 if skip else 0), ["text"]):
            if skip and d.id == skip:
                continue
            if float(getattr(d, "score", 2)) <= max_dist:
                out.append(getattr(d, "text", ""))
    except Exception as e:
        # Without this log line, a down/misconfigured Redis is indistinguishable
        # from "no relevant memories this turn" — silently degrading retrieval
        # with no signal an admin could act on.
        log.warning("memory search failed (session=%s): %s: %s", session_id, type(e).__name__, e)
    return out[:k]


async def purge_memory(dim: int):
    """Drop and recreate only mem_idx (lore_idx untouched) — used when the memory
    canon language changes and old entries are no longer compatible with new ones."""
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
    try:
        await _r.delete(MEM_PREFIX + mem_id)
    except Exception:
        pass


async def list_memory(session_id: str, k: int = 30):
    res = await _r.ft(MEM_INDEX).search(
        Query(f"@session:{{{session_id}}}").sort_by("ts", asc=False)
        .return_fields("text", "ts").paging(0, k).dialect(2))
    return [{"id": d.id.removeprefix(MEM_PREFIX), "text": getattr(d, "text", ""),
             "ts": int(float(getattr(d, "ts", 0)))} for d in res.docs]


async def search_memory_scored(session_id: str, vec, k: int = 20):
    docs = await _knn(MEM_INDEX, f"@session:{{{session_id}}}", vec, k, ["text", "ts"])
    return [{"text": getattr(d, "text", ""), "score": round(float(getattr(d, "score", 0)), 3),
             "ts": int(float(getattr(d, "ts", 0)))} for d in docs]


# --------------------------------------------------------------------------
# Lore vectors (content lives in SQLite; we store id -> vector only)
# --------------------------------------------------------------------------
async def store_lore_vector(lore_id: str, char_id: str | None, vec):
    await _r.hset(LORE_PREFIX + lore_id,
                  mapping={"chartag": char_id or "_global", "embedding": _to_bytes(vec)})


async def search_lore_ids(char_id: str, vec, k: int, max_dist: float):
    ids = []
    try:
        for d in await _knn(LORE_INDEX, f"@chartag:{{{char_id}|_global}}", vec, k, []):
            if float(getattr(d, "score", 2)) <= max_dist:
                ids.append(d.id[len(LORE_PREFIX):])
    except Exception as e:
        log.warning("lore search failed (char=%s): %s: %s", char_id, type(e).__name__, e)
    return ids


async def delete_lore_vector(lore_id: str):
    await _r.delete(LORE_PREFIX + lore_id)


async def delete_by_tag(index: str, field: str, value: str):
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
        import logging as _log
        _log.getLogger(__name__).warning("delete_by_tag(%s, %s=%s) failed: %s", index, field, value, e)


async def stats():
    try:
        m = int((await _r.ft(MEM_INDEX).info())["num_docs"])
        l = int((await _r.ft(LORE_INDEX).info())["num_docs"])
        return {"memories": m, "lore_vectors": l, "ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
