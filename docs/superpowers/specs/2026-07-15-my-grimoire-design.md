# My Grimoire (`/sanctum/grimoire`) — new_ui design spec

## Context

`new_ui/` is the in-progress Tailwind rebuild of StoryHaven's frontend. Sanctum's overview (`/sanctum`) already exists (`new_ui/js/sanctum.js`) with a "Browse" section linking to `/sanctum/grimoire`, `/sanctum/masks`, `/sanctum/casts`, `/sanctum/forge`, and a merged recent-items feed whose lore rows already link to `/sanctum/grimoire/{cid}/{lid}`. All four of those routes currently resolve to `renderPlaceholder()` (`new_ui/js/router.js`'s `sanctum-grimoire` entry) — `/sanctum/grimoire/...` ignores any path segments past `/sanctum/grimoire` today. This spec replaces that placeholder with the real screen.

Legacy reference: `legacy_ui/js/lorebook.js` (159 lines) — `loreModal` (create/edit form) and `loreEntryModal` (read-only view → Edit/Delete), both invoked from within a character's own editor (`legacy_ui/js/editor.js`), never from a standalone cross-character list — legacy has no "My Grimoire" equivalent at all. That screen is new, made possible by the `lore.list_mine`/`GET /api/lore/mine` endpoint added alongside the Sanctum overview.

Two legacy widgets `loreModal` depends on — `openCropper` (image crop) and `openImageGenPickerModal` (AI image generation) — do not exist anywhere in `new_ui/` yet; they belong to My Forge, which isn't built. This spec's image field is scoped around that gap (see below).

## Scope

### Route

`/sanctum/grimoire` and `/sanctum/grimoire/{cid}/{lid}` both render the same `GrimoireView`. The router's existing multi-segment parsing (`sanctum-${parts[1]}` → same key regardless of further segments, `new_ui/js/router.js`'s `currentRoute()`) already resolves both to the `sanctum-grimoire` route key — no router changes needed, only replacing that route's handler function from `renderPlaceholder` to `(main) => new GrimoireView().mount(main)`. `GrimoireView` reads `location.pathname`'s 3rd/4th segments itself (same pattern `SymposiumThreadView`/`ArtisanProfileView` already use) to know whether it should auto-open an entry.

### Data

On mount, fetch in parallel:
- `GET /api/lore/mine` — every lore entry across the user's characters (already returns decrypted `content`/`name`/`keys` etc., `always`/`hidden`/`global`/`is_explicit` as booleans, `char_id`, `category`, `image`, `created`).
- `GET /api/characters?scope=mine` — to resolve each entry's `char_id` to a character name for the per-row tag (`list_mine` doesn't join character names in).

Both wrapped in `.catch(() => [])` (matches `CompendiumView`/`SanctumView`'s existing per-source failure isolation — one bad fetch doesn't blank the screen).

### Layout — codex/table-of-contents grouping

1. Standard header: `pageHeaderHtml("Sanctum", "Lore", "My Grimoire", "The lore entries that shape your worlds.")` (subtitle text already established in `router.js`'s current placeholder — reused verbatim).
2. A "+" add button in the header row (same visual slot/weight as other add actions in this codebase — e.g. `+40px` accent-filled circular button, matching the bottom-nav's own "+" for New Character).
3. Entries grouped into sections by `category` (a free-text field, not an enum — group by each entry's actual string value; entries with `category === ""` fall into a final "Uncategorized" section). Section header: mono-uppercase label, same treatment as `.sanctum-feed-header` (`SANCTUM · Lore` style already established). Sections are sorted by entry count descending, "Uncategorized" always last regardless of count.
4. Rows within a section: reuse the specimen-thumbnail pattern from `SanctumView.specimenHtml` (rounded-square thumbnail — entry's `image` field, or first-letter-on-gradient if none — with a small corner icon tab), title = entry's `name` (or first `keys` entry, or "Untitled entry" — matching legacy's `loreEntryModal` title-fallback chain), and a character-name tag in place of the relative-time line `SanctumView` uses (this screen's rows don't need recency, they need ownership context).
5. Empty state (no entries at all, across any category): matches the `.sanctum-empty`/`.parlance-empty` pattern — a mark, "Nothing recorded yet.", a sub-line, and a CTA that opens the same add-flow as the header's "+" button (not a route — the add flow is a character-picker modal, see below).

### Add flow

Tapping "+" (header button or empty-state CTA) opens a small modal listing the user's characters (`GET /api/characters?scope=mine`, same data already fetched for the tag lookup — no second fetch), each row tappable. Selecting a character closes that modal and opens the entry editor (below) in create mode for that `char_id`. If the user has zero characters, the modal shows a short message and a link to `/sanctum/create` instead of an empty list.

### Entry interaction — two-step (matches legacy)

**View modal** (tap a row): read-only — category eyebrow, title, `keys` as tag chips, content text (respecting `hidden` the same way legacy's `loreEntryModal` does — for entries here `canEdit` is always `true` since `list_mine` is already owner-scoped, so hidden content is always shown in full, no viewer-facing redaction needed, unlike legacy's cross-user case), an "Always" / "Global" stat line (`Global` will always read "No" here — `list_mine`'s inner join excludes global entries by construction, but the field is still shown for consistency with legacy's view and because a future toggle could change that), Edit and Delete buttons.

**Edit form modal** (from View's Edit button, or directly for new entries): fields — Name, Category (free text), Keys (comma-separated text input, split/joined the same way `loreModal` does), Content (textarea, required — matches the existing backend validation in `POST /characters/{cid}/lore` which 400s on empty content), Always toggle, Hidden toggle, Image.

**Image field:** a thumbnail/upload box wired to a plain file input → `POST /api/characters/{cid}/media` (existing endpoint, no cropping — `FormData` upload, same shape `loreModal`'s file-upload branch already uses minus the `openCropper` step) → sets the entry's `image` to the returned URL. A second button, "🎨 Generate", sits next to it but is inert — clicking it shows `toast("My Forge isn't built yet — image generation will work once it exists.")` rather than opening anything. This keeps the field's final layout stable so wiring it up later (once Forge/`openImageGenPickerModal` exist) is a pure addition, not a rework.

Save (create): `POST /api/characters/{cid}/lore` with `{content, keys, always, hidden, image, category, name}` (no `global` field sent — this screen never creates global entries, since they wouldn't appear back in this list anyway). Save (edit): `PUT /api/lore/{lid}` with the same shape. Both matching `LoreIn`'s existing schema exactly (`backend/schemas.py`) — no backend changes needed.

Delete: `DELETE /api/lore/{lid}` (existing endpoint), confirmation modal first (reuse the confirm-modal pattern already established in `ParlanceView.confirmDelete`), then close both modals and refresh the list.

### Deep-link auto-open

If `GrimoireView` mounts with a `{cid}/{lid}` in the URL (from the Sanctum overview feed, or a future direct link), once the fetched list includes a matching entry, automatically open its View modal (same as a manual tap) — no separate fetch, found by scanning the already-loaded `list_mine` results by `id`. If the id isn't found (e.g. it was deleted, or belongs to a different user), silently fall back to just showing the list — no error toast, since arriving at a stale link isn't the user's mistake to be told about.

## Architecture

- New file `new_ui/js/grimoire.js` — `class GrimoireView` (constructor + `mount(main)`, following the exact same shape as `SanctumView`/`ParlanceView`/`ArtisansView`), plus the modal-building functions (`_grimoireCharacterPickerModal`, `_grimoireViewModal`, `_grimoireEditModal`) as free functions in the same file (they're one-shot dialog builders with no persisted state of their own — matches the "stateless logic stays a function" rule; only `GrimoireView` itself owns real state: the fetched list, the loaded character map).
- Registered in `new_ui/js/router.js`: `"sanctum-grimoire": (main) => new GrimoireView().mount(main),` replacing the current placeholder line.
- New script tag in `new_ui/index.html`, alongside the other Sanctum-area scripts (after `sanctum.js`).
- New CSS in `new_ui/css/cards.css`: `.grimoire-section-header` (reuses `.sanctum-feed-header`'s exact style — could share the class outright, but a distinct name keeps Grimoire's own section semantics independent of Sanctum overview's "Recent" header if either needs to diverge later), `.grimoire-row` (thumbnail + title + character tag, structurally identical to `.sanctum-feed-row` but with a tag instead of a meta line), `.grimoire-tag`, `.grimoire-add-btn`, plus the view/edit modal's own field layout (can reuse `.field`-equivalent patterns already established in `profile-editor.js`'s modal — check that file's CSS class names before inventing new ones).

## Error handling

- List fetch failure: same per-source `.catch(() => [])` isolation as the rest of Sanctum — a failed `/api/lore/mine` shows the empty state rather than an error (indistinguishable from "you have none yet," acceptable per the same reasoning already used for the Sanctum overview).
- Save/delete failures: `errorToast`/`toast` with the server's error message, matching every other mutating flow in this codebase (`ParlanceView.deleteSession`, `profile-editor.js`) — never a silent failure.
- Empty content on save: caught client-side before the request fires ("Content required." toast, matching legacy's own client-side check) as well as relying on the existing backend 400 as the real guard.

## Testing

- No backend changes in this spec — no new pytest needed (the two backend endpoints this depends on, `list_mine` and the existing lore CRUD routes, already have coverage from the Sanctum overview work and pre-existing tests respectively).
- Frontend: no JS test runner exists in `new_ui/` (consistent with every other screen so far) — verification is manual against `:3001`, covering: category grouping with entries across 2+ categories and one uncategorized entry, add flow (character picker → create → appears in the right section), view → edit → save (edit persists), delete (row disappears, confirmation required), deep-link auto-open from a Sanctum-overview feed link, and empty state (a test account/character with zero lore).

## Out of scope

- Actual AI image generation for lore entries (the "🎨 Generate" button) — depends on My Forge, not built.
- Global lore entries (`char_id IS NULL`) — out of `list_mine`'s scope by construction; managing those (if that's ever a per-user-facing feature at all, today it reads more like an admin/system concept) is a separate future decision, not part of this screen.
- My Casts (`/sanctum/casts`) itself — the character picker in the add flow is a lightweight inline modal here, not a dependency on that screen existing.
