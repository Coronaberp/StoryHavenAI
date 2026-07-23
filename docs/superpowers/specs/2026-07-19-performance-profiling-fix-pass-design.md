# Site-wide performance profiling + fix pass (round 2)

## Context

Round 1 dispatched four parallel Playwright agents against the live app to test the hypothesis that `new_ui/js/*.js`'s pattern of rebuilding `this.main.innerHTML` on every state change causes visible jank. That hypothesis mostly didn't hold — DOM rebuilds at the tested sizes (400-750 nodes) never produced a PerformanceObserver long-task entry. Two real, unrelated problems were found instead:

1. `/explore/media` (`pinacotheca.js`) eager-loads all gallery images with no `loading="lazy"`, producing ~1.5s of main-thread blocking time (12 long tasks) on initial page load.
2. `admin-health.js`'s 1h/24h/7d range buttons rebuild the entire service-card grid's HTML and destroy+recreate every Chart.js instance on every click (confirmed via DOM node identity marking — 6 of 7 canvases were replaced, not reused), costing ~1000ms per click for what should be a pure data update via Chart.js's own `update()` API.

A third signal — `ChatView.render()` sitting at ~50ms with only 7 test messages, right at Chrome's long-task threshold — is a real concern but explicitly out of scope here: the user is building a genuinely long roleplay session to test it properly, suspecting server-side Fernet decryption cost (not client render) is the actual bottleneck there. That investigation happens separately once the session exists.

## Goal

Extend the same measurement-driven approach to the screens/interactions round 1 didn't cover, then fix everything confirmed as an actual hotspot — round 1's two findings plus whatever round 2 turns up. Do not touch anything that measures fine.

## Round 2 profiling scope

Screens/interactions not yet profiled:
- Admin: `admin-users.js`, `admin-moderation.js`, `admin-emojis.js`, `admin-previews.js`, `admin-train.js` (LoRA training panel — there's a standing, previously unconfirmed project note that its progress UI goes stale and needs a manual reload; check whether this is a `TrainingJobWatcher` polling-lifecycle bug while profiling this screen, but don't chase it deeply if it turns out to be unrelated to responsiveness)
- `sanctum.js` (personas home), `notifications.js`, `comments.js` (thread rendering)
- Key modals: dice-roll (`chat.js`), style/length picker (`chat.js`), session-lore reveal (`chat.js`)

Same method as round 1: parallel `general-purpose` Agent dispatches, each given 2-4 screens, using Playwright against the live public domain with `claude`/`0987654321` (admin) or `test`/`11111111` credentials, measuring:
- Time to `networkidle` on load
- DOM node count
- `PerformanceObserver` long-task entries (>50ms) during load and during 2-3 realistic interactions per screen
- Any confirmed DOM-churn pattern worth calling out (e.g. via node-identity marking, as done for `admin-health`'s charts)

Read-only — no edits during profiling, findings reported back as text.

## Fixes to apply

In confirmed-first order:

1. **`/explore/media` lazy-loading**: add `loading="lazy"` to gallery `<img>` tags in `pinacotheca.js`. Verify via a before/after Playwright long-task count on page load.

2. **`admin-health.js` chart/grid rebuild**: replace the `renderHealth()` → full `grid.innerHTML` rebuild → `renderChart()` destroy-and-recreate cycle with an in-place update: keep each service's `<canvas>` and its `Chart` instance alive across a range-button click, and update via `chart.data = ...; chart.update()` plus targeted text-content updates for the surrounding card (uptime %, latency, status dot) rather than replacing the card's HTML. Verify via the same DOM node-identity marking technique used in round 1's profiling (tag canvases, click a range button, confirm they're the *same* nodes afterward) plus a before/after long-task count.

3. **Round 2 findings**: fixed using the same "only what's measured" discipline — each fix scoped narrowly to the confirmed hotspot, not a broader rewrite of the surrounding view.

## Non-goals

- `ChatView.render()` / message-history scaling — deferred to the user's own long-session test.
- Any admin-train polling bug that turns out to be a correctness/lifecycle issue unrelated to raw responsiveness — flagged for a separate fix, not folded into this pass.
- No speculative architectural changes (e.g. no virtual-DOM introduction, no framework adoption) — round 1 already showed the `innerHTML`-rebuild pattern itself isn't the bottleneck at current data scales.

## Testing

Every fix gets a live before/after Playwright re-measurement (long-task count/duration, and DOM node-identity checks where relevant) — the same verification method used to find the problems in the first place, not just visual inspection.
