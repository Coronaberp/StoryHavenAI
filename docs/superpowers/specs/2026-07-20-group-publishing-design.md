# Group publishing — reusable group templates with `/g/{id}` detail pages

## Overview

Let a user publish a group chat as a **reusable group template** other people can browse and start their own chat from, exactly the way characters work. A template is setup only (name, opening, mode, cast of 2–4 characters) — never the owner's messages or persona. Published templates live at `/g/{id}`, surface in the same community feed as characters, and are cross-linked from each cast character's page.

This is additive. The existing private group-chat flow (the "New group" modal creating a session immediately) is unchanged in behavior; only its endpoint path is renamed to free the `groups` resource name for templates.

## Data model

Two new tables (SQLAlchemy Core in `backend/db.py`, created by `metadata.create_all`).

**`groups`** — the template:
- `id` TEXT PK (`nid("g")`)
- `owner_id` TEXT (FK users)
- `name` TEXT NOT NULL
- `opening` TEXT NOT NULL
- `group_mode` TEXT NOT NULL DEFAULT `'roleplay'` (`roleplay` | `chat`)
- `is_public` INTEGER NOT NULL DEFAULT 0
- `created` / `updated` BIGINT

**`group_characters`** — the template's cast (mirrors `session_characters`, minus session-runtime fields):
- `group_id` TEXT (FK groups)
- `char_id` TEXT (FK characters)
- `position` INTEGER

No personas, no messages, no muted/narrator runtime state on the template. Cast size is validated 2–4 on write.

New repository `backend/repositories/groups.py` (plain-function module, same pattern as the others): `create`, `get`, `update`, `delete`, `set_cast`, `list_cast`, `list_public`, `list_public_for_char`, `list_by_owner`. Every mutation logs via `backend.state.log`.

## Publish flow (from an existing group chat)

A **"Publish as group"** action in a group chat's header menu calls:

- `POST /api/groups` body `{session_id}` — snapshots that session's `title`→name, first opening message→opening, `group_mode`, and `session_characters` cast into a new `groups` row owned by the caller, `is_public=1`. Returns `{id}`.

**Publish gate:** every cast character the caller *owns* must be `is_public`. If any owned cast character is private, respond `400` naming them ("Publish these characters first: …"). Community characters the caller does not own are included as-is regardless of their current public state. RPG characters are already impossible in a group cast, so no extra check needed.

Idempotence: publishing the same session twice creates distinct templates (a template is a snapshot, not a live link). The owner manages duplicates via delete.

## Template lifecycle endpoints

New router `backend/routers/groups.py` (attaches to the shared `api` router):

- `GET /api/groups/{gid}` — detail. Visible if `is_public` or caller is owner, else `404`. Returns name, opening, group_mode, is_public, owner attribution (username, display name, avatar), and `cast`: for each member `{char_id, name, avatar, is_public, owned_by_viewer}`. A member links to `/c/{id}` on the frontend only when `is_public` is true.
- `PUT /api/groups/{gid}` — full edit (owner only): `{name, opening, group_mode, char_ids}`. Re-validate 2–4 cast, own-chars-public gate, characters exist and are non-RPG. Updates `groups` + rewrites `group_characters`.
- `DELETE /api/groups/{gid}` — owner only.
- `POST /api/groups/{gid}/sessions` — start a chat from the template. Creates a group **session** from the template's cast/name/opening/mode using the existing group-session creation path (`chat_sessions.create_group` + `session_characters.set_cast` + macro'd opening), owned by the caller with their default persona. Returns `{session_id}`. Requires auth (unauthenticated Start-chat prompts sign-in on the frontend).

Every mutating endpoint gets a `log.info` on success; every caught error a `log.warning`/`error`, per the standing logging rule.

## Rename to free the `groups` resource

The current ad-hoc session creation is `POST /api/groups` (returns `session_id`). Rename it to **`POST /api/group-chats`** (unchanged body/behavior, still returns `session_id`). Update the three frontend callers: `new_ui/js/group-create.js` (`create()`), `new_ui/js/chat.js` (`startNewChat` group recreate). Now `POST /api/groups` cleanly means "publish a template."

## Discovery — same feed as characters

Per the decision that published groups are surfaced through the same endpoint as characters:

- The **community characters listing** (`GET /api/characters?scope=community`, powering Explore's grid) additionally returns published group templates as items carrying `kind:"group"` (character items are implicitly `kind:"character"`). Group items include `{id, kind, name, group_mode, cast_preview:[{char_id,name,avatar}], creator}` — enough for a tile without a second request. The frontend grid renders a group tile (cast collage + name + mode badge) that routes to `/g/{id}`; character tiles are unchanged.
- `GET /api/characters/{cid}/groups` — public group templates whose cast includes `cid`, for the "Appears in these groups" section on `/c/{id}`.

Sorting/paging of the merged feed follows the existing character listing's contract; groups interleave by recency using the same key.

## Frontend

- **Route** `/g/{id}` → new `GroupDetailView` (`new_ui/js/group-detail.js`), added to the router's path→name resolution and to `PUBLIC_ROUTES` so unauthenticated visitors can view. Optional `/g/{id}/new-chat` mirrors `character-new-chat`.
- **Detail page** contents (visual design done with the frontend-design skill at implementation time — this spec fixes *what* is on it, not the styling): group name, mode badge, creator attribution line, cast lineup (avatar + name per member, linking to `/c/{id}` only when that member is public), opening preview, **Start chat** button (creates a session via `POST /api/groups/{gid}/sessions`, then navigates to `/chats/{session_id}`; if unauthenticated, route to sign-in first). Owner sees **Edit** and **Delete**.
- **Explore grid** (`new_ui/js/explore-characters.js` or wherever the community grid renders): handle `kind:"group"` items → group tile → `/g/{id}`.
- **Character page** (`new_ui/js/character.js`): "Appears in these groups" section from `GET /api/characters/{cid}/groups`.
- **Chat header** (group chats): "Publish as group" action (owner of the session) → `POST /api/groups {session_id}` → on success toast + navigate to `/g/{id}`. Surface the own-chars-public error clearly.
- **Group template edit** modal (full edit): reuse the `GroupCreateModal` picker UI (cast 2–4, name, opening, mode) pre-filled from the template, saving via `PUT /api/groups/{gid}`.
- **UI copy** follows `PROSE_STYLE_GUARD` (no em dashes/semicolons/AI-cliché); all strings go through `t(key, fallback)` with new `group_publish_*` / `group_detail_*` keys in `translations.js`.

## Permissions summary

- View `/g/{id}`: anyone if `is_public`, else owner only.
- Publish / edit / delete / unpublish: owner only.
- Publish gate: every cast character owned by the caller must be public.
- Cast member `/c` link on the detail page: only when that member is currently public (prevents broken links / minor leak of an unpublished community char).
- Start chat: any authenticated user on a public template.

## Testing

- `backend/tests/test_groups_repo.py` — CRUD, `set_cast`/`list_cast`, `list_public`, `list_public_for_char`, ordering.
- `backend/tests/test_groups_router.py` — publish gate (owned private char blocks, community char allowed), visibility (private template 404 for non-owner), full edit re-validation (cast size, own-chars-public), start-chat creates a session with the template's cast/mode, delete ownership.
- Extend character-listing tests to assert `kind:"group"` items appear in `scope=community` and `GET /api/characters/{cid}/groups` returns featuring groups.
- Frontend: follow the existing `tests/new_ui` Playwright pattern for the `/g/{id}` route and the publish action if feasible in that harness.

## Logging

Publish, edit, delete, start-chat, and unpublish each emit a `log.info` (ids/owner/counts only, never content). The publish-gate rejection logs a `log.warning` with the blocking character ids. No chat content, character bodies, or keys in logs.

## Out of scope

- Ratings/favorites/comments on group templates (characters' social features are not extended here yet).
- Authoring a template from scratch in the Workshop (publish is chat-first per the chosen flow).
- Live linkage between a template and the session it was published from (snapshot only).
