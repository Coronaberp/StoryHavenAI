import pytest

from backend.repositories import lore, lore_links

pytestmark = pytest.mark.asyncio


async def _make_lore(db_conn, name):
    return await lore.create(None, [], "content", always=False, name=name)


async def test_set_link_and_outgoing(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_link(a, b, "lives in")
    assert await lore_links.outgoing_for(a) == [{"target_id": b, "label": "lives in"}]
    assert await lore_links.outgoing_for(b) == []
    assert await lore_links.incoming_for(b) == [{"source_id": a, "label": "lives in"}]
    assert await lore_links.incoming_for(a) == []


async def test_set_link_direction_matters(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_link(a, b, "enemies of")
    await lore_links.set_link(b, a, "enemies of")
    assert await lore_links.outgoing_for(a) == [{"target_id": b, "label": "enemies of"}]
    assert await lore_links.outgoing_for(b) == [{"target_id": a, "label": "enemies of"}]


async def test_set_link_updates_label(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_link(a, b, "lives in")
    await lore_links.set_link(a, b, "visits")
    assert await lore_links.outgoing_for(a) == [{"target_id": b, "label": "visits"}]


async def test_set_link_self_is_noop(db_conn):
    a = await _make_lore(db_conn, "a")
    await lore_links.set_link(a, a, "self")
    assert await lore_links.outgoing_for(a) == []


async def test_label_trimmed_and_capped(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_link(a, b, "  " + ("x" * 100) + "  ")
    result = await lore_links.outgoing_for(a)
    assert result[0]["label"] == "x" * 60


async def test_blank_label_stored_as_empty(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_link(a, b, "   ")
    assert await lore_links.outgoing_for(a) == [{"target_id": b, "label": ""}]


async def test_unlink(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_link(a, b, "lives in")
    await lore_links.unlink(a, b)
    assert await lore_links.outgoing_for(a) == []


async def test_unlink_missing_is_noop(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.unlink(a, b)
    assert await lore_links.outgoing_for(a) == []


async def test_delete_all_for(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    c = await _make_lore(db_conn, "c")
    await lore_links.set_link(a, b, "lives in")
    await lore_links.set_link(c, a, "visits")
    await lore_links.delete_all_for(a)
    assert await lore_links.outgoing_for(a) == []
    assert await lore_links.incoming_for(a) == []
    assert await lore_links.outgoing_for(c) == []


async def test_outgoing_for_many(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    c = await _make_lore(db_conn, "c")
    await lore_links.set_link(a, b, "lives in")
    result = await lore_links.outgoing_for_many([a, b, c])
    assert result[a] == [{"target_id": b, "label": "lives in"}]
    assert result[b] == []
    assert result[c] == []


async def test_incoming_for_many(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    c = await _make_lore(db_conn, "c")
    await lore_links.set_link(a, b, "lives in")
    result = await lore_links.incoming_for_many([a, b, c])
    assert result[b] == [{"source_id": a, "label": "lives in"}]
    assert result[a] == []
    assert result[c] == []


async def test_set_outgoing_links_adds_updates_removes(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    c = await _make_lore(db_conn, "c")
    await lore_links.set_link(a, b, "lives in")
    await lore_links.set_outgoing_links(a, [
        {"target_id": b, "label": "visits"},
        {"target_id": c, "label": "enemies of"},
    ])
    result = {r["target_id"]: r["label"] for r in await lore_links.outgoing_for(a)}
    assert result == {b: "visits", c: "enemies of"}


async def test_set_outgoing_links_dedupes_target_last_wins(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_outgoing_links(a, [
        {"target_id": b, "label": "lives in"},
        {"target_id": b, "label": "visits"},
    ])
    assert await lore_links.outgoing_for(a) == [{"target_id": b, "label": "visits"}]


async def test_set_outgoing_links_ignores_self_target(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_outgoing_links(a, [
        {"target_id": a, "label": "self"},
        {"target_id": b, "label": "lives in"},
    ])
    assert await lore_links.outgoing_for(a) == [{"target_id": b, "label": "lives in"}]


async def test_set_outgoing_links_does_not_touch_incoming(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.set_link(b, a, "watches")
    await lore_links.set_outgoing_links(a, [])
    assert await lore_links.incoming_for(a) == [{"source_id": b, "label": "watches"}]
