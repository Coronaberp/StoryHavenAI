import os

import pytest

from backend import lore_memory, memory_service
from backend.repositories import lore_secrets, memory_facts, session_lore_state

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "1024"))

@pytest.fixture(autouse=True)
def _tables():
    memory_facts.build_tables(_EMBED_DIM)

@pytest.fixture(autouse=True)
def _stub_embed(monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * _EMBED_DIM
    monkeypatch.setattr("backend.llm.embed", fake_embed)

def _messages(count: int) -> list[dict]:
    msgs = []
    for i in range(count):
        msgs.append({"id": f"u{i}", "role": "user", "content": f"user {i}"})
        msgs.append({"id": f"a{i}", "role": "assistant", "content": f"reply {i}"})
    return msgs

async def _rollback_last(session_id: str, msgs: list[dict], batch_id: str,
                         pair_start: int, pair_end: int):
    await memory_facts.record_batch(session_id, batch_id, pair_start=pair_start,
                                    pair_end=pair_end, turn=pair_end)
    return await memory_service.rollback_discarded_turn(
        session_id, msgs, msgs[-1]["id"])

async def test_rollback_removes_override_applied_by_that_batch(db_conn):
    session_id = "sess-lore-rb-1"
    fact_id = await lore_memory.apply_session_lore_override(
        session_id, "char-1", "lore-1", "The gate is shattered.", batch_id="batch-1")
    assert await session_lore_state.get_state(session_id, "lore-1")
    await _rollback_last(session_id, _messages(3), "batch-1", 0, 3)
    assert await session_lore_state.get_state(session_id, "lore-1") is None
    assert await session_lore_state.get_all_overrides_for_session(session_id) == {}
    assert not await memory_facts.list_live(session_id, 50) or all(
        f["id"] != fact_id for f in await memory_facts.list_live(session_id, 50))

async def test_rollback_restores_the_prior_override(db_conn):
    session_id = "sess-lore-rb-2"
    await lore_memory.apply_session_lore_override(
        session_id, "char-1", "lore-2", "The gate stands.", batch_id="batch-old")
    await memory_facts.record_batch(session_id, "batch-old", pair_start=0, pair_end=2, turn=2)
    await lore_memory.apply_session_lore_override(
        session_id, "char-1", "lore-2", "The gate is shattered.", batch_id="batch-new")
    overrides = await session_lore_state.get_all_overrides_for_session(session_id)
    assert overrides["lore-2"] == "The gate is shattered."
    await _rollback_last(session_id, _messages(4), "batch-new", 2, 4)
    overrides = await session_lore_state.get_all_overrides_for_session(session_id)
    assert overrides["lore-2"] == "The gate stands."
    state = await session_lore_state.get_state(session_id, "lore-2")
    assert state["batch_id"] is None
    assert state["prior_override_content"] is None

async def test_rollback_deletes_secret_reveals_from_that_batch(db_conn):
    session_id = "sess-lore-rb-3"
    await lore_memory.apply_secret_reveal(session_id, "char-1", "secret-1",
                                          "She is the heir.", batch_id="batch-1")
    assert await lore_secrets.revealed_ids(session_id, ["secret-1"]) == {"secret-1"}
    await _rollback_last(session_id, _messages(3), "batch-1", 0, 3)
    assert await lore_secrets.revealed_ids(session_id, ["secret-1"]) == set()

async def test_rollback_keeps_reveals_and_overrides_from_surviving_batches(db_conn):
    session_id = "sess-lore-rb-4"
    await lore_memory.apply_secret_reveal(session_id, "char-1", "secret-keep",
                                          "He owns the mill.", batch_id="batch-keep")
    await lore_memory.apply_session_lore_override(
        session_id, "char-1", "lore-keep", "The mill still turns.", batch_id="batch-keep")
    await memory_facts.record_batch(session_id, "batch-keep", pair_start=0, pair_end=2, turn=2)
    await lore_memory.apply_secret_reveal(session_id, "char-1", "secret-drop",
                                          "She is the heir.", batch_id="batch-drop")
    await _rollback_last(session_id, _messages(4), "batch-drop", 2, 4)
    assert await lore_secrets.revealed_ids(session_id, ["secret-keep"]) == {"secret-keep"}
    assert await lore_secrets.revealed_ids(session_id, ["secret-drop"]) == set()
    overrides = await session_lore_state.get_all_overrides_for_session(session_id)
    assert overrides["lore-keep"] == "The mill still turns."

async def test_manual_override_is_not_rolled_back(db_conn):
    session_id = "sess-lore-rb-5"
    await lore_memory.apply_session_lore_override(
        session_id, "char-1", "lore-manual", "Player set this.")
    await _rollback_last(session_id, _messages(3), "batch-1", 0, 3)
    overrides = await session_lore_state.get_all_overrides_for_session(session_id)
    assert overrides["lore-manual"] == "Player set this."
