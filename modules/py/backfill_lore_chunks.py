import sys
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend import db
from backend import vectors
from backend.retrieval import index_lore, chunk_lore_content, LORE_CHUNK_THRESHOLD_TOKENS, _estimate_tokens
from backend.repositories import settings as global_settings_repo
from backend.repositories import lore_chunks as lore_chunks_repo
from backend.state import CFG, log

MAX_RECONCILE_ATTEMPTS = 5

async def _vector_count(lid: str) -> int:
    rows = await db._q(db.select(vectors._lore_tbl).where(vectors._lore_tbl.c.lore_id == lid))
    return len(rows)

async def _reconcile(oversized: list) -> None:
    by_id = {lid: (char_id, content, name, category)
              for lid, char_id, content, name, category in oversized}
    for attempt in range(1, MAX_RECONCILE_ATTEMPTS + 1):
        incomplete = []
        for lid, (char_id, content, name, category) in by_id.items():
            expected = len(chunk_lore_content(content))
            actual = await _vector_count(lid)
            if actual < expected:
                incomplete.append(lid)
        if not incomplete:
            log.info("backfill_lore_chunks: reconcile pass %d, all entries complete", attempt)
            return
        log.info("backfill_lore_chunks: reconcile pass %d, %d entries missing embeddings",
                 attempt, len(incomplete))
        for lid in incomplete:
            char_id, content, name, category = by_id[lid]
            await index_lore(lid, char_id, content, name, category)
    remaining = [lid for lid in by_id
                 if await _vector_count(lid) < len(chunk_lore_content(by_id[lid][1]))]
    if remaining:
        log.warning("backfill_lore_chunks: %d entries still missing embeddings after %d attempts: %s",
                     len(remaining), MAX_RECONCILE_ATTEMPTS, remaining)

async def main():
    await db.init()
    saved = await global_settings_repo.all_settings()
    for k, v in saved.items():
        if k in CFG and v is not None:
            CFG[k] = v
    vectors.connect()
    await vectors.ensure_indexes(CFG["embed_dim"])
    try:
        rows = await db._q(db.select(db.lore))
        oversized = []
        for row in rows:
            content = db._decrypt_secret(row["content"] or "")
            if _estimate_tokens(content) > LORE_CHUNK_THRESHOLD_TOKENS:
                oversized.append((row["id"], row["char_id"], content,
                                  db._decrypt_secret(row["name"] or ""), row["category"]))
        log.info("backfill_lore_chunks: found %d oversized entries", len(oversized))
        for i, (lid, char_id, content, name, category) in enumerate(oversized):
            await index_lore(lid, char_id, content, name, category)
            log.info("backfill_lore_chunks: reindexed %d/%d id=%s", i + 1, len(oversized), lid)
        log.info("backfill_lore_chunks: done, %d entries reindexed", len(oversized))
        await _reconcile(oversized)
    finally:
        await db.close()

if __name__ == "__main__":
    asyncio.run(main())
