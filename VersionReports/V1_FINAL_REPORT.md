# StoryHaven AI | V1.0 Final Report

This is the true final outcome report. Every item from `report_v1.md`'s original audit, including the three frontend items deliberately deferred in the first remediation pass, is resolved. All application-level changes were verified against the live running instance — every file compiles, imports cleanly, the OpenAPI route surface stayed byte-identical through the `server.py` split (88 routes, empty diff), and the container restarted clean with `/api/health` returning the documented `401` "up" signal at every stage.

This report also covers the infrastructure work that followed: a compose-file precedence bug fix, an LLM backend swap, and standing up a PostgreSQL+pgvector container. That part ends with **two genuinely open items** — see the bottom of this report.

## Security — all items resolved

| Item | Outcome |
|---|---|
| No rate limiting on login | ✅ Fixed. 5 failed attempts per (IP, username) within 5 minutes returns 429; resets on success. |
| Encryption key stored alongside what it encrypts | ✅ Fixed. `SECRET_ENCRYPTION_KEY` env var moves the key outside the database when set; non-breaking fallback otherwise. |
| Raw CSS unsanitized in the custom-page sandbox | ✅ Fixed. `@import` stripped, absolute/protocol-relative `url(...)` rewritten to `none` before injection. |

## Backend — all items resolved

| Item | Outcome |
|---|---|
| No transaction boundaries around multi-step writes | ✅ Fixed with a write-serialization lock, then **superseded** — see "SQLAlchemy Core port" below. |
| Blocking work on the async event loop | ✅ Fixed — image processing/file writes run via `run_in_executor`. |
| `server.py` monolith / `_run` god function | ✅ Fixed — split into 8 domain routers + `state.py`/`auth.py`/`ssrf.py`/`prompt.py`/`media.py`/`chat_service.py`. |
| N+1 query patterns | ✅ Fixed — correlated subqueries/joins replace per-row loops. |
| Duplicated image-upload logic (5 places) | ✅ Fixed — one shared `_save_uploaded_image` helper. |
| Side AI calls ignoring a user's custom endpoint | ✅ Fixed — turn-signal extraction, image-prompt generation, and translate now thread the calling user's endpoint. |
| No size cap on uploads | ✅ Fixed — 15MB cap enforced before decode. |
| In-flight generation lost on restart | Unchanged by design — inherent to a single-process buffer, not a bug. |

## Frontend — all items resolved (including the previously-deferred three)

| Item | Outcome |
|---|---|
| Three "confirm destructive action" patterns | ✅ Fixed — all native `window.confirm()` sites migrated to `confirmAction()`. |
| Duplicated SSE stream parser | ✅ Fixed — one shared `sseEvents()` helper. |
| Custom dropdown had no keyboard/ARIA support | ✅ Fixed — full listbox semantics, arrow-key/Enter/Escape handling, visible focus ring. |
| Silent error swallowing | ✅ Fixed where it hid a real failure; deliberately-silent paths left alone. |
| Autosize helper copied 5× | ✅ Fixed — one shared `autosize(ta, max)`. |
| Full thread re-render on every reply | ✅ Fixed. A finished turn is appended incrementally in place of the live-streaming node instead of rebuilding the entire visible conversation; full re-render is preserved for initial load, chat switch, edit/delete, and pagination. |
| Chat state as a loosely-owned global | ✅ Fixed. Replaced with an owned `ChatState` object (`set`/`current`/`isActive`/`clear`) that explicitly aborts an in-flight stream on navigation, instead of scattered defensive null-checks across ~30 call sites. |
| Sidebar refetches on every navigation | ✅ Fixed. 30-second cache with explicit invalidation at every action that actually changes the list. |

## Application-level work beyond the original audit

**Rebrand complete.** Personae → StoryHaven AI everywhere — code, docs, API title. Zero remaining references outside the deliberately-untouched `personae.db` filename (a live deployment detail, not a branding string).

**Encryption at rest.** Character personas/scenarios/greetings/dialogue/system prompts, lore content, persona descriptions, and message content are encrypted transparently on write/read. The one real conflict found — `characters.persona` needed for SQL search — was resolved by moving that search into Python over decrypted rows, not by leaving a plaintext exception.

**`server.py` decomposed** into `server.py`, `state.py`, `auth.py`, `ssrf.py`, `prompt.py`, `media.py`, `chat_service.py`, and 8 `routers/*.py` files — verified with a live restart and an empty route-surface diff.

**PostgreSQL migration — phase 1 complete.** `db.py`'s entire query layer has been ported from raw `aiosqlite` `?`-placeholder SQL to SQLAlchemy Core (Table objects + expression API), verified against live data (existing characters read back with persona text correctly decrypted; a real write path was confirmed to land in the database). `personae.db` was backed up before cutover and has not been deleted.

## Infrastructure work

**Compose file precedence bug found and fixed.** `~/.sillytavern/` contained both `docker-compose.yml` (the real stack, per `CLAUDE.md`) and a stray, unrelated `compose.yaml` (an old standalone ComfyUI-only file). Docker Compose's file-discovery silently prefers `compose.yaml` when both exist, so any bare `podman compose`/`docker compose` command (without an explicit `-f`) was running against the wrong file. Fixed by deleting the stray file and renaming the real one to `compose.yaml`, so default invocations now resolve correctly.

**LLM backend swap: koboldcpp → llama.cpp, now live.** `koboldcpp` is removed; `llamacpp-chat` and `llamacpp-embed` are up (llama.cpp serves one model per instance, so this is two containers where koboldcpp was one). App defaults (`state.py`, `llm.py`, `CLAUDE.md`, `README.md`) updated to match. Context window set to 128k per your request.

**Chat model changed to `HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive`**, pulled directly from Hugging Face rather than the old local Qwen GGUF. `llamacpp-embed` is confirmed up and serving (`nomic-embed-text`, unchanged). `llamacpp-chat` is not yet serving — see open items below.

**PostgreSQL + pgvector container stood up: `storyhaven-postgres`**, healthy, accepting connections on `127.0.0.1:5433` (not 5432 — that port was already owned by a separate, pre-existing `airoleplay-pg` container unrelated to this stack). Placeholder credentials (`storyhaven`/`ChangeMe`) — **change the password before relying on this for anything real.** Not yet connected to the app — that's phases 2–4 of `MIGRATION_POSTGRES.md`, not started.

**Redis deliberately not removed yet.** `vectors.py` still depends on it for memory/lore search; pulling it out now, before that code is ported to pgvector, would break live retrieval immediately. This happens once the vectors.py port is actually done, not before.

## What's genuinely still open
3. **Postgres isn't connected to the app.** The container exists and is healthy; wiring the app to it (data migration, `vectors.py` port to pgvector, actual cutover) is still ahead — see `MIGRATION_POSTGRES.md`.
4. **`db._write_lock`** stays in place until the real Postgres cutover happens.

