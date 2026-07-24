import asyncio
import os

import pytest

from backend import memory_service
from backend import memory_ranking
from backend.repositories import memory_facts

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "1024"))

@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(_EMBED_DIM)

async def test_retrieve_block_returns_empty_for_blank_query(db_conn):
    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-rb-1", "known_names": "[]"},
        char={"id": "char-rb-1", "name": "Test"},
        user_name="Player", query="", msgs=[], cfg={}, keyword_lore_entries=[])
    assert block == ""
    assert used == []
    assert lore_lines == []
    assert mem_lines == []

async def test_retrieve_block_includes_keyword_lore_in_meta_lines(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    entry = {"id": "l-rb-1", "content": "The gate is sealed.", "category": "", "name": ""}
    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-rb-2", "known_names": "[]"},
        char={"id": "char-rb-2", "name": "Test"},
        user_name="Player", query="tell me about the gate",
        msgs=[{"role": "user", "content": "tell me about the gate"}],
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8, "memory_v2_budget_tokens": 600},
        keyword_lore_entries=[entry])
    assert any("The gate is sealed." in line for line in lore_lines)
    assert "## Established world facts" in block

async def test_extract_batch_calls_lore_update_detection(db_conn, monkeypatch):
    calls = []
    async def fake_detect(session_id, char_id, drafts, *args, **kwargs):
        calls.append((session_id, char_id, drafts))
        return {"checked": len(drafts), "applied": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_apply_lore_updates", fake_detect)
    async def fake_run_extract(*args, **kwargs):
        from backend.memory_extraction import FactDraft, CharStateDraft
        return [FactDraft(text="a fact", fact_type="event", participants=[],
                          importance=3, valence=0)], CharStateDraft()
    monkeypatch.setattr("backend.memory_service.run_extract", fake_run_extract)
    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    async def fake_reconcile(*args, **kwargs):
        from backend.memory_extraction import ReconcileDecision
        return [ReconcileDecision(index=0, action="add")]
    monkeypatch.setattr("backend.memory_service.run_reconcile", fake_reconcile)

    stats = await memory_service.extract_batch(
        "sess-eb-1", "char-eb-1", "Char", "Player", [({"content": "hi", "role": "user"},
        {"content": "hello", "role": "assistant", "mood": None})], turn=5,
        language="English", model="test-model", prev_session={"known_names": "[]"})
    assert len(calls) == 1
    assert stats["lore_updates_applied"] == 0

async def test_extract_batch_tags_new_fact_with_resolved_location(db_conn, monkeypatch):
    async def fake_run_extract(*args, **kwargs):
        from backend.memory_extraction import FactDraft, CharStateDraft
        return ([FactDraft(text="found a hidden door", fact_type="state",
                           participants=[], importance=3, valence=0)],
                CharStateDraft(doing="", location="the abandoned mill", npcs=[]))
    monkeypatch.setattr("backend.memory_service.run_extract", fake_run_extract)
    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    async def fake_reconcile(*args, **kwargs):
        from backend.memory_extraction import ReconcileDecision
        return [ReconcileDecision(index=0, action="add")]
    monkeypatch.setattr("backend.memory_service.run_reconcile", fake_reconcile)
    async def fake_detect(*args, **kwargs):
        return {"checked": 0, "applied": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_apply_lore_updates", fake_detect)
    async def fake_reveal(*args, **kwargs):
        return {"checked": 0, "revealed": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_reveal_secrets", fake_reveal)

    await memory_service.extract_batch(
        "sess-loc-eb-1", "char-loc-eb-1", "Char", "Player",
        [({"content": "hi", "role": "user"}, {"content": "hello", "role": "assistant", "mood": None})],
        turn=5, language="English", model="test-model",
        prev_session={"known_names": "[]", "char_location": "the tavern"})

    live = await memory_facts.list_live("sess-loc-eb-1")
    assert live[0]["location"] == "the abandoned mill"

async def test_retrieve_block_demotes_active_fact_from_different_location(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    await memory_facts.insert({
        "session_id": "sess-loc-rb-1", "char_id": "char-loc-rb-1",
        "text": "the bridge is guarded", "fact_type": "state",
        "participants": [], "importance": memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
        "valence": 0, "turn": 1, "location": "the mountain pass",
    }, [0.1] * 1024)

    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-loc-rb-1", "known_names": "[]", "char_location": "the tavern"},
        char={"id": "char-loc-rb-1", "name": "Test"},
        user_name="Player", query="what is happening at the tavern",
        msgs=[{"role": "user", "content": "what is happening at the tavern"}] * 10,
        cfg={"memory_v2_budget_tokens": 1000}, keyword_lore_entries=[])
    assert "## Ongoing & pinned" not in block
    assert "the bridge is guarded" in block

async def test_retrieve_block_keeps_active_fact_from_matching_location(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    await memory_facts.insert({
        "session_id": "sess-loc-rb-2", "char_id": "char-loc-rb-2",
        "text": "the tavern keeper is nervous", "fact_type": "state",
        "participants": [], "importance": memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
        "valence": 0, "turn": 1, "location": "the tavern",
    }, [0.1] * 1024)

    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-loc-rb-2", "known_names": "[]", "char_location": "the tavern"},
        char={"id": "char-loc-rb-2", "name": "Test"},
        user_name="Player", query="what is happening at the tavern",
        msgs=[{"role": "user", "content": "what is happening at the tavern"}],
        cfg={"memory_v2_budget_tokens": 1000}, keyword_lore_entries=[])
    assert "the tavern keeper is nervous" in block

async def test_retrieve_block_caps_active_facts_at_max_reserved(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    for index in range(memory_ranking.MAX_ACTIVE_RESERVED_FACTS + 3):
        await memory_facts.insert({
            "session_id": "sess-loc-rb-3", "char_id": "char-loc-rb-3",
            "text": f"ongoing detail number {index}", "fact_type": "state",
            "participants": [], "importance": memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
            "valence": 0, "turn": index + 1, "location": "the tavern",
        }, [0.1] * 1024)

    later_turn_message_count = memory_ranking.MAX_ACTIVE_RESERVED_FACTS + 3 + 5
    block, used, lore_lines, mem_lines = await memory_service.retrieve_block(
        session={"id": "sess-loc-rb-3", "known_names": "[]", "char_location": "the tavern"},
        char={"id": "char-loc-rb-3", "name": "Test"},
        user_name="Player", query="what is happening at the tavern",
        msgs=[{"role": "user", "content": "what is happening at the tavern"}] * later_turn_message_count,
        cfg={"memory_v2_budget_tokens": 1000}, keyword_lore_entries=[])
    if "## Ongoing & pinned" in block:
        active_section = block.split("## Ongoing & pinned")[1].split("## Recalled from earlier")[0]
    else:
        active_section = ""
    reserved_count = active_section.count("ongoing detail number")
    assert reserved_count <= memory_ranking.MAX_ACTIVE_RESERVED_FACTS

def _msg(mid, role, content, char_id=None):
    return {"id": mid, "role": role, "content": content, "mood": None, "char_id": char_id}

def _patch_extraction_pipeline(monkeypatch, recorded_turns):
    async def fake_run_extract(*args, **kwargs):
        from backend.memory_extraction import FactDraft, CharStateDraft
        return [], CharStateDraft()
    monkeypatch.setattr("backend.memory_service.run_extract", fake_run_extract)
    async def fake_reconcile(*args, **kwargs):
        return []
    monkeypatch.setattr("backend.memory_service.run_reconcile", fake_reconcile)
    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    async def fake_detect_lore(*args, **kwargs):
        return {"checked": 0, "applied": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_apply_lore_updates", fake_detect_lore)
    async def fake_detect_secrets(*args, **kwargs):
        return {"checked": 0, "revealed": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_reveal_secrets", fake_detect_secrets)
    original_extract_batch = memory_service.extract_batch
    async def spying_extract_batch(sid, char_id, char_name, user_name, batch, turn, *args, **kwargs):
        recorded_turns.append(turn)
        return await original_extract_batch(sid, char_id, char_name, user_name, batch, turn,
                                            *args, **kwargs)
    monkeypatch.setattr(memory_service, "extract_batch", spying_extract_batch)

async def test_maybe_extract_single_character_turn_matches_user_message_count(db_conn, monkeypatch):
    recorded_turns = []
    _patch_extraction_pipeline(monkeypatch, recorded_turns)
    msgs = []
    for i in range(1, 7):
        msgs.append(_msg(f"u{i}", "user", f"user message {i}"))
        msgs.append(_msg(f"a{i}", "assistant", f"assistant reply {i}"))
    async def fake_list_messages(sid):
        return msgs
    monkeypatch.setattr(memory_service.chat_sessions, "list_messages", fake_list_messages)

    await memory_service.maybe_extract(
        {"id": "sess-turn-single-1", "known_names": "[]"}, {"id": "char-turn-1", "name": "Char"},
        "Player", "English", "test-model")

    assert recorded_turns == [5]

async def test_maybe_extract_catches_up_partial_batch_in_long_session(db_conn, monkeypatch):
    recorded_turns = []
    _patch_extraction_pipeline(monkeypatch, recorded_turns)
    msgs = []
    for i in range(1, 19):
        msgs.append(_msg(f"u{i}", "user", f"user message {i}"))
        msgs.append(_msg(f"a{i}", "assistant", f"assistant reply {i}"))
    async def fake_list_messages(sid):
        return msgs
    monkeypatch.setattr(memory_service.chat_sessions, "list_messages", fake_list_messages)
    sid = "sess-catchup-long"

    await memory_service.maybe_extract(
        {"id": sid, "known_names": "[]"}, {"id": "char-catchup-1", "name": "Char"},
        "Player", "English", "test-model")

    assert recorded_turns == [5, 10, 15, 17]
    assert await memory_service.memory_facts.get_cursor(sid) == 17

async def test_maybe_extract_no_catch_up_in_short_session(db_conn, monkeypatch):
    recorded_turns = []
    _patch_extraction_pipeline(monkeypatch, recorded_turns)
    msgs = []
    for i in range(1, 9):
        msgs.append(_msg(f"u{i}", "user", f"user message {i}"))
        msgs.append(_msg(f"a{i}", "assistant", f"assistant reply {i}"))
    async def fake_list_messages(sid):
        return msgs
    monkeypatch.setattr(memory_service.chat_sessions, "list_messages", fake_list_messages)
    sid = "sess-catchup-short"

    await memory_service.maybe_extract(
        {"id": sid, "known_names": "[]"}, {"id": "char-catchup-2", "name": "Char"},
        "Player", "English", "test-model")

    assert recorded_turns == [5]
    assert await memory_service.memory_facts.get_cursor(sid) == 5

async def test_maybe_extract_group_turn_matches_distinct_user_message_count(db_conn, monkeypatch):
    recorded_turns = []
    _patch_extraction_pipeline(monkeypatch, recorded_turns)
    msgs = [
        _msg("u1", "user", "hello everyone"),
        _msg("a1a", "assistant", "reply from A", char_id="charA"),
        _msg("a1b", "assistant", "reply from B", char_id="charB"),
        _msg("u2", "user", "second message"),
        _msg("a2a", "assistant", "reply from A", char_id="charA"),
        _msg("a2b", "assistant", "reply from B", char_id="charB"),
        _msg("u3", "user", "third message"),
        _msg("a3a", "assistant", "reply from A", char_id="charA"),
        _msg("a3b", "assistant", "reply from B", char_id="charB"),
    ]
    async def fake_list_messages(sid):
        return msgs
    monkeypatch.setattr(memory_service.chat_sessions, "list_messages", fake_list_messages)

    await memory_service.maybe_extract(
        {"id": "sess-turn-group-1", "known_names": "[]"}, {"id": "char-turn-2", "name": "Char"},
        "Player", "English", "test-model", names_by_id={"charA": "A", "charB": "B"})

    assert recorded_turns == [3]
    assert recorded_turns != [5]

def _patch_extraction_pipeline_with_fact(monkeypatch):
    async def fake_run_extract(*args, **kwargs):
        from backend.memory_extraction import FactDraft, CharStateDraft
        return ([FactDraft(text="a fact from this batch", fact_type="event", participants=[],
                           importance=3, valence=0)], CharStateDraft())
    monkeypatch.setattr("backend.memory_service.run_extract", fake_run_extract)
    async def fake_reconcile(*args, **kwargs):
        from backend.memory_extraction import ReconcileDecision
        return [ReconcileDecision(index=0, action="add")]
    monkeypatch.setattr("backend.memory_service.run_reconcile", fake_reconcile)
    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    async def fake_detect_lore(*args, **kwargs):
        return {"checked": 0, "applied": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_apply_lore_updates", fake_detect_lore)
    async def fake_detect_secrets(*args, **kwargs):
        return {"checked": 0, "revealed": 0}
    monkeypatch.setattr("backend.lore_memory.detect_and_reveal_secrets", fake_detect_secrets)

async def test_rollback_discarded_turn_removes_facts_and_allows_reextraction(db_conn, monkeypatch):
    _patch_extraction_pipeline_with_fact(monkeypatch)
    session_id = "sess-rollback-service-1"
    msgs = []
    for i in range(1, 7):
        msgs.append(_msg(f"u{i}", "user", f"user message {i}"))
        msgs.append(_msg(f"a{i}", "assistant", f"assistant reply {i}"))
    async def fake_list_messages(sid):
        return msgs
    monkeypatch.setattr(memory_service.chat_sessions, "list_messages", fake_list_messages)

    await memory_service.maybe_extract(
        {"id": session_id, "known_names": "[]"}, {"id": "char-rb-1", "name": "Char"},
        "Player", "English", "test-model")

    live_before = await memory_facts.list_live(session_id)
    assert len(live_before) == 1
    assert await memory_facts.get_cursor(session_id) == 5

    result = await memory_service.rollback_discarded_turn(session_id, msgs, "a3")
    assert result["batches_rolled_back"] == 1
    assert result["facts_deleted"] == 1
    live_after_rollback = await memory_facts.list_live(session_id)
    assert live_after_rollback == []
    assert await memory_facts.get_cursor(session_id) == 0

    await memory_service.maybe_extract(
        {"id": session_id, "known_names": "[]"}, {"id": "char-rb-1", "name": "Char"},
        "Player", "English", "test-model")

    live_final = await memory_facts.list_live(session_id)
    assert len(live_final) == 1
    assert await memory_facts.get_cursor(session_id) == 5

async def test_rollback_discarded_turn_is_noop_for_unextracted_message(db_conn, monkeypatch):
    _patch_extraction_pipeline_with_fact(monkeypatch)
    session_id = "sess-rollback-service-2"
    msgs = []
    for i in range(1, 7):
        msgs.append(_msg(f"u{i}", "user", f"user message {i}"))
        msgs.append(_msg(f"a{i}", "assistant", f"assistant reply {i}"))
    async def fake_list_messages(sid):
        return msgs
    monkeypatch.setattr(memory_service.chat_sessions, "list_messages", fake_list_messages)

    await memory_service.maybe_extract(
        {"id": session_id, "known_names": "[]"}, {"id": "char-rb-2", "name": "Char"},
        "Player", "English", "test-model")

    result = await memory_service.rollback_discarded_turn(session_id, msgs, "a6")
    assert result["batches_rolled_back"] == 0
    live = await memory_facts.list_live(session_id)
    assert len(live) == 1
    assert await memory_facts.get_cursor(session_id) == 5

async def test_rollback_discarded_turn_returns_none_for_unknown_message(db_conn, monkeypatch):
    session_id = "sess-rollback-service-3"
    msgs = [_msg("u1", "user", "hi"), _msg("a1", "assistant", "hello")]
    result = await memory_service.rollback_discarded_turn(session_id, msgs, "does-not-exist")
    assert result is None

def test_user_turn_ordinals_counts_distinct_user_messages():
    msgs = [
        _msg("u1", "user", "hi"),
        _msg("a1a", "assistant", "reply"),
        _msg("a1b", "assistant", "reply2"),
        _msg("u2", "user", "hi again"),
        _msg("a2a", "assistant", "reply3"),
    ]
    ordinals = memory_service.user_turn_ordinals(msgs)
    assert ordinals == {"u1": 1, "u2": 2}

def test_present_participants_multiple_users():
    result = memory_service.present_participants("Narrator", ["Mira", "Torvald"], [], "Mira and Torvald enter the archive.")
    assert result == ["Mira", "Torvald", "Narrator"]

def test_present_participants_single_user_unchanged():
    result = memory_service.present_participants("Narrator", ["You"], [], "You enter the archive.")
    assert result == ["You", "Narrator"]

def test_transcript_labels_solo_sender_unchanged():
    batch = [
        ({"content": "I open the door."}, {"content": "It creaks open.", "char_id": None}),
    ]
    out = memory_service._transcript(batch, "Narrator", "You")
    assert out == "You: I open the door.\nNarrator: It creaks open."

def test_transcript_labels_each_sender_by_id():
    batch = [
        ({"content": "I open the door.", "sender_user_id": "user-a"},
         {"content": "It creaks open.", "char_id": None}),
        ({"content": "I keep watch.", "sender_user_id": "user-b"},
         {"content": "Nothing stirs.", "char_id": None}),
    ]
    out = memory_service._transcript(batch, "Narrator", "You", user_names_by_sender_id={"user-a": "Mira", "user-b": "Torvald"})
    assert out == (
        "Mira: I open the door.\n"
        "Narrator: It creaks open.\n"
        "Torvald: I keep watch.\n"
        "Narrator: Nothing stirs."
    )

def test_transcript_falls_back_to_user_name_for_unknown_sender():
    batch = [
        ({"content": "I open the door.", "sender_user_id": "user-unknown"},
         {"content": "It creaks open.", "char_id": None}),
    ]
    out = memory_service._transcript(batch, "Narrator", "You", user_names_by_sender_id={"user-a": "Mira"})
    assert out == "You: I open the door.\nNarrator: It creaks open."

async def test_concurrent_maybe_extract_processes_batch_once(db_conn, monkeypatch):
    recorded_turns = []
    _patch_extraction_pipeline(monkeypatch, recorded_turns)
    slow_original = memory_service.extract_batch
    async def slow_extract_batch(*args, **kwargs):
        await asyncio.sleep(0.05)
        return await slow_original(*args, **kwargs)
    monkeypatch.setattr(memory_service, "extract_batch", slow_extract_batch)
    msgs = []
    for i in range(1, 7):
        msgs.append(_msg(f"u{i}", "user", f"user message {i}"))
        msgs.append(_msg(f"a{i}", "assistant", f"assistant reply {i}"))
    async def fake_list_messages(sid):
        return msgs
    monkeypatch.setattr(memory_service.chat_sessions, "list_messages", fake_list_messages)
    session = {"id": "sess-concurrent-1", "known_names": "[]"}
    char = {"id": "char-concurrent-1", "name": "Char"}
    await asyncio.gather(
        memory_service.maybe_extract(session, char, "Player", "English", "test-model"),
        memory_service.maybe_extract(session, char, "Player", "English", "test-model"))
    cursor = await memory_service.memory_facts.get_cursor("sess-concurrent-1")
    assert cursor == 5
    assert recorded_turns == [5]
