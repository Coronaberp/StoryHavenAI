import pytest

from backend.repositories import session_characters as sc

pytestmark = pytest.mark.asyncio


async def test_set_and_list_cast_ordered(db_conn):
    await sc.set_cast("sess-1", [
        {"char_id": "aurelia"},
        {"char_id": "bram"},
        {"char_id": "narr", "is_narrator": True},
    ])
    cast = await sc.list_cast("sess-1")
    assert [c["char_id"] for c in cast] == ["aurelia", "bram", "narr"]
    assert [c["position"] for c in cast] == [0, 1, 2]
    assert cast[2]["is_narrator"] == 1


async def test_set_cast_replaces(db_conn):
    await sc.set_cast("sess-2", [{"char_id": "a"}, {"char_id": "b"}])
    await sc.set_cast("sess-2", [{"char_id": "c"}])
    cast = await sc.list_cast("sess-2")
    assert [c["char_id"] for c in cast] == ["c"]


async def test_add_member_appends_and_dedupes(db_conn):
    await sc.set_cast("sess-3", [{"char_id": "a"}])
    await sc.add_member("sess-3", "b")
    await sc.add_member("sess-3", "b")
    cast = await sc.list_cast("sess-3")
    assert [c["char_id"] for c in cast] == ["a", "b"]
    assert [c["position"] for c in cast] == [0, 1]


async def test_remove_member(db_conn):
    await sc.set_cast("sess-4", [{"char_id": "a"}, {"char_id": "b"}])
    await sc.remove_member("sess-4", "a")
    assert [c["char_id"] for c in await sc.list_cast("sess-4")] == ["b"]


async def test_set_muted(db_conn):
    await sc.set_cast("sess-5", [{"char_id": "a"}])
    await sc.set_muted("sess-5", "a", True)
    assert (await sc.list_cast("sess-5"))[0]["muted"] == 1
    await sc.set_muted("sess-5", "a", False)
    assert (await sc.list_cast("sess-5"))[0]["muted"] == 0
