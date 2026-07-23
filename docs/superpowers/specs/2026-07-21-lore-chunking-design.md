# Lore Chunking, Content Size Limits & Lorebook Matching (Memory v2.1)

## Problem

A lore entry is currently one atomic, all-or-nothing unit in the memory/lore
token budget (`backend/memory_block.py`'s `build_block`). Each candidate is
either fully included or fully dropped — never truncated, never partially
shown. If a single entry's estimated token cost exceeds the budget slice
it's competing for, it silently never appears, forever, with no warning to
anyone.

This is not theoretical. Checked directly against the live database:

- One `always=1` lore entry is ~1228 estimated tokens. Before this session's
  budget increase (`memory_v2_budget_tokens` was 1000, reserved tier 60% =
  600), it almost certainly never once made it into the reserved tier since
  its creation — the `always` flag was silently doing nothing for it.
- Several non-`always` entries are 2000-7000+ tokens (one is a genuine
  ~7063-token entry, roughly 5000+ words). These can never be recalled via
  semantic search either, since each alone exceeds the entire budget.
- `LoreIn.content` (`backend/schemas.py`) has no length limit at creation
  time — nothing stops a creator from writing an essay into one field.

`memory_v2_budget_tokens` was raised to 20000 as part of this same session
(a live-configurable setting, no code change needed, no hardcoded ceiling)
which alone resolves the immediate crowding pressure — but it doesn't fix
the underlying architectural issue: a sufficiently long entry can always be
written that exceeds whatever the budget is, and today that entry becomes
permanently invisible with zero signal to anyone that it happened.

## Fix

Split long lore entries into ~500-token chunks at index time, each
independently embedded and retrievable, linked back to the source entry via
`lore_id` + `part_id`. This changes the unit of retrieval from "the whole
entry" to "the relevant part of the entry" — a 7000-token essay can
contribute just the ~150-token paragraph that's actually relevant to the
current turn, instead of being all-or-nothing.

## 1. Threshold and trigger

New constant `LORE_CHUNK_THRESHOLD_TOKENS = 500` in `backend/retrieval.py`.
Chunking only activates when an entry's content exceeds this. The vast
majority of lore entries are short and stay completely untouched — one
embedding, one candidate, identical to today's behavior. Only entries over
the threshold get split.

## 2. Schema

New table, `lore_chunks` (`backend/db.py`, alongside the existing `lore`
table):

```
lore_chunks
  id          TEXT PRIMARY KEY
  lore_id     TEXT NOT NULL          -- references lore.id
  part_id     INTEGER NOT NULL       -- 0-indexed order within the entry
  content     TEXT NOT NULL          -- encrypted at rest, same as lore.content
  created_ts  BIGINT NOT NULL
```

Fully derived, regenerated-on-write storage — the same pattern this
codebase already uses for keeping embeddings in sync with content (recompute
from source, don't incrementally patch). An entry under the threshold never
gets a `lore_chunks` row at all.

`lore_vectors`' primary key (`backend/vectors.py`) changes from `lore_id`
alone to a composite `(lore_id, part_id)`, so each chunk gets its own
embedding row. A migration sets `part_id = 0` on every existing row, keeping
every never-chunked entry's existing single-vector behavior exactly as it
is today — `part_id` is invisible plumbing for the common case, not a new
concept a lore author needs to think about.

## 3. Chunking logic

`backend/retrieval.py`'s `index_lore()` gains the split:

- **Under threshold**: behaves exactly as today. One embed call, one
  `store_lore_vector` call, `part_id=0`. No `lore_chunks` row.
- **Over threshold**: delete any existing `lore_chunks`/`lore_vectors` rows
  for that `lore_id` first (re-derive-on-write, matching the codebase's
  existing convention), then split on paragraph boundaries (blank lines),
  greedily packing consecutive paragraphs into ~500-token groups. A single
  paragraph that's itself over 500 tokens falls back to splitting by
  sentence. Embed and store each resulting chunk with its `part_id`.

This keeps each chunk coherent and readable to the model — no mid-sentence
cutoffs — rather than a naive fixed-character slice.

## 4. Retrieval

**Semantic search** (`backend/vectors.py`'s `search_lore_ids`, called from
`backend/lore_memory.py`'s `fetch_lore_candidates`): needs no logic change.
Each chunk already has its own embedding row, so KNN search naturally
operates at chunk granularity for oversized entries and at whole-entry
granularity for everything else — this falls out of the schema change alone.

**Keyword/`always` matching** (`backend/retrieval.py`'s `retrieve`):
currently returns whole `lore` rows. For an entry with `lore_chunks` rows,
this returns one candidate per chunk instead of one candidate for the whole
entry; for an entry with no chunks, behavior is unchanged (one candidate,
the whole entry). Every chunk of an `always` entry stays `pinned=True`
(matching today's `always` semantics per-chunk, per your decision) —
`fetch_lore_candidates` already marks every `keyword_entries` candidate
`pinned=True` (`backend/lore_memory.py:29-33`), so this requires no new
pinning logic, only that `retrieve()` hands it a list of chunk-level
candidates instead of one whole-entry candidate when chunks exist.

**Rendering** (`backend/memory_block._render`): no change needed. Each
chunk is just its own bullet line in the "Established world facts" section,
identical in shape to how multiple *different* lore entries already appear
together with no special formatting linking them.

## 5. Pinned-lore cap: `MAX_PINNED_LORE_CHUNKS`

Raising `memory_v2_budget_tokens` to 20000 removes the crowding *pressure*
but doesn't bound how much of it actually gets used. A larger context
window doesn't mean the model uses a large prompt well — this is a
well-documented effect across current LLMs generally (sometimes called
"lost in the middle"): instruction-following and coherence measurably
degrade as prompt length grows, even far below the model's stated max
context, because attention isn't uniform across a long input. A prompt
padded with mostly-irrelevant pinned content can measurably hurt output
quality even though nothing technically overflows.

Memory facts already have this bounded: `MAX_ACTIVE_RESERVED_FACTS = 12`
(`backend/memory_ranking.py`) caps the unconditional-reserve tier
regardless of how large the token budget is. Lore's `always` path has no
equivalent — every `always`-flagged entry's chunks get pinned, unbounded,
every turn, no matter how many exist or how irrelevant to the current
scene. A heavily-loremaxxed character (many `always` entries) could
otherwise silently degrade its own roleplay quality by flooding every
reply's prompt with mostly-irrelevant pinned world-facts.

New constant `MAX_PINNED_LORE_CHUNKS = 12` (`backend/lore_memory.py`,
matching the existing memory-side cap's value for consistency). In
`fetch_lore_candidates`, after building the `pinned=True` candidate list
from `keyword_entries` (including `always` chunks), sort by importance
(mirroring `memory_service.retrieve_block`'s existing
`active_matching.sort(key=lambda f: (f["importance"], f["last_turn"]),
reverse=True)` pattern) and keep only the top `MAX_PINNED_LORE_CHUNKS`.
Anything cut by the cap is not discarded — merge it into the scored
candidate pool (the same demote-into-scoring approach already built for
memory facts in `memory_service.retrieve_block`), so it still competes for
inclusion via real relevance instead of permanently vanishing.

This, combined with chunking itself, turns today's failure mode (a whole
document silently invisible forever) into graceful, bounded degradation:
some paragraphs make it into the guaranteed tier, the rest compete
normally, and the guaranteed tier itself can never balloon past a sane,
fixed size regardless of how many `always` entries exist or how large the
token budget is set to.

## 6. Migration for existing oversized entries

A one-time backfill script (matching `modules/py/`'s existing convention
for one-off backfills, e.g. `backfill_encrypt.py`): iterate every `lore`
row whose content exceeds `LORE_CHUNK_THRESHOLD_TOKENS`, call the updated
`index_lore()` on each. This naturally chunks them under the new logic —
no separate migration-specific code path, the same function real edits go
through. Both the ~7063-token entry and the `always=1` ~1228-token entry
found in the live database get fixed by this same backfill.

Every existing `lore_vectors` row (all currently single-vector, `part_id`
implicitly 0) needs a schema migration to add the `part_id` column,
defaulting existing rows to `0`, before the composite primary key change
can apply — this happens once, live, via `ALTER TABLE`, matching this
project's established live-migration pattern (`ADD COLUMN IF NOT EXISTS`).

## 8. Character card content limits

Character-defining fields are architecturally worse than the lore problem,
not comparable to it: `system_prompt`, `persona`, `scenario`, and
`dialogue` (`backend/prompt.py`'s `build_system`, confirmed by reading the
actual field usage — `description` is card-display only and never reaches
the model) are assembled into the system prompt **in full, every turn,
unconditionally**. There's no retrieval, no relevance filtering, no
"always" flag needed, because there's no selection step at all — an
oversized field here is pure, permanent prompt bloat with no possibility
of graceful degradation, unlike lore which now has chunking to fall back
on.

New validation in `backend/schemas.py`'s `CharacterIn`: a Pydantic model
validator enforcing that `len(system_prompt) + len(persona) +
len(scenario) + len(dialogue) <= 25000` characters combined (~6250
estimated tokens), matching a known, battle-tested limit used by a
comparable platform for the same purpose. This is generous relative to
real usage — most existing character cards run 500-3000 characters total
across these fields — and only blocks genuine outliers, not normal
detailed character writing. `description` is excluded from this cap
entirely (never sent to the model, no prompt-inflation risk); it keeps
whatever validation it already has, unchanged.

On violation, the API returns a 422 (Pydantic's standard validation
error format) with a clear message naming which combined length was
exceeded — surfaced in the character editor UI (`new_ui/js/
workshop-characters-form.js`) as a real, actionable error near the
save button, not a generic failure.

## 9. Non-goals

- Session-scoped lore content overrides (`session_lore_state`) stay
  unchunked. They're short, LLM-generated update summaries produced by the
  extraction pipeline, not essay-length source material — not a real gap.
- No admin-facing UI changes for chunking. It's fully transparent — an
  admin still edits one block of text for a lore entry; splitting happens
  invisibly at index time. No new concept ("chunks," "parts") is ever
  exposed to a lore author.
- No change to the `memory_v2_budget_tokens` default in code — it was
  already raised live for this deployment via the existing settings
  mechanism, not something this design needs to touch.
- No retroactive change to how non-lore memory facts are chunked or sized —
  this design is scoped to lore content only.
- **No length cap on individual lore entries.** Explicitly decided against
  one — chunking already handles arbitrarily long content gracefully, so a
  hard per-entry limit isn't needed to prevent a technical failure mode.
  `MAX_PINNED_LORE_CHUNKS` (section 5) is the actual guardrail against
  abuse/dilution, not an entry-length limit.
- No combined-length cap on `description` or any other non-prompt-facing
  character field (avatar, tags, appearance_tags, etc.) — only the four
  fields that actually reach the model are covered by section 8's limit.
- **No probability/chance-to-trigger.** Deliberately cut from the original
  "SillyTavern parity" scope. Nondeterministic inclusion makes "why didn't
  this show up" indistinguishable from an actual bug, and for
  continuity-focused roleplay, a fact that sometimes silently doesn't
  apply reads as broken, not as a feature. Revisit only if a concrete need
  shows up later.
- **No insertion depth/position control.** Also cut. Every other mechanism
  in this spec traces back to a real, observed problem in this app's own
  data; this one doesn't — it's parity for its own sake, with real
  plumbing cost (two rendered blocks, a second appended system message,
  two paths to keep in sync). Addable later as its own scoped design if a
  concrete symptom ever points to it.
- **No re-validation against the 1700-turn stress-test harness before
  shipping this feature.** Flagged as a real risk, not silently skipped:
  the last actual measured recall number for this whole memory/lore system
  predates every fix built this session. This feature ships on reasoning
  and per-mechanism tests, not a fresh end-to-end measurement.

## 10. Lorebook matching: multi-key AND/OR/NOT logic

Scoped down from a broader "SillyTavern parity" pass to the two mechanisms
that are deterministic and solve needs lore authors actually run into
often — probability (nondeterministic, actively fights debuggability) and
insertion-depth control (no observed real need, real plumbing cost) were
both cut. See sections 11-12 for what's in scope.

Two new `lore` table columns, matching the existing `keys` column's exact
shape (`sa.Text`, encrypted, comma-joined, parsed via `.split(",")` in
`_lore_row`, same as `backend/db.py:217`):

```
require_keys   TEXT NOT NULL DEFAULT ''   -- AND: all must be present
exclude_keys   TEXT NOT NULL DEFAULT ''   -- NOT: none can be present
```

`backend/retrieval.py`'s per-entry match check becomes:

```python
def _entry_matches(e, text_lower):
    if not any(k.lower() in text_lower for k in e["keys"]):
        return False
    if e["require_keys"] and not all(k.lower() in text_lower for k in e["require_keys"]):
        return False
    if e["exclude_keys"] and any(k.lower() in text_lower for k in e["exclude_keys"]):
        return False
    return True
```

`always` entries bypass this entirely, same as today — `require_keys`/
`exclude_keys` only apply when an entry's inclusion is otherwise
keyword-conditional, matching how `always` already bypasses the plain
`keys` check.

## 11. Recursive scanning

An entry that gets matched can itself contain text that triggers other
entries' keys — chaining related facts in without the author having to
manually cross-reference everything into one giant entry.

New constant `LORE_RECURSION_MAX_DEPTH = 2` in `backend/retrieval.py`.
`retrieve()` changes from a single pass to a bounded loop:

```python
async def retrieve(char_id, session_id, query, recent, viewer_id=None):
    rt = (recent or "").lower()
    entries = await db.list_lore(char_id, viewer_id)
    matched = {}
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

Fixed depth, no per-entry recursion toggle — guarantees termination with no
new UI surface. An entry already in `matched` is never re-evaluated, so
each entry's match check runs at most once per turn regardless of how many
recursion passes occur.

## 12. Schema/UI surface for section 10

`LoreIn` (`backend/schemas.py`) gains `require_keys: list[str] = []` and
`exclude_keys: list[str] = []`. The lore editor
(`new_ui/js/workshop-lore.js`) gains matching fields, kept in a collapsed
"advanced" section of the entry editor so the common case (just `keys` /
`always`, unchanged) stays uncluttered for casual authors — the vast
majority of entries will never touch these fields.

## 13. Chunk preview — making chunking visible, not a black box

Goal: a creator should be able to see and learn from what the system
actually does with their content, not just trust it blindly — while never
requiring anyone to understand chunking to use the app normally.

`backend/retrieval.py`'s paragraph-aware splitting logic (section 3) gets
extracted into a standalone pure function:

```python
def chunk_lore_content(content: str) -> list[str]:
    ...  # the same paragraph-packing/sentence-fallback logic from section 3
```

`index_lore()` calls this function for the real indexing path. A new
endpoint, `POST /lore/preview-chunks` (body: `{"content": str}`, returns
`{"chunks": [str, ...]}`), calls the exact same function for preview
purposes — there is no separate preview-only approximation, so the preview
can never show something different from what actually gets indexed. If
`len(content)` is under `LORE_CHUNK_THRESHOLD_TOKENS`, `chunks` is a
single-element list (today's unchunked behavior), same as what indexing
would do.

**UI: automatic, not a discoverable feature.** In the lore entry editor
(`new_ui/js/workshop-lore.js`), no button, no toggle, nothing to find or
configure. As the author writes, once the content crosses the chunking
threshold, a small info panel appears on its own beneath the content
field — debounced to avoid a preview request on every keystroke, firing
shortly after typing pauses. Plain language, no jargon (no "tokens," no
"part_id," no chunk count math exposed as a formula):

> "This entry is long enough that the AI will read it in pieces so it can
> find the relevant part when it matters. Here's how it splits:"

followed by each returned chunk in its own numbered card. If the author
trims the content back under the threshold, the panel disappears on its
own. Someone who never writes an entry that long never sees this UI at
all — it costs nothing for the common case and only ever appears exactly
when it's true and relevant.

## Testing

- `backend/tests/test_retrieval.py` (new or extended, check if one exists):
  `index_lore()` stays single-vector/no-`lore_chunks`-row for content under
  threshold; splits correctly on paragraph boundaries for content over
  threshold; falls back to sentence-splitting for a single oversized
  paragraph; re-indexing an already-chunked entry deletes and replaces its
  old chunks rather than accumulating duplicates.
- `backend/tests/test_lore_repo.py` or equivalent: `lore_chunks` CRUD.
- `backend/tests/test_vectors.py` or equivalent: composite
  `(lore_id, part_id)` primary key behavior, `search_lore_ids` returning
  chunk-level hits for a chunked entry.
- `backend/tests/test_retrieval.py`: `retrieve()` returns one pinned
  candidate per chunk for an `always` entry with chunks, and the existing
  single-candidate behavior for an entry without chunks.
- Live verification against the actual oversized entries found in
  production data: after the backfill runs, confirm via direct query that
  the ~7063-token entry and the `always=1` ~1228-token entry both now have
  `lore_chunks` rows, and that a chat turn's retrieved memory block can
  actually include content from one of them (previously impossible).
- `backend/tests/test_lore_memory.py`: `fetch_lore_candidates` caps pinned
  lore candidates at `MAX_PINNED_LORE_CHUNKS`, and anything cut by the cap
  shows up in the scored pool instead of vanishing (mirroring the existing
  `test_memory_service.py` coverage for the analogous memory-side cap).
- `backend/tests/test_characters.py` or equivalent: `CharacterIn` rejects a
  combined `system_prompt`+`persona`+`scenario`+`dialogue` length over
  25000 characters with a 422, accepts exactly 25000, and accepts a card
  with a long `description` alone (confirming that field is excluded from
  the cap).
- `backend/tests/test_retrieval.py`: `_entry_matches` covers `require_keys`
  (all must be present, entry excluded if any missing), `exclude_keys`
  (entry excluded if any present), and both combined with `keys`. Recursion
  tests: entry A's content contains a key that matches entry B (B gets
  included even with no direct match against the recent text); a 3-entry
  chain (A triggers B triggers C) is fully included within
  `LORE_RECURSION_MAX_DEPTH = 2` passes; a circular chain (A triggers B
  triggers A) terminates without an infinite loop and without duplicating
  A in the result.
- `backend/tests/test_retrieval.py`: `chunk_lore_content` produces a
  single-element list for content under threshold, and the exact same
  output whether called from `index_lore()` or the preview endpoint (same
  function, called twice, asserted equal) — guarantees the preview can
  never drift from what actually gets indexed.
- `backend/tests/test_lore_router.py` or equivalent: `POST
  /lore/preview-chunks` returns the correct chunk list for short content
  (one chunk) and long content (multiple chunks), with no `part_id`/token
  metadata leaking into the response shape.
