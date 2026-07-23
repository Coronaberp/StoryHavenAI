# Session Lore State — Design Spec

Date: 2026-07-17

## Problem

Today the `hidden` flag on a lore entry is binary and permanent: hidden
content is always visible to the character's owner and always invisible to
everyone else, forever, regardless of what actually happens in a chat
session. The AI already has full backend access to hidden entries at all
times (`retrieval.py`'s `retrieve()` never filters by `hidden`) — the flag
only gates the human-facing Grimoire UI. Nothing connects "this secret got
said out loud in the story" to "this entry should now be visible to the
person playing."

Separately, when the model drifts or hallucinates (misremembers a detail,
contradicts something said earlier), there is currently no way for the User
to correct it — the only recourse is hoping the next reply self-corrects.

## Roles

Two roles, not three. The **Author** creates the character, writes the
opening, and authors the lorebook — entirely offline, before any session
exists. The **User** is whoever is actually chatting, live, in a given
session — the Author playing their own character, or a stranger playing a
public one the Author made. There is no third human "GM" role — the AI
plays that part. The Author is never present during someone else's live
session to approve anything; every trigger in this spec is therefore a
**User action on their own session**, never routed back to the Author.

## Scope

In scope:
- **Discovery, at the granularity of individual facts, not whole entries.**
  A hidden entry is not one atomic secret — it's a set of independent
  facts, and revealing one must never imply or leak the others. Concrete
  example that shaped this: an entry says a character likes sweets *and*
  hates cake. If the story only ever established that she likes sweets,
  the "hates cake" fact must stay completely hidden — it cannot ride along
  just because it lives in the same lore entry. Facts are decomposed once
  per entry (cached), and discovery/reveal happens per fact, per session.
- **Override**: the User can hand-edit an entry's effective content for
  their own session. The override is written into `memory_facts` as a
  **pinned** fact, so it actively steers what the AI generates going
  forward — not a passive display-only journal entry.
- Works identically in `character` mode and `rpg` mode — the mechanism sits
  upstream of `build_system`'s mode branch in `prompt.py`, which only
  changes narration instructions, never what lore/memory is fed in.

Out of scope (explicitly deferred, not decided against):
- **Mutation via the memory supersede chain** (an entry automatically
  reading differently because of a reconciled memory fact) — blocked on a
  real gap: `memory_facts.participants` is a list of free-text name
  strings, not lore entry IDs, so there is no reliable way today to resolve
  "this memory fact is about this Grimoire entry." Needs that resolution
  built first.
- **Automatic detection of which fact "just got revealed" in the chat
  transcript.** Reveal is a manual User action per fact, same reasoning as
  everywhere else in this spec: an automatic trigger's failure mode is a
  premature spoiler, and per-fact granularity makes an automated guess even
  riskier than the earlier per-entry version would have been.
- **New lore entries auto-suggested from story progression** — a
  meaningfully bigger feature (structured-content generation, not just
  extraction), sized separately.
- Changing what the AI itself is allowed to see (`retrieval.py` stays
  completely untouched for AI access in this iteration — the model remains
  omniscient re: hidden lore exactly as it is today, including every fact
  within a hidden entry; this feature only ever gates what the *human*
  sees).

## Data model

Three new tables. Named `lore_secrets`/`session_secret_reveals` rather than
reusing "fact," which is already `memory_facts`' vocabulary for a
completely different concept (extracted chat memories) — keeping the two
apart avoids a confusing collision in code and in this doc.

```python
lore_secrets = sa.Table(
    "lore_secrets", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("lore_id", sa.Text, nullable=False),
    sa.Column("text", sa.Text, nullable=False),
    sa.Column("position", sa.Integer, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
)

session_secret_reveals = sa.Table(
    "session_secret_reveals", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("session_id", sa.Text, nullable=False),
    sa.Column("secret_id", sa.Text, nullable=False),
    sa.Column("revealed", sa.Float, nullable=False),
    sa.UniqueConstraint("session_id", "secret_id", name="uq_session_secret_pair"),
)

session_lore_state = sa.Table(
    "session_lore_state", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("session_id", sa.Text, nullable=False),
    sa.Column("lore_id", sa.Text, nullable=False),
    sa.Column("override_content", sa.Text),
    sa.Column("override_fact_id", sa.Text),
    sa.Column("updated", sa.Float, nullable=False),
    sa.UniqueConstraint("session_id", "lore_id", name="uq_session_lore_pair"),
)
```

`lore_secrets`: one row per atomic, independent fact a hidden entry
contains — generated once per entry (see below), shared across every
session, exactly like the old single `hidden_summary` column was, just
decomposed into rows instead of one blob. `session_secret_reveals`: the
per-session reveal state, one row per (session, secret) that's actually
been revealed — a secret with no row for a given session is simply not
revealed there yet. `session_lore_state` keeps only the override fields now
that discovery moved to the secret level — it no longer owns a `discovered`
flag at all.

`memory_facts` gains a `pinned` argument on `insert()` (the column already
exists, `insert()` just hardcodes `False` today) and a new `update_text()`
function, so re-saving an override updates the same pinned fact instead of
accumulating duplicates.

### Decomposing an entry into independent secrets

A new side-call in `backend/ai_helpers.py`, `extract_lore_secrets()`,
follows the exact pattern `expand_persona_description()` already
establishes (one `llm.chat_stream` call, plain text out, no JSON) — the
model is instructed to break the entry's content into a numbered list of
short, **mutually independent** facts, explicitly told that no fact may
imply, hint at, or require another fact to make sense on its own, and never
to quote more than a few consecutive words of the source verbatim in any
one fact. The "likes sweets / hates cake" example is baked directly into
the prompt as a worked example of two facts that must be split, specifically
because they'd otherwise leak each other by association.

Generated once per entry, not once per session, and only when actually
needed — the first time any session's User opens that entry's per-fact
reveal list (`GET .../lore/{lid}/secrets`, see API below), not eagerly on
entry creation. `repositories/lore.py`'s `update()` deletes that entry's
`lore_secrets` rows whenever `content` changes, so a stale decomposition
can never survive an edit — the next time anyone opens the reveal list
after an edit, it regenerates from the current content.

**Hard fallback rule:** if generation fails for any reason (LLM error,
empty result, a response that doesn't parse into a list), the reveal list
for that entry is simply empty for this request — the User sees "nothing
to reveal right now, try again" and can retry. This is never grounds to
fall back to displaying the entry's raw `content` as a stand-in list of
one giant "secret."

## API

New router `backend/routers/session_lore.py`, every endpoint gated by
`_own_session(sid, current_user)` (from `chat_service.py`) exactly like
every other session-scoped endpoint in this codebase — a User can only ever
touch their own session's overlay, which is also why there is nothing to
moderate across different Users of the same public character.

- `GET /api/sessions/{sid}/lore` — returns the character's lore entries
  annotated with this session's state. Non-hidden entries always included
  with real content, unchanged from today. A hidden entry is included only
  if it has at least one revealed secret for this session, and its
  `content` is the **join of only the revealed secrets' text** — never the
  entry's real `content` field, and never secrets that haven't been
  individually revealed — unless a `session_lore_state.override_content`
  exists, in which case that (the User's own words) wins entirely, same as
  before. Every entry carries `player_edited: bool`.
- `GET /api/sessions/{sid}/lore/{lid}/secrets` — the per-entry reveal
  picker. Lazily decomposes the entry into `lore_secrets` rows if none
  exist yet (or content changed since the last decomposition — see above).
  Returns one row per secret: `{"id", "revealed": bool, "text": str | null}`
  — **`text` is `null` for any secret not yet revealed in this session.**
  The unrevealed secret's text is never sent to the client at all, not
  even as a hidden/collapsed field — this is the same discipline as the
  entry-level `content`/`keys` boundary, just applied one level deeper.
- `POST /api/sessions/{sid}/lore/{lid}/secrets/{secret_id}/reveal` —
  reveals exactly one secret for this session. 404 if the secret doesn't
  belong to `lid`, or `lid` doesn't belong to this session's character —
  a secret id is only ever meaningful scoped to its own entry, never
  guessable/reusable across entries. **If Memory V2 is enabled for this
  session, also inserts an ordinary (non-pinned) `memory_facts` row**
  recording that this specific fact became known — reusing
  `memory_facts.insert()` from Task 2, `fact_type="state"`, unpinned. This
  is deliberately not gated behind the same hard requirement the override
  endpoint has: reveal works completely standalone with Memory V2 off (it's
  a UI/display feature first), this insert is a bonus, best-effort
  enrichment when V2 happens to be on — wrapped in the same
  try/log.warning-don't-fail pattern this codebase already uses elsewhere
  for non-critical side effects (e.g. `index_lore`'s embedding failure
  handling in `routers/lore.py`), so a Memory V2 hiccup can never block the
  reveal itself. The point: without this, a revealed secret is inert lore
  the AI already silently knew; with it, the reveal becomes a first-class
  memory the GM can naturally reference and build on ("since you found
  out...") through the exact same KNN/ranking pipeline every other memory
  already goes through — not a separate, disconnected system.
- `PUT /api/sessions/{sid}/lore/{lid}/override` — body `{"content":
  str | null}`. `null` clears the override (deletes the
  `session_lore_state` row's override fields and, if `override_fact_id` is
  set, expires that pinned memory fact rather than deleting it outright —
  consistent with how `memory_facts` never hard-deletes, only expires via
  `valid_until_turn`/`expired_ts`). A non-null value upserts
  `override_content` and either creates a new pinned `memory_facts` row
  (first override) or calls `update_text()` on the existing
  `override_fact_id` (subsequent edits to the same override) — never
  duplicate pinned facts for the same (session, entry) pair.
- `GET /api/sessions/{sid}/lore/hidden` — **the discovery trigger surface,
  entry-level.** Nothing in this app's chat UI reads hidden content
  anywhere today, so there was no existing place to hang a "reveal
  something" action off of — this endpoint exists specifically to create
  one. Lists hidden entries that still have at least one unrevealed secret
  for this session, as `{"id", "name", "category"}` — a character's name
  and category are not the protected material (an entry can be about
  someone everyone can already see and name, while the *details* about
  them are what's hidden), so showing those is fine; **`content` and
  `keys` never appear here, full stop.** Clicking through from this list is
  what opens the per-entry `.../secrets` picker above.

## Frontend

A new "Session Lore" row in the existing chat header dropdown (`chat.js`,
alongside "Character state", "Mask", "Response style"), opening a modal
that mirrors `openCharStateModal()`'s existing fetch/render pattern exactly:
loading state, then either an empty state or a list of entries grouped the
same way the List view already groups by category.

A **"Still hidden"** section (only rendered if the hidden-entries list is
non-empty) lists each entry with at least one unrevealed secret, by name,
with a **"What's hidden here?"** action that opens that entry's per-secret
picker: a plain list of rows, each either a revealed secret's actual text
or a generic "Something is hidden here" placeholder with its own **Reveal**
button. Revealing one secret updates just that row in place — the other
secrets in the same entry stay exactly as hidden as they were.

Each entry in the main list: title, content (the session's effective
content — override if present, else the join of whatever secrets have been
revealed so far), and one action:
- **Edit** — opens an inline textarea pre-filled with the current effective
  content. Saving shows the three-line warning **every time**, not a
  one-time dismissible dialog, immediately before the save actually commits:

  > "This gets pinned into the AI's memory — it will write as if this is
  > true starting now."
  > "That overrides what the Author actually built — their intent for who
  > this character is, and how this story was meant to unfold."
  > "Your story from here can drift somewhere the Author never designed
  > for — and the further you push it, the harder that is to undo."

  A "Clear override" action (sends `content: null`) reverts to the
  original/discovered content and is not behind the warning — reverting
  toward the Author's original intent carries none of the risk the warning
  exists for.

## Idiot-proofing

- Self-contained per session: a User can only ever read/write their own
  session's overlay — `_own_session` already enforces this for every other
  session-scoped endpoint, reused verbatim here.
- Revealing an already-revealed secret is idempotent, not an error — the
  frontend action is a plain button that can be clicked more than once
  without consequence.
- A secret can only ever be revealed one at a time, explicitly, by id — the
  route requires knowing the exact `secret_id`, and unrevealed secret ids
  are never sent to the client in the first place (only revealed ones carry
  `text`), so there's no way to "guess and reveal" a secret you were never
  shown.
- Re-saving an override updates the same pinned fact rather than piling up
  duplicates that would double-count in future ranking/retrieval.
- Clearing an override never deletes the underlying memory fact outright —
  it expires it the same way every other superseded fact already expires,
  so a User can't corrupt the memory table's invariants by clearing
  something.
- The warning is shown on every override save, not gated behind a one-time
  acknowledgment a User could dismiss once and forget — the risk is
  per-edit.
- Editing a hidden entry's `content` deletes its cached `lore_secrets` —
  the next reveal-picker open regenerates from the new text, so an Author's
  edit can never leave stale, now-inaccurate secrets sitting around from
  before the edit.
- The decomposition step's own failure mode is an empty list, never a
  fallback to raw `content` — there is no code path, including the failure
  path, where any surface can leak more of the Author's original text than
  a User has explicitly, individually earned by revealing that exact
  secret.

## Testing

New `backend/tests/test_lore_secrets_repo.py`: decomposition creates the
right number of rows in the right order; editing an entry's content deletes
existing secrets; revealing a secret is idempotent; a secret revealed in
one session is not revealed in another; the entry-level listing only
includes revealed secrets' text, never unrevealed ones, even when some of
each exist side by side on the same entry (the "likes sweets, hates cake"
case, tested directly).

`backend/tests/test_session_lore_state_repo.py`: override create vs.
update (same `override_fact_id` reused, not duplicated); clearing an
override expires rather than deletes the pinned fact; a User's overlay is
invisible to a different session entirely (no cross-session leakage).

`backend/tests/test_memory_facts_repo.py` (new, if none exists — check
first) or extending whatever exists: `insert(..., pinned=True)` actually
persists `pinned=1`; `update_text()` changes text/embedding without
resetting `reinforcements`/`valid_from_turn`.

Router-level tests for `session_lore.py` follow the existing pattern seen
in `test_lore_repo.py` (calling router functions directly with a plain
`current_user` dict, not a full HTTP client) — ownership rejection (a
different session's `current_user` gets 404), a secret revealed for one
entry can't be revealed via a different entry's id, override create/
update/clear round-trip through the real endpoint, and the specific
"partial reveal never leaks the other secret" scenario end to end through
the actual `GET /lore` listing.

No new frontend test infrastructure exists in this repo for `new_ui/` — the
modal is verified manually against the live app, per this project's
established pattern for every prior frontend task in this session.
