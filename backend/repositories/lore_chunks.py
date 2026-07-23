import time

from sqlalchemy import select, insert, delete as sa_delete

from backend.db import lore_chunks, nid, _q, _w
from backend.state import log


def _row(row) -> dict:
    return {"id": row["id"], "lore_id": row["lore_id"], "part_id": row["part_id"],
            "content": row["content"]}


async def chunks_for(lore_id: str) -> list[dict]:
    rows = await _q(select(lore_chunks).where(lore_chunks.c.lore_id == lore_id)
                    .order_by(lore_chunks.c.part_id))
    return [_row(r) for r in rows]


async def set_chunks(lore_id: str, chunks: list[str]) -> list[dict]:
    await delete_chunks(lore_id)
    created_ts = int(time.time())
    rows = [{"id": nid("lchk"), "lore_id": lore_id, "part_id": i, "content": chunk,
             "created_ts": created_ts}
            for i, chunk in enumerate(chunks)]
    if rows:
        await _w(insert(lore_chunks).values(rows))
    log.info("lore_chunks: set count=%s lore=%s", len(rows), lore_id)
    return await chunks_for(lore_id)


async def delete_chunks(lore_id: str) -> None:
    await _w(sa_delete(lore_chunks).where(lore_chunks.c.lore_id == lore_id))
    log.info("lore_chunks: deleted lore=%s", lore_id)


async def insert_chunk(lore_id: str, part_id: int, content: str) -> dict:
    row = {"id": nid("lchk"), "lore_id": lore_id, "part_id": part_id, "content": content,
           "created_ts": int(time.time())}
    await _w(insert(lore_chunks).values(row))
    log.info("lore_chunks: inserted lore=%s part=%s", lore_id, part_id)
    return _row(row)
