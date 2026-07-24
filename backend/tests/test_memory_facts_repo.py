import os

import pytest

from backend.repositories import memory_facts

pytestmark = pytest.mark.asyncio

def _fake_vec(dim=None):
    dim = dim or int(os.environ.get("EMBED_DIM", "1024"))
    return [0.1] * dim

@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(int(os.environ.get("EMBED_DIM", "1024")))

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

async def test_similar_current_excludes_superseded_facts(db_conn):
    original_id = await memory_facts.insert({
        "session_id": "sess-current-1", "char_id": "char-1", "text": "old worry",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    new_id = await memory_facts.supersede(original_id, {
        "session_id": "sess-current-1", "char_id": "char-1", "text": "new worry",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 5,
    }, _fake_vec(), 5)
    current = await memory_facts.similar_current("sess-current-1", _fake_vec(), 10)
    ids = [r["id"] for r in current]
    assert new_id in ids
    assert original_id not in ids

async def test_similar_live_still_includes_superseded_facts(db_conn):
    original_id = await memory_facts.insert({
        "session_id": "sess-current-2", "char_id": "char-1", "text": "old worry",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec())
    new_id = await memory_facts.supersede(original_id, {
        "session_id": "sess-current-2", "char_id": "char-1", "text": "new worry",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 5,
    }, _fake_vec(), 5)
    live = await memory_facts.similar_live("sess-current-2", _fake_vec(), 10)
    ids = [r["id"] for r in live]
    assert new_id in ids
    assert original_id in ids

async def test_rollback_from_pair_index_deletes_batch_facts_and_rewinds_cursor(db_conn):
    session_id = "sess-rollback-1"
    fact_id = await memory_facts.insert({
        "session_id": session_id, "char_id": "char-1", "text": "a discarded fact",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 5,
        "batch_id": "batch-a",
    }, _fake_vec())
    await memory_facts.record_batch(session_id, "batch-a", pair_start=0, pair_end=5, turn=5)
    await memory_facts.set_cursor(session_id, 5)

    result = await memory_facts.rollback_from_pair_index(session_id, 2)

    assert result["batches_rolled_back"] == 1
    assert result["facts_deleted"] == 1
    assert result["rewound_cursor"] == 0
    live = await memory_facts.list_live(session_id)
    assert fact_id not in [f["id"] for f in live]
    assert await memory_facts.get_cursor(session_id) == 0

async def test_rollback_from_pair_index_before_batch_start_is_noop(db_conn):
    session_id = "sess-rollback-2"
    fact_id = await memory_facts.insert({
        "session_id": session_id, "char_id": "char-1", "text": "a settled fact",
        "fact_type": "event", "participants": [], "importance": 3, "valence": 0, "turn": 5,
        "batch_id": "batch-b",
    }, _fake_vec())
    await memory_facts.record_batch(session_id, "batch-b", pair_start=0, pair_end=5, turn=5)
    await memory_facts.set_cursor(session_id, 5)

    result = await memory_facts.rollback_from_pair_index(session_id, 10)

    assert result["batches_rolled_back"] == 0
    assert result["facts_deleted"] == 0
    assert result["rewound_cursor"] is None
    live = await memory_facts.list_live(session_id)
    assert fact_id in [f["id"] for f in live]
    assert await memory_facts.get_cursor(session_id) == 5

async def test_rollback_restores_superseded_fact_to_live(db_conn):
    session_id = "sess-rollback-3"
    original_id = await memory_facts.insert({
        "session_id": session_id, "char_id": "char-1", "text": "original worry",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
        "batch_id": "batch-earlier",
    }, _fake_vec())
    await memory_facts.record_batch(session_id, "batch-earlier", pair_start=0, pair_end=5, turn=1)
    new_id = await memory_facts.supersede(original_id, {
        "session_id": session_id, "char_id": "char-1", "text": "updated worry",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 10,
        "batch_id": "batch-later",
    }, _fake_vec(), 10)
    await memory_facts.record_batch(session_id, "batch-later", pair_start=5, pair_end=10, turn=10)
    await memory_facts.set_cursor(session_id, 10)

    result = await memory_facts.rollback_from_pair_index(session_id, 7)

    assert result["facts_deleted"] == 1
    live = await memory_facts.list_live(session_id)
    live_ids = [f["id"] for f in live]
    assert new_id not in live_ids
    assert original_id in live_ids
    restored = next(f for f in live if f["id"] == original_id)
    assert restored["valid_until_turn"] is None
    assert restored["superseded_by"] is None

async def test_rollback_restores_reinforcement_counters(db_conn):
    session_id = "sess-rollback-reinforce"
    fid = await memory_facts.insert({
        "session_id": session_id, "char_id": "char-1", "text": "recurring fact",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
        "batch_id": "batch-early",
    }, _fake_vec())
    await memory_facts.record_batch(session_id, "batch-early", pair_start=0, pair_end=5, turn=1)
    await memory_facts.reinforce(fid, 9, batch_id="batch-late", session_id=session_id)
    await memory_facts.record_batch(session_id, "batch-late", pair_start=5, pair_end=10, turn=9)
    await memory_facts.set_cursor(session_id, 10)
    before = next(f for f in await memory_facts.list_live(session_id) if f["id"] == fid)
    assert before["reinforcements"] == 1 and before["last_turn"] == 9

    result = await memory_facts.rollback_from_pair_index(session_id, 7)

    assert result["reinforcements_restored"] == 1
    after = next(f for f in await memory_facts.list_live(session_id) if f["id"] == fid)
    assert after["reinforcements"] == 0
    assert after["last_turn"] == 1

async def test_rollback_keeps_reinforcement_from_surviving_batch(db_conn):
    session_id = "sess-rollback-reinforce-2"
    fid = await memory_facts.insert({
        "session_id": session_id, "char_id": "char-1", "text": "twice-reinforced",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
        "batch_id": "batch-1",
    }, _fake_vec())
    await memory_facts.record_batch(session_id, "batch-1", pair_start=0, pair_end=5, turn=1)
    await memory_facts.reinforce(fid, 6, batch_id="batch-2", session_id=session_id)
    await memory_facts.record_batch(session_id, "batch-2", pair_start=5, pair_end=10, turn=6)
    await memory_facts.reinforce(fid, 11, batch_id="batch-3", session_id=session_id)
    await memory_facts.record_batch(session_id, "batch-3", pair_start=10, pair_end=15, turn=11)
    await memory_facts.set_cursor(session_id, 15)

    result = await memory_facts.rollback_from_pair_index(session_id, 12)

    assert result["reinforcements_restored"] == 1
    after = next(f for f in await memory_facts.list_live(session_id) if f["id"] == fid)
    assert after["reinforcements"] == 1
    assert after["last_turn"] == 6

async def test_insert_without_location_stores_none(db_conn):
    fid = await memory_facts.insert({
        "session_id": "sess-loc-2", "char_id": "char-1", "text": "no location given",
        "fact_type": "state", "participants": [], "importance": 3, "valence": 0, "turn": 1,
    }, _fake_vec(), pinned=True)
    reserved = await memory_facts.reserved("sess-loc-2")
    match = next(r for r in reserved if r["id"] == fid)
    assert match["location"] is None
