import time

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, insert as pg_insert

from backend.db import nid, _encrypt_secret, _decrypt_secret
from backend.state import log

_meta = sa.MetaData()
_tbl = None
_cursor_tbl = None


def _engine():
    from backend import db
    return db.engine()


def build_tables(dim: int):
    global _tbl, _cursor_tbl, _meta
    from pgvector.sqlalchemy import Vector
    _meta = sa.MetaData()
    _tbl = sa.Table(
        "memory_facts", _meta,
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("session_id", sa.Text, nullable=False, index=True),
        sa.Column("char_id", sa.Text),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("fact_type", sa.Text, nullable=False),
        sa.Column("participants", ARRAY(sa.Text), nullable=False),
        sa.Column("importance", sa.Integer, nullable=False),
        sa.Column("valence", sa.Integer, nullable=False),
        sa.Column("reinforcements", sa.Integer, nullable=False),
        sa.Column("valid_from_turn", sa.Integer, nullable=False),
        sa.Column("valid_until_turn", sa.Integer),
        sa.Column("last_turn", sa.Integer, nullable=False),
        sa.Column("created_ts", sa.BigInteger, nullable=False),
        sa.Column("expired_ts", sa.BigInteger),
        sa.Column("superseded_by", sa.Text),
        sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("location", sa.Text),
        sa.Column("embedding", Vector(dim)),
    )
    _cursor_tbl = sa.Table(
        "memory_extract_cursors", _meta,
        sa.Column("session_id", sa.Text, primary_key=True),
        sa.Column("settled_exchanges", sa.Integer, nullable=False),
    )


async def ensure_tables(dim: int):
    build_tables(dim)
    async with _engine().begin() as conn:
        await conn.execute(sa.text(
            "ALTER TABLE memory_facts ADD COLUMN IF NOT EXISTS location TEXT"))
        await conn.run_sync(_meta.create_all)
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_memfacts_hnsw ON memory_facts "
            "USING hnsw (embedding vector_cosine_ops)"))


async def drop_tables():
    async with _engine().begin() as conn:
        await conn.execute(sa.text("DROP TABLE IF EXISTS memory_facts"))
        await conn.execute(sa.text("DROP TABLE IF EXISTS memory_extract_cursors"))


def _row(mapping) -> dict:
    out = dict(mapping)
    out.pop("embedding", None)
    out["text"] = _decrypt_secret(out.get("text") or "")
    return out


async def insert(fact: dict, vec, pinned: bool = False) -> str:
    fid = nid("mf")
    async with _engine().begin() as conn:
        await conn.execute(_tbl.insert().values(
            id=fid, session_id=fact["session_id"], char_id=fact.get("char_id"),
            text=_encrypt_secret(fact["text"]), fact_type=fact["fact_type"],
            participants=list(fact.get("participants") or []),
            importance=int(fact.get("importance") or 3),
            valence=int(fact.get("valence") or 0),
            reinforcements=0,
            valid_from_turn=int(fact["turn"]), valid_until_turn=None,
            last_turn=int(fact["turn"]), created_ts=int(time.time()),
            expired_ts=None, superseded_by=None, pinned=pinned,
            location=fact.get("location"),
            embedding=list(vec)))
    log.info("memory fact added: session=%s id=%s type=%s importance=%s pinned=%s",
             fact["session_id"], fid, fact["fact_type"], fact.get("importance"), pinned)
    return fid


async def reinforce(fact_id: str, turn: int):
    async with _engine().begin() as conn:
        await conn.execute(sa.update(_tbl).where(_tbl.c.id == fact_id).values(
            reinforcements=_tbl.c.reinforcements + 1, last_turn=int(turn)))
    log.info("memory fact reinforced: id=%s turn=%s", fact_id, turn)


async def update_text(fact_id: str, text: str, vec) -> None:
    async with _engine().begin() as conn:
        await conn.execute(sa.update(_tbl).where(_tbl.c.id == fact_id).values(
            text=_encrypt_secret(text), embedding=list(vec)))
    log.info("memory fact text updated: id=%s", fact_id)


async def expire(fact_id: str) -> None:
    async with _engine().begin() as conn:
        await conn.execute(sa.update(_tbl).where(_tbl.c.id == fact_id).values(
            expired_ts=int(time.time())))
    log.info("memory fact expired: id=%s", fact_id)


async def supersede(old_id: str, new_fact: dict, vec, turn: int) -> str:
    new_id = await insert(new_fact, vec)
    async with _engine().begin() as conn:
        await conn.execute(sa.update(_tbl).where(_tbl.c.id == old_id).values(
            valid_until_turn=int(turn), superseded_by=new_id))
    log.info("memory fact superseded: old=%s new=%s turn=%s", old_id, new_id, turn)
    return new_id


async def similar_live(session_id: str, vec, k: int) -> list[dict]:
    dist = _tbl.c.embedding.cosine_distance(list(vec))
    stmt = (sa.select(_tbl, dist.label("distance"))
            .where(_tbl.c.session_id == session_id, _tbl.c.expired_ts.is_(None))
            .order_by(sa.text("distance")).limit(k))
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [dict(_row(r._mapping), distance=float(r._mapping["distance"])) for r in rows]


async def reserved(session_id: str) -> list[dict]:
    stmt = sa.select(_tbl).where(
        _tbl.c.session_id == session_id, _tbl.c.expired_ts.is_(None),
        sa.or_(_tbl.c.pinned.is_(True),
               sa.and_(_tbl.c.fact_type == "state", _tbl.c.valid_until_turn.is_(None))))
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [_row(r._mapping) for r in rows]


async def list_live(session_id: str, k: int = 50) -> list[dict]:
    stmt = (sa.select(_tbl).where(
                _tbl.c.session_id == session_id, _tbl.c.expired_ts.is_(None))
            .order_by(_tbl.c.last_turn.desc()).limit(k))
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [_row(r._mapping) for r in rows]


async def count_live(session_id: str) -> int:
    stmt = sa.select(sa.func.count()).select_from(_tbl).where(
        _tbl.c.session_id == session_id, _tbl.c.expired_ts.is_(None))
    async with _engine().connect() as conn:
        return (await conn.execute(stmt)).scalar_one()


async def get_cursor(session_id: str) -> int:
    stmt = sa.select(_cursor_tbl.c.settled_exchanges).where(_cursor_tbl.c.session_id == session_id)
    async with _engine().connect() as conn:
        row = (await conn.execute(stmt)).fetchone()
    return int(row[0]) if row else 0


async def set_cursor(session_id: str, settled_exchanges: int):
    ins = pg_insert(_cursor_tbl).values(session_id=session_id,
                                        settled_exchanges=int(settled_exchanges))
    ins = ins.on_conflict_do_update(index_elements=["session_id"],
                                    set_={"settled_exchanges": ins.excluded.settled_exchanges})
    async with _engine().begin() as conn:
        await conn.execute(ins)


async def purge_session(session_id: str):
    async with _engine().begin() as conn:
        await conn.execute(sa.delete(_tbl).where(_tbl.c.session_id == session_id))
        await conn.execute(sa.delete(_cursor_tbl).where(_cursor_tbl.c.session_id == session_id))
    log.info("memory facts purged: session=%s", session_id)


async def purge_char(char_id: str):
    async with _engine().begin() as conn:
        await conn.execute(sa.delete(_tbl).where(_tbl.c.char_id == char_id))
    log.info("memory facts purged: char=%s", char_id)
