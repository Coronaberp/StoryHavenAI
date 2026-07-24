import pytest

from backend import lore_memory
from backend import vectors

pytestmark = pytest.mark.asyncio

def test_lore_candidate_shape_for_keyword_match():
    entry = {"id": "l1", "content": "The Sunken City lies beneath the bay.",
             "category": "Locations", "name": "Sunken City"}
    cand = lore_memory.lore_candidate(entry, current_turn=42, pinned=True)
    assert cand["id"] == "l1"
    assert cand["source"] == "lore"
    assert cand["text"] == "The Sunken City lies beneath the bay."
    assert cand["pinned"] is True
    assert cand["last_turn"] == 42
    assert cand["valid_until_turn"] is None
    assert cand["link_label"] is None

def test_lore_candidate_carries_link_label_and_distance():
    entry = {"id": "l2", "content": "Chancellor Voss leads the council.", "category": "", "name": ""}
    cand = lore_memory.lore_candidate(entry, current_turn=1, distance=0.3, link_label="leads")
    assert cand["distance"] == 0.3
    assert cand["link_label"] == "leads"
    assert cand["pinned"] is False

async def test_fetch_lore_candidates_includes_keyword_matches_as_pinned(db_conn):
    from backend.repositories import lore as lore_repo
    lid = await lore_repo.create("char-lm-1", ["gate"], "The gate is sealed.", always=True, owner_id="user-1")
    entry = await lore_repo.get(lid)
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-lm-1", session_id="sess-lm-1",
        keyword_entries=[entry], query_vec=None,
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8}, current_turn=1)
    ids = [c["id"] for c in candidates]
    assert entry["id"] in ids
    match = next(c for c in candidates if c["id"] == entry["id"])
    assert match["pinned"] is True

async def test_fetch_lore_candidates_expands_one_hop_relationships(db_conn):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_links
    a_id = await lore_repo.create("char-lm-2", ["gov"], "The Government rules the city.", always=True, owner_id="user-1")
    b_id = await lore_repo.create("char-lm-2", [], "Chancellor Voss leads the Government.", always=False, owner_id="user-1")
    a = await lore_repo.get(a_id)
    b = await lore_repo.get(b_id)
    await lore_links.set_link(a["id"], b["id"], "leads")
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-lm-2", session_id="sess-lm-2",
        keyword_entries=[a], query_vec=None,
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8}, current_turn=1)
    ids = [c["id"] for c in candidates]
    assert b["id"] in ids
    expanded = next(c for c in candidates if c["id"] == b["id"])
    assert expanded["link_label"] == "leads"
    assert expanded["pinned"] is False

async def test_fetch_lore_candidates_applies_session_override_content(db_conn):
    from backend.repositories import lore as lore_repo
    from backend.repositories import session_lore_state
    lid = await lore_repo.create("char-lm-3", ["gov"], "The Government rules the city.", always=True, owner_id="user-1")
    entry = await lore_repo.get(lid)
    await session_lore_state.set_override("sess-lm-3", entry["id"], "The Government was overthrown.", "mf-fake")
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-lm-3", session_id="sess-lm-3",
        keyword_entries=[entry], query_vec=None,
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8}, current_turn=1)
    match = next(c for c in candidates if c["id"] == entry["id"])
    assert match["text"] == "The Government was overthrown."

async def test_fetch_lore_candidates_includes_knn_matches_and_dedupes(db_conn):
    from backend.repositories import lore as lore_repo
    await vectors.ensure_indexes(768)
    kw_id = await lore_repo.create("char-lm-4", ["gate"], "The gate is sealed.", always=True, owner_id="user-1")
    knn_id = await lore_repo.create("char-lm-4", [], "A hidden vault below the gate.", always=False, owner_id="user-1")
    kw_entry = await lore_repo.get(kw_id)
    knn_entry = await lore_repo.get(knn_id)
    query_vec = [0.1] * 768
    await vectors.store_lore_vector(knn_entry["id"], "char-lm-4", query_vec)
    await vectors.store_lore_vector(kw_entry["id"], "char-lm-4", query_vec)
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-lm-4", session_id="sess-lm-4",
        keyword_entries=[kw_entry], query_vec=query_vec,
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8}, current_turn=1)
    ids = [c["id"] for c in candidates]
    assert ids.count(kw_entry["id"]) == 1
    assert knn_entry["id"] in ids
    knn_match = next(c for c in candidates if c["id"] == knn_entry["id"])
    assert knn_match["pinned"] is False
    kw_match = next(c for c in candidates if c["id"] == kw_entry["id"])
    assert kw_match["pinned"] is True

async def test_fetch_lore_candidates_knn_pool_not_capped_at_top_k_lore(db_conn):
    from backend.repositories import lore as lore_repo
    await vectors.ensure_indexes(768)
    query_vec = [0.1] * 768
    for i in range(10):
        eid = await lore_repo.create(
            "char-wide-1", [], f"Entry number {i} about the wide pool test.",
            always=False, owner_id="user-1")
        await vectors.store_lore_vector(eid, "char-wide-1", query_vec)
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-wide-1", session_id="sess-wide-1",
        keyword_entries=[], query_vec=query_vec,
        cfg={"top_k_lore": 6, "lore_max_dist": 0.8}, current_turn=1)
    assert len(candidates) > 6

async def test_apply_session_lore_override_creates_pinned_fact_and_state(db_conn, monkeypatch):
    from backend.repositories import session_lore_state
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    fact_id = await lore_memory.apply_session_lore_override(
        "sess-apply-1", "char-apply-1", "lore-apply-1", "The government was overthrown.")
    assert fact_id
    state = await session_lore_state.get_state("sess-apply-1", "lore-apply-1")
    assert state["override_content"] == "The government was overthrown."
    assert state["override_fact_id"] == fact_id

async def test_apply_session_lore_override_updates_existing_override(db_conn, monkeypatch):
    from backend.repositories import session_lore_state
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    first_id = await lore_memory.apply_session_lore_override(
        "sess-apply-2", "char-apply-2", "lore-apply-2", "first version")
    second_id = await lore_memory.apply_session_lore_override(
        "sess-apply-2", "char-apply-2", "lore-apply-2", "second version")
    assert first_id == second_id
    state = await session_lore_state.get_state("sess-apply-2", "lore-apply-2")
    assert state["override_content"] == "second version"

async def test_apply_secret_reveal_marks_revealed_and_inserts_memory_fact(db_conn, monkeypatch):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_secrets
    from backend.repositories import memory_facts

    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)

    lid = await lore_repo.create("char-reveal-1", ["chest"], "A locked chest.", always=True, owner_id="user-1")
    secrets = await lore_secrets.set_secrets(lid, ["The chest holds a cursed ring."])
    secret_id = secrets[0]["id"]

    await lore_memory.apply_secret_reveal("sess-reveal-1", "char-reveal-1", secret_id,
                                          "The chest holds a cursed ring.")

    revealed = await lore_secrets.revealed_ids("sess-reveal-1", [secret_id])
    assert secret_id in revealed
    live = await memory_facts.list_live("sess-reveal-1")
    assert any(f["text"] == "The chest holds a cursed ring." for f in live)

async def test_apply_secret_reveal_is_idempotent(db_conn, monkeypatch):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_secrets

    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)

    lid = await lore_repo.create("char-reveal-2", ["door"], "A sealed door.", always=True, owner_id="user-1")
    secrets = await lore_secrets.set_secrets(lid, ["Behind the door is a shrine."])
    secret_id = secrets[0]["id"]

    await lore_memory.apply_secret_reveal("sess-reveal-2", "char-reveal-2", secret_id,
                                          "Behind the door is a shrine.")
    await lore_memory.apply_secret_reveal("sess-reveal-2", "char-reveal-2", secret_id,
                                          "Behind the door is a shrine.")

    revealed = await lore_secrets.revealed_ids("sess-reveal-2", [secret_id])
    assert secret_id in revealed

async def test_detect_and_reveal_secrets_no_drafts_returns_zero(db_conn):
    stats = await lore_memory.detect_and_reveal_secrets(
        "sess-reveal-3", "char-reveal-3", [], "test-model", None, None, None, None)
    assert stats == {"checked": 0, "revealed": 0}

async def test_fetch_lore_candidates_expands_chunked_keyword_entry(db_conn, monkeypatch):
    from backend import lore_memory
    from backend.repositories import lore_chunks as lore_chunks_repo
    await lore_chunks_repo.set_chunks("l-fetch-1", ["first chunk text", "second chunk text"])
    entry = {"id": "l-fetch-1", "content": "first chunk text\n\nsecond chunk text",
             "always": True, "pinned": False}
    candidates = await lore_memory.fetch_lore_candidates(
        "char-1", "sess-1", [entry], None, {}, current_turn=1)
    chunk_texts = {c["text"] for c in candidates}
    assert "first chunk text" in chunk_texts
    assert "second chunk text" in chunk_texts
    assert all(c["pinned"] for c in candidates)

async def test_fetch_lore_candidates_single_candidate_for_unchunked_entry(db_conn):
    from backend import lore_memory
    entry = {"id": "l-fetch-2", "content": "a short entry", "always": True, "pinned": False}
    candidates = await lore_memory.fetch_lore_candidates(
        "char-1", "sess-2", [entry], None, {}, current_turn=1)
    assert len(candidates) == 1
    assert candidates[0]["text"] == "a short entry"

async def test_fetch_lore_candidates_override_bypasses_chunking(db_conn, monkeypatch):
    from backend import lore_memory
    from backend.repositories import lore_chunks as lore_chunks_repo
    from backend.repositories import session_lore_state
    await lore_chunks_repo.set_chunks("l-fetch-3", ["chunk a", "chunk b"])
    await session_lore_state.set_override("sess-3", "l-fetch-3", "the overridden content", "mf-fake")
    entry = {"id": "l-fetch-3", "content": "chunk a\n\nchunk b", "always": True, "pinned": False}
    candidates = await lore_memory.fetch_lore_candidates(
        "char-1", "sess-3", [entry], None, {}, current_turn=1)
    assert len(candidates) == 1
    assert candidates[0]["text"] == "the overridden content"

async def test_fetch_lore_candidates_caps_pinned_at_max_and_demotes_overflow(db_conn):
    from backend import lore_memory
    entries = [{"id": f"l-fetch-cap-{i}", "content": f"fact number {i}",
               "always": True, "pinned": False, "importance": i}
              for i in range(lore_memory.MAX_PINNED_LORE_CHUNKS + 3)]
    candidates = await lore_memory.fetch_lore_candidates(
        "char-1", "sess-4", entries, None, {}, current_turn=1)
    pinned = [c for c in candidates if c["pinned"]]
    demoted = [c for c in candidates if not c["pinned"]]
    assert len(pinned) == lore_memory.MAX_PINNED_LORE_CHUNKS
    assert len(demoted) == 3
