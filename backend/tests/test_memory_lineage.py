import os

import pytest

from backend.repositories import memory_facts
from backend.routers import chat as chat_router

pytestmark = pytest.mark.asyncio

def _fake_vec():
    return [0.1] * int(os.environ.get("EMBED_DIM", "1024"))

@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(int(os.environ.get("EMBED_DIM", "1024")))

def _draft(session_id, text, turn):
    return {"session_id": session_id, "char_id": "char-1", "text": text,
            "fact_type": "state", "participants": [], "importance": 3,
            "valence": 0, "turn": turn}

async def test_lineage_returns_full_supersede_chain(db_conn):
    sid = "lineage-chain"
    first = await memory_facts.insert(_draft(sid, "she lives in the north", 1), _fake_vec())
    second = await memory_facts.supersede(first, _draft(sid, "she moved south", 2), _fake_vec(), 2)
    third = await memory_facts.supersede(second, _draft(sid, "she moved east", 3), _fake_vec(), 3)
    result = await memory_facts.lineage(sid, [third])
    texts = [entry["text"] for entry in result[third]]
    assert texts == ["she lives in the north", "she moved south"]
    assert result[third][0]["replaced_at_turn"] == 2
    assert result[third][1]["replaced_at_turn"] == 3

async def test_lineage_omits_facts_without_history(db_conn):
    sid = "lineage-none"
    fid = await memory_facts.insert(_draft(sid, "nothing replaced", 1), _fake_vec())
    assert await memory_facts.lineage(sid, [fid]) == {}

async def test_lineage_empty_input_returns_empty(db_conn):
    assert await memory_facts.lineage("lineage-empty", []) == {}

async def test_lineage_is_scoped_to_session(db_conn):
    first = await memory_facts.insert(_draft("lineage-a", "old", 1), _fake_vec())
    new_id = await memory_facts.supersede(first, _draft("lineage-a", "new", 2), _fake_vec(), 2)
    assert await memory_facts.lineage("lineage-b", [new_id]) == {}

async def test_memory_endpoint_reports_lineage_and_reinforcements(db_conn, monkeypatch):
    sid = "lineage-endpoint"
    first = await memory_facts.insert(_draft(sid, "the gate was sealed", 1), _fake_vec())
    live = await memory_facts.supersede(first, _draft(sid, "the gate is open", 2), _fake_vec(), 2)
    plain = await memory_facts.insert(_draft(sid, "he carries a lantern", 2), _fake_vec())
    await memory_facts.reinforce(live, 4)

    async def fake_own_session(session_id, current_user):
        return {"id": session_id}

    async def fake_user_settings(uid):
        return {}

    async def fake_endpoints(*args, **kwargs):
        return {"embed_base": "", "embed_key": ""}

    monkeypatch.setattr(chat_router, "_own_session", fake_own_session)
    monkeypatch.setattr(chat_router.db, "get_user_settings", fake_user_settings)
    monkeypatch.setattr(chat_router, "_endpoints", fake_endpoints)

    res = await chat_router.get_memory(sid, current_user={"id": "u1"})
    items = {item["id"]: item for item in res["items"]}
    assert items[live]["superseded_count"] == 1
    assert items[live]["superseded"][0]["text"] == "the gate was sealed"
    assert items[live]["reinforcements"] == 1
    assert items[live]["last_turn"] == 4
    assert items[plain]["superseded"] == []
    assert items[plain]["superseded_count"] == 0
    assert items[plain]["reinforcements"] == 0
    assert items[plain]["text"] == "he carries a lantern"
