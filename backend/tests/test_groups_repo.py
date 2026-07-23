import pytest
from backend.repositories import groups as gr
pytestmark = pytest.mark.asyncio


async def test_tables_exist():
    from backend.db import groups, group_characters
    assert groups.name == "groups"
    assert group_characters.name == "group_characters"


async def test_create_get_and_cast(db_conn):
    gid = await gr.create("owner-1", "The Crew", "They meet.", "roleplay", 1, ["a", "b"])
    g = await gr.get(gid)
    assert g["name"] == "The Crew" and g["is_public"] == 1 and g["group_mode"] == "roleplay"
    cast = await gr.list_cast(gid)
    assert [c["char_id"] for c in cast] == ["a", "b"]


async def test_update_rewrites_cast(db_conn):
    gid = await gr.create("owner-1", "X", "o", "chat", 0, ["a", "b"])
    await gr.update(gid, "Y", "o2", "roleplay", ["c", "d", "e"])
    g = await gr.get(gid)
    assert g["name"] == "Y" and g["group_mode"] == "roleplay"
    assert [c["char_id"] for c in await gr.list_cast(gid)] == ["c", "d", "e"]


async def test_delete_removes_group_and_cast(db_conn):
    gid = await gr.create("o", "X", "o", "chat", 1, ["a", "b"])
    await gr.delete(gid)
    assert await gr.get(gid) is None
    assert await gr.list_cast(gid) == []


async def test_list_public_only_public(db_conn):
    pub = await gr.create("o", "Pub", "o", "chat", 1, ["a", "b"])
    await gr.create("o", "Priv", "o", "chat", 0, ["a", "b"])
    ids = [g["id"] for g in await gr.list_public(None, None)]
    assert pub in ids
    assert all(g["is_public"] == 1 for g in await gr.list_public(None, None))


async def test_list_public_for_char(db_conn):
    gid = await gr.create("o", "Feat", "o", "chat", 1, ["hero", "sidekick"])
    await gr.create("o", "Priv", "o", "chat", 0, ["hero", "villain"])
    featuring = await gr.list_public_for_char("hero")
    assert gid in [g["id"] for g in featuring]
    assert all(g["is_public"] == 1 for g in featuring)


async def test_name_and_opening_stored_encrypted(db_conn):
    from backend.db import groups, _q1
    from sqlalchemy import select
    gid = await gr.create("owner-1", "Secret Crew", "A private opening line.", "chat", 0, ["a"])
    raw = await _q1(select(groups).where(groups.c.id == gid))
    assert raw["name"].startswith("enc:") and raw["name"] != "Secret Crew"
    assert raw["opening"].startswith("enc:") and raw["opening"] != "A private opening line."


async def test_list_public_search_matches_decrypted_name(db_conn):
    gid = await gr.create("o", "Moonlit Tavern", "o", "chat", 1, ["a"])
    await gr.create("o", "Unrelated", "o", "chat", 1, ["a"])
    found = await gr.list_public("moonlit", None)
    assert [g["id"] for g in found] == [gid]
