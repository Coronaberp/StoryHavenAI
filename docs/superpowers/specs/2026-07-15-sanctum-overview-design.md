# Sanctum overview — new_ui design spec

## Context

`new_ui/` is the in-progress Tailwind rebuild of StoryHaven's frontend (mobile-first, served on :3001 via `dev_server.py`, proxying to the real backend on :3000). Sanctum is the user's private workshop tab — currently a bare placeholder at `/sanctum` (`new_ui/js/router.js`), with four further sub-areas (My Casts, My Masks, My Grimoire, My Forge) and a "create character" flow, all still placeholders, reachable today only through the `openSanctumMenu()` popup (`new_ui/js/nav-menus.js`).

Compendium (`new_ui/js/compendium.js`) is the closest built analogue — an overview screen that samples from each community sub-area. Sanctum's overview is deliberately different: it leads with quick-create actions (this is the workshop, not a browsing surface), with a secondary recent-items feed below.

This spec covers **only the Sanctum overview screen** (`/sanctum`) and the route restructuring it requires. My Casts / My Masks / My Grimoire / My Forge remain placeholders — this spec does not design their full screens, only the URLs they'll live at and the fact that the overview links into them.

## Scope

### Routing change

All Sanctum-owned routes move under `/sanctum/...`, replacing today's flat top-level routes. `currentRoute()` (`new_ui/js/router.js`) already special-cases multi-segment paths (`/u/{username}`, `/symposium/{tid}`) — extend the same approach for a `/sanctum/...` prefix.

| Old route | New route | Notes |
|---|---|---|
| `/sanctum` | `/sanctum` | Overview (this spec) |
| `/casts` | `/sanctum/casts` | My Casts list (still placeholder) |
| — | `/sanctum/casts/{cid}` | Single character detail/edit (still placeholder; overview's feed links here) |
| `/masks` | `/sanctum/masks` | My Masks list (still placeholder) |
| — | `/sanctum/masks/{pid}` | Single persona detail (still placeholder; feed links here) |
| `/grimoire` | `/sanctum/grimoire` | My Grimoire list (still placeholder) |
| — | `/sanctum/grimoire/{cid}/{lid}` | Single lore entry (lore belongs to a character, so it's addressed by both; still placeholder; feed links here) |
| `/forge` | `/sanctum/forge` | My Forge list (still placeholder) |
| — | `/sanctum/forge/{iid}` | Single generated image (still placeholder; feed links here) |
| `/create` | `/sanctum/create` | New character flow (still placeholder) |

`TAB_FOR_ROUTE` and `NAV_ROUTES`/`MENU_ONLY_ROUTES` get updated so every nested route still highlights the Sanctum tab and shows the menu (not the ribbon), matching how `artisan-profile` today maps back to `dossier`/`compendium`. `openSanctumMenu()`'s links in `nav-menus.js` update to the new paths.

Placeholder routes (`casts`, `masks`, `grimoire`, `forge`, `create`, and all their `{id}` variants) keep rendering via `renderPlaceholder()` — the id segment is parsed and preserved in the URL but not used yet, since those screens aren't designed. This is intentional: the overview's feed can deep-link today, and the links start working once each sub-screen is actually built, with no further routing changes needed.

### Sanctum overview (`/sanctum`)

New `SanctumView` class, `new_ui/js/sanctum.js`, registered in `routes`. Structure top to bottom:

1. **Header** — `pageHeaderHtml("Sanctum", "Overview", "Sanctum", "Your workshop with everything you've made, or are making.")`, same as every other top-level screen.

2. **Quick-create row** — four compact tiles, one per sub-area, in a horizontal `flex` row (wraps on narrow viewports): New Character, New Persona, New Lore Entry, New Image. Each tile: icon (reuse `_NAV_MENU_ICONS.casts/masks/grimoire/forge` from `nav-menus.js`), short label, accent-gradient background (same visual weight as the accent-filled icon badges in `_navMenuRow`) — this row is the one bold element on the screen. New Character → `/sanctum/create`. New Persona → `/sanctum/masks` (persona creation lives inside that screen once built; no standalone create route exists). New Lore Entry → `/sanctum/casts` (lore is created from within a character, so this routes to character selection first). New Image → `/sanctum/forge`.

3. **Recent feed** — one interleaved list, newest-first, merging:
   - `GET /api/characters?scope=mine` (characters — `created` field)
   - `GET /api/personas` (personas — `created` field)
   - `GET /api/lore/mine` (lore — **new endpoint, see Backend below**)
   - `GET /api/imagegen/standalone` (generated images — `created` field)

   Fetched in parallel via `Promise.all`, merged, sorted by `created` descending, capped to the 20 most recent. Each row: a small square thumbnail (character avatar / lore's `image` field / generated image, or an initial-on-gradient placeholder for personas, which have no image) with a corner tab showing the type icon — this is Sanctum's own signature motif (a "specimen" card), visually distinct from Parlance's circular wax-seal rows so the two screens don't feel like reskins of each other. Title, type label (Cast/Mask/Grimoire/Forge, mono uppercase, same treatment as Parlance's timestamp), relative time (reuse `_parlanceAgo`, promoted to a shared helper — see Architecture). Tapping a row navigates to that item's nested detail route (e.g. `/sanctum/casts/{cid}`).

4. **Empty state** — if all four sources are empty, hide the feed entirely and show one combined invitation, matching Parlance's empty-state pattern: a mark, "Nothing forged yet.", a short sub-line, and a CTA into New Character (the natural first step for a brand-new account).

### Backend addition

`backend/repositories/lore.py` gets a new `list_mine(user_id)`: joins `lore` → `characters` on `char_id`, filters `characters.owner_id == user_id`, orders by `lore.created` descending. `backend/routers/lore.py` gets `GET /api/lore/mine` calling it, `current_user: dict = Depends(get_current_user)`. Plain read endpoint — no mutation, so no `log.info` needed per the logging rule (only mutating/error paths require it); matches the existing unlogged-GET pattern used by `list_lore`.

## Architecture

- `_parlanceAgo` (`new_ui/js/parlance.js`) is renamed to a shared `timeAgo` helper (same implementation) and moved to a small shared location — simplest option: keep it in `parlance.js` since that file already loads before `sanctum.js` isn't guaranteed by load order, so instead define it once in `dom-utils.js` (already loaded early, already holds shared vanilla helpers per `CLAUDE.md`'s module table) and have both `parlance.js` and the new `sanctum.js` call it. `parlance.js`'s local `_parlanceAgo` is deleted in favor of the shared one.
- `SanctumView` follows the same `mount(main)` / `render()` class shape as `ParlanceView`/`ArtisansView`: render once immediately (loading state), fetch, render again.
- New CSS lives in `cards.css` alongside `.parlance-*`: `.sanctum-quick-row`, `.sanctum-quick-tile`, `.sanctum-feed`, `.sanctum-specimen` (thumbnail + corner tab), `.sanctum-empty` — all theme-token-driven (`var(--color-*)`), no hardcoded colors, consistent with every existing screen.

## Error handling

- Any of the four fetches failing independently (e.g. `/api/lore/mine` 500) doesn't blank the whole feed — each fetch is wrapped in its own `.catch(() => [])`, same pattern `CompendiumView.mount` already uses, so one bad source just contributes nothing rather than breaking the merge.
- If literally everything fails, the feed shows the empty state's sub-line, not a raw error dump — the difference between "you have nothing" and "we couldn't load it" isn't worth a separate UI state here, since retrying is just navigating back to `/sanctum`.

## Testing

- Backend: a pytest for `lore.list_mine` — a user with lore on two different characters gets both back sorted by `created` desc; a user with none gets `[]`; another user's lore never appears.
- Frontend: no existing JS test pattern in `new_ui/` to follow (confirmed — no test files under `new_ui/`), consistent with the rest of the vanilla-JS rebuild so far; verification is manual against `:3001` per `CLAUDE.md`'s existing-dev-server rule.

## Out of scope

- The four sub-screens' own designs (My Casts, My Masks, My Grimoire, My Forge) and the `{id}` detail routes' real content — separate specs, one per screen, following this same brainstorming process.
- New Persona / New Lore Entry standalone creation flows — until Masks/Grimoire are designed, the quick-create tiles route into the (placeholder) list screens rather than a dedicated creation form.
