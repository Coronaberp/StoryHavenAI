# Chat interface (Parlance) — new_ui design spec

## Context

`new_ui/` is the in-progress Tailwind rebuild of StoryHaven's frontend. `ParlanceView` (`new_ui/js/parlance.js`) already lists a user's sessions (`GET /api/sessions`, resolved against `GET /api/characters/{cid}` for name/avatar) with delete, but clicking a row currently just toasts "the chat itself isn't here yet." `CharacterView`'s Play button (`new_ui/js/character.js`) currently navigates to the `/sanctum/casts` placeholder. Neither wires into any real chat surface — this spec builds that surface.

Legacy reference: `legacy_ui/js/chat.js` (main view, SSE wiring, message rendering), `chat-actions.js` (regenerate/continue/roll/edit/delete), `chat-modals.js` (out of scope here, see below). Visual reference: `Mobile-first app redesign/Mobile App.dc.html`'s `chatEl()`/`composerEl()`, whose token usage (gold-gradient user bubble, Fraunces name labels, mono uppercase status line, `--paper`/`--surface`/`--line`) already matches `new_ui`'s established system — this spec follows that mockup's structure directly rather than inventing a new one.

Backend is untouched — `backend/chat_service.py`'s `_run` SSE loop and `backend/routers/chat.py`/`sessions.py`'s REST surface already support everything this spec needs.

## Scope

**In:** send a message (streamed), view history, regenerate the last AI turn, continue the last AI turn, delete a message, edit a message's text, a thinking-block toggle/display, RPG-mode dice quick-roll bar, creating a session from a character page and from Parlance.

**Out (explicitly deferred):** in-chat image generation, VN/sprite/mood staging, translation, author's-note/response-style/glossary modals, lorebook picker UI, slash-command palette (`/ooc`, `/scene`, etc. render as plain text, not collapsed cards), recap/memory-viewer modals, milestone toasts, swipe gestures (actions are icon-button-driven, matching the rest of `new_ui`).

## Route

New route `parlance-thread`, path `/parlance/{sid}`. `router.js`'s `currentRoute()` gets a segment check (`seg === "parlance" && parts[1]`) alongside the existing `symposium`/`i`/`c` multi-segment cases. Requires auth (not added to `PUBLIC_ROUTES` — sessions are private, unlike character/image shares). `TAB_FOR_ROUTE["parlance-thread"] = "parlance"`.

## Entry points

1. **`ParlanceView.rowHtml`**: replace the stub `onclick="toast(...)"` with `navigate('/parlance/${s.id}')`.
2. **`CharacterView`'s `#charStartChat`**: replace `navigate("/sanctum/casts")` with `await api(POST /api/characters/{cid}/sessions, {persona_id: null})` → `navigate('/parlance/{new sid}')`. Button shows a brief loading state (disable + spinner swap) since session creation can involve a greeting-localization round trip.

## Data model

`ChatView` constructor takes `sid`. On mount: `GET /api/sessions/{sid}` → `{id, char_id, title, messages: [{id, role, content, lang}], user_name, language, ...}`. Then `GET /api/characters/{char_id}` for name/avatar/mode/hue (same hue-hash pattern used everywhere else: `[...c.id].reduce(...)`).

Each message's `content` is split client-side via a ported `splitThink`/`stripMood` (from `legacy_ui/js/chat.js`, ~6 lines, no reason to reinvent): `<think>...</think>` prefix → collapsed thinking block; `[mood: x]` tag → stripped (mood itself is not displayed in this pass — no VN staging).

## Layout

```
┌─────────────────────────────┐
│ ← [avatar] Name              │  sticky header, hideNavOnly() chrome
│    ● memory on · session      │  (full-bleed like character/pinacotheca detail)
├─────────────────────────────┤
│         NAME (mono, muted)   │  scrollable thread, flex-col
│  ┌─────────────────────┐    │  AI turn: left-aligned, .sym-body markdown,
│  │ AI reply markdown     │    │  surface bg, 1px line border, rounded
│  │ ▸ Thinking (collapsed)│    │  16px/16px/16px/4px (mockup's asymmetric corner)
│  └─────────────────────┘    │
│                    YOU       │
│         ┌──────────────┐    │  user turn: right-aligned, gold-gradient bg,
│         │ user message  │    │  --color-paper-base text, mirrored corner radius
│         └──────────────┘    │
│  ● ● ●  Aria is writing…      │  blinking-dot row, replaces the in-progress
├─────────────────────────────┤  bubble's place until first delta arrives
│ 🎲 d4 d6 d8 d20 2d6            │  RPG mode only (`char.mode === "rpg"`)
├─────────────────────────────┤
│ [➕] [ textarea.......... ] [➤]│  ➕ = image-gen stub (toasts "not built yet",
└─────────────────────────────┘  same pattern as Studio/Edit elsewhere)
```

Message-action row (copy / edit / delete always; regenerate / continue only on the last assistant turn) is hidden by default, revealed by tapping the bubble — matching the tap-to-reveal pattern already used for Pinacotheca's NSFW reveal and the general restraint principle (no permanently-visible icon clutter on every single bubble). Uses the same `.ig-icon-btn`/`data-tooltip` component as every other icon button in the app — no new button style invented.

## Streaming

One shared `async sendTurn(endpoint, body)` method drives `chat`, `regenerate`, `continue`, and `roll` — they differ only in URL suffix and request body, and all five SSE event types are handled identically:

- Append an optimistic user bubble immediately (for `chat`/`roll`; skip for `regenerate`/`continue`, which act on existing history) and a placeholder AI turn showing the blinking-dot "is writing…" state.
- `fetch(POST, {signal})` → `sseEvents(res, onEvent)` (existing helper from `card-sandbox.js`, already loaded — no new SSE parser).
- `meta`: no UI effect in this pass (lore/memory context isn't surfaced yet — deferred with the memory-viewer modal).
- `status`: swap the placeholder's label ("generating…" / "translating…").
- `thinking`: append chunks into the placeholder's (auto-expanded while streaming) thinking block.
- `delta`: full-text replace of the placeholder's body each event (backend withholds the reply until complete, per `CLAUDE.md`'s SSE contract — this is not token-streamed, so "replace" not "append" is correct).
- `error`: replace placeholder with an inline error row + a retry-capable state (leaves the user's message intact, matching legacy's non-destructive-failure behavior).
- `done`: replace the placeholder with the real persisted message (`done.message`, gets a real `id` → actions become available), auto-scroll to bottom. There is no backend auto-naming (confirmed: `PATCH /api/sessions/{sid}` is a manual rename endpoint only, nothing calls it automatically; a new session's `title` is seeded to the character's own name at creation — `sessions.py`'s `new_session` passes `char["name"]`, not blank or "Untitled"). Legacy's `chat-actions.js` renamed client-side after the first reply, sourced from the *AI's* reply text (not the user's message): strip markdown/OOC markers, take the first sentence, truncate to 60 chars. This view ports that verbatim — after a `chat`-turn's `done` event, if `session.title` still equals the character's name (i.e. never renamed), derive and `PATCH` a title from `done.message.content` the same way, so Parlance rows stop all reading as the character's own name once a conversation actually develops.

A single in-flight guard (`this.streaming = true/false`) disables the composer and quick-roll chips while a turn is in progress, matching the disabled-while-busy pattern already used for `CharacterView`'s Play button.

## Actions

- **Copy**: `copyTextFallback`/clipboard, same pattern as tag-copy elsewhere.
- **Edit**: inline textarea swap-in on the bubble itself (not a modal — matches the lightweight, in-place feel of `charDescToggle`'s expand/collapse rather than opening yet another modal for a one-field edit), `PATCH /api/sessions/{sid}/messages/{mid}`.
- **Delete**: `confirm()`-gated (matches `deleteCharacter`/`deleteImage`'s existing pattern, not a custom modal — this codebase uses native `confirm()` for simple binary destructive actions and `openModal` confirms only where more context/copy is needed), `DELETE /api/sessions/{sid}/messages/{mid}`.
- **Regenerate**: only rendered on the last assistant turn; `sendTurn('regenerate', {})`.
- **Continue**: only rendered on the last assistant turn; `sendTurn('continue', {})` (no steering-direction input in this pass — that's `chat-modals.js`'s "continue with" picker, deferred).
- **Roll** (RPG only): quick-roll chips (`d4`/`d6`/`d8`/`d20`/`2d6`) call `sendTurn('roll', {expr, note: ''})`.

## Header

Back (→ `/parlance`, or `history.back()` if it's in history — same pattern as `CharacterView`'s back button), avatar (small, hue-gradient fallback matching every other avatar in the app), name, a static "memory on · session" (or "· campaign" for RPG mode) status line with a green dot — memory is always on in this backend (no per-session toggle exists), so this is accurate as a static label, not a real control. No generate-scene/memory-viewer icons in this pass (both belong to deferred features).

## Empty/error states

- Session not found / not owned: same inline warning-text pattern as `CharacterView.render()`'s error branch, with a link back to `/parlance`.
- Zero messages (shouldn't normally happen — session creation always seeds a greeting — but handled defensively): a short empty-state line, composer still active.

## What's reused vs. new

Reused as-is: `sseEvents` (`card-sandbox.js`), `symposiumMd` (`symposium.js`), `copyShareUrl`/`copyTextFallback` (`profile-template.js`), `.ig-icon-btn`/`[data-tooltip]` CSS, `openModal`/`closeModal`, `pageHeaderHtml`'s absence is intentional (this is a chromeless full-bleed view like `character.js`/`pinacotheca.js`'s standalone paths — `hideNavOnly()`, not the standard page header).

New: `new_ui/js/chat.js` (the whole view), a `.chat-bubble`/`.chat-turn` CSS block in `cards.css` for the asymmetric-corner bubbles and the writing-indicator animation (not expressible with existing utility classes), `router.js`'s `parlance-thread` route entry, `ParlanceView`/`CharacterView`'s two one-line entry-point edits.
