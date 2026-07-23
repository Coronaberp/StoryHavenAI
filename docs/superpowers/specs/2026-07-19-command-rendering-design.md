# Chat command rendering redesign

**Date:** 2026-07-19
**Approved via artifact:** claude.ai/code/artifact/bd970c2b (10-direction gallery → #3+#5 combo).

## Problem

A turn using directives + a roll collapses into one run-on line
(`[Scene: …] 🎲 … = 4 [as Mira] "…"`). Unreadable, especially stacked.

## The system (four lanes)

1. **In-fiction breaks** — `scene` and `time` render as full-width dividers
   *above* the turn. Scene = gold italic rule; Time = smaller muted rule.
2. **Story bubble** — the prose only. An `as Name` directive keeps its spoken
   content as the bubble and adds a small "speaking as Name" badge.
3. **Action tray** — `note` and `roll` bundle behind a "⚙ N actions" toggle
   beside the bubble, expandable.
4. **Off-stage lane** — `ooc` (user) and the AI's OOC reply render as dashed,
   desaturated bands, NOT chat bubbles. The AI's is labelled "Game Master ·
   off-stage". Bands are still normal messages (copy/delete on hover). A mixed
   AI reply (fiction + aside) splits: fiction to bubble, aside to a band.

## Hide OOC

A display-only toggle (global, localStorage `hideOoc`) collapses every
off-stage band in the thread into one "👁 N off-stage messages hidden · tap to
show" line. Surfaced in the chat rail (desktop) and the chat ⋯ menu (mobile).
No backend/data change — pure view filter.

## Implementation

Frontend-only (`new_ui/js/chat.js` + `cards.css`):

- `parseCommandedMessage(content, role)` → `{ scenes[], times[], actions[],
  asName, oocs[], prose }`.
  - User: match sigil directives `(╾━╤デ╦︻:[cmd arg] content)` for
    scene/time/ooc/note/as, and resolved rolls `🎲 … = **N**` for actions.
  - Assistant: detect OOC asides (`[ooc: …]` from strip_leaked_sigil, or a
    leading `(OOC: …)`) → `oocs`; the rest is prose.
- `commandedTurnHtml(parsed, msg, role, hideOoc)` builds breaks + tray + bubble
  + off-stage bands, honouring the hide toggle.
- `turnHtml` routes user AND assistant messages through it.
- New CSS: `.cmd-break` (scene/time), `.cmd-tray`, `.offstage-band`,
  `.as-badge`, `.offstage-hidden`.
- Toggle: rail button + mobile ⋯ row → `store.set("hideOoc", …)` → re-render.

## Testing

- Manual: a turn with all six commands renders in the four lanes; hide toggle
  folds/reveals; edit still round-trips (directiveToEditable unchanged);
  delete works on off-stage bands.
- No backend changes, so no repo/router tests. JS has no harness — verify live.
