# Embedding swap: nomic-embed-text → Qwen3-Embedding-0.6B

## Goal

Replace the retrieval embedder (`nomic-embed-text-v2-moe`, 768-dim) with `Qwen3-Embedding-0.6B` (1024-dim) to improve multilingual and query→fact retrieval quality for memory v2.1 and lore, without starving the shared GPU. The 0.6B was chosen over the 4B/8B because at this corpus size (762 vectors) the larger models are overkill and their VRAM/latency cost on a GPU shared with the chat and image models is not justified.

## Why this helps memory v2.1

Retrieval is asymmetric: the query is live conversational roleplay text, the documents are terse declarative typed facts. Qwen3's instruction-wrapped query encoding re-projects the conversational query into the declarative-fact space, which sharpens the exact gates memory v2.1 depends on: the hard KNN distance cutoff (`MEM_MAX_DIST=0.80`) and the fixed `TOP_K_MEMORY=4`. A truly-relevant fact currently scoring just past the cutoff can pass it once query and fact are aligned, and the top-4 become more likely to be the right four. This improves the candidate-retrieval stage (recall + threshold precision) that feeds ranking; it does not change the downstream ranking/filter logic (participant-presence window, location matching, batch rollback), but it gives those filters a cleaner candidate pool.

## Decisions

- **Model / dim:** `Qwen3-Embedding-0.6B`, native **1024** dims.
- **Quant:** `Qwen/Qwen3-Embedding-0.6B-GGUF`, **Q8_0** (~600 MB, near-lossless at this size).
- **Pooling:** last-token (Qwen3 requirement; nomic used mean). Configured on the embed container, verified against a real vector rather than assumed.
- **Input format (option A):** asymmetric. The one true retrieval query is instruction-wrapped; everything else stays raw.
- **Re-embed:** both lore (721) and memory (41) after the dim reset.

## Components

### 1. Embed container — `~/.sillytavern/compose.yaml`, service `llamacpp-embed`

- `LLAMA_ARG_MODEL=/models/Qwen3-Embedding-0.6B-Q8_0.gguf`
- Add last-token pooling (llama.cpp `--pooling last`, via the matching `LLAMA_ARG_*` env). Verify the exact env var and whether the GGUF metadata already sets pooling during the verify gate.
- Restart `llamacpp-embed`.
- **Gate:** embed a test string via `llamacpp-embed:5002/v1/embeddings`, confirm the vector is length **1024** and non-degenerate. Do not proceed to the DB step until this passes.

### 2. App config — `backend/state.py`

- `embed_model` default: `nomic-embed-text` → `Qwen3-Embedding-0.6B`.
- `embed_dim` default: `768` → `1024`.
- Update the `settings` table rows (`embed_model`, `embed_dim`) to match, since that override is what the running app resolves.
- The model name is cosmetic for llama.cpp (it serves the loaded model regardless of the request's `model` field); `embed_dim=1024` is the load-bearing value.

### 3. Query-instruction format — `backend/llm.py` + call sites

- Add `embed_query(text, ...)` alongside `embed()`. `embed_query` wraps input as:
  `Instruct: Given the current roleplay moment, retrieve character facts, relationships, unresolved commitments, and world details needed to stay consistent.\nQuery: {text}`
- **Instruction-wrapped (retrieval query):** only `memory_service.retrieve_block`'s `qvec` — the single call that searches conversation → facts/lore for prompt context.
- **Raw (unchanged):** `index_lore` (documents), memory-fact storage, and all dedup/reconcile/lore-update/secret-reveal embeds. A draft matched against existing facts is symmetric similarity, not query→document, so both sides must keep the same raw encoding. Applying the instruction there would degrade dedup.

### 4. DB reset + re-embed

- Changing `embed_dim` triggers `vectors.reset_indexes(1024)`, dropping and recreating the pgvector tables (wipes all 762 vectors). This is the intended, unavoidable consequence of a dimension change.
- **Backfill lore (721):** iterate all lore entries, call `index_lore` (re-chunk + embed + store), following the existing `backfill_lore_chunks.py` pattern.
- **Backfill memory (41):** a small loop re-embedding each live `memory_facts` row's text (raw/document encoding) and storing the vector back.
- Verify KNN returns sane hits for both after backfill.

### 5. Comments

- Strip banned comments/docstrings from every file touched: `llm.py`, `retrieval.py`, `memory_service.py`, `lore_memory.py`, `state.py`, and any other file edited for this change (zero-comments rule).

## Cutover order (each step gated)

1. Download the Q8_0 GGUF into the model volume.
2. Reconfigure + restart the embed container.
3. **Verify 1024-dim, non-degenerate vector.**
4. App changes: `state.py` defaults, `embed_query` wrapper, wire `retrieve_block` query. Confirm `import server` assembles.
5. Set `embed_dim=1024` (settings) → reset_indexes wipes vectors.
6. Re-embed lore + memory.
7. **Verify retrieval** returns sane hits + live `/api/health` returns 401.
8. Strip comments from touched files, re-confirm `import server`.
9. Commit (only with explicit go-ahead).

## Verification

- Container: test embedding length == 1024, non-degenerate.
- App assembly: `import server` OK after each code change.
- Retrieval: a sample query returns non-empty, plausibly-ranked lore + memory hits after backfill.
- Live app: `/api/health` returns 401 (boots) after each stage.

## Out of scope

- No change to ranking/filter logic (participant-presence window, location matching, batch rollback).
- No change to embed_dim truncation via MRL (using Qwen3-0.6B's native 1024).
- No migration of the old 768-dim vectors (they are wiped and re-embedded, not converted).
