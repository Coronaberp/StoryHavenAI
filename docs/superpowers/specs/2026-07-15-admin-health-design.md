# Admin panel — Service health & server logs — new_ui design spec

## Context

Sixth and final sub-project of the Admin panel (see `docs/superpowers/specs/2026-07-15-admin-overview-users-design.md` for the six-way split; sub-projects 1-5 already shipped). Covers `legacy_ui/js/admin-health.js`'s scope: per-service health cards with latency history, and a live server-log viewer.

## Scope

One new route, `admin-health` (`AdminHealthView` — `new_ui/js/admin-health.js`), role-gated identically to the other admin routes, linked from `/admin`.

- **Service health**: a time-range selector (1h / 24h / 7d, matching legacy's `healthRangeHours`), process uptime, and a card per service (`database`, `chat_llm`, `embed_llm`, `comfyui`, `image_classify_llm`, `modal`) from `GET /api/admin/service-health?hours={h}` — status dot, current latency, 24h uptime %, average latency, and a **Chart.js line chart** of the service's `latency_history` (`{t, ok, ms}[]`) plotted over the selected range (per this project's stated preference for Chart.js over hand-rolled SVG for any chart — this replaces legacy's raw-SVG `_admHealthLineChart` polyline entirely). A down/error state shows the service's `error` message.
- **Server logs**: a level filter (DEBUG/INFO/WARNING/ERROR, matching legacy's `#logLevel` select) and a refresh button, from `GET /api/admin/logs?level={level}&limit=300` — each entry rendered as one line (timestamp, level with color coding, logger name, message), newest first (matches legacy's `.reverse()`).

**No backend changes.** Both endpoints already exist and are already tested.

## Chart.js integration

`new_ui/index.html` currently loads two CDN scripts (`marked.min.js`, `purify.min.js`) with SRI hashes via plain `<script src="..." integrity="..." crossorigin="anonymous" defer>` tags — this is the established pattern for third-party libraries in this project (no bundler/npm). Add Chart.js the same way: a CDN `<script>` tag with an SRI integrity hash, `defer`, loaded before `admin-health.js`. One `Chart` instance per service card, `type: "line"`, `data.labels` from each history point's `t` (formatted as a time string), `data.datasets[0].data` from each point's `ms` (null for down/missing points, so Chart.js's default gap-rendering shows the outage visually rather than plotting it as zero latency) — a small, minimal line chart (no legend, no axis labels beyond what's needed to read the trend at a glance, matching the compact sparkline role the legacy SVG version played) styled to follow the current theme (`var(--color-accent)` for the line, `var(--color-line)` for gridlines pulled via `getComputedStyle` since Chart.js needs real color values, not CSS custom property references, in its config object).

## Data flow & error handling

Health cards re-fetch on mount and on every range-selector click; logs re-fetch on mount and on level-select change or manual refresh. Both follow the standard try/catch/errorToast pattern used by every other admin screen, with an inline error message replacing the grid/log-view content on failure (matching legacy's inline `log_fail`-style message) rather than a toast, since these are read-only data-loading views where the failure IS the content to show. Every user-controlled string — specifically the log `message`/`logger` fields (per `CLAUDE.md`'s own note that logs "never contain chat/character content, API keys, or endpoint URLs," but the message text itself is still admin-facing free text originating from app code, some of which echoes back things like a username or model name) and the service `error` string — goes through `_esc()` for its context.

## Testing

No backend changes. No JS unit-test harness; Playwright verification against the running `:3001` server logging in as `claude`. Purely read-only screen (no mutations), so verification is limited to confirming both sections render real data and the range/level controls actually change what's fetched (verifiable via `page.expect_response(...)` showing the request URL's `hours`/`level` query param changes on interaction).
