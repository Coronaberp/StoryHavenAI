import pytest

from backend.repositories import lore_chunks as lore_chunks_repo

pytestmark = pytest.mark.asyncio

async def test_set_chunks_creates_ordered_rows(db_conn):
    rows = await lore_chunks_repo.set_chunks("l-test-1", ["first piece", "second piece"])
    assert len(rows) == 2
    assert rows[0]["part_id"] == 0
    assert rows[0]["content"] == "first piece"
    assert rows[1]["part_id"] == 1
    assert rows[1]["content"] == "second piece"

async def test_chunks_for_returns_ordered(db_conn):
    await lore_chunks_repo.set_chunks("l-test-2", ["a", "b", "c"])
    chunks = await lore_chunks_repo.chunks_for("l-test-2")
    assert [c["content"] for c in chunks] == ["a", "b", "c"]

async def test_set_chunks_replaces_not_accumulates(db_conn):
    await lore_chunks_repo.set_chunks("l-test-3", ["old one", "old two"])
    await lore_chunks_repo.set_chunks("l-test-3", ["new single"])
    chunks = await lore_chunks_repo.chunks_for("l-test-3")
    assert len(chunks) == 1
    assert chunks[0]["content"] == "new single"

async def test_delete_chunks_removes_all(db_conn):
    await lore_chunks_repo.set_chunks("l-test-4", ["x", "y"])
    await lore_chunks_repo.delete_chunks("l-test-4")
    assert await lore_chunks_repo.chunks_for("l-test-4") == []

async def test_chunks_for_never_chunked_entry_is_empty(db_conn):
    assert await lore_chunks_repo.chunks_for("l-never-touched") == []
