# Migration readiness: SQLite + Redis → PostgreSQL + pgvector

This is a **readiness assessment and plan**, not a completed migration — there's no target database connection string, hosting choice, or downtime window specified yet, and guessing at those would produce code that can't actually be tested. What follows is what a real migration would involve, and the concrete things in the current codebase that would need to change first.

## Why this is worth doing eventually

Today's architecture is two databases: SQLite (`db.py`, via `aiosqlite`) for all structured data, and Redis Stack (`vectors.py`) purely for HNSW vector search on memory/lore embeddings. Consolidating onto PostgreSQL + the `pgvector` extension would:

- **Drop a whole service dependency** — no separate Redis container, one connection string, one backup story.
- **Replace the hand-rolled write-serialization lock** added in this review (`db._write_lock` in `db.py`) with real transactions and a proper connection pool — Postgres's MVCC handles concurrent writes correctly by default; the lock exists specifically because SQLite's single-connection model doesn't.
- **Make vector search queryable alongside relational data** — e.g. "top memories for this session AND this character" becomes one SQL query with a `WHERE` clause instead of a Redis tag filter plus a separate SQLite lookup to resolve lore IDs back to content.

## Schema mapping

| SQLite (current) | PostgreSQL (target) | Notes |
|---|---|---|
| `TEXT PRIMARY KEY` (all id columns, via `nid()`) | `TEXT PRIMARY KEY` | No change — ids are already opaque strings, not SQLite-specific. |
| `INTEGER PRIMARY KEY AUTOINCREMENT` (`messages.seq`) | `GENERATED ALWAYS AS IDENTITY` or `BIGSERIAL` | Syntax differs; semantics the same. |
| `TEXT ... DEFAULT '[]'` / `'{}'` holding `json.dumps()`d values (`tags`, `assets`, `alt_greetings`) | `JSONB` | Real win, not just portability — Postgres can index and query into JSONB directly instead of only ever reading the whole blob out and parsing in Python. |
| Fernet-encrypted text (`enc:` prefix, `scenario`/`persona`/`content`/etc.) | `TEXT` (unchanged) | Encryption is at the application layer (Fernet in `db.py`), not the database's — this carries over with zero changes. The key-source logic (`SECRET_ENCRYPTION_KEY` env var, falling back to a `settings`-table-stored key) is fully portable. |
| `PRAGMA journal_mode=WAL` / `PRAGMA foreign_keys=ON` | _(drop both)_ | SQLite-specific pragmas. Postgres's WAL is on unconditionally and foreign keys are enforced by default once declared. |
| `?` positional placeholders | `$1, $2, ...` (asyncpg) or ORM-bound params (SQLAlchemy) | See "the real blocker" below. |

## The real blocker: raw `?`-placeholder SQL throughout `db.py`

Every query in `db.py` is hand-written SQL using SQLite's `?` placeholder style, including dynamically-built `WHERE`/`IN` clauses (e.g. `list_characters`'s `conditions`/`params` list-building, the `marks = ",".join("?" * len(ids))` pattern used for `IN (...)` lookups in several places). None of this is portable to asyncpg's `$1`/`$2` numbered-placeholder style without a rewrite of every query.

**Recommendation: don't hand-port to raw asyncpg — introduce SQLAlchemy Core** (not the full ORM, just the query-builder + async engine) as the migration vehicle. Reasons:
- SQLAlchemy Core abstracts placeholder style entirely — the same `select()`/`insert()`/`update()` constructs work against SQLite today and Postgres tomorrow, so the migration can be done **in two steps instead of one**: first port `db.py` to SQLAlchemy Core against the *existing* SQLite file (verify nothing broke), then swap the connection string to Postgres (a one-line change) once that's proven.
- It keeps the dynamic `WHERE`-clause-building pattern (`list_characters`, `list_lore`, etc.) expressible in Python rather than hand-concatenating placeholder strings for a new dialect.
- The router layer (`routers/*.py`) never touches SQL directly — every route calls `db.xxx()` functions — so as long as `db.py`'s public function signatures stay identical, **zero changes are needed above the data layer**. This is exactly why the recent `server.py` modularization matters here too: the routers already only depend on `db`'s function contracts, not its internals.

## Vector search: Redis HNSW → pgvector

`vectors.py` currently does three things `pgvector` replaces directly:

| Redis (current) | pgvector (target) |
|---|---|
| `mem_idx` / `lore_idx` HNSW indexes (`FT.CREATE`, `VectorField`) | `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` on a `vector(EMBED_DIM)` column |
| KNN query (`_knn` helper, cosine distance via `Query(...).sort_by(vector_score)`) | `SELECT ... ORDER BY embedding <=> $1 LIMIT k` (`<=>` is pgvector's cosine-distance operator) |
| Tag-based scoping (`@session:{sid}`, `@chartag:{cid\|_global}`) | Plain `WHERE session_id = $1` / `WHERE char_id = $1 OR char_id IS NULL` — this is actually simpler in SQL than Redis's tag-escaping syntax |
| Separate `mem_idx`/`lore_idx` reset on `EMBED_DIM` change (`FT.DROPINDEX ... DD`) | `DROP INDEX` + `ALTER TABLE ... ALTER COLUMN embedding TYPE vector(new_dim)` |

Two new tables would replace the two Redis indexes:
```sql
CREATE TABLE memory_vectors(
    id TEXT PRIMARY KEY,        -- the triggering user message id, matching today's Redis key
    session_id TEXT NOT NULL,
    char_id TEXT,
    text TEXT NOT NULL,
    ts BIGINT NOT NULL,
    embedding VECTOR(768)       -- EMBED_DIM
);
CREATE INDEX ON memory_vectors USING hnsw (embedding vector_cosine_ops);

CREATE TABLE lore_vectors(
    lore_id TEXT PRIMARY KEY,
    char_id TEXT,               -- NULL = global
    embedding VECTOR(768)
);
CREATE INDEX ON lore_vectors USING hnsw (embedding vector_cosine_ops);
```
`vectors.py`'s public function signatures (`store_memory_vector`, `search_memory`, `store_lore_vector`, `search_lore_ids`, `delete_memory`, `purge_memory`, `list_memory`, `search_memory_scored`) would be reimplemented against these tables — same approach as `db.py`: keep the function contracts identical so nothing above this layer needs to change.

## What's already migration-friendly (no work needed)

- **The encryption layer** — Fernet operates on plain strings before they ever reach SQL; it's fully database-agnostic.
- **The router/service layer** — `chat_service.py`, `prompt.py`, `auth.py`, and every file under `routers/` only call `db.xxx()`/`vectors.xxx()` functions, never raw SQL or Redis commands directly. This was true before this session's modularization and is stronger now that `server.py` itself has been split along the same lines.
- **`llm.py`/`imagegen.py`** — entirely unrelated to storage, no changes needed.

## Suggested phased plan (not started — sequencing only)

1. **Port `db.py` to SQLAlchemy Core, staying on SQLite.** Verify full parity (every route, every existing test/manual smoke pass) before touching Postgres at all — this isolates "did the query rewrite break anything" from "did the new database break anything."
2. **Stand up Postgres + pgvector alongside the existing stack**, point the SQLAlchemy engine at it, run schema creation, and do a one-time data export/import script (SQLite rows → Postgres inserts; this needs to run through the app's own encrypt/decrypt helpers if any re-encryption is desired, or copy ciphertext as-is since Fernet output travels unchanged).
3. **Port `vectors.py` to pgvector**, backed by a one-time re-embedding pass (safest) or a raw vector-blob export/import from Redis (faster, couples the migration to Redis's binary vector format).
4. **Cut over**: point `DB_PATH`-equivalent config at the Postgres DSN, decommission the SQLite file and Redis container once parity is confirmed in production traffic for a burn-in period.
5. **Remove `db._write_lock`** — the SQLite-specific concurrency workaround becomes dead code once Postgres's own transaction handling is in place.

## Open questions only you can answer before step 2 can start

- Target hosting (self-managed Postgres in the same compose stack vs. a managed service)?
- Acceptable downtime window for the cutover, or does this need to be a live/zero-downtime migration?
- Keep `EMBED_DIM=768` as-is, or take the opportunity to change embedding models during the migration (affects the `vector(N)` column width)?
