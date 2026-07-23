import pytest

from backend.repositories import lore, lore_secrets as ls

pytestmark = pytest.mark.asyncio


async def _make_lore(db_conn, name="entry", content="content"):
    return await lore.create(None, [], content, always=False, name=name, hidden=True)


async def test_set_secrets_creates_ordered_rows(db_conn):
    lid = await _make_lore(db_conn)
    result = await ls.set_secrets(lid, ["likes sweets", "hates cake"])
    assert [r["text"] for r in result] == ["likes sweets", "hates cake"]
    assert [r["position"] for r in result] == [0, 1]


async def test_secrets_for_returns_ordered(db_conn):
    lid = await _make_lore(db_conn)
    await ls.set_secrets(lid, ["first", "second", "third"])
    result = await ls.secrets_for(lid)
    assert [r["text"] for r in result] == ["first", "second", "third"]


async def test_set_secrets_replaces_existing(db_conn):
    lid = await _make_lore(db_conn)
    await ls.set_secrets(lid, ["old fact"])
    await ls.set_secrets(lid, ["new fact one", "new fact two"])
    result = await ls.secrets_for(lid)
    assert [r["text"] for r in result] == ["new fact one", "new fact two"]


async def test_delete_secrets(db_conn):
    lid = await _make_lore(db_conn)
    await ls.set_secrets(lid, ["a fact"])
    await ls.delete_secrets(lid)
    assert await ls.secrets_for(lid) == []


async def test_reveal_and_revealed_ids(db_conn):
    lid = await _make_lore(db_conn)
    secrets = await ls.set_secrets(lid, ["likes sweets", "hates cake"])
    sweets_id, cake_id = secrets[0]["id"], secrets[1]["id"]
    await ls.reveal("sess-1", sweets_id)
    revealed = await ls.revealed_ids("sess-1", [sweets_id, cake_id])
    assert revealed == {sweets_id}


async def test_reveal_is_idempotent(db_conn):
    lid = await _make_lore(db_conn)
    secrets = await ls.set_secrets(lid, ["a fact"])
    sid = secrets[0]["id"]
    await ls.reveal("sess-1", sid)
    await ls.reveal("sess-1", sid)
    revealed = await ls.revealed_ids("sess-1", [sid])
    assert revealed == {sid}


async def test_reveal_scoped_to_session(db_conn):
    lid = await _make_lore(db_conn)
    secrets = await ls.set_secrets(lid, ["a fact"])
    sid = secrets[0]["id"]
    await ls.reveal("sess-1", sid)
    revealed = await ls.revealed_ids("sess-2", [sid])
    assert revealed == set()


async def test_partial_reveal_does_not_leak_sibling_secret(db_conn):
    lid = await _make_lore(db_conn)
    secrets = await ls.set_secrets(lid, ["likes sweets", "hates cake"])
    sweets_id = secrets[0]["id"]
    cake_id = secrets[1]["id"]
    await ls.reveal("sess-1", sweets_id)
    all_secrets = await ls.secrets_for(lid)
    revealed = await ls.revealed_ids("sess-1", [s["id"] for s in all_secrets])
    assert sweets_id in revealed
    assert cake_id not in revealed
