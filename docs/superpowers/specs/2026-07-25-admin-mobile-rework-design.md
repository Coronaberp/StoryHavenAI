# Admin panel mobile rework, polling and latency fixes

## Problem

The admin area (9 screens, ~4000 lines of JS) has almost no responsive
treatment: tables overflow at phone width, navigation requires bouncing
through Overview, and the Health dashboard is unusable on mobile. Three
functional defects compound it:

1. `GET /admin/service-health` runs live service checks inline on every
   request; each unreachable service blocks up to 5 seconds. The Overview
   calls it on mount, so the admin panel stalls whenever anything is down,
   which is the normal state for instances using a hosted image provider
   with no ComfyUI.
2. `GET /media-gen-status` reports image generation availability from the
   ComfyUI ping alone, wrongly blocking image generation in the UI when a
   hosted `image_provider` is active.
3. The LoRA training watcher binds DOM refs once at `watch()` time and
   checks `isConnected` on every poll. Leaving and re-entering the Progress
   tab creates new nodes, so the poller keeps fetching but silently stops
   rendering until a manual reload (long-standing stale-progress bug).

## Decisions (user-selected from mockups)

- Navigation: a screen-switcher dropdown pinned under the header on every
  admin screen at mobile and tablet widths. Shows the current screen name
  plus its attention-badge count; opens a list of all nine areas, each with
  its own badge. Desktop (1024px+) is untouched.
- Queue screens (Moderation's queues, pending emoji, model requests):
  A-cards — identity line, facts line, and the row's 2-3 real actions as
  inline buttons. Destructive actions keep their confirm modal.
- Directory screens (Users, model previews, LoRA past jobs): C-rows — one
  compact line per item (name, one status pill, chevron); tap opens a bottom
  sheet with full details and large action buttons.
- Both patterns are one card family sharing surface, pill, and action-button
  styles built on the existing theme tokens.
- Health: one row per service with status LED, name, current latency, and a
  small inline Chart.js sparkline; tapping expands the full latency-history
  chart inline. Log viewer gets a level-filter chip row; log lines scroll
  horizontally inside their own container, never the page.
- Forms (Server Configuration, Announcements, Feature Flags): single-column
  stacking with full-width inputs and a sticky primary button at phone
  width. No structural change.
- Tiers: mobile (<768) gets everything above; tablet (768-1023) gets the
  dropdown plus two-column card grids, reusing the `#tabletRail` pattern
  where a rail exists; desktop and ultrawide unchanged.

## Backend changes

- `GET /admin/service-health` returns the recorded pings (the background
  loop already records every 5 minutes) without running live checks. A new
  `POST /admin/service-health/refresh` runs `run_all_checks_and_record()`
  and returns the fresh results; only the Health screen's explicit refresh
  button calls it. Overview always uses the fast cached read.
- `GET /media-gen-status` returns `{"available": true}` whenever
  `CFG["image_provider"]` is set and not `"comfyui"`; otherwise the existing
  ComfyUI-ping logic applies unchanged.
- Both changes get pytest coverage (cached read does not invoke checks,
  refresh does; provider-active bypasses the ping, comfyui mode still uses
  it).

## Frontend changes

- New `new_ui/js/admin-mobile.js`: the screen-switcher dropdown, the shared
  card/row/bottom-sheet renderers, and the sparkline helper. Plain functions
  except where real state exists (the bottom sheet owns open/close state and
  is a class if and only if it holds live DOM/timer state).
- Styles in `new_ui/css/cards.css` (never `app.css`), using theme tokens
  only, no hardcoded hex values. `./rebuild.sh --once` after CSS edits.
- Each of the nine admin files adapts its render to emit A-cards or C-rows
  through the shared helpers at mobile width, keeping its existing desktop
  markup untouched.
- Training watcher fix: `watch()` refs become re-attachable — a
  `rebind(refs)` method the Progress tab calls on every mount while a job is
  being watched; polling cadence and settle logic unchanged. The health
  screen's poller gets the same mount-lifecycle audit.
- All new UI strings go through `t("key", "Fallback")` and are added to
  UI_STRINGS. No em dashes or semicolons in user-facing strings.

## Out of scope (recorded follow-ups)

- `/api/notifications/unread-count` client polling frequency (app-wide, the
  noisiest endpoint in the logs; needs a longer interval plus hidden-tab
  backoff).
- Any desktop admin redesign.

## Testing

- Backend: pytest for the two endpoint changes as above.
- Frontend: tree-sitter parse for every touched JS file; visual verification
  against the live app at 375px, 800px, 1280px, and 2200px widths; the
  training-watcher rebind verified by switching tabs during a queued job.

## Verification claims checked during design

The app launches without ComfyUI (nothing in startup requires it), Modal is
provisioned only on use, chat/embed endpoints degrade per-request rather
than blocking boot. Embeddings stay functionally required for memory and
lore but do not block launch.
