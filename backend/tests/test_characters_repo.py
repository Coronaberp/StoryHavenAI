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

async def test_create_with_valid_genre(db_conn):
    c = await _make_character(db_conn, name="Genred", genre="Fantasy")
    assert c["genre"] == "Fantasy"

async def test_create_with_invalid_genre_is_ignored(db_conn):
    c = await _make_character(db_conn, name="BadGenre", genre="Not A Real Genre")
    assert c["genre"] is None

async def test_create_with_no_genre_defaults_to_none(db_conn):
    c = await _make_character(db_conn, name="NoGenre")
    assert c["genre"] is None

async def test_update_genre(db_conn):
    c = await _make_character(db_conn, name="ToRegenre", genre="Horror")
    updated = await characters.update(c["id"], {"genre": "Comedy"})
    assert updated["genre"] == "Comedy"

async def test_update_with_invalid_genre_clears_it(db_conn):
    c = await _make_character(db_conn, name="ToClear", genre="Drama")
    updated = await characters.update(c["id"], {"genre": "Not Real"})
    assert updated["genre"] is None

async def test_public_character_count_only_counts_public(db_conn):
    await _make_character(db_conn, name="Public One", owner_id="user-count", is_public=True)
    await _make_character(db_conn, name="Public Two", owner_id="user-count", is_public=True)
    await _make_character(db_conn, name="Private One", owner_id="user-count", is_public=False)
    assert await characters.public_character_count("user-count") == 2

async def test_public_character_count_no_characters(db_conn):
    assert await characters.public_character_count("nonexistent") == 0
