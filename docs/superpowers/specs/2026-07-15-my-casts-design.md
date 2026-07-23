# My Casts (`/sanctum/casts`) — new_ui design spec

## Context

`new_ui/` is the in-progress Tailwind rebuild of StoryHaven's frontend. `PantheonView` (`new_ui/js/pantheon.js`) already implements a full character browser (search, tag filters, gender/mode/rating filters, `@creator` filtering) at `/pantheon`, fetching `GET /api/characters?scope=community`. My Casts is the same screen scoped to the user's own library instead of the community — `GET /api/characters?scope=mine` (`backend/repositories/characters.py`'s `list_all`, `scope='mine'` branch: owner's characters only, already excludes drafts by construction).

Rather than forking a near-duplicate class, `PantheonView` becomes configurable and is reused directly for both routes — no new view file. This matches the existing pattern of one class reused with light parameterization rather than copy-pasted variants.

`CharacterView` (`new_ui/js/character.js`, route `/c/{cid}`) already exists and is owner-aware (`isOwner = ME && this.char.owner_id === ME.id`) — `GET /api/characters/{cid}` already permits the owner to fetch their own private characters. My Casts needs no new detail page; its cards link to `/c/{cid}` exactly like Pantheon's do, unchanged.

`/sanctum/casts` currently renders a placeholder (`new_ui/js/router.js`'s `sanctum-casts` route). This spec replaces it.

## Scope

### `PantheonView` becomes configurable

`PantheonView`'s constructor takes an options object: `constructor({ scope = "community" } = {})`. `scope` is stored on the instance and drives every point of divergence below. Both routes instantiate the same class:

```javascript
pantheon: (main) => new PantheonView().mount(main),
"sanctum-casts": (main) => new PantheonView({ scope: "mine" }).mount(main),
```

### Points of divergence, all keyed off `this.scope`

- **Fetch**: `load()` sends `scope=${this.scope}` instead of the hardcoded `"community"`.
- **Creator filter — off entirely when `scope === "mine"`**: no `@creator` branch in the search suggestion box, no creator pills, no creator drawer section, no `editingCreator` double-click-to-edit state, no `loadCreatorProfiles()` call (nothing needs creator profile data once creator filtering and the card's creator row are both gone). `allCreators()` is only called from the now-conditional `@` suggestion branch, so it naturally stops being invoked — no separate guard needed there.
- **Blocked-tags filter — off when `scope === "mine"`**: `visibleChars()`'s `getBlockedTags()` check only applies when `this.scope === "community"`. That preference exists to hide *other people's* content by tag; applying it to the user's own library doesn't make sense.
- **Card creator row — hidden when `scope === "mine"`**: `characterCardHtml(c, profile, opts = {})` gains a third parameter; `cardHtml(c)` passes `{ hideCreator: this.scope === "mine" }`. When `opts.hideCreator` is true, the `.char-card-creator` block is omitted entirely from the returned markup — everything else (art, explicit-flag data attribute, tags, title, description, chat-count ribbon) stays identical. This is the one change to the shared card function; Pantheon's own rendering is unaffected since it passes `hideCreator: false`.
- **Header text**: `pageHeaderHtml(...)` call in `render()` switches between Pantheon's existing copy and My Casts' copy based on `this.scope`:
  - `scope === "community"`: `pageHeaderHtml("Compendium", "Characters", "Pantheon", "Every character in the pantheon, yours and everyone else's.")` (current, unchanged).
  - `scope === "mine"`: `pageHeaderHtml("Sanctum", "Characters", "My Casts", "Characters you've created or imported, private to you.")` (the exact copy already established in `router.js`'s current `sanctum-casts` placeholder — reused verbatim).
- **Error message**: `err.message || (this.scope === "mine" ? "Couldn't load your characters." : "Couldn't load the Pantheon.")`.

### Everything else — unchanged, shared automatically

Search box (text + `#tag` pills/suggestions), popular-tags row, gender/mode/rating filter drawer, loading/empty states, `card-grid` layout, card tap → `/c/{cid}` — all identical code paths, no branching needed since none of it references creator data or community-specific copy.

## Architecture

- Modify `new_ui/js/pantheon.js` only — no new file. `PantheonView`'s constructor, `load`, `visibleChars`, `loadCreatorProfiles` (now conditionally skipped), `updateSuggestions`, `activeFilterPills`, `filterDrawerHtml`'s creator section (removed outright, was never scope-conditional in the first place — it doesn't exist yet as a drawer section, creator filtering lives in the search box's `@` branch, not the drawer), `render`'s header call, and `characterCardHtml`'s signature all change.
- `new_ui/js/router.js`: `"sanctum-casts": (main) => new PantheonView({ scope: "mine" }).mount(main),` replacing the current placeholder line. No new script tag needed — `pantheon.js` is already loaded (it powers `/pantheon` today).

## Error handling

Same pattern throughout: fetch failures set `this.error` and render a message, never a silent blank screen — the message text is the only scope-dependent part (see above).

## Testing

No backend changes — `scope=mine`/`scope=community` and `GET /api/characters/{cid}` are all pre-existing, already covered by existing tests. Frontend verification is manual against `:3001` (no JS test runner in `new_ui/`): confirm `/pantheon` still behaves exactly as before (creator filter, creator card row, community-scoped fetch all intact — this is a regression check, not just a new-feature check, since `pantheon.js` itself is being edited), then confirm `/sanctum/casts` shows only the logged-in user's characters, no `@`/creator UI surfaces anywhere on it, cards have no creator row, search/tags/gender/mode/rating filters all work, empty state shows for a zero-character account, and a card tap lands on `/c/{cid}` correctly (including for a private, non-public character, to confirm the owner-access path).

## Out of scope

- Draft characters / a "Pending" tab — explicitly deferred until the character editor exists to do anything useful with a draft.
- Character creation/editing itself — `/sanctum/create` stays a placeholder; this spec is the list screen only.
