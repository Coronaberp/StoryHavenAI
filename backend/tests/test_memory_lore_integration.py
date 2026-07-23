import pytest

pytestmark = pytest.mark.asyncio


async def test_oversized_always_entry_actually_reaches_the_rendered_block(db_conn, monkeypatch):
    from backend.retrieval import index_lore, retrieve
    from backend import lore_memory, memory_block, vectors
    from backend.repositories import lore

    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    await vectors.ensure_indexes(768)

    char_id = "char-integ-1"
    paragraph = ("The lost kingdom of Aurelia fell after a century of war. " * 20).strip()
    content = "\n\n".join([paragraph] * 8)
    lid = await lore.create(char_id, ["aurelia"], content, True)
    await index_lore(lid, char_id, content, "Aurelia", "")

    keyword_entries, _ = await retrieve(char_id, "sess-integ-1", "aurelia", "tell me about aurelia")
    assert any(e["id"] == lid for e in keyword_entries)

    candidates = await lore_memory.fetch_lore_candidates(
        char_id, "sess-integ-1", keyword_entries, None, {}, current_turn=1)
    pinned = [c for c in candidates if c["pinned"]]
    assert len(pinned) > 1
    assert any(lid in c["id"] for c in pinned)
    assert any("#" in c["id"] for c in pinned)

    block, used_ids, dropped_ids = memory_block.build_block(pinned, [], [], budget_tokens=20000)
    assert "Aurelia" in block or "kingdom" in block.lower()


async def test_oversized_entry_chunks_are_capped_and_demoted_not_dropped(db_conn, monkeypatch):
    from backend.retrieval import index_lore, retrieve
    from backend import lore_memory, vectors
    from backend.repositories import lore

    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    await vectors.ensure_indexes(768)

    char_id = "char-integ-4"
    paragraphs = [
        (f"Paragraph {i} recounts the endless annals of the Sunken Archive, "
         "detailing the scribes, wars, and treaties that filled its shelves. " * 12).strip()
        for i in range(20)
    ]
    content = "\n\n".join(paragraphs)
    lid = await lore.create(char_id, ["archive"], content, True)
    await index_lore(lid, char_id, content, "Sunken Archive", "")

    keyword_entries, _ = await retrieve(char_id, "sess-integ-4", "archive", "tell me about the archive")
    assert any(e["id"] == lid for e in keyword_entries)

    candidates = await lore_memory.fetch_lore_candidates(
        char_id, "sess-integ-4", keyword_entries, None, {}, current_turn=1)
    entry_candidates = [c for c in candidates if c["id"].split("#")[0] == lid]
    pinned_from_entry = [c for c in entry_candidates if c["pinned"]]
    demoted_from_entry = [c for c in entry_candidates if not c["pinned"]]

    assert len(pinned_from_entry) == lore_memory.MAX_PINNED_LORE_CHUNKS
    assert len(demoted_from_entry) > 0
    assert len(entry_candidates) > lore_memory.MAX_PINNED_LORE_CHUNKS


async def test_semantic_knn_chunk_path_resolves_real_chunk_content(db_conn, monkeypatch):
    from backend.retrieval import index_lore
    from backend import lore_memory, vectors
    from backend.repositories import lore

    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    await vectors.ensure_indexes(768)

    char_id = "char-integ-5"
    paragraph = ("The Iron Concord bound the northern clans after decades of raiding. " * 20).strip()
    content = "\n\n".join([paragraph] * 8)
    lid = await lore.create(char_id, ["concord"], content, False)
    await index_lore(lid, char_id, content, "Iron Concord", "")

    query_vec = [0.1] * 768
    candidates = await lore_memory.fetch_lore_candidates(
        char_id, "sess-integ-5", [], query_vec, {}, current_turn=1)

    assert candidates
    assert any(c["id"].split("#")[0] == lid for c in candidates)
    from backend.repositories import lore_chunks
    chunks = await lore_chunks.chunks_for(lid)
    chunk_texts = {c["content"] for c in chunks}
    assert any(c["text"] in chunk_texts for c in candidates if c["id"].split("#")[0] == lid)


async def test_require_and_exclude_keys_actually_gate_retrieval_end_to_end(db_conn):
    from backend.retrieval import retrieve
    from backend.repositories import lore

    char_id = "char-integ-2"
    lid = await lore.create(char_id, ["dragon"], "The dragon guards the cave treasure.",
                                 False, require_keys=["cave"], exclude_keys=["slain"])

    matched_no_cave, _ = await retrieve(char_id, "sess-integ-2a", "dragon", "a dragon appeared")
    assert not any(e["id"] == lid for e in matched_no_cave)

    matched_with_cave, _ = await retrieve(char_id, "sess-integ-2b", "dragon cave", "a dragon in the cave")
    assert any(e["id"] == lid for e in matched_with_cave)

    matched_slain, _ = await retrieve(char_id, "sess-integ-2c", "dragon cave slain",
                                      "a dragon in the cave was slain")
    assert not any(e["id"] == lid for e in matched_slain)


async def test_pinned_lore_cap_and_demotion_survive_the_full_pipeline(db_conn):
    from backend import lore_memory, memory_ranking

    char_id = "char-integ-3"
    entries = [{"id": f"l-integ-3-{i}", "content": f"world fact number {i}",
               "always": True, "pinned": False, "importance": i}
              for i in range(lore_memory.MAX_PINNED_LORE_CHUNKS + 5)]
    candidates = await lore_memory.fetch_lore_candidates(
        char_id, "sess-integ-3", entries, None, {}, current_turn=1)
    pinned = [c for c in candidates if c["pinned"]]
    scored_pool = [c for c in candidates if not c["pinned"]]
    assert len(pinned) == lore_memory.MAX_PINNED_LORE_CHUNKS
    assert len(scored_pool) == 5
    ranked = memory_ranking.rank(scored_pool, present=[], current_turn=1)
    assert isinstance(ranked, list)
