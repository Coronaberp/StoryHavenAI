# StoryHaven AI — V1.1 Release Audit Report

Audit performed across the whole app (server assembly, routers, db/vectors, static frontend, auth/security surface, chat/prompt/llm pipeline) ahead of the V1.1 release. Five domain audits ran in parallel; findings below are deduplicated and verified — several sub-agent findings were checked against the code and turned out to be false positives, noted as such.

## Fixed in this pass

- **`prompt.py` — `parse_mood`/`MOOD_RE` regex bug.** The regex matched `[mood: X]`-shaped text anywhere in a reply, not just a trailing tag. A reply that happened to contain that literal pattern mid-story (e.g. quoted dialogue) could have text silently stripped from the middle of the narration, and multiple matches meant the *last* one won arbitrarily. Anchored the regex to end-of-string so only a genuine trailing mood tag is parsed/stripped.
- **Stale `app.js`/`style.css` comments** left over from the pre-split monolith, in `static/css/base.css` and `static/js/modal-settings.js`. Updated to reference the current `static/js/*.js` / `static/css/*.css` split.
- **`CLAUDE.md` SSE stream format section** understated actual behavior — the `delta` event withholds the *entire* reply until generation completes (not just a trailing mood tag), by design, so a mood tag can never leak. Doc now matches the actual (intentional) implementation.
- **`CLAUDE.md`** now has an explicit section stating this checkout *is* the live running app (bind-mounted into the `story-game` container) and that `EnterWorktree`/`git worktree` must never be used here — a worktree is a different directory the container isn't mounted to, so changes there would silently never reach the live app.

## Audited, confirmed correct — no fix needed

- **Router wiring**: all new routers (`comments`, `forum`, `emojis`, `notifications`, `health`) are registered in `server.py`; none are dead code.
- **Frontend coverage**: all four new backend domains (comments, forum, emojis, notifications) have real, wired-up frontend UI in `static/js/*.js` — none are backend-only.
- **Notifications encryption**: a sub-agent flagged `db.notifications.title/body` as unencrypted based on `backfill_encrypt.py`'s target list — verified false. `create_notification`/`_notif_row` correctly encrypt on write and decrypt on read.
- **SSRF redirect-following**: a sub-agent flagged missing `follow_redirects=False` handling in `llm.py`/`ssrf.py` — verified false. httpx defaults to `follow_redirects=False` and nothing in the codebase overrides it, so the validated-endpoint-then-redirected-elsewhere attack doesn't apply.
- **Auth**: session cookie flags, password hashing, login throttling, pending-account gating all check out. No route found missing its auth dependency.
- **SSRF validation**: private/loopback/link-local/metadata-IP ranges are blocked via `ipaddress`, with DNS-rebinding closed by pinning the validated IP for the actual request.
- **Media upload validation**: magic-byte checks via `PIL.Image.verify()`, GIF frame cap, upload size cap, and path-traversal-safe deletion all present.
- **`_endpoints()` single-resolution**: no other code path independently reads `CFG`/`user_settings` for a chat/embed base URL or API key outside the two informational, non-generation call sites in `routers/health.py` and `routers/misc.py`.
- **Regeneration memory cleanup, think-block stripping, language threading, base-URL normalization, `ThinkSplitter` split-tag handling**: all verified correct against `CLAUDE.md`'s documented behavior.
- **Migration idempotency**: all `ALTER TABLE ... ADD COLUMN` migrations in `db.py` carry safe defaults for existing rows; nothing would break against a live V1.0 database.
- **No hardcoded secrets** anywhere in the repo (excluding `venv/`).

## Known backlog (left untouched — low severity, or too risky to change on a live app in this pass)

- `db.list_forum_threads` / `db.list_comments` fetch all matching rows and sort/paginate in Python rather than pushing `LIMIT`/`OFFSET` into SQL. Fine at current scale; worth a proper SQL-side rewrite once forum/comment volume grows enough to matter. Deferred because a correct fix requires restructuring how like-counts are aggregated into the query, and this is a live production app — not something to change blind under this pass.
- Missing indexes on `model_requests`, `image_rating_reports`, `admin_notes` — all admin-only, low-volume tables today.
- `auth.py`'s login throttle is in-process memory; correct for the current single-worker deployment but won't survive a future multi-worker setup without shared state.
- Password hashing is PBKDF2-HMAC-SHA256 (120k iterations) — acceptable now, worth moving to argon2id in a future version.
- `routers/comments.py`'s `GET /comments` has no pagination limit — fine at current traffic, same deferral reasoning as the forum/comments query above.

## Process note

This audit ran five domain agents in parallel (router wiring, db/vectors schema, frontend static split, auth/security, chat/prompt/llm pipeline). Two of their findings (notifications encryption, SSRF redirect handling) were flagged as high/medium severity but did not survive verification against the actual code — both are noted above as confirmed-correct rather than acted on, to avoid introducing unnecessary changes based on a mistaken read.
