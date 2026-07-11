# Codebase-wide refactor: fix perf, then split/OOP-ify the biggest files, with tests and logging

## Context

Two separate problems triggered this:
1. **The app is slow, and polling "is basically broken."** There's already a root-caused, uncommitted diagnosis sitting in `plan.md`: `watchTrainingJob()` in `static/js/personas.js` starts a new `setInterval(poll, 5000)` on every re-render of the Train LoRA tab without ever clearing the previous one. Because the DOM ids it polls against are identical across re-renders, old "zombie" pollers never error out — they just keep hitting `GET /api/admin/lora-training/jobs` and writing to the (now-detached) DOM forever. Every visit to that tab adds one more permanent background poller for the rest of the session. This is a plausible, concrete cause of both the perceived slowness and "polling doesn't work" (racing DOM writes from multiple zombie pollers).
2. **Standing architecture directive** (now in `CLAUDE.md`): OOP is mandatory for new/touched code, tests and logs are mandatory, and files must not become dumping grounds for unrelated functionality. Today nothing in this ~25.7k-line app has automated tests, and three files are badly overgrown: `backend/db.py` (3186 lines — every table's CRUD in one file), `static/js/core.js` (3221 lines — shared helpers/i18n/appearance for the whole SPA), `static/js/personas.js` (2252 lines — persona editor, image generation, AND LoRA training tab, three barely-related feature areas in one file).

Per your direction: fix the concrete performance bug and actually profile load times *before* assuming a class-based rewrite will make anything faster — OOP is a readability/maintainability win here, not a performance one. The two workstreams are ordered so the quick, high-confidence fix and the profiling data land first, informing whether/where the bigger split-and-refactor work is even worth prioritizing.

This is a live app with no test net today and no worktree isolation (per `CLAUDE.md`, never use `EnterWorktree` here) — every edit takes effect immediately in the running container. The plan is deliberately phased so each phase is independently shippable and verifiable before the next begins, rather than one large simultaneous rewrite.

## Phase 0 — Fix the known polling leak (ships first, standalone)

File: `static/js/personas.js`, `watchTrainingJob(jobId)` (~line 1065), using the idiom this file already applies elsewhere (`statusPillTimer`/`tlStatusPillTimer`: `clearInterval` immediately before `setInterval`; `admin.js`'s `_modPollIv`: self-terminate by checking `.isConnected` on a captured DOM node):

1. `clearInterval(recoveredPolling)` before assigning a new one, so switching tabs repeatedly can't stack pollers.
2. Inside `poll()`, check `statusLabel.isConnected` (already captured via `$("#lt_status_label")`) at the top — if the DOM has been replaced by a fresh render, `clearInterval` and return, so a zombie poller self-terminates within one tick instead of running forever.

Verify per `plan.md`'s existing verification section: switch Training tab ↔ another tab 3-4 times while a job runs, confirm the Network tab shows exactly one `lora-training/jobs` request per 5s (not a growing multiple), and confirm no more requests fire after leaving the tab.

## Phase 1 — Profile actual load-time bottlenecks (data before rewriting)

Before touching file structure, gather real numbers so effort goes where it matters:
- Browser DevTools Network tab (cold load of the main chat view and the admin/studio views): total JS/CSS payload size, any render-blocking request, any request that's slow rather than just present. `static/js/core.js` and `personas.js` are loaded as plain `<script>` tags with no bundling/minification/compression — check whether `Content-Encoding: gzip/br` is actually being sent (`server.py`'s static mount config) and whether these large uncompressed files are the actual weight, versus a slow backend call.
- Server-side: check `backend/state.py`'s `log` / admin Server Logs panel during a slow page load for any endpoint taking unusually long (candidates: `db.py` queries backing session/character list loads, `_eff_cfg` settings resolution, `/api/ui-translations` if not cached).
- Confirm the Phase 0 fix alone by re-checking perceived responsiveness after a normal multi-tab-switch session, before concluding more work is needed.

Output of this phase: a short prioritized list (in the PR/commit description, not a new doc) of which bottleneck(s) are real vs. assumed. If compression/caching headers are the actual issue, that's a small, targeted fix, independent of the file-splitting work below — call it out and do it as its own small change rather than folding it into the OOP pass.

## Phase 2 — Split and class-ify the three overgrown files, one at a time, tests added alongside

Order: `backend/db.py` → `static/js/core.js` → `static/js/personas.js` (backend first since pytest coverage is straightforward there; each file fully shipped and verified before the next starts).

**`backend/db.py`** (3186 lines, one file for every table's CRUD): split by domain to match the existing `backend/routers/*.py` one-file-per-domain convention — e.g. `backend/repositories/characters.py`, `personas.py`, `lore.py`, `sessions.py`, `settings.py`, `forum.py`, `lora_training.py`, each holding a class (e.g. `CharacterRepository`) wrapping the existing asyncpg/SQLAlchemy Core calls for that domain, replacing today's module-level functions taking a raw connection. Add pytest tests per repository (using a test DB or transaction-rollback fixture — no test infra exists yet, so this phase also stands up `pytest` + `pytest-asyncio` + a minimal fixture as its first commit). Add `log.*` calls to mutating methods per the standing logging rule (CLAUDE.md notes `db.py` currently has ~zero).

**`static/js/core.js`** (3221 lines, shared helpers/i18n/appearance for the whole SPA): identify the distinct concepts already living in it (toast/notification system, modal helpers, i18n string lookup, appearance/theme, autocomplete dropdowns) and split into one small ES6 class per concept (e.g. `class ToastManager`, `class I18n`), each in its own file loaded via the existing plain `<script>` tag mechanism — no bundler/build step introduced, per your confirmation that vanilla JS stays vanilla.

**`static/js/personas.js`** (2252 lines, three unrelated feature areas bolted together): split into `personas.js` (persona editor proper), `imagegen.js` (image generation UI), and a new `lora-training.js` (the Train LoRA tab, including the Phase 0 fix). Each becomes/uses a class holding its own state (e.g. `class TrainingJobWatcher` replacing the free-floating `recoveredPolling` variable and `watchTrainingJob` function) instead of module-level mutable globals.

Each of the three sub-phases: implement, then manually verify the affected UI/API in the running app (character CRUD, page load using the split core.js helpers, persona editor + image gen + training tab) before moving to the next file — do not proceed to the next file with an unverified prior one.

## Non-goals

- No TypeScript, no bundler, no framework migration — confirmed out of scope, keeps `CLAUDE.md`'s "no build step" description accurate.
- No changes to `modal_app/lora_train.py`, `modules/py/*.py` (standalone migration scripts), or DB schema shape — this is an internal-structure refactor, not a data-model change.
- Not a single simultaneous rewrite of all three files — each ships and is verified independently.

## Verification

- Phase 0: Network tab shows no duplicate/zombie polling after repeated tab switches (steps already detailed above).
- Phase 1: documented before/after network payload sizes and any backend timing findings.
- Phase 2, per file: existing app functionality exercised manually against the live app (`localhost:3000`) after each split — character list/detail, chat send, persona editor open/save, image gen submit, LoRA training tab watch — plus new pytest suite passing for the `db.py` split (`pytest backend/`).
