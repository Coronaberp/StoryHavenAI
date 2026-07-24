import os

import pytest

from backend import vectors

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "768"))

async def test_store_and_search_single_chunk(db_conn):
    vectors._build_tables(_EMBED_DIM)
    await vectors.store_lore_vector("l-vec-1", None, [0.1] * _EMBED_DIM, part_id=0)
    ids = await vectors.search_lore_ids(None, [0.1] * _EMBED_DIM, 5, 0.8)
    assert "l-vec-1" in ids

async def test_search_lore_ids_dedups_multiple_chunks_to_one_entry(db_conn):
    vectors._build_tables(_EMBED_DIM)
    await vectors.store_lore_vector("l-vec-2", None, [0.1] * _EMBED_DIM, part_id=0)
    await vectors.store_lore_vector("l-vec-2", None, [0.1] * _EMBED_DIM, part_id=1)
    ids = await vectors.search_lore_ids(None, [0.1] * _EMBED_DIM, 5, 0.8)
    assert ids.count("l-vec-2") == 1

async def test_search_lore_chunks_returns_part_level_hits(db_conn):
    vectors._build_tables(_EMBED_DIM)
    await vectors.store_lore_vector("l-vec-3", None, [0.1] * _EMBED_DIM, part_id=0)
    await vectors.store_lore_vector("l-vec-3", None, [0.2] * _EMBED_DIM, part_id=1)
    hits = await vectors.search_lore_chunks(None, [0.1] * _EMBED_DIM, 5, 0.8)
    part_ids = {h["part_id"] for h in hits if h["lore_id"] == "l-vec-3"}
    assert part_ids == {0, 1}
