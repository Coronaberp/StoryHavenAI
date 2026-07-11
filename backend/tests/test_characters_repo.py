import pytest

from backend.repositories import characters

pytestmark = pytest.mark.asyncio


async def _make_character(db_conn, name="Test Character", owner_id=None, **extra):
    data = {"name": name, "persona": "a persona", "owner_id": owner_id, **extra}
    return await characters.create(data)


async def test_create_and_get(db_conn):
    c = await _make_character(db_conn, name="Alice")
    fetched = await characters.get(c["id"])
    assert fetched["id"] == c["id"]
    assert fetched["name"] == "Alice"
    assert fetched["persona"] == "a persona"
    assert fetched["chats"] == 0


async def test_get_missing_returns_none(db_conn):
    assert await characters.get("nonexistent") is None


async def test_update(db_conn):
    c = await _make_character(db_conn, name="Before")
    updated = await characters.update(c["id"], {"name": "After", "persona": "new persona"})
    assert updated["name"] == "After"
    assert updated["persona"] == "new persona"


async def test_update_missing_returns_none(db_conn):
    assert await characters.update("nonexistent", {"name": "x"}) is None


async def test_delete(db_conn):
    c = await _make_character(db_conn, name="ToDelete")
    sids = await characters.delete(c["id"])
    assert sids == []
    assert await characters.get(c["id"]) is None


async def test_list_all_community_scope(db_conn):
    c = await _make_character(db_conn, name="Public One", is_public=True)
    rows = await characters.list_all(scope="community")
    ids = {r["id"] for r in rows}
    assert c["id"] in ids


async def test_list_all_mine_scope_excludes_others(db_conn):
    mine = await _make_character(db_conn, name="Mine", owner_id="user-a")
    other = await _make_character(db_conn, name="Other", owner_id="user-b")
    rows = await characters.list_all(user_id="user-a", scope="mine")
    ids = {r["id"] for r in rows}
    assert mine["id"] in ids
    assert other["id"] not in ids


async def test_owner_username_none_when_no_owner(db_conn):
    assert await characters.owner_username(None) is None
