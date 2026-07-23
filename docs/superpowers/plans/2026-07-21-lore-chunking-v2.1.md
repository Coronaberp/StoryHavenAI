# Lore Chunking, Content Size Limits & Lorebook Matching (Memory v2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix lore's all-or-nothing token-budget failure mode (chunking + a pinned-lore cap), close the character-card prompt-bloat gap, add deterministic lorebook matching (AND/OR/NOT + bounded recursion), make chunking visible to creators, and validate the whole memory/lore pipeline end-to-end with a live 50-turn stress test.

**Architecture:** Long lore content is split into ~500-token chunks at index time, each independently embedded (`lore_vectors` gets a composite `(lore_id, part_id)` key) and stored in a new `lore_chunks` table. Retrieval (`backend/retrieval.py`'s keyword/`always` path, `backend/lore_memory.py`'s semantic/KNN path) is made chunk-aware so a long entry contributes only its relevant piece instead of being all-or-nothing. A new pinned-lore cap mirrors the existing memory-fact cap. Two new deterministic lorebook-matching columns (`require_keys`/`exclude_keys`) and bounded recursive scanning extend `retrieve()`'s matching logic. This is explicitly prioritized as **the main deliverable of this plan** — tight integration between every piece matters more than speed, and the plan ends with a real 50-turn live stress test (reusing the existing `run_academy_live.py` harness) before being considered done.

**Tech Stack:** Python (FastAPI, SQLAlchemy Core, asyncpg/Postgres, pgvector), vanilla JS frontend, no build step.

## Global Constraints

- This is a live app (project CLAUDE.md) — this checkout IS the running container's bind mount. After every edit to a live `.py` file: `python3 -c "import ast; ast.parse(open('<file>').read())"`, then `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health` (expect `401`), then `podman logs --tail 50 story-game | grep -i "error\|traceback"`. No `node` binary — verify JS by curling the live served file.
- Zero comments in any file, including docstrings.
- No abbreviations in identifiers.
- `LORE_CHUNK_THRESHOLD_TOKENS = 500` — chunking only activates over this; entries under it are completely unaffected (no `lore_chunks` row, single embedding, identical behavior to before this plan).
- `MAX_PINNED_LORE_CHUNKS = 12` — matches the existing `MAX_ACTIVE_RESERVED_FACTS` value for consistency.
- `LORE_RECURSION_MAX_DEPTH = 2` — fixed, no per-entry toggle.
- Character card combined-field cap: `len(system_prompt) + len(persona) + len(scenario) + len(dialogue) <= 25000` characters. `description` is excluded entirely (never reaches the model).
- No probability/chance-to-trigger, no insertion-depth/position control — both explicitly cut from scope, do not implement them.
- `always` entries bypass `require_keys`/`exclude_keys` entirely, same as they already bypass plain `keys`.
- Chunking is invisible in the admin/creator-facing entry editor except for the automatic, non-configurable chunk preview panel (section 13 of the spec) — no "chunks" or "part_id" concept ever exposed as something to configure.
- Full spec: `docs/superpowers/specs/2026-07-21-lore-chunking-design.md`.

---

### Task 1: Schema — `lore_chunks` table, `lore.require_keys`/`exclude_keys`, `lore_vectors` composite key

**Files:**
- Modify: `backend/db.py` (add `lore_chunks` table, add columns to `lore` table, update `_lore_row`)
- Modify: `backend/vectors.py` (composite primary key on `lore_vectors`)
- Create: `backend/repositories/lore_chunks.py`
- Test: `backend/tests/test_lore_chunks_repo.py`

**Interfaces:**
- Consumes: nothing from other tasks (foundational).
- Produces:
  - `backend.db.lore_chunks` (SQLAlchemy `Table`)
  - `async def set_chunks(lore_id: str, chunks: list[str]) -> list[dict]` — delete-then-recreate, mirrors `lore_secrets.set_secrets`'s exact shape
  - `async def chunks_for(lore_id: str) -> list[dict]` (each dict: `id`, `lore_id`, `part_id`, `content`)
  - `async def delete_chunks(lore_id: str) -> None`
  - `db._lore_row` now parses `require_keys`/`exclude_keys` into lists, same shape as `keys`
  - `vectors._lore_tbl`'s primary key is `(lore_id, part_id)` instead of `lore_id` alone

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_lore_chunks_repo.py`:

```python
import pytest

from backend.repositories import lore_chunks as lore_chunks_repo

pytestmark = pytest.mark.asyncio


async def test_set_chunks_creates_ordered_rows(db_conn):
    rows = await lore_chunks_repo.set_chunks("l-test-1", ["first piece", "second piece"])
    assert len(rows) == 2
    assert rows[0]["part_id"] == 0
    assert rows[0]["content"] == "first piece"
    assert rows[1]["part_id"] == 1
    assert rows[1]["content"] == "second piece"


async def test_chunks_for_returns_ordered(db_conn):
    await lore_chunks_repo.set_chunks("l-test-2", ["a", "b", "c"])
    chunks = await lore_chunks_repo.chunks_for("l-test-2")
    assert [c["content"] for c in chunks] == ["a", "b", "c"]


async def test_set_chunks_replaces_not_accumulates(db_conn):
    await lore_chunks_repo.set_chunks("l-test-3", ["old one", "old two"])
    await lore_chunks_repo.set_chunks("l-test-3", ["new single"])
    chunks = await lore_chunks_repo.chunks_for("l-test-3")
    assert len(chunks) == 1
    assert chunks[0]["content"] == "new single"


async def test_delete_chunks_removes_all(db_conn):
    await lore_chunks_repo.set_chunks("l-test-4", ["x", "y"])
    await lore_chunks_repo.delete_chunks("l-test-4")
    assert await lore_chunks_repo.chunks_for("l-test-4") == []


async def test_chunks_for_never_chunked_entry_is_empty(db_conn):
    assert await lore_chunks_repo.chunks_for("l-never-touched") == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_chunks_repo.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.repositories.lore_chunks'`

- [ ] **Step 3: Add the `lore_chunks` table and `lore` columns**

In `backend/db.py`, find the `lore_secrets` table declaration (around line 242) and add the new table right after it:

```python
lore_chunks = sa.Table(
    "lore_chunks", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("lore_id", sa.Text, nullable=False),
    sa.Column("part_id", sa.Integer, nullable=False),
    sa.Column("content", sa.Text, nullable=False),
    sa.Column("created_ts", sa.BigInteger, nullable=False),
)
```

Find the `lore` table declaration (around line 212) and add two new columns right after `keys`:

```python
    sa.Column("keys", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("require_keys", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("exclude_keys", sa.Text, nullable=False, server_default=text("''")),
```

Find `_lore_row` (around line 1453) and add parsing for the two new columns, matching how `keys` is already parsed:

```python
def _lore_row(row) -> dict:
    d = dict(row)
    d["content"] = _decrypt_secret(d.get("content") or "")
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["appearance_tags"] = _decrypt_secret(d.get("appearance_tags") or "")
    d["appearance_tags_negative"] = _decrypt_secret(d.get("appearance_tags_negative") or "")
    d["keys"] = [k for k in _decrypt_secret(d.get("keys") or "").split(",") if k]
    d["require_keys"] = [k for k in (d.get("require_keys") or "").split(",") if k]
    d["exclude_keys"] = [k for k in (d.get("exclude_keys") or "").split(",") if k]
    d["always"] = bool(d.get("always"))
    d["hidden"] = bool(d.get("hidden"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    d["global"] = d.get("char_id") is None
    return d
```

`require_keys`/`exclude_keys` are stored unencrypted (unlike `keys`, which is historically encrypted) — they're structural matching data, not narrative content, consistent with how `category`/`hidden` and other structural lore fields are already stored in plain columns.

- [ ] **Step 4: Add the composite primary key to `lore_vectors`**

In `backend/vectors.py`, find the `_lore_tbl` declaration (around line 53) and change it:

```python
    _lore_tbl = sa.Table(
        "lore_vectors", _meta,
        sa.Column("lore_id", sa.Text, primary_key=True),
        sa.Column("part_id", sa.Integer, primary_key=True, server_default=sa.text("0")),
        sa.Column("char_id", sa.Text),
        sa.Column("embedding", Vector(dim)),
    )
```

In `ensure_indexes` (around line 73), add a live migration before `metadata.create_all` to handle existing single-column-PK rows:

```python
async def ensure_indexes(dim: int):
    _build_tables(dim)
    async with _engine().begin() as conn:
        await conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.execute(sa.text(
            "ALTER TABLE lore_vectors ADD COLUMN IF NOT EXISTS part_id INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(sa.text(
            "ALTER TABLE lore_vectors DROP CONSTRAINT IF EXISTS lore_vectors_pkey"))
        await conn.execute(sa.text(
            "ALTER TABLE lore_vectors ADD PRIMARY KEY (lore_id, part_id)"))
        await conn.run_sync(_meta.create_all)
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_memvec_hnsw ON memory_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))
        await conn.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS idx_lorevec_hnsw ON lore_vectors "
            "USING hnsw (embedding vector_cosine_ops)"))
    from backend.repositories import memory_facts
    await memory_facts.ensure_tables(dim)
```

The `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and the drop/re-add primary key sequence is idempotent and safe to run on every startup — on a fresh table `lore_vectors_pkey` won't exist yet the first time (before `_meta.create_all` has ever run), so wrap the two `ALTER TABLE` migration lines in a check: only run them if the table already exists.

```python
        table_exists = await conn.scalar(sa.text(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'lore_vectors')"))
        if table_exists:
            await conn.execute(sa.text(
                "ALTER TABLE lore_vectors ADD COLUMN IF NOT EXISTS part_id INTEGER NOT NULL DEFAULT 0"))
            await conn.execute(sa.text(
                "ALTER TABLE lore_vectors DROP CONSTRAINT IF EXISTS lore_vectors_pkey"))
            await conn.execute(sa.text(
                "ALTER TABLE lore_vectors ADD PRIMARY KEY (lore_id, part_id)"))
```

(Use this guarded version instead of the unconditional one above — place it right before `await conn.run_sync(_meta.create_all)`.)

- [ ] **Step 5: Write the repository**

Create `backend/repositories/lore_chunks.py`:

```python
import time

from sqlalchemy import select, insert, delete as sa_delete

from backend.db import lore_chunks, nid, _q, _w
from backend.state import log


def _row(row) -> dict:
    return {"id": row["id"], "lore_id": row["lore_id"], "part_id": row["part_id"],
            "content": row["content"]}


async def chunks_for(lore_id: str) -> list[dict]:
    rows = await _q(select(lore_chunks).where(lore_chunks.c.lore_id == lore_id)
                    .order_by(lore_chunks.c.part_id))
    return [_row(r) for r in rows]


async def set_chunks(lore_id: str, chunks: list[str]) -> list[dict]:
    await delete_chunks(lore_id)
    created_ts = int(time.time())
    rows = [{"id": nid("lchk"), "lore_id": lore_id, "part_id": i, "content": chunk,
             "created_ts": created_ts}
            for i, chunk in enumerate(chunks)]
    if rows:
        await _w(insert(lore_chunks).values(rows))
    log.info("lore_chunks: set count=%s lore=%s", len(rows), lore_id)
    return await chunks_for(lore_id)


async def delete_chunks(lore_id: str) -> None:
    await _w(sa_delete(lore_chunks).where(lore_chunks.c.lore_id == lore_id))
    log.info("lore_chunks: deleted lore=%s", lore_id)
```

- [ ] **Step 6: Syntax-check and live-verify**

Run for each of `backend/db.py`, `backend/vectors.py`, `backend/repositories/lore_chunks.py`:
```bash
python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/db.py').read())"
python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/vectors.py').read())"
python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/repositories/lore_chunks.py').read())"
```
Expected: no output, all three.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401` (the app restarts on save; the live migration runs at startup).

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors — specifically check for any error around the `lore_vectors` primary-key migration, since that's the riskiest line in this task.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_chunks_repo.py -v`
Expected: PASS, all 5 tests.

- [ ] **Step 8: Commit**

```bash
git add backend/db.py backend/vectors.py backend/repositories/lore_chunks.py backend/tests/test_lore_chunks_repo.py
git commit -m "Add lore_chunks table, lore require_keys/exclude_keys columns, composite lore_vectors key"
```

---

### Task 2: `chunk_lore_content()` — paragraph-aware splitting

**Files:**
- Modify: `backend/retrieval.py`
- Test: `backend/tests/test_retrieval.py` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `def chunk_lore_content(content: str) -> list[str]` — pure, synchronous, no I/O. Returns a single-element list for content at or under `LORE_CHUNK_THRESHOLD_TOKENS`; splits on paragraph boundaries into ~500-token groups otherwise, falling back to sentence-splitting for any single paragraph over threshold on its own.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_retrieval.py`:

```python
from backend.retrieval import chunk_lore_content, LORE_CHUNK_THRESHOLD_TOKENS


def test_short_content_is_a_single_chunk():
    content = "A short lore entry about a tavern."
    assert chunk_lore_content(content) == [content]


def test_content_exactly_at_threshold_is_a_single_chunk():
    content = "word " * (LORE_CHUNK_THRESHOLD_TOKENS - 1)
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


def test_no_chunk_starts_or_ends_mid_word():
    paragraph = ("The old kingdom fell after a long war between three noble houses. " * 15).strip()
    content = "\n\n".join([paragraph] * 8)
    chunks = chunk_lore_content(content)
    for chunk in chunks:
        stripped = chunk.strip()
        assert stripped == "" or stripped[0].isupper() or stripped[0] in "\"'"
        assert stripped[-1] in ".!?\"'"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_retrieval.py -v`
Expected: FAIL — `ImportError: cannot import name 'chunk_lore_content'`

- [ ] **Step 3: Implement `chunk_lore_content`**

In `backend/retrieval.py`, add near the top of the file (after imports):

```python
LORE_CHUNK_THRESHOLD_TOKENS = 500


def _estimate_tokens(text: str) -> int:
    return len(text) // 4 + 1


def _split_into_sentences(text: str) -> list[str]:
    import re
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s for s in sentences if s]


def _pack_sentences(sentences: list[str], limit_tokens: int) -> list[str]:
    packed, current = [], []
    current_tokens = 0
    for sentence in sentences:
        sentence_tokens = _estimate_tokens(sentence)
        if current and current_tokens + sentence_tokens > limit_tokens:
            packed.append(" ".join(current))
            current, current_tokens = [], 0
        current.append(sentence)
        current_tokens += sentence_tokens
    if current:
        packed.append(" ".join(current))
    return packed


def chunk_lore_content(content: str) -> list[str]:
    if _estimate_tokens(content) <= LORE_CHUNK_THRESHOLD_TOKENS:
        return [content]
    paragraphs = [p for p in content.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0
    for paragraph in paragraphs:
        paragraph_tokens = _estimate_tokens(paragraph)
        if paragraph_tokens > LORE_CHUNK_THRESHOLD_TOKENS:
            if current:
                chunks.append("\n\n".join(current))
                current, current_tokens = [], 0
            sentences = _split_into_sentences(paragraph)
            chunks.extend(_pack_sentences(sentences, LORE_CHUNK_THRESHOLD_TOKENS))
            continue
        if current and current_tokens + paragraph_tokens > LORE_CHUNK_THRESHOLD_TOKENS:
            chunks.append("\n\n".join(current))
            current, current_tokens = [], 0
        current.append(paragraph)
        current_tokens += paragraph_tokens
    if current:
        chunks.append("\n\n".join(current))
    return chunks
```

- [ ] **Step 4: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/retrieval.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_retrieval.py -v`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/retrieval.py backend/tests/test_retrieval.py
git commit -m "Add chunk_lore_content paragraph-aware splitting"
```

---

### Task 3: Wire chunking into `index_lore()`, adapt `vectors.py`

**Files:**
- Modify: `backend/retrieval.py` (`index_lore`)
- Modify: `backend/vectors.py` (`store_lore_vector`, `search_lore_ids`, new `search_lore_chunks`)
- Test: `backend/tests/test_retrieval.py`, `backend/tests/test_vectors.py` (new)

**Interfaces:**
- Consumes: `chunk_lore_content` (Task 2), `lore_chunks.set_chunks`/`delete_chunks` (Task 1).
- Produces:
  - `index_lore(lid, char_id, content, name="", category="")` — same external signature, now chunk-aware internally.
  - `vectors.store_lore_vector(lore_id, char_id, vec, part_id=0)` — gains an optional `part_id` parameter, defaults preserve every existing call site's behavior unchanged.
  - `vectors.search_lore_ids(char_id, vec, k, max_dist) -> list[str]` — same external contract as before (unique lore ids), now dedups multiple chunk hits of the same entry, keeping the closest.
  - `vectors.search_lore_chunks(char_id, vec, k, max_dist) -> list[dict]` — new, each dict `{"lore_id": str, "part_id": int, "distance": float}`, used only by Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_retrieval.py`:

```python
import pytest

from backend import db
from backend.retrieval import index_lore
from backend.repositories import lore_chunks as lore_chunks_repo
from backend import vectors

pytestmark = pytest.mark.asyncio


async def test_index_lore_under_threshold_creates_no_chunks(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    await index_lore("l-idx-short", None, "A short entry.", "Short", "")
    assert await lore_chunks_repo.chunks_for("l-idx-short") == []


async def test_index_lore_over_threshold_creates_chunks(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    paragraph = ("This is a long sentence about the kingdom and its ancient history. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    await index_lore("l-idx-long", None, content, "Long", "")
    chunks = await lore_chunks_repo.chunks_for("l-idx-long")
    assert len(chunks) > 1


async def test_index_lore_reindex_replaces_not_accumulates(db_conn, monkeypatch):
    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)
    paragraph = ("This is a long sentence about the kingdom and its ancient history. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    await index_lore("l-idx-reindex", None, content, "Long", "")
    first_count = len(await lore_chunks_repo.chunks_for("l-idx-reindex"))
    await index_lore("l-idx-reindex", None, content, "Long", "")
    second_count = len(await lore_chunks_repo.chunks_for("l-idx-reindex"))
    assert first_count == second_count
```

Create `backend/tests/test_vectors.py`:

```python
import os

import pytest

from backend import vectors

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "768"))


async def test_store_and_search_single_chunk(db_conn):
    vectors._build_tables(_EMBED_DIM)
    await vectors.store_lore_vector("l-vec-1", None, [0.1] * _EMBED_DIM, part_id=0)
    ids = await vectors.search_lore_ids(None, [0.1] * _EMBED_DIM, 5, 0.8)
    assert "l-vec-1" in ids


async def test_search_lore_ids_dedups_multiple_chunks_to_one_entry(db_conn):
    vectors._build_tables(_EMBED_DIM)
    await vectors.store_lore_vector("l-vec-2", None, [0.1] * _EMBED_DIM, part_id=0)
    await vectors.store_lore_vector("l-vec-2", None, [0.1] * _EMBED_DIM, part_id=1)
    ids = await vectors.search_lore_ids(None, [0.1] * _EMBED_DIM, 5, 0.8)
    assert ids.count("l-vec-2") == 1


async def test_search_lore_chunks_returns_part_level_hits(db_conn):
    vectors._build_tables(_EMBED_DIM)
    await vectors.store_lore_vector("l-vec-3", None, [0.1] * _EMBED_DIM, part_id=0)
    await vectors.store_lore_vector("l-vec-3", None, [0.2] * _EMBED_DIM, part_id=1)
    hits = await vectors.search_lore_chunks(None, [0.1] * _EMBED_DIM, 5, 0.8)
    part_ids = {h["part_id"] for h in hits if h["lore_id"] == "l-vec-3"}
    assert part_ids == {0, 1}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_retrieval.py backend/tests/test_vectors.py -v`
Expected: FAIL — `index_lore` doesn't create `lore_chunks` rows yet, `store_lore_vector` doesn't accept `part_id`, `search_lore_chunks` doesn't exist.

- [ ] **Step 3: Update `vectors.py`**

Replace `store_lore_vector`, `search_lore_ids`, and add `search_lore_chunks` in `backend/vectors.py`:

```python
async def store_lore_vector(lore_id: str, char_id: str | None, vec, part_id: int = 0):
    ins = pg_insert(_lore_tbl).values(
        lore_id=lore_id, part_id=part_id, char_id=char_id, embedding=_to_list(vec))
    ins = ins.on_conflict_do_update(index_elements=["lore_id", "part_id"], set_={
        "char_id": ins.excluded.char_id, "embedding": ins.excluded.embedding})
    async with _engine().begin() as conn:
        await conn.execute(ins)


async def search_lore_ids(char_id: str, vec, k: int, max_dist: float):
    best_by_lore_id: dict[str, float] = {}
    try:
        dist = _lore_tbl.c.embedding.cosine_distance(_to_list(vec))
        stmt = (sa.select(_lore_tbl.c.lore_id, dist.label("score"))
                .where(sa.or_(_lore_tbl.c.char_id == char_id,
                              _lore_tbl.c.char_id.is_(None)))
                .order_by(sa.text("score")).limit(k * 4))
        async with _engine().connect() as conn:
            for r in (await conn.execute(stmt)).fetchall():
                score = float(r._mapping["score"])
                if score > max_dist:
                    continue
                lore_id = r._mapping["lore_id"]
                if lore_id not in best_by_lore_id or score < best_by_lore_id[lore_id]:
                    best_by_lore_id[lore_id] = score
    except Exception as e:
        log.warning("lore search failed (char=%s): %s: %s", char_id, type(e).__name__, e)
    ranked = sorted(best_by_lore_id.items(), key=lambda item: item[1])
    return [lore_id for lore_id, _ in ranked[:k]]


async def search_lore_chunks(char_id: str, vec, k: int, max_dist: float) -> list[dict]:
    hits = []
    try:
        dist = _lore_tbl.c.embedding.cosine_distance(_to_list(vec))
        stmt = (sa.select(_lore_tbl.c.lore_id, _lore_tbl.c.part_id, dist.label("score"))
                .where(sa.or_(_lore_tbl.c.char_id == char_id,
                              _lore_tbl.c.char_id.is_(None)))
                .order_by(sa.text("score")).limit(k))
        async with _engine().connect() as conn:
            for r in (await conn.execute(stmt)).fetchall():
                score = float(r._mapping["score"])
                if score <= max_dist:
                    hits.append({"lore_id": r._mapping["lore_id"],
                                "part_id": r._mapping["part_id"], "distance": score})
    except Exception as e:
        log.warning("lore chunk search failed (char=%s): %s: %s", char_id, type(e).__name__, e)
    return hits
```

`search_lore_ids` widens its raw query limit to `k * 4` before deduping to unique lore ids, since multiple chunk-level rows can belong to the same entry — this keeps the final unique-entry result count meaningfully close to `k` instead of shrinking whenever an entry has several chunks competing for the same slots.

- [ ] **Step 4: Update `index_lore`**

In `backend/retrieval.py`, replace `index_lore`:

```python
async def index_lore(lid, char_id, content, name: str = "", category: str = ""):
    try:
        prefix = ", ".join(p for p in (category, name) if p)
        chunks = chunk_lore_content(content)
        await lore_chunks_repo.delete_chunks(lid)
        if len(chunks) == 1:
            embed_text = f"{prefix}: {content}" if prefix else content
            vec = await llm.embed(embed_text, CFG["embed_model"])
            await vectors.store_lore_vector(lid, char_id, vec, part_id=0)
            return
        await lore_chunks_repo.set_chunks(lid, chunks)
        for part_id, chunk in enumerate(chunks):
            embed_text = f"{prefix}: {chunk}" if prefix else chunk
            vec = await llm.embed(embed_text, CFG["embed_model"])
            await vectors.store_lore_vector(lid, char_id, vec, part_id=part_id)
    except Exception as e:
        log.warning("lore embedding failed for %s: %s", lid, e)
```

Add the import at the top of `backend/retrieval.py`:

```python
from backend.repositories import lore_chunks as lore_chunks_repo
```

- [ ] **Step 5: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/retrieval.py').read())"`
Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/vectors.py').read())"`
Expected: no output, both.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_retrieval.py backend/tests/test_vectors.py -v`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add backend/retrieval.py backend/vectors.py backend/tests/test_retrieval.py backend/tests/test_vectors.py
git commit -m "Wire chunking into index_lore, add chunk-level vector search"
```

---

### Task 4: `fetch_lore_candidates` chunk-awareness + `MAX_PINNED_LORE_CHUNKS` cap

**Files:**
- Modify: `backend/lore_memory.py`
- Test: `backend/tests/test_lore_memory.py`

**Interfaces:**
- Consumes: `vectors.search_lore_chunks` (Task 3), `lore_chunks.chunks_for` (Task 1).
- Produces: `fetch_lore_candidates(char_id, session_id, keyword_entries, query_vec, cfg, current_turn) -> list[dict]` — same external signature. Candidates for a chunked entry now carry chunk-specific `content`/`id` instead of the whole entry. The `pinned=True` subset returned is capped at `MAX_PINNED_LORE_CHUNKS`, with overflow merged into the non-pinned portion of the returned list instead of being dropped.

This is the integration-heaviest task in the plan — read `backend/lore_memory.py` in full before starting, and read `backend/session_lore_state.py`'s `get_all_overrides_for_session` (an override is keyed by the real `lore_id`, always short LLM-generated prose per the spec's non-goals — an entry with an active override is never chunk-expanded, it always produces exactly one candidate using the override content, matching today's behavior).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_lore_memory.py` (read the existing file first to match its fixture/mocking style exactly):

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_memory.py -v`
Expected: FAIL — chunk expansion doesn't exist yet, `MAX_PINNED_LORE_CHUNKS` doesn't exist, no cap logic.

- [ ] **Step 3: Implement**

Replace `backend/lore_memory.py`'s `lore_candidate` and `fetch_lore_candidates`:

```python
MAX_PINNED_LORE_CHUNKS = 12


def lore_candidate(entry: dict, current_turn: int, distance: float = 0.0,
                   pinned: bool = False, link_label: str | None = None,
                   candidate_id: str | None = None, content: str | None = None) -> dict:
    return {
        "id": candidate_id or entry["id"], "source": "lore", "fact_type": "lore",
        "text": content if content is not None else entry["content"],
        "participants": [], "importance": entry.get("importance", 3), "valence": 0,
        "reinforcements": 0, "pinned": pinned, "valid_until_turn": None,
        "last_turn": current_turn, "distance": distance, "link_label": link_label,
    }


async def _expand_entry_candidates(entry: dict, overrides: dict, current_turn: int,
                                   pinned: bool, distance: float = 0.0,
                                   link_label: str | None = None) -> list[dict]:
    if entry["id"] in overrides:
        return [lore_candidate(entry, current_turn, distance, pinned, link_label,
                               content=overrides[entry["id"]])]
    chunks = await lore_chunks.chunks_for(entry["id"])
    if not chunks:
        return [lore_candidate(entry, current_turn, distance, pinned, link_label)]
    return [lore_candidate(entry, current_turn, distance, pinned, link_label,
                           candidate_id=f"{entry['id']}#{chunk['part_id']}",
                           content=chunk["content"])
            for chunk in chunks]


async def fetch_lore_candidates(char_id: str, session_id: str, keyword_entries: list[dict],
                                query_vec, cfg: dict, current_turn: int) -> list[dict]:
    overrides = await session_lore_state.get_all_overrides_for_session(session_id)
    seen_ids = {e["id"] for e in keyword_entries}
    pinned_candidates: list[dict] = []
    for e in keyword_entries:
        pinned_candidates.extend(await _expand_entry_candidates(e, overrides, current_turn, pinned=True))
    pinned_candidates.sort(key=lambda c: c["importance"], reverse=True)
    active_pinned = pinned_candidates[:MAX_PINNED_LORE_CHUNKS]
    demoted_pinned = [dict(c, pinned=False) for c in pinned_candidates[MAX_PINNED_LORE_CHUNKS:]]
    candidates = list(active_pinned)
    if query_vec is not None:
        chunk_hits = await vectors.search_lore_chunks(
            char_id, query_vec, LORE_CANDIDATE_K, cfg.get("lore_max_dist", CFG["lore_max_dist"]))
        new_hits = [h for h in chunk_hits if h["lore_id"] not in seen_ids]
        hit_lore_ids = {h["lore_id"] for h in new_hits}
        if hit_lore_ids:
            knn_entries = {e["id"]: e for e in await db.lore_by_ids(list(hit_lore_ids))}
            for hit in new_hits:
                entry = knn_entries.get(hit["lore_id"])
                if not entry:
                    continue
                if hit["lore_id"] in overrides:
                    candidates.append(lore_candidate(entry, current_turn, hit["distance"],
                                                      content=overrides[hit["lore_id"]]))
                elif hit["part_id"] == 0:
                    chunks = await lore_chunks.chunks_for(hit["lore_id"])
                    if not chunks:
                        candidates.append(lore_candidate(entry, current_turn, hit["distance"]))
                    else:
                        candidates.append(lore_candidate(
                            entry, current_turn, hit["distance"],
                            candidate_id=f"{hit['lore_id']}#0", content=chunks[0]["content"]))
                else:
                    chunks = await lore_chunks.chunks_for(hit["lore_id"])
                    chunk = next((c for c in chunks if c["part_id"] == hit["part_id"]), None)
                    if chunk:
                        candidates.append(lore_candidate(
                            entry, current_turn, hit["distance"],
                            candidate_id=f"{hit['lore_id']}#{hit['part_id']}",
                            content=chunk["content"]))
                seen_ids.add(hit["lore_id"])
    candidates.extend(demoted_pinned)
    expand_ids = [c["id"].split("#")[0] for c in candidates]
    if expand_ids:
        outgoing = await lore_links.outgoing_for_many(expand_ids)
        incoming = await lore_links.incoming_for_many(expand_ids)
        neighbor_labels: dict[str, str] = {}
        for links in outgoing.values():
            for link in links:
                if link["target_id"] not in seen_ids:
                    neighbor_labels.setdefault(link["target_id"], link["label"])
        for links in incoming.values():
            for link in links:
                if link["source_id"] not in seen_ids:
                    neighbor_labels.setdefault(link["source_id"], link["label"])
        if neighbor_labels:
            neighbor_entries = await db.lore_by_ids(list(neighbor_labels))
            for e in neighbor_entries:
                candidates.append(lore_candidate(
                    {**e, "content": overrides.get(e["id"], e["content"])},
                    current_turn, link_label=neighbor_labels[e["id"]] or None))
                seen_ids.add(e["id"])
    return candidates
```

Add the import at the top of `backend/lore_memory.py`:

```python
from backend.repositories import lore_chunks
```

- [ ] **Step 4: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/lore_memory.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_memory.py -v`
Expected: PASS, all tests including the pre-existing ones in the file.

- [ ] **Step 6: Commit**

```bash
git add backend/lore_memory.py backend/tests/test_lore_memory.py
git commit -m "Make fetch_lore_candidates chunk-aware, add MAX_PINNED_LORE_CHUNKS cap"
```

---

### Task 5: `require_keys`/`exclude_keys` AND/NOT logic + recursive scanning

**Files:**
- Modify: `backend/retrieval.py` (`retrieve`)
- Test: `backend/tests/test_retrieval.py`

**Interfaces:**
- Consumes: `require_keys`/`exclude_keys` on entry dicts (Task 1's `_lore_row` change).
- Produces: `def _entry_matches(e: dict, text_lower: str) -> bool`, `LORE_RECURSION_MAX_DEPTH = 2`, `retrieve(char_id, session_id, query, recent, viewer_id=None) -> tuple[list[dict], None]` — same external signature, now applies AND/NOT logic and bounded recursive scanning.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_retrieval.py`:

```python
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
```

Append DB-backed retrieve() tests, checking `backend/tests/test_lore_repo.py` first for the exact `lore` repository's `create` signature to build real test fixtures:

```python
import pytest

pytestmark = pytest.mark.asyncio


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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_retrieval.py -v`
Expected: FAIL — `_entry_matches`/`LORE_RECURSION_MAX_DEPTH` don't exist, `retrieve` doesn't recurse.

- [ ] **Step 3: Implement**

In `backend/retrieval.py`, add the constant near `LORE_CHUNK_THRESHOLD_TOKENS`:

```python
LORE_RECURSION_MAX_DEPTH = 2
```

Add `_entry_matches` and replace `retrieve`:

```python
def _entry_matches(e: dict, text_lower: str) -> bool:
    if not any(k.lower() in text_lower for k in e["keys"]):
        return False
    if e["require_keys"] and not all(k.lower() in text_lower for k in e["require_keys"]):
        return False
    if e["exclude_keys"] and any(k.lower() in text_lower for k in e["exclude_keys"]):
        return False
    return True


async def retrieve(char_id, session_id, query, recent, viewer_id: str | None = None) -> tuple[list[dict], None]:
    rt = (recent or "").lower()
    entries = await db.list_lore(char_id, viewer_id)
    matched: dict[str, dict] = {}
    for e in entries:
        if e["always"] or _entry_matches(e, rt):
            matched[e["id"]] = e
    scan_text = rt
    for _ in range(LORE_RECURSION_MAX_DEPTH):
        combined = scan_text + " " + " ".join(m["content"].lower() for m in matched.values())
        added = False
        for e in entries:
            if e["id"] in matched:
                continue
            if _entry_matches(e, combined):
                matched[e["id"]] = e
                added = True
        if not added:
            break
        scan_text = combined
    return list(matched.values()), None
```

- [ ] **Step 4: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/retrieval.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_retrieval.py -v`
Expected: PASS, all tests in the file including everything from Tasks 2-3.

- [ ] **Step 6: Commit**

```bash
git add backend/retrieval.py backend/tests/test_retrieval.py
git commit -m "Add require_keys/exclude_keys matching and bounded recursive scanning"
```

---

### Task 6: `LoreIn` schema fields, repository wiring, editor UI for `require_keys`/`exclude_keys`

**Files:**
- Modify: `backend/schemas.py` (`LoreIn`)
- Modify: `backend/repositories/lore.py` (`_row`, `_keys_str` reuse, `create`, `update`)
- Modify: `backend/routers/lore.py` (`_create_entry`, `update_lore`)
- Modify: `new_ui/js/workshop-lore.js`
- Test: `backend/tests/test_lore_repo.py`

**Interfaces:**
- Consumes: `lore.require_keys`/`exclude_keys` columns (Task 1).
- Produces: `LoreIn.require_keys: list[str]`, `LoreIn.exclude_keys: list[str]`; `lore.create`/`lore.update` accept and persist both.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_lore_repo.py` (read the file first to match its exact fixture/import style):

```python
async def test_create_and_get_persists_require_and_exclude_keys(db_conn):
    lid = await lore.create("char-req-1", ["dragon"], "content", False,
                                 require_keys=["cave"], exclude_keys=["slain"])
    entry = await lore.get(lid)
    assert entry["require_keys"] == ["cave"]
    assert entry["exclude_keys"] == ["slain"]


async def test_update_changes_require_and_exclude_keys(db_conn):
    lid = await lore.create("char-req-2", ["dragon"], "content", False)
    await lore.update(lid, ["dragon"], "content", False,
                           require_keys=["mountain"], exclude_keys=["dead"])
    entry = await lore.get(lid)
    assert entry["require_keys"] == ["mountain"]
    assert entry["exclude_keys"] == ["dead"]
```

(`test_lore_repo.py` already imports `from backend.repositories import lore`, so `lore.create`/`lore.get`/`lore.update` above match its existing style exactly.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_repo.py -v`
Expected: FAIL — `create()`/`update()` don't accept `require_keys`/`exclude_keys` yet.

- [ ] **Step 3: Update the schema**

In `backend/schemas.py`, `LoreIn` gains two fields right after `keys`:

```python
class LoreIn(BaseModel):
    content: str
    keys: list[str] | str = []
    require_keys: list[str] | str = []
    exclude_keys: list[str] | str = []
    always: bool = False
    is_global: bool = Field(False, alias="global")
    image: str = ""
    image_data: str | None = None
    category: str = ""
    hidden: bool = False
    name: str = ""
    appearance_tags: str = ""
    appearance_tags_negative: str = ""
    model_config = {"populate_by_name": True}
```

- [ ] **Step 4: Update the repository**

In `backend/repositories/lore.py`, update `_row` to parse the two new columns (unencrypted, matching Task 1's `db.py` `_lore_row` treatment):

```python
def _row(row) -> dict:
    d = dict(row)
    d["content"] = _decrypt_secret(d.get("content") or "")
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["appearance_tags"] = _decrypt_secret(d.get("appearance_tags") or "")
    d["appearance_tags_negative"] = _decrypt_secret(d.get("appearance_tags_negative") or "")
    d["keys"] = [k for k in _decrypt_secret(d.get("keys") or "").split(",") if k]
    d["require_keys"] = [k for k in (d.get("require_keys") or "").split(",") if k]
    d["exclude_keys"] = [k for k in (d.get("exclude_keys") or "").split(",") if k]
    d["always"] = bool(d.get("always"))
    d["hidden"] = bool(d.get("hidden"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    d["usable_as_persona"] = bool(d.get("usable_as_persona"))
    return d
```

Update `create` and `update` signatures:

```python
async def create(char_id, keys, content, always, image="", category="", hidden=False, name="",
                  appearance_tags="", appearance_tags_negative="", is_explicit=False,
                  owner_id=None, require_keys=None, exclude_keys=None) -> str:
    lid = nid("l")
    await _w(insert(lore).values(
        id=lid, char_id=char_id, owner_id=owner_id, keys=_encrypt_secret(_keys_str(keys)),
        require_keys=_keys_str(require_keys or []), exclude_keys=_keys_str(exclude_keys or []),
        content=_encrypt_secret(content or ""), always=1 if always else 0,
        image=image, category=category, hidden=1 if hidden else 0,
        name=_encrypt_secret(name or ""),
        appearance_tags=_encrypt_secret(appearance_tags or ""),
        appearance_tags_negative=_encrypt_secret(appearance_tags_negative or ""),
        is_explicit=1 if is_explicit else 0, created=time.time()))
    log.info("lore: created id=%s char=%s always=%s hidden=%s", lid, char_id, bool(always), bool(hidden))
    return lid
```

```python
async def update(lid: str, keys, content, always, image=None, category=None, hidden=None, name=None,
                  appearance_tags=None, appearance_tags_negative=None, is_explicit=None,
                  require_keys=None, exclude_keys=None) -> bool:
    cur = await get(lid)
    if not cur:
        log.warning("lore: update failed, id=%s not found", lid)
        return False
    if content is not None and content != cur["content"]:
        await lore_secrets.delete_secrets(lid)
    await _w(sa_update(lore).where(lore.c.id == lid).values(
        keys=_encrypt_secret(_keys_str(keys)),
        require_keys=_keys_str(cur["require_keys"] if require_keys is None else require_keys),
        exclude_keys=_keys_str(cur["exclude_keys"] if exclude_keys is None else exclude_keys),
        content=_encrypt_secret(content or ""),
        always=1 if always else 0,
        image=cur["image"] if image is None else image,
        category=cur["category"] if category is None else category,
        hidden=(1 if cur["hidden"] else 0) if hidden is None else (1 if hidden else 0),
        name=_encrypt_secret(cur["name"] if name is None else name),
        appearance_tags=_encrypt_secret(cur["appearance_tags"] if appearance_tags is None else appearance_tags),
        appearance_tags_negative=_encrypt_secret(
            cur["appearance_tags_negative"] if appearance_tags_negative is None else appearance_tags_negative),
        is_explicit=(1 if cur["is_explicit"] else 0) if is_explicit is None else (1 if is_explicit else 0)))
    log.info("lore: updated id=%s", lid)
    return True
```

(Read the actual current `update` body in `backend/repositories/lore.py` before editing — the `is_explicit` line and any surrounding lines not shown in the excerpt above must be preserved exactly as they currently are, only the `require_keys`/`exclude_keys` handling and the new parameters are additions.)

- [ ] **Step 5: Wire the router**

In `backend/routers/lore.py`, update `_create_entry` and `update_lore` to pass the two new fields through:

```python
async def _create_entry(char_id: str | None, owner_id: str | None, body: LoreIn,
                        current_user: dict) -> str:
    image = _decode_lore_image(body.image_data) if body.image_data else body.image
    lid = await lore.create(char_id, body.keys, body.content, body.always,
                                  image, body.category, body.hidden, body.name,
                                  body.appearance_tags, body.appearance_tags_negative,
                                  is_explicit=False, owner_id=owner_id,
                                  require_keys=body.require_keys, exclude_keys=body.exclude_keys)
    if body.image_data:
        img_bytes, mime = _data_url_to_bytes(body.image_data)
        if img_bytes:
            classify_image_background(img_bytes, mime or "image/png", current_user["id"],
                                      current_user["is_admin"], lambda: lore.set_explicit(lid),
                                      review_context="a lore entry image")
    await index_lore(lid, char_id, body.content, body.name, body.category)
    return lid
```

```python
@api.put("/lore/{lid}")
async def update_lore(lid: str, body: LoreIn, current_user: dict = Depends(get_current_user)):
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    await _require_can_edit(entry, current_user)
    image = body.image
    is_explicit = None
    img_bytes = mime = None
    if body.image_data:
        image = _decode_lore_image(body.image_data)
        img_bytes, mime = _data_url_to_bytes(body.image_data)
        if img_bytes:
            is_explicit = False
    await lore.update(lid, body.keys, body.content, body.always,
                            image, body.category, body.hidden, body.name,
                            body.appearance_tags, body.appearance_tags_negative,
                            is_explicit=is_explicit,
                            require_keys=body.require_keys, exclude_keys=body.exclude_keys)
    if img_bytes:
        classify_image_background(img_bytes, mime or "image/png", current_user["id"],
                                  current_user["is_admin"], lambda: lore.set_explicit(lid),
                                  review_context="a lore entry image")
    await index_lore(lid, entry.get("char_id"), body.content, body.name, body.category)
    log.info("lore: updated id=%s by=%s", lid, current_user["username"])
    return {"id": lid}
```

- [ ] **Step 6: Add the editor UI**

In `new_ui/js/workshop-lore.js`, find where the `keys` field is rendered in the entry editor form (search for `gAlways`/`e.keys` per the module responsibilities in this codebase's CLAUDE.md, or grep the file for the existing keys-input markup) and add a collapsed "Advanced matching" section right after it, containing two comma-separated text inputs for `require_keys` and `exclude_keys`, following the exact same input pattern the existing `keys` field already uses (read that exact markup first and mirror its structure/id-naming/value-parsing so the new fields save and load identically). Keep this section collapsed by default (a `<details>` element or an existing collapse pattern already used elsewhere in this file) so casual authors never see it unless they expand it.

- [ ] **Step 7: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/schemas.py').read())"`
Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/repositories/lore.py').read())"`
Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/routers/lore.py').read())"`
Expected: no output, all three.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/workshop-lore.js | grep -c "require_keys"`
Expected: `1` or more.

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_repo.py backend/tests/test_retrieval.py backend/tests/test_lore_memory.py -v`
Expected: PASS, all tests.

- [ ] **Step 9: Commit**

```bash
git add backend/schemas.py backend/repositories/lore.py backend/routers/lore.py new_ui/js/workshop-lore.js backend/tests/test_lore_repo.py
git commit -m "Add require_keys/exclude_keys end-to-end: schema, repository, router, editor UI"
```

---

### Task 7: Chunk preview endpoint + automatic editor panel

**Files:**
- Modify: `backend/retrieval.py` (extract nothing new — `chunk_lore_content` already exists from Task 2)
- Modify: `backend/routers/lore.py` (new endpoint)
- Modify: `new_ui/js/workshop-lore.js` (auto-appearing panel)
- Test: `backend/tests/test_lore_router.py` (new)

**Interfaces:**
- Consumes: `chunk_lore_content` (Task 2).
- Produces: `POST /lore/preview-chunks` — body `{"content": str}`, returns `{"chunks": [str, ...]}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lore_router.py`:

```python
import pytest

pytestmark = pytest.mark.asyncio


async def test_preview_chunks_short_content_returns_one_chunk():
    from backend.routers.lore import preview_lore_chunks
    from backend.schemas import LoreChunkPreviewIn
    result = await preview_lore_chunks(LoreChunkPreviewIn(content="A short entry."))
    assert result == {"chunks": ["A short entry."]}


async def test_preview_chunks_long_content_returns_multiple():
    from backend.routers.lore import preview_lore_chunks
    from backend.schemas import LoreChunkPreviewIn
    paragraph = ("This is a long sentence about the ancient kingdom. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    result = await preview_lore_chunks(LoreChunkPreviewIn(content=content))
    assert len(result["chunks"]) > 1
    for chunk in result["chunks"]:
        assert isinstance(chunk, str)


async def test_preview_chunks_response_has_no_extra_metadata():
    from backend.routers.lore import preview_lore_chunks
    from backend.schemas import LoreChunkPreviewIn
    result = await preview_lore_chunks(LoreChunkPreviewIn(content="short"))
    assert set(result.keys()) == {"chunks"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_router.py -v`
Expected: FAIL — `ImportError: cannot import name 'preview_lore_chunks'`

- [ ] **Step 3: Add the schema and endpoint**

In `backend/schemas.py`, add near `LoreIn`:

```python
class LoreChunkPreviewIn(BaseModel):
    content: str = ""
```

In `backend/routers/lore.py`, add the import and endpoint:

```python
from backend.retrieval import index_lore, chunk_lore_content
from backend.schemas import LoreIn, LorePersonaToggleIn, LoreLinksIn, LoreChunkPreviewIn


@api.post("/lore/preview-chunks")
async def preview_lore_chunks(body: LoreChunkPreviewIn):
    return {"chunks": chunk_lore_content(body.content)}
```

(This endpoint is intentionally unauthenticated-parameter-free at the dependency level beyond default session handling — it takes no `current_user` dependency since it performs no database read/write and reveals nothing about any specific entry, only a pure transform of the text the caller already has. Match whatever the surrounding endpoints in this file do regarding auth if this reasoning turns out to conflict with a project-wide convention you find while editing — if every other route in this file requires `Depends(get_current_user)` even for stateless helpers, follow that convention instead for consistency.)

- [ ] **Step 4: Build the automatic UI panel**

In `new_ui/js/workshop-lore.js`, find the content `<textarea>` in the entry editor form and add a debounced input listener: on each `input` event, clear any existing timer, set a new ~600ms timer; when it fires, if the current content's estimated length (`content.length / 4` roughly matching the backend's token estimate) exceeds `500`, call `api("/api/lore/preview-chunks", { method: "POST", body: JSON.stringify({ content }) })` and render the returned `chunks` array into a panel beneath the textarea using the exact copy from the spec ("This entry is long enough that the AI will read it in pieces so it can find the relevant part when it matters. Here's how it splits:" followed by each chunk in its own numbered card). If the estimated length is at or under `500`, remove the panel if it's currently shown. Match this file's existing panel-rendering/DOM patterns (how other dynamic sections already get inserted/removed from the form) rather than inventing a new one.

- [ ] **Step 5: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/schemas.py').read())"`
Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/routers/lore.py').read())"`
Expected: no output, both.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/workshop-lore.js | grep -c "preview-chunks"`
Expected: `1` or more.

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_router.py -v`
Expected: PASS, all 3 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/schemas.py backend/routers/lore.py new_ui/js/workshop-lore.js backend/tests/test_lore_router.py
git commit -m "Add chunk preview endpoint and automatic editor panel"
```

---

### Task 8: Character card content limit

**Files:**
- Modify: `backend/schemas.py` (`CharacterIn`)
- Modify: `new_ui/js/workshop-characters-form.js`
- Test: `backend/tests/test_schemas.py` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `CharacterIn` rejects a combined `system_prompt + persona + scenario + dialogue` length over 25000 characters with a Pydantic validation error.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_schemas.py`:

```python
import pytest
from pydantic import ValidationError

from backend.schemas import CharacterIn


def test_character_in_accepts_short_fields():
    CharacterIn(system_prompt="short", persona="short", scenario="short", dialogue="short")


def test_character_in_accepts_exactly_25000_combined():
    CharacterIn(system_prompt="a" * 25000, persona="", scenario="", dialogue="")


def test_character_in_rejects_over_25000_combined():
    with pytest.raises(ValidationError):
        CharacterIn(system_prompt="a" * 25001, persona="", scenario="", dialogue="")


def test_character_in_description_excluded_from_cap():
    CharacterIn(description="a" * 100000, system_prompt="", persona="", scenario="", dialogue="")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_schemas.py -v`
Expected: FAIL — no validation exists yet, `test_character_in_rejects_over_25000_combined` fails because no `ValidationError` is raised.

- [ ] **Step 3: Add the validator**

In `backend/schemas.py`, add the import and validator to `CharacterIn`:

```python
from pydantic import BaseModel, Field, model_validator
```

```python
class CharacterIn(BaseModel):
    name: str = "Unnamed"
    description: str = ""
    persona: str = ""
    scenario: str = ""
    greeting: str = ""
    dialogue: str = ""
    system_prompt: str = ""
    tags: list[str] = []
    creator: str = "you"
    avatar: str = ""
    alt_greetings: list[str] = []
    mode: str = "character"
    assets: dict | None = None
    is_public: bool = False
    presentation_html: str = ""
    can_be_persona: bool = False
    allow_download: bool = False
    is_explicit: bool = False
    is_draft: bool = False
    appearance_tags: str = ""
    appearance_tags_negative: str = ""

    @model_validator(mode="after")
    def check_prompt_fields_combined_length(self):
        combined = len(self.system_prompt) + len(self.persona) + len(self.scenario) + len(self.dialogue)
        if combined > 25000:
            raise ValueError(
                f"system_prompt, persona, scenario, and dialogue combined must be 25000 "
                f"characters or fewer (currently {combined})")
        return self
```

- [ ] **Step 4: Surface the error in the editor UI**

In `new_ui/js/workshop-characters-form.js`, find where the character save API call (`POST /characters` or `PUT /characters/{cid}`) is made and its error handling — a `422` response from a Pydantic validation error carries `detail` as a list of `{"msg": ..., ...}` objects (FastAPI's standard shape). Extract `detail[0].msg` (or however this file's existing save-error handling already extracts a message from a caught API error — check that first and match it) and show it near the save button via whatever error-display mechanism (`errorToast` or similar) this file already uses for other save failures.

- [ ] **Step 5: Syntax-check and live-verify**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/backend/schemas.py').read())"`
Expected: no output.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 30 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_schemas.py -v`
Expected: PASS, all 4 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/schemas.py new_ui/js/workshop-characters-form.js backend/tests/test_schemas.py
git commit -m "Add 25000-character combined cap to character prompt-facing fields"
```

---

### Task 9: Migration/backfill for existing oversized entries

**Files:**
- Create: `modules/py/backfill_lore_chunks.py`

**Interfaces:**
- Consumes: `index_lore` (Task 3), `LORE_CHUNK_THRESHOLD_TOKENS` (Task 2).
- Produces: a standalone script, run manually inside the container, not imported by the running app.

- [ ] **Step 1: Read the existing backfill precedent**

Read `modules/py/backfill_encrypt.py` in full to match its exact import style (`import db`/`import state`, not `backend.db`, since these scripts run with a different `sys.path` setup than the main app) and its logging/progress-reporting convention.

- [ ] **Step 2: Write the script**

Create `modules/py/backfill_lore_chunks.py`:

```python
"""One-time backfill: re-index every lore entry whose content exceeds the
chunking threshold, so existing oversized entries get split into retrievable
chunks under the scheme introduced by the lore-chunking-design spec.

Run inside the story-game container:

    ./venv/bin/python3 backfill_lore_chunks.py

Progress streams live via `podman logs -f story-game`.
"""
import asyncio

import db
from retrieval import index_lore, LORE_CHUNK_THRESHOLD_TOKENS, _estimate_tokens
from state import log


async def main():
    await db.init()
    rows = await db._q(db.select(db.lore))
    oversized = []
    for row in rows:
        content = db._decrypt_secret(row["content"] or "")
        if _estimate_tokens(content) > LORE_CHUNK_THRESHOLD_TOKENS:
            oversized.append((row["id"], row["char_id"], content,
                              db._decrypt_secret(row["name"] or ""), row["category"]))
    log.info("backfill_lore_chunks: found %d oversized entries", len(oversized))
    for i, (lid, char_id, content, name, category) in enumerate(oversized):
        await index_lore(lid, char_id, content, name, category)
        log.info("backfill_lore_chunks: reindexed %d/%d id=%s", i + 1, len(oversized), lid)
    log.info("backfill_lore_chunks: done, %d entries reindexed", len(oversized))


if __name__ == "__main__":
    asyncio.run(main())
```

Verify the exact import names (`db._q`, `db.select`, `db._decrypt_secret`, `retrieval._estimate_tokens`) actually exist with those names when imported the way `backfill_encrypt.py` imports its own dependencies — adjust to match whatever the real non-package-relative import surface looks like from inside `modules/py/`, since that directory's scripts don't import via the `backend.` package prefix the way the running app does.

- [ ] **Step 3: Syntax-check**

Run: `python3 -c "import ast; ast.parse(open('/var/home/staygold/ai-frontend/modules/py/backfill_lore_chunks.py').read())"`
Expected: no output.

- [ ] **Step 4: Run it live against the real database**

Run: `podman exec -w /app/ai-frontend/modules/py story-game ../../venv/bin/python3 backfill_lore_chunks.py`

Then verify directly: query the two known oversized entries from the spec (the ~7063-token entry and the `always=1` ~1228-token entry) and confirm they now have `lore_chunks` rows:

```bash
podman exec -w /app/ai-frontend story-game venv/bin/python3 -c "
import asyncio
from backend import db

async def main():
    await db.init()
    from backend.repositories import lore_chunks as lore_chunks_repo
    rows = await db._q(db.select(db.lore).order_by(db.func.length(db.lore.c.content).desc()).limit(1))
    lid = rows[0]['id']
    chunks = await lore_chunks_repo.chunks_for(lid)
    print(lid, len(chunks), 'chunks')

asyncio.run(main())
"
```

Expected: the largest entry now shows more than 1 chunk (previously 0).

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 100 story-game | grep -i "error\|traceback"`
Expected: no new errors from the backfill run.

- [ ] **Step 5: Commit**

```bash
git add modules/py/backfill_lore_chunks.py
git commit -m "Add backfill script to re-chunk existing oversized lore entries"
```

---

### Task 10: Cross-cutting integration tests — the whole pipeline together

**Files:**
- Test: `backend/tests/test_memory_lore_integration.py` (new)

**Interfaces:**
- Consumes: everything from Tasks 1-9.
- Produces: no new application code — this task exists purely to verify the pieces built in isolation across Tasks 1-9 actually work correctly *together*, per this plan's stated priority on tight integration. Every test in this file exercises at least two of: `index_lore`, `retrieve`, `fetch_lore_candidates`, `memory_block.build_block`, against a real database, not mocks.

- [ ] **Step 1: Write the integration tests**

Create `backend/tests/test_memory_lore_integration.py`:

```python
import pytest

pytestmark = pytest.mark.asyncio


async def test_oversized_always_entry_actually_reaches_the_rendered_block(db_conn, monkeypatch):
    from backend.retrieval import index_lore, retrieve
    from backend import lore_memory, memory_ranking, memory_block
    from backend.repositories import lore

    async def fake_embed(*args, **kwargs):
        return [0.1] * 768
    monkeypatch.setattr("backend.llm.embed", fake_embed)

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
    assert len(pinned) >= 1
    assert any(lid in c["id"] for c in pinned)

    block, used_ids, dropped_ids = memory_block.build_block(pinned, [], [], budget_tokens=20000)
    assert "Aurelia" in block or "kingdom" in block.lower()


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
    from backend import lore_memory

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
```

Add the missing import at the top if `memory_ranking` isn't already imported in the third test's scope — it needs `from backend import memory_ranking` alongside the other imports at module level or inside the test function, matching whichever import style the rest of the file uses.

- [ ] **Step 2: Run and verify all pass against the real database**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_memory_lore_integration.py -v`
Expected: PASS, all 3 tests. If any fails, this is a real integration bug between two pieces that each passed their own isolated unit tests — do not weaken the test to make it pass; fix the actual integration gap in the relevant Task's code.

- [ ] **Step 3: Run the full test suite for this plan's touched files together**

Run: `podman exec -w /app/ai-frontend story-game venv/bin/python3 -m pytest backend/tests/test_lore_chunks_repo.py backend/tests/test_retrieval.py backend/tests/test_vectors.py backend/tests/test_lore_memory.py backend/tests/test_lore_repo.py backend/tests/test_lore_router.py backend/tests/test_schemas.py backend/tests/test_memory_lore_integration.py -v`
Expected: PASS, every test from every task in this plan, run together in one session — this is the check that nothing from an earlier task regressed when a later task touched a shared file.

- [ ] **Step 4: Live-verify**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health`
Expected: `401`

Run: `podman logs --tail 50 story-game | grep -i "error\|traceback"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_memory_lore_integration.py
git commit -m "Add cross-cutting integration tests for the full lore chunking pipeline"
```

---

### Task 11: 50-turn live stress test

**Files:**
- Modify: `modules/py/memory_probe_scripts/run_academy_live.py` (only if needed — read it first)

**Interfaces:**
- Consumes: the entire feature built in Tasks 1-10, running live against the real chat pipeline.
- Produces: no new application code. A real, measured result for whether this plan's changes work in practice, not just in unit tests.

- [ ] **Step 1: Read the existing harness**

Read `modules/py/memory_probe_scripts/run_academy_live.py` in full. It already runs a 50-turn (`NUM_TURNS = 50`) live stress test with the model generating both the user's (persona's) and the character's turns, with milestone-driven scene shifts, against a real character/persona/session in the live database. Confirm it still works unmodified against the current codebase — this plan's changes (chunking, caps, AND/OR/NOT, recursion) are all internal to the retrieval/memory pipeline and shouldn't require changes to a harness that already just drives real chat turns through the normal API.

- [ ] **Step 2: Add lore content that actually exercises this plan's changes**

Before running, add real lore entries to the test character (`CHAR_ID = "cf19fbf4f821f"` per the script) that specifically exercise what this plan built: at least one entry over `LORE_CHUNK_THRESHOLD_TOKENS` (500 tokens) marked `always=True` (to exercise chunking + the pinned cap), and at least one entry using `require_keys`/`exclude_keys` (to exercise the new AND/NOT matching) tied to a milestone event already in the script's `MILESTONES` dict (e.g. a `require_keys=["war"]` entry that should only surface once the war-declaration milestone has actually happened in the generated story). Add these via direct repository calls (`lore.create`) in a short setup script, or manually through the live app UI if that's more reliable — either way, confirm via a direct query that the entries exist with the right flags before running the main script.

- [ ] **Step 3: Run the 50-turn stress test**

Run: `podman exec -w /app/ai-frontend/modules/py/memory_probe_scripts story-game ../../../venv/bin/python3 run_academy_live.py`

This will take real wall-clock time (50 turns of real LLM generation) and incur real API cost against whatever chat endpoint is configured — confirm with the user before running if there's any doubt about which endpoint/cost is in play, per this project's established "don't waste API spend carelessly" discipline from earlier in this session.

- [ ] **Step 4: Verify the specific things this plan changed, not just general recall**

After the run completes, directly inspect (via DB query or the admin panel) whether:
- The oversized `always` lore entry actually appeared in at least one turn's rendered memory block (confirms chunking + pinning + cap survive real usage, not just the integration tests).
- The `require_keys`/`exclude_keys` entry appeared only after its milestone, not before (confirms AND/NOT matching works against real generated text, not just controlled test fixtures).
- No error appeared in `podman logs` for any of the 50 turns related to `lore_chunks`, `lore_vectors`, or the new candidate-expansion logic.

- [ ] **Step 5: Report the result honestly**

Write a short report (in your final task report, not a new file unless the user asks for one) stating: whether the test completed all 50 turns without errors, whether the two plan-specific checks in Step 4 passed, and — if a probe/scoring mechanism from the earlier 1700-turn stress test is still applicable to this 50-turn run — what the actual recall number came out to. If anything failed, say so plainly rather than characterizing a partial result as success; this task's whole purpose (per the plan's Goal and this project's established practice this session of measuring rather than assuming) is to find out the truth, not to confirm a hoped-for outcome.

- [ ] **Step 6: No commit for this task**

This task produces a live-run report, not a code change (unless Step 1 found the harness genuinely needed a fix, in which case commit that fix separately with a clear message, and re-run from Step 3 after committing it).

---

## Self-Review Notes

- **Spec coverage:** Section 1 (threshold) → Task 2. Section 2 (schema) → Task 1. Section 3 (chunking logic) → Task 3. Section 4 (retrieval, both semantic and keyword) → Tasks 4 and 5. Section 5 (pinned cap) → Task 4. Section 6 (migration) → Task 9. Section 8 (character card limit) → Task 8. Section 10 (AND/OR/NOT) → Task 5. Section 11 (recursion) → Task 5. Section 12 (schema/UI surface) → Task 6. Section 13 (chunk preview) → Task 7. All spec sections are covered. The plan adds Task 10 (cross-cutting integration tests) and Task 11 (50-turn stress test) beyond the spec's own Testing section, directly per the user's explicit priority: "fix the lore/memory system, ensure extremely tight integration, stress test with 50 turns."
- **Placeholder scan:** Task 9's exact import surface for `modules/py/` scripts and Task 6's exact editor-UI insertion point are flagged as "read the real file first" rather than guessed — this is a deliberate instruction to verify against reality, not a content placeholder; all code given is complete and real.
- **Type consistency:** `chunk_lore_content(content: str) -> list[str]` (Task 2) is used identically by `index_lore` (Task 3) and the preview endpoint (Task 7) — the single-source-of-truth guarantee the spec requires. `MAX_PINNED_LORE_CHUNKS` (Task 4) and `LORE_RECURSION_MAX_DEPTH`/`LORE_CHUNK_THRESHOLD_TOKENS` (Tasks 2, 5) are each defined once and referenced, never redefined. `_entry_matches` (Task 5) reads `require_keys`/`exclude_keys` as lists, matching exactly how Task 1's `_lore_row` and Task 6's `repositories/lore.py`'s `_row` both parse them.
