# Grimoire Web View — Design Spec

Date: 2026-07-17

## Problem

The Grimoire page (`new_ui/js/grimoire.js`) currently shows a flat list of a
user's lore entries grouped by category. There is no way to see how entries
relate to each other, and the flat list is a poor way to browse a growing
lorebook. The goal is a node-graph ("web") view of a lorebook, in addition to
the existing list, using vis.js.

## Scope

In scope:
- A new `lore_links` relationship between two lore entries, explicit and
  user-managed (not inferred from keys or content).
- A "Linked entries" picker in the existing lore edit modal.
- A List/Web toggle on the Grimoire page.
- A new graph view (`GrimoireWebView`) rendered with vis.js Network.

Out of scope:
- Any change to the existing list view's own behavior.
- Any change to lore retrieval/memory/prompt-building — links are a browsing
  aid only, not fed into the model.
- Directed/typed relationships ("parent of", "enemy of", etc.) — links are
  plain, undirected, unlabeled edges for this iteration.

## Data model

New table in `backend/db.py`:

```python
lore_links = sa.Table(
    "lore_links", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("lore_id_a", sa.Text, nullable=False),
    sa.Column("lore_id_b", sa.Text, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
    sa.UniqueConstraint("lore_id_a", "lore_id_b", name="uq_lore_link_pair"),
    sa.CheckConstraint("lore_id_a != lore_id_b", name="ck_lore_link_no_self"),
)
sa.Index("idx_lore_links_a", lore_links.c.lore_id_a)
sa.Index("idx_lore_links_b", lore_links.c.lore_id_b)
```

Links are undirected. To guarantee a pair can never be stored both ways
(`A,B` and `B,A`), all writes go through `backend/repositories/lore_links.py`,
which always normalizes to `lore_id_a = min(a, b)`, `lore_id_b = max(a, b)`
before insert/delete/lookup — callers never need to think about ordering.

New repository `backend/repositories/lore_links.py`:
- `link(a: str, b: str) -> None` — normalizes order, inserts if not already
  present (no-op, not an error, if the link already exists — idempotent).
- `unlink(a: str, b: str) -> None` — normalizes order, deletes if present.
- `links_for(lore_id: str) -> list[str]` — every entry id linked to this one.
- `links_for_many(lore_ids: list[str]) -> dict[str, list[str]]` — batched
  version used when listing a whole lorebook, avoiding N+1 queries.
- `delete_all_for(lore_id: str) -> None` — removes every link touching this
  entry; called from `repositories/lore.py`'s `delete()` so deleting an entry
  never leaves a dangling edge.
- `set_links(lore_id: str, target_ids: list[str]) -> None` — diffs the
  entry's current links against `target_ids` and calls `link`/`unlink` for
  the difference; this is what the edit-modal save uses so the picker can
  just submit the full desired set each time.

All functions log via `backend/state.log` on mutation (`link`/`unlink`),
consistent with the rest of the repo layer.

## API

- `PUT /api/lore/{lid}/links` — body `{"link_ids": [str, ...]}`. Requires the
  same ownership check `update_lore` already does (owner of the entry's
  character, or admin for global entries). Calls `lore_links.set_links`.
  Returns `{"id": lid, "link_ids": [...]}`.
- `GET /api/lore/mine` and `GET /characters/{cid}/lore` — each returned entry
  gains a `linked_ids: list[str]` field, populated via `links_for_many` in
  one extra query per request (not per entry).

New schema in `backend/schemas.py`:
```python
class LoreLinksIn(BaseModel):
    link_ids: list[str] = []
```

## Frontend — edit modal

`_grimoireEditModal` (`new_ui/js/grimoire.js`) gains a "Linked entries" field
between Keys and Content. It's a searchable multi-select using the same pill
pattern as the existing key-filter chips in the Grimoire search box:
- A text input filters a dropdown of every *other* entry in the same
  lorebook (the current character's entries + all global entries), shown by
  name.
- Picking one adds a pill above the input; each pill has an `×` to remove.
- The entry currently being edited is excluded from its own candidate list —
  self-linking is structurally impossible from the UI, not just rejected by
  the backend.
- On save, after the existing `PUT /api/lore/{lid}` (or POST for new
  entries) succeeds, a follow-up `PUT /api/lore/{lid}/links` submits the
  current pill set. For a brand-new entry this means creating it first to
  get an id, then setting links — same two-step order the image-gen flow
  already uses elsewhere in this file.

## Frontend — Grimoire page toggle

`GrimoireView.render()` (`new_ui/js/grimoire.js`) gets a two-way segmented
control ("List" / "Web") using the existing `filter-chip` style, state held
in `this.mode` (default `"list"`, not persisted across reloads — simplest
behavior, avoids a stale toggle surprising a returning user).

- `mode === "list"` renders exactly the current `bodyHtml()` output,
  unchanged.
- `mode === "web"` mounts a new `GrimoireWebView` into the same content
  column, handing it `this.entries` and `this.chars` (already fetched by the
  page, no duplicate network calls).

## Frontend — `GrimoireWebView` (new file `new_ui/js/grimoire-web.js`)

vis.js is loaded via a `<script>` tag in `new_ui/index.html` (CDN, pinned
version) alongside the other vendored script tags already in that file.

State: `selectedCharId`, `categoryFilter` (default "All categories"),
`frozen` (bool, physics on/off).

Layout, matching the reference mockup:
1. Lorebook dropdown — the user's characters, selects `selectedCharId`.
2. Category dropdown — populated from the distinct non-empty `category`
   values present in the current lorebook's visible entries; "All
   categories" is the default and always first. (Per explicit instruction:
   a `<select>`, not filter pills.)
3. "Reset view" and "Freeze layout" buttons.
4. The graph canvas (a plain `<div>` vis.js mounts into).
5. A static hint line below: "Tap any node to read it — the web zooms to
   just that entry and its links."

**Node set**: every entry belonging to `selectedCharId` plus every global
entry (`char_id === null`), filtered further by `categoryFilter` if set.
Entries with zero links still render as isolated nodes — nothing is ever
hidden just for being unconnected, since a lorebook's first few entries will
always have no links yet.

**Edge set**: every `lore_links` pair where both endpoints are in the
current node set.

**Node sizing**: radius scales with degree (count of edges touching that
node) within the currently visible set, using a fixed min/base/max bucket
(e.g. degree 0 → 18px, each additional connection nudges the radius up to a
capped max ~40px) — no separate library, a few lines of arithmetic.

**Node styling**: fill color keyed off the entry's `category` using the
existing CSS custom properties (`--color-accent`, `--color-primary`, etc. —
never a hardcoded hex, per this repo's theming rule) so the graph re-themes
correctly on accent/light-dark switches. Global entries get a distinct
border treatment so they read as shared across characters.

**vis.js config**: `physics: { solver: "forceAtlas2Based" }` while
unfrozen; `dragNodes: true`, `zoomView: true`, `hover: true`. "Freeze
layout" sets `physics.enabled = false` via `network.setOptions`. "Reset
view" calls `network.fit()`.

**Node click**: opens the existing `_grimoireViewModal` — the same modal the
list view already uses — so there's exactly one entry-detail UI shared by
both views, not a duplicate.

**Empty state**: no entries at all → the same empty state the list view
already shows ("Nothing recorded yet.").

## Mobile-first

The mockup was drawn as a phone screen and this stays true through
implementation, not just visually:
- Lorebook/category dropdowns and the Reset/Freeze buttons stack in a single
  column and are full-width tap targets (≥44px tall) below the mobile
  breakpoint, matching the rest of `new_ui`'s existing form controls.
- The graph canvas takes a fixed aspect ratio (not viewport-height-locked)
  so it doesn't push the hint text and page chrome off-screen on short
  phone viewports.
- vis.js's own touch handling covers pinch-zoom and one-finger pan/drag out
  of the box; `interaction.zoomView` and `dragNodes` are left on for touch,
  no separate mobile code path needed there.
- Node/label sizing has a minimum floor (the 18px baseline above) so labels
  stay legible on a small screen rather than shrinking indefinitely as more
  entries are added.
- Tapping a node (not dragging) opens the view modal — vis.js distinguishes
  a tap from a drag natively, so this doesn't need extra touch-vs-click
  disambiguation code.
- Desktop/tablet/ultrawide get more horizontal room (dropdowns inline
  instead of stacked, larger canvas) via the same breakpoint pattern already
  used elsewhere in `new_ui` — reusing existing tiers, not inventing new
  ones.

## Idiot-proofing checklist

- Self-links: impossible from the UI (excluded from picker) and rejected at
  the DB layer (`CHECK` constraint) as a backstop.
- Duplicate links: impossible — `set_links` diffs against normalized pairs,
  and the `UNIQUE` constraint is a backstop against any future direct
  caller.
- Deleting an entry cleans up its links automatically
  (`lore_links.delete_all_for` called from `lore.delete`) — no dangling
  edges, no orphaned-reference errors later.
- The link picker always shows entry names, never raw ids.
- Physics is on by default (self-organizing) but one click freezes it for
  anyone who finds a moving graph hard to read.
- Global vs. character-owned entries are visually distinguished so a user
  isn't confused about why an entry they didn't add to this character
  appears in the graph.

## Testing

`backend/tests/test_lore_repo.py` (207 lines currently, extending in place
rather than splitting) gains cases for the new repo:
- `link`/`unlink` round-trip.
- Linking the same pair twice is a no-op, not a duplicate row or an error.
- Linking a pair in reversed order (`link(b, a)` after `link(a, b)`) does
  not create a second row.
- Attempting to link an entry to itself raises (surfaced via the DB
  constraint) rather than silently succeeding.
- Deleting a lore entry via `lore.delete()` removes its rows from
  `lore_links` too.
- `links_for_many` returns the correct mapping for a mixed set of linked and
  unlinked entries, including entries with zero links (present as empty
  lists, not missing keys).

No new JS test infra exists in this repo for `new_ui/`; per the project's
existing pattern, the frontend piece is verified manually against the live
app (list/web toggle, add/remove links, filter dropdowns, freeze/reset,
node click opening the existing view modal) rather than with automated
frontend tests.
