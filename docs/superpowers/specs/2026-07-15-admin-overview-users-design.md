# Admin panel — Overview + Users & roles — new_ui design spec

## Context

The full admin panel is too large for one spec. Legacy (`legacy_ui/js/admin-*.js`) splits it into six genuinely independent subsystems:

| Legacy file | Scope | Lines |
|---|---|---|
| `admin-core.js` | Panel shell/tabs, overview dashboard | 204 |
| `admin-users.js` | User list, role changes, suspend/ban, notes, identity labels | 116 |
| `admin-moderation.js` | Content reports, flagged endpoints | 258 |
| `admin-previews.js` | Checkpoint/LoRA/sampler/scheduler/upscaler curation | 394 |
| `admin-emojis.js` | Emoji management | 109 |
| `admin-config.js` | Global server config (`CFG`) | 249 |
| `admin-health.js` | Server logs, health | 127 |

This spec covers the first sub-project: **Overview dashboard + Users & roles management**, replacing the current `/admin` placeholder route (`new_ui/js/router.js`, added as a temporary stub alongside the role-gated "Admin panel" row in `new_ui/js/settings.js`). The remaining five subsystems (Moderation, Model-preview curation, Emojis, Global config, Health/logs) each get their own spec → plan → implementation cycle afterward.

`Mobile-first app redesign/Mobile App.dc.html`'s `adminEl()` (~line 664) is the visual reference for the overview screen — a lightweight dashboard (service-health tiles, stat tiles, a top-users list with role badges, a moderation-reports banner, links to deeper screens), not the full admin UI. Its stat set includes a fictional "Chats today" tile with no backend support — this spec uses legacy's real, already-proven stat set instead (Users, Admins, Characters, Pending reports, Flagged endpoints, Password resets, Model requests — see `legacy_ui/js/admin-core.js`'s `overviewPanelHTML`).

## Scope

Two new routes, following the exact `SettingsView`/`AppearanceSettingsView` class pattern established in `new_ui/js/settings*.js`:

| Route | View class / file | Covers |
|---|---|---|
| `admin` | `AdminOverviewView` — `new_ui/js/admin.js` | Service health, stat tiles, attention banner, top-users summary |
| `admin-users` | `AdminUsersView` — `new_ui/js/admin-users.js` | Full user list + create/delete/role/Dev/suspend/notes/identity-label management |

Both routes are role-gated: only `ME.role === "admin"` or `ME.role === "dev"` may access them. The Admin panel row already added to `/settings` (`new_ui/js/settings.js`) only *shows* the link for these roles, but that's a UI nicety, not the security boundary — the route handler itself must check the role and redirect a non-admin hitting `/admin` or `/admin-users` directly (e.g. `navigate('/compendium')`), the same way `route()` in `router.js` already redirects unauthenticated users away from protected routes. The backend is the real enforcement boundary regardless (every consumed endpoint already requires `get_admin`/`get_dev`), but the frontend should not render admin UI to a user who can't use it.

**No backend changes.** Every stat, list, and mutation this spec needs already has a working endpoint:
- `GET /api/admin/users`, `POST /api/admin/users`, `DELETE /api/admin/users/{uid}`, `PUT /api/admin/users/{uid}/password`, `PUT /api/admin/users/{uid}/role`, `PUT /api/admin/users/{uid}/dev-role`, `POST /api/admin/users/{uid}/suspend`, `POST /api/admin/users/{uid}/unsuspend`
- `GET/POST /api/admin/users/{uid}/notes`, `DELETE /api/admin/notes/{note_id}`
- `PUT /api/admin/users/{uid}/identity`
- `GET /api/characters` (character count)
- `GET /api/admin/content-reports`, `GET /api/admin/flagged-endpoints`, `GET /api/admin/password-reset-requests`, `GET /api/admin/model-requests` (attention counts)
- `GET /api/admin/service-health` (ComfyUI/model/pgvector/storage tiles)

## Screens

### `admin` — Overview dashboard

On mount, fires the same parallel-fetch pattern as legacy's `admin-core.js` `render()`: `Promise.all` across `/api/admin/users`, `/api/characters`, `/api/admin/content-reports`, `/api/admin/flagged-endpoints`, `/api/admin/password-reset-requests`, `/api/admin/model-requests`, `/api/admin/service-health` — each `.catch(() => [])`/`.catch(() => ({}))` individually so one failing endpoint doesn't blank the whole dashboard (matches legacy's defensive pattern exactly).

- **Service-health row**: tiles for ComfyUI backend, chat model, pgvector, storage — pulled from `/api/admin/service-health`'s per-service `ok`/latest-value shape, styled like the mockup's `svc()` tiles (icon + label + green/warn status dot + value).
- **Stat tiles**: Users (`allUsers.length`), Admins (`allUsers.filter(u => u.is_admin).length`), Characters (`chars.length`) — plain counts, no attention styling.
- **Attention tiles**: Pending user approvals (`allUsers.filter(u => u.status === 'pending').length`), Flagged endpoints (`flagged.length`), Password resets (`resetReqs.length`), Model requests (`modelReqs.filter(r => r.status === 'pending').length`) — styled distinctly (accent/warn color) when nonzero, matching legacy's `{attn:true}` stat variant.
- **Attention banner**: shown only when the sum of the four attention counts is nonzero, listing each nonzero count inline (e.g. "3 pending · 1 flagged"). No jump-to-moderation button in this sub-project (that screen doesn't exist yet) — the banner is informational only until the Moderation sub-project ships, at which point a follow-up change adds the jump link.
- **Top users list**: first 5 users from `allUsers` (matches mockup's 5-row list), avatar + name + `@handle` + role badge (Owner/Dev/Admin/Member/Suspended, colored per role), each row linking to `/admin-users` (the mockup's per-row chevron doesn't deep-link to a single user's detail — this sub-project doesn't build per-user detail pages, the full list on `/admin-users` is where per-user actions live).

### `admin-users` — User list & management

Full list (not just top 5), each row expandable/actionable:

- **Row display**: avatar, username, identity label badge (if set), "You" badge (if `u.id === ME.id`), role badge (Admin/Dev), suspended badge + reason (if suspended), truncated user ID.
- **Create user**: button opens a small inline form (username — auto-sanitized to `[A-Za-z0-9_-]` as typed, matching legacy's `nu_name` input handler — password with an 8-char minimum client-side check before submit, "grant admin" checkbox) → `POST /api/admin/users`.
- **Per-row actions** (each a button, all matching legacy's exact permission gating):
  - Reset password → `PUT /api/admin/users/{uid}/password`
  - Promote to admin / demote from admin (never shown for `u.id === ME.id`) → `PUT /api/admin/users/{uid}/role`
  - Grant/revoke Dev (only shown when `ME.role === "dev"`, target is already admin, and `u.id !== ME.id` — matches `backend/auth.py`'s Dev-only, no-self-escalation rule) → `PUT /api/admin/users/{uid}/dev-role`
  - Suspend (prompts for a reason, matching legacy) / Unsuspend (never shown for `u.id === ME.id`) → `POST /api/admin/users/{uid}/suspend` / `POST /api/admin/users/{uid}/unsuspend`
  - Delete (never shown for `u.id === ME.id`, confirmation required) → `DELETE /api/admin/users/{uid}`
  - Notes → opens a small modal (or inline expansion) listing existing notes (`GET /api/admin/users/{uid}/notes`) with add (`POST`) and delete (`DELETE /api/admin/notes/{note_id}`) — private, admin-only moderation log, never shown to the user being noted
  - Identity label → a single-line text field, saved via `PUT /api/admin/users/{uid}/identity` — an admin-only tag (e.g. for tracking known alt accounts), shown as a badge in the row display above

All list/action HTML follows the same escaping discipline established in the Settings feature: every user-controlled string (`username`, `display_name`, `identity_label`, note text, suspension reason) goes through `_esc()`/`_attr()` before landing in `innerHTML`/attribute contexts — this is not optional, it's the same class of bug the Settings feature shipped and fixed twice already this session.

## Data flow & error handling

- Both screens fetch on `mount()`; `admin-users` re-fetches the full list after every successful mutation (simplicity over optimistic local patching, matching the Settings screens' established pattern) rather than trying to diff-update a single row.
- Every mutating action: confirm (native `confirm()`) for destructive ones (delete, suspend), call the endpoint, `toast()` on success, `errorToast(e.message)` on failure with no state change, `render()` to reflect the new state.
- Role-gate check happens in the route handler (`router.js`'s `routes.admin`/`routes["admin-users"]`), not inside the view class — a non-admin never even constructs `AdminOverviewView`/`AdminUsersView`.

## Testing

No backend changes — every consumed endpoint already exists and is already tested. No JS unit-test harness exists in `new_ui/` (project-wide constraint, not new to this spec). Verification is manual/Playwright against the running `:3001` dev server, logging in as the `claude` admin account (per `CLAUDE.md`'s fixed test accounts — never create new ones):
- `/admin` renders service-health tiles, stat tiles, attention banner (or "all clear" state), and a 5-row user summary.
- A non-admin (`test` account) hitting `/admin` or `/admin-users` directly gets redirected, not shown a broken/empty admin screen.
- `/admin-users` renders the full list; create/suspend/unsuspend/role-change/delete/notes/identity-label each round-trip correctly against the live backend. `CLAUDE.md`'s "DO NOT CREATE NEW ACCOUNTS" governs login credentials for testing this app's regular features (always use the fixed `claude`/`test` accounts) — it does not forbid exercising the admin panel's own create-user feature. Verification creates one throwaway user via the panel's own "Create user" action, exercises suspend/role-change/notes/identity-label/reset-password against it, then deletes it via the panel's own delete action within the same test run — never against the `claude`/`test` fixed accounts themselves, and never left behind after the test run ends.
