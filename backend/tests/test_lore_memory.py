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
    await vectors.ensure_indexes(1024)
    kw_id = await lore_repo.create("char-lm-4", ["gate"], "The gate is sealed.", always=True, owner_id="user-1")
    knn_id = await lore_repo.create("char-lm-4", [], "A hidden vault below the gate.", always=False, owner_id="user-1")
    kw_entry = await lore_repo.get(kw_id)
    knn_entry = await lore_repo.get(knn_id)
    query_vec = [0.1] * 1024
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
    await vectors.ensure_indexes(1024)
    query_vec = [0.1] * 1024
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
        return [0.1] * 1024
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
        return [0.1] * 1024
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
        return [0.1] * 1024
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
        return [0.1] * 1024
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

async def test_ensure_secrets_indexed_embeds_secrets_for_vector_search(db_conn, monkeypatch):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_secrets

    async def fake_extract(content, chat_model, chat_base=None, chat_key=None):
        return ["The vault is cursed."]
    monkeypatch.setattr("backend.ai_helpers.extract_lore_secrets", fake_extract)

    async def fake_embed(*args, **kwargs):
        return [0.2] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)

    lid = await lore_repo.create("char-ensure-1", ["vault"], "A locked vault.", always=True,
                                 hidden=True, owner_id="user-1")
    entry = await lore_repo.get(lid)

    secrets = await lore_memory.ensure_secrets_indexed(entry, "test-model")
    assert len(secrets) == 1
    stored = await lore_secrets.secrets_for(lid)
    assert stored[0]["text"] == "The vault is cursed."

    hits = await vectors.search_secret_ids("char-ensure-1", [0.2] * 1024, 3, 0.80)
    assert any(h["secret_id"] == secrets[0]["id"] for h in hits)

async def test_ensure_secrets_indexed_does_not_re_extract_if_already_present(db_conn, monkeypatch):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_secrets

    calls = []
    async def fake_extract(content, chat_model, chat_base=None, chat_key=None):
        calls.append(content)
        return ["Fresh secret."]
    monkeypatch.setattr("backend.ai_helpers.extract_lore_secrets", fake_extract)
    async def fake_embed(*args, **kwargs):
        return [0.4] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)

    lid = await lore_repo.create("char-ensure-2", ["crypt"], "A sealed crypt.", always=True,
                                 hidden=True, owner_id="user-1")
    await lore_secrets.set_secrets(lid, ["Existing secret."])
    entry = await lore_repo.get(lid)

    secrets = await lore_memory.ensure_secrets_indexed(entry, "test-model")
    assert secrets[0]["text"] == "Existing secret."
    assert calls == []

async def test_reindex_secrets_replaces_old_secrets_and_vectors(db_conn, monkeypatch):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_secrets

    async def fake_extract(content, chat_model, chat_base=None, chat_key=None):
        return ["New secret about the tomb."]
    monkeypatch.setattr("backend.ai_helpers.extract_lore_secrets", fake_extract)

    async def fake_embed(*args, **kwargs):
        return [0.3] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)

    lid = await lore_repo.create("char-reindex-1", ["tomb"], "An old tomb.", always=True,
                                 hidden=True, owner_id="user-1")
    old_secrets = await lore_secrets.set_secrets(lid, ["Stale secret."])
    old_id = old_secrets[0]["id"]
    entry = await lore_repo.get(lid)

    new_secrets = await lore_memory.reindex_secrets(entry, "test-model")
    assert new_secrets[0]["text"] == "New secret about the tomb."
    assert new_secrets[0]["id"] != old_id

    hits = await vectors.search_secret_ids("char-reindex-1", [0.3] * 1024, 3, 0.80)
    ids_found = {h["secret_id"] for h in hits}
    assert old_id not in ids_found
    assert new_secrets[0]["id"] in ids_found

async def test_detect_and_reveal_secrets_finds_secret_via_its_own_embedding(db_conn, monkeypatch):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_secrets
    from backend.memory_extraction import FactDraft, SecretRevealDecision

    lid = await lore_repo.create("char-detect-1", ["shrine"], "An abandoned shrine, nothing more.",
                                 always=True, hidden=True, owner_id="user-1")
    secrets = await lore_secrets.set_secrets(
        lid, ["A priest was murdered here a century ago."])
    secret_id = secrets[0]["id"]

    lore_vec = [1.0] + [0.0] * 1023
    secret_vec = [0.0, 1.0] + [0.0] * 1022
    await vectors.store_lore_vector(lid, "char-detect-1", lore_vec)
    await vectors.store_secret_vector(secret_id, lid, "char-detect-1", secret_vec)

    async def fake_embed(text, *args, **kwargs):
        return secret_vec
    monkeypatch.setattr("backend.llm.embed", fake_embed)

    async def fake_detect(drafts, secret_neighbors, model, chat_base, chat_key):
        assert secret_neighbors[0]
        return [SecretRevealDecision(index=0, secret_id=secret_id)]
    monkeypatch.setattr("backend.lore_memory.run_secret_reveal_detection", fake_detect)

    draft = FactDraft(text="Someone found bones beneath the shrine's floor.", fact_type="event",
                      participants=[], importance=3, valence=0)
    stats = await lore_memory.detect_and_reveal_secrets(
        "sess-detect-1", "char-detect-1", [draft], "test-model", None, None, None, None)

    assert stats["revealed"] == 1
    revealed = await lore_secrets.revealed_ids("sess-detect-1", [secret_id])
    assert secret_id in revealed

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

def test_dedupe_candidates_keeps_one_entry_per_id_and_prefers_pinned():
    duplicated = [
        {"id": "l1#0", "pinned": False, "text": "scored copy"},
        {"id": "l1#0", "pinned": True, "text": "pinned copy"},
        {"id": "l2#0", "pinned": False, "text": "only copy"},
    ]
    result = lore_memory._dedupe_candidates(duplicated)
    assert len(result) == 2
    by_id = {c["id"]: c for c in result}
    assert by_id["l1#0"]["pinned"] is True
    assert by_id["l2#0"]["text"] == "only copy"

async def test_link_expanded_neighbour_is_chunked_not_whole_entry(db_conn):
    from backend.repositories import lore as lore_repo
    from backend.repositories import lore_chunks
    from backend.repositories import lore_links
    long_content = "\n\n".join(f"Paragraph {i} about the sealed vault beneath the city." * 12
                               for i in range(8))
    a_id = await lore_repo.create("char-lm-9", ["gate"], "The gate is sealed.", always=True, owner_id="user-1")
    b_id = await lore_repo.create("char-lm-9", [], long_content, always=False, owner_id="user-1")
    a = await lore_repo.get(a_id)
    b = await lore_repo.get(b_id)
    await lore_links.set_link(a["id"], b["id"], "leads")
    await lore_chunks.insert_chunk(b["id"], 0, "First half of the vault notes.")
    await lore_chunks.insert_chunk(b["id"], 1, "Second half of the vault notes.")
    candidates = await lore_memory.fetch_lore_candidates(
        char_id="char-lm-9", session_id="sess-lm-9",
        keyword_entries=[a], query_vec=None,
        cfg={"top_k_lore": 4, "lore_max_dist": 0.8}, current_turn=1)
    neighbour = [c for c in candidates if c["id"].startswith(b["id"])]
    assert [c["id"] for c in neighbour] == [f"{b['id']}#0", f"{b['id']}#1"]
    assert all(c["link_label"] == "leads" for c in neighbour)
    assert all(len(c["text"]) < len(long_content) for c in neighbour)
