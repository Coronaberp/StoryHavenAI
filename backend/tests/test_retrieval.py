from backend.retrieval import chunk_lore_content, LORE_CHUNK_THRESHOLD_TOKENS


def test_short_content_is_a_single_chunk():
    content = "A short lore entry about a tavern."
    assert chunk_lore_content(content) == [content]


def test_content_exactly_at_threshold_is_a_single_chunk():
    content = "a" * ((LORE_CHUNK_THRESHOLD_TOKENS - 1) * 4)
    chunks = chunk_lore_content(content)
    assert len(chunks) == 1


def test_long_content_splits_into_multiple_chunks():
    paragraph = ("This is a sentence about the ancient kingdom and its long history. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    chunks = chunk_lore_content(content)
    assert len(chunks) > 1


def test_split_preserves_all_content_no_loss():
    paragraph = "Sentence one here. Sentence two here. Sentence three here. " * 15
    content = "\n\n".join([paragraph.strip()] * 5)
    chunks = chunk_lore_content(content)
    rejoined_words = " ".join(chunks).split()
    original_words = content.split()
    assert rejoined_words == original_words


def test_single_oversized_paragraph_falls_back_to_sentence_split():
    huge_paragraph = "This is one single sentence about the kingdom. " * 60
    chunks = chunk_lore_content(huge_paragraph.strip())
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.strip().endswith(".")


def test_single_oversized_paragraph_preserves_content_through_sentence_fallback():
    huge_paragraph = "This is one single sentence about the kingdom. " * 60
    content = huge_paragraph.strip()
    chunks = chunk_lore_content(content)
    assert len(chunks) > 1
    rejoined_words = " ".join(chunks).split()
    original_words = content.split()
    assert rejoined_words == original_words


def test_punctuation_free_blob_still_produces_bounded_chunks():
    blob = "word " * (LORE_CHUNK_THRESHOLD_TOKENS * 9)
    content = blob.strip()
    chunks = chunk_lore_content(content)
    assert len(chunks) > 1
    for chunk in chunks:
        from backend.retrieval import _estimate_tokens
        assert _estimate_tokens(chunk) <= LORE_CHUNK_THRESHOLD_TOKENS + 5
    rejoined_words = " ".join(chunks).split()
    original_words = content.split()
    assert rejoined_words == original_words


def test_single_unbroken_run_with_no_spaces_or_punctuation_is_hard_sliced():
    content = "a" * (LORE_CHUNK_THRESHOLD_TOKENS * 4 * 6)
    chunks = chunk_lore_content(content)
    assert len(chunks) > 1
    from backend.retrieval import _estimate_tokens
    for chunk in chunks:
        assert _estimate_tokens(chunk) <= LORE_CHUNK_THRESHOLD_TOKENS + 5
    assert "".join(chunks) == content


def test_no_chunk_starts_or_ends_mid_word():
    paragraph = ("The old kingdom fell after a long war between three noble houses. " * 15).strip()
    content = "\n\n".join([paragraph] * 8)
    chunks = chunk_lore_content(content)
    for chunk in chunks:
        stripped = chunk.strip()
        assert stripped == "" or stripped[0].isupper() or stripped[0] in "\"'"
        assert stripped[-1] in ".!?\"'"


import pytest
import sqlalchemy as sa

from backend import db
from backend.retrieval import index_lore
from backend.repositories import lore_chunks as lore_chunks_repo
from backend import vectors

pytestmark = pytest.mark.asyncio


async def test_index_lore_under_threshold_creates_no_chunks(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    vectors._build_tables(768)
    await index_lore("l-idx-short", None, "A short entry.", "Short", "")
    assert await lore_chunks_repo.chunks_for("l-idx-short") == []


async def test_index_lore_over_threshold_creates_chunks(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    vectors._build_tables(768)
    paragraph = ("This is a long sentence about the kingdom and its ancient history. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    await index_lore("l-idx-long", None, content, "Long", "")
    chunks = await lore_chunks_repo.chunks_for("l-idx-long")
    assert len(chunks) > 1


async def test_index_lore_reindex_replaces_not_accumulates(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    vectors._build_tables(768)
    paragraph = ("This is a long sentence about the kingdom and its ancient history. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    await index_lore("l-idx-reindex", None, content, "Long", "")
    first_count = len(await lore_chunks_repo.chunks_for("l-idx-reindex"))
    await index_lore("l-idx-reindex", None, content, "Long", "")
    second_count = len(await lore_chunks_repo.chunks_for("l-idx-reindex"))
    assert first_count == second_count


async def _count_lore_vectors(lore_id):
    async with vectors._engine().connect() as conn:
        result = await conn.execute(
            sa.select(sa.func.count()).select_from(vectors._lore_tbl).where(vectors._lore_tbl.c.lore_id == lore_id)
        )
        return result.scalar()


async def test_index_lore_shrink_removes_orphaned_vectors(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    vectors._build_tables(768)
    paragraph = ("This is a long sentence about the kingdom and its ancient history. " * 20).strip()
    long_content = "\n\n".join([paragraph] * 6)
    await index_lore("l-idx-shrink", None, long_content, "Long", "")
    long_count = await _count_lore_vectors("l-idx-shrink")
    assert long_count > 1

    await index_lore("l-idx-shrink", None, "A short entry now.", "Short", "")
    short_count = await _count_lore_vectors("l-idx-shrink")
    assert short_count == 1


async def test_index_lore_isolates_single_chunk_embed_failure(db_conn, monkeypatch):
    calls = []

    async def flaky_embed(text, *args, **kwargs):
        calls.append(text)
        if len(calls) == 2:
            raise RuntimeError("embed server rejected batch")
        return [0.1] * 768

    monkeypatch.setattr("backend.llm.embed", flaky_embed)
    vectors._build_tables(768)
    paragraph = ("This is a long sentence about the kingdom and its ancient history. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    chunks_expected = chunk_lore_content(content)
    assert len(chunks_expected) >= 3

    await index_lore("l-idx-partial-fail", None, content, "Long", "")

    stored_chunks = await lore_chunks_repo.chunks_for("l-idx-partial-fail")
    stored_part_ids = {c["part_id"] for c in stored_chunks}
    assert 1 not in stored_part_ids
    assert 0 in stored_part_ids
    assert 2 in stored_part_ids

    async with vectors._engine().connect() as conn:
        result = await conn.execute(
            sa.select(vectors._lore_tbl.c.part_id)
            .where(vectors._lore_tbl.c.lore_id == "l-idx-partial-fail")
        )
        stored_vector_parts = {row[0] for row in result.fetchall()}
    assert 1 not in stored_vector_parts
    assert 0 in stored_vector_parts
    assert 2 in stored_vector_parts

    assert len(stored_part_ids) == len(chunks_expected) - 1


from backend.retrieval import _entry_matches, retrieve, LORE_RECURSION_MAX_DEPTH


def _entry(**overrides):
    base = {"id": "l-1", "keys": ["dragon"], "require_keys": [], "exclude_keys": [],
            "always": False, "content": ""}
    base.update(overrides)
    return base


def test_entry_matches_plain_key():
    assert _entry_matches(_entry(keys=["dragon"]), "a dragon appeared") is True
    assert _entry_matches(_entry(keys=["dragon"]), "a griffin appeared") is False


def test_entry_matches_require_keys_and_logic():
    entry = _entry(keys=["dragon"], require_keys=["cave"])
    assert _entry_matches(entry, "a dragon in a cave") is True
    assert _entry_matches(entry, "a dragon in a forest") is False


def test_entry_matches_exclude_keys_not_logic():
    entry = _entry(keys=["king"], exclude_keys=["dead"])
    assert _entry_matches(entry, "the king rules") is True
    assert _entry_matches(entry, "the king is dead") is False


def test_entry_matches_require_and_exclude_combined():
    entry = _entry(keys=["dragon"], require_keys=["cave"], exclude_keys=["slain"])
    assert _entry_matches(entry, "a dragon in a cave") is True
    assert _entry_matches(entry, "a dragon in a cave was slain") is False
    assert _entry_matches(entry, "a dragon in a forest") is False


def test_entry_matches_word_boundary_avoids_false_positive_substring():
    entry = _entry(keys=["academy"], require_keys=["war"], exclude_keys=[])
    assert _entry_matches(entry, "walking towards the academy gates") is False
    assert _entry_matches(entry, "the war has begun at the academy") is True


def test_entry_matches_word_boundary_multi_word_phrase():
    entry = _entry(keys=["peace treaty"])
    assert _entry_matches(entry, "they signed a peace treaty yesterday") is True
    assert _entry_matches(entry, "they discussed peace but no treaty yet") is False
    assert _entry_matches(entry, "they signed a treaty yesterday") is False


def test_entry_matches_cjk_key_without_spaces():
    entry = _entry(keys=["战争"])
    assert _entry_matches(entry, "东京战争开始了") is True


async def test_retrieve_includes_entry_via_recursion(db_conn, monkeypatch):
    from backend.repositories import lore
    char_id = "char-recur-1"
    entry_a = await lore.create(char_id, ["dragon"], "The dragon lives near the old bridge.", False)
    entry_b = await lore.create(char_id, ["bridge"], "The bridge was built a century ago.", False)
    matched, _ = await retrieve(char_id, "sess-recur-1", "dragon", "a dragon appeared")
    matched_ids = {e["id"] for e in matched}
    assert entry_a in matched_ids
    assert entry_b in matched_ids


async def test_retrieve_recursion_terminates_on_circular_chain(db_conn):
    from backend.repositories import lore
    char_id = "char-recur-2"
    entry_a = await lore.create(char_id, ["alpha"], "This mentions beta the traveler.", False)
    entry_b = await lore.create(char_id, ["beta"], "This mentions alpha the traveler.", False)
    matched, _ = await retrieve(char_id, "sess-recur-2", "alpha", "alpha arrives")
    matched_ids = [e["id"] for e in matched]
    assert matched_ids.count(entry_a) == 1
    assert matched_ids.count(entry_b) == 1


async def test_retrieve_three_entry_chain_within_max_depth(db_conn):
    from backend.repositories import lore
    char_id = "char-recur-3"
    entry_a = await lore.create(char_id, ["start"], "This leads to middle events.", False)
    entry_b = await lore.create(char_id, ["middle"], "This leads to finish events.", False)
    entry_c = await lore.create(char_id, ["finish"], "The story concludes here.", False)
    matched, _ = await retrieve(char_id, "sess-recur-3", "start", "start happens")
    matched_ids = {e["id"] for e in matched}
    assert {entry_a, entry_b, entry_c}.issubset(matched_ids)


async def test_retrieve_always_entry_content_does_not_leak_into_gating(db_conn):
    from backend.repositories import lore
    char_id = "char-recur-always-1"
    always_entry = await lore.create(
        char_id, ["academy"],
        "The Academy was founded long after the Second Crossing War ended.",
        True,
    )
    gated_entry = await lore.create(
        char_id, ["soldier"], "The soldiers rally when war breaks out.", False,
        require_keys=["war"],
    )
    matched, _ = await retrieve(char_id, "sess-recur-always-1", "soldier", "a soldier walks by")
    matched_ids = {e["id"] for e in matched}
    assert always_entry in matched_ids
    assert gated_entry not in matched_ids


async def test_retrieve_non_always_entry_still_feeds_recursion_gating(db_conn):
    from backend.repositories import lore
    char_id = "char-recur-always-2"
    triggered_entry = await lore.create(
        char_id, ["soldier"], "The soldiers gathered because war has broken out.", False,
    )
    gated_entry = await lore.create(
        char_id, ["camp"], "The camp is fortified during the war.", False,
        require_keys=["war"],
    )
    matched, _ = await retrieve(char_id, "sess-recur-always-2", "soldier camp", "a soldier and a camp appear")
    matched_ids = {e["id"] for e in matched}
    assert triggered_entry in matched_ids
    assert gated_entry in matched_ids
