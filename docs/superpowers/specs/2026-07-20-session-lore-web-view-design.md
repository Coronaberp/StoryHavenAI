# Session Lore Web View — Design

## Problem

The in-chat "Session Lore" tab (inside the Memory modal opened from a chat's header menu) currently offers a List/Web toggle, but the Web view is a hand-rolled SVG circle with fake radial lines to a center avatar — no real relationship data, no zoom/pan, no interaction beyond a flat tap-to-read. Meanwhile the standalone Workshop Lorebook page already has a genuinely capable graph view (`workshop-lore-web.js`, backed by `vis.js`): category-colored nodes, real relationship edges with arrows and labels, force-directed layout, freeze/reset, click-to-isolate-neighborhood-and-zoom, and a rich detail panel. The in-chat version should be brought up to the same standard, adapted for its narrower, session-scoped context and rendered inside a modal instead of a full page.

## Goals

- Replace the in-chat Session Lore web view with a real `vis.js` force-directed graph, reusing `workshop-lore-web.js`'s proven visual language (category colors, node sizing by relationship degree, real edges from `lore_links`, freeze/reset, click-to-isolate).
- Fit correctly inside a modal, mobile-first: usable on a phone before any desktop refinement is layered on.
- Preserve session-specific behavior the workshop version doesn't need: session-effective content (overrides applied), a visual marker for player-edited entries, no delete action (can't delete a shared lore entry from inside one session), edit opens the existing lightweight session-override editor (not the full lorebook CRUD form).
- Memory tab stays list-only — the List/Web toggle only ever applies to Session Lore, since lore has real relationship structure and flat memory facts don't.

## Non-goals

- No changes to the Workshop Lorebook page itself (`workshop-lore-web.js`/`workshop-lore.js` are read-only references for this work, not modified).
- No changes to how relationships are authored (lore_links CRUD stays where it is, in the Workshop lore editor).
- No char/global selector — a session only ever has one character's lore in play, so that whole dropdown and the char-root/global-root split from the reference implementation is dropped.
- Hidden/unrevealed entries still never appear as nodes (unchanged from current behavior) — the backend already filters these out of `GET /sessions/{sid}/lore`.

## Architecture

**Data**: `GET /sessions/{sid}/lore` already returns session-effective entries (with overrides substituted) and, as of the earlier auto-reveal work, a `links` array per entry (`{target_id, label}`, filtered to only edges between currently-visible entries). No backend changes needed for this feature.

**Frontend**: a new lightweight class (or a function returning the same shape `renderSessionLoreWeb(body, entries)` already stubbed in `chat.js`) that:
1. Builds a `vis.DataSet` of nodes: one root-less structure of `category → entry` (no char/global roots, since there's only ever one character). Category nodes get the same hash-based palette/coloring as the reference. Entry nodes size by relationship degree (reusing `nodeRadius`/`degreeMap` logic verbatim where possible).
2. Builds edges: category→entry structural edges (solid), plus real `lore_links` relationship edges (dashed, arrowed, labeled) — using each entry's `links` field directly instead of re-deriving from a separate `outgoing_links` fetch like the workshop version does.
3. Player-edited entries (`entry.player_edited === true`) get a distinct border/glow color, layered onto the existing category-color scheme.
4. Renders into the modal's body via `vis.Network`, with mobile-first sizing (see below), freeze/reset controls, and a legend.
5. Click a node → isolate its neighborhood (fit view to it + its direct connections), show a detail panel below the canvas with the entry's content and an "Edit" button. Edit opens the existing session-override textarea editor (`openSessionLoreEditor`), not a new component.

**Container**: `openModal(..., { wide: true })`, same as today, with the graph replacing the current `.map()`-based node ring inside `#memBody`.

## Mobile-first layout

- Canvas aspect ratio `4:5` by default (taller than wide, matches portrait phones), widening to `16:10` at `≥640px` — reusing `.grimoire-web-canvas`'s existing CSS rules directly rather than writing new ones.
- `touch-action: none` on the canvas so vis.js's own pan/zoom/drag isn't fought by the modal's page scroll (already true of the reference CSS, carried over unchanged).
- Controls (category filter, Freeze/Reset) stack vertically full-width under `640px`, reusing `.grimoire-web-controls`'s existing responsive rule.
- Freeze defaults **on** for the initial render below `640px` (a settling physics simulation is harder to tap through on a small screen); defaults off at `≥640px`.
- Detail panel renders below the canvas in the same scrollable modal body, never as a floating overlay — avoids a cramped floating box on small screens.

## Error handling

- If the session has no lore entries at all, show the existing empty-state message (`chat_nothing_revealed_yet`) instead of an empty graph.
- If `GET /sessions/{sid}/lore` fails, show the existing error state (`chat_couldnt_load_session_lore`) — unchanged from today.
- Editing/saving an override failure path is unchanged (already handled by the existing `openSessionLoreEditor`).

## Testing

This is a pure frontend visual/interaction feature with no new backend logic (the `links` field was already added and tested in the prior auto-reveal-adjacent work). Verification is manual: open a chat whose character has lore with real relationships, confirm the graph renders correctly on a narrow viewport and a wide one, confirm click-to-isolate and edit-from-detail-panel both work, confirm player-edited entries are visually distinct, confirm the Memory tab no longer shows a Web toggle.
