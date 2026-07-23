import os

import pytest

from backend.repositories import memory_facts

pytestmark = pytest.mark.asyncio


def _fake_vec(dim=None):
    dim = dim or int(os.environ.get("EMBED_DIM", "768"))
    return [0.1] * dim


@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(int(os.environ.get("EMBED_DIM", "768")))


async def test_insert_pinned_true_persists(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-1", "char_id": "char-1", "text": "pinned fact",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    reserved = await memory_facts.reserved("sess-1")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["pinned"] is True


async def test_insert_pinned_default_false(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-2", "char_id": "char-1", "text": "ordinary fact",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    reserved = await memory_facts.reserved("sess-2")
    assert fid not in [r["id"] for r in reserved]


async def test_update_text_changes_text_keeps_reinforcements(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-3", "char_id": "char-1", "text": "before",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    await memory_facts.reinforce(fid, 2)
    await memory_facts.update_text(fid, "after", _fake_vec())
    reserved = await memory_facts.reserved("sess-3")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["text"] == "after"
    assert match["reinforcements"] == 1


async def test_expire_removes_from_live_results(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-4", "char_id": "char-1", "text": "expiring fact",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    await memory_facts.expire(fid)
    reserved = await memory_facts.reserved("sess-4")
    assert fid not in [r["id"] for r in reserved]


async def test_list_live_excludes_expired(db_conn):
    live_id = await memory_facts.insert({
        "session_id": "sess-live", "char_id": "char-1", "text": "still here",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    expired_id = await memory_facts.insert({
        "session_id": "sess-live", "char_id": "char-1", "text": "gone",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    await memory_facts.expire(expired_id)
    result = await memory_facts.list_live("sess-live")
    ids = [r["id"] for r in result]
    assert live_id in ids
    assert expired_id not in ids


async def test_list_live_orders_newest_last_turn_first(db_conn):
    older = await memory_facts.insert({
        "session_id": "sess-order", "char_id": "char-1", "text": "older",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    newer = await memory_facts.insert({
        "session_id": "sess-order", "char_id": "char-1", "text": "newer",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 5,
    }, _fake_vec())
    result = await memory_facts.list_live("sess-order")
    ids = [r["id"] for r in result]
    assert ids.index(newer) < ids.index(older)


async def test_purge_char_removes_facts_across_sessions(db_conn):
    fid_a = await memory_facts.insert({
        "session_id": "sess-a", "char_id": "char-purge", "text": "a",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    fid_b = await memory_facts.insert({
        "session_id": "sess-b", "char_id": "char-purge", "text": "b",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    await memory_facts.purge_char("char-purge")
    remaining_a = await memory_facts.list_live("sess-a")
    remaining_b = await memory_facts.list_live("sess-b")
    assert fid_a not in [r["id"] for r in remaining_a]
    assert fid_b not in [r["id"] for r in remaining_b]


async def test_insert_stores_location(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-loc-1", "char_id": "char-1", "text": "at the mill",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
        "location": "the abandoned mill",
    }, _fake_vec(), pinned=True)
    reserved = await memory_facts.reserved("sess-loc-1")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["location"] == "the abandoned mill"


async def test_insert_without_location_stores_none(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-loc-2", "char_id": "char-1", "text": "no location given",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    reserved = await memory_facts.reserved("sess-loc-2")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["location"] is None
