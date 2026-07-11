import pytest

from backend.repositories import lore

pytestmark = pytest.mark.asyncio


async def _make_lore(db_conn, char_id=None, name="test-lore", content="secret content"):
    return await lore.create(char_id, ["alpha", "beta"], content, always=False, name=name)


async def test_create_and_get(db_conn):
    lid = await _make_lore(db_conn)
    entry = await lore.get(lid)
    assert entry["id"] == lid
    assert entry["name"] == "test-lore"
    assert entry["content"] == "secret content"
    assert entry["keys"] == ["alpha", "beta"]
    assert entry["always"] is False
    assert entry["global"] is True


async def test_get_missing_returns_none(db_conn):
    assert await lore.get("nonexistent") is None


async def test_list_for_character_includes_global(db_conn):
    lid = await _make_lore(db_conn, char_id=None, name="global-entry")
    entries = await lore.list_for_character("some-char-id")
    ids = {e["id"] for e in entries}
    assert lid in ids


async def test_update(db_conn):
    lid = await _make_lore(db_conn, name="before-update")
    ok = await lore.update(lid, ["gamma"], "updated content", always=True, hidden=True)
    assert ok is True
    entry = await lore.get(lid)
    assert entry["content"] == "updated content"
    assert entry["keys"] == ["gamma"]
    assert entry["always"] is True
    assert entry["hidden"] is True
    assert entry["name"] == "before-update"


async def test_update_missing_returns_false(db_conn):
    assert await lore.update("nonexistent", ["k"], "c", always=False) is False


async def test_delete(db_conn):
    lid = await _make_lore(db_conn)
    await lore.delete(lid)
    assert await lore.get(lid) is None


async def test_by_ids(db_conn):
    lid1 = await _make_lore(db_conn, name="one")
    lid2 = await _make_lore(db_conn, name="two")
    entries = await lore.by_ids([lid1, lid2, "nonexistent"])
    ids = {e["id"] for e in entries}
    assert ids == {lid1, lid2}


async def test_by_ids_empty_list(db_conn):
    assert await lore.by_ids([]) == []
