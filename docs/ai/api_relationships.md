# API & core request-handling patterns

> Part of `docs/ai/` — git-tracked, public. Code-architecture facts only. See
> `architecture.md` for the exposure rule this doc set follows.

## Auth

HttpOnly cookie sessions (`persona_session`), checked by the `get_current_user`/`get_admin` FastAPI dependencies. First startup auto-creates an `admin` user and prints a random password to stdout if no users exist yet. `auth_router` (`/api/auth/*`) is public; everything under `api` (`/api/*`) requires a valid session. Self-registration (`POST /api/auth/register`) creates the account with `status="pending"` and notifies admins — it cannot log in until an admin approves it in the admin panel's Moderation tab.

## Settings

Two-tier: **global** config (admin-only, `PUT /api/settings`) is seeded from env vars into the `CFG` dict at startup, then overlaid from the `settings` table; **local** per-user overrides (`PUT /api/me/settings`, `user_settings` table) win over global for every key in `USER_CFG_KEYS` (`_eff_cfg`). Both tiers own an OpenAI-compatible chat endpoint *and* embed endpoint, each with an optional API key; `_endpoints()` in `chat_service.py` is the single place that resolves them (a per-user API key only applies together with that user's own URL). Embed *model/dim* stay global (one shared vector index) — only the endpoint serving it can be per-user. `PUBLIC_CFG_KEYS` controls what is exposed; `api_key` is write-only and never returned.

## Languages

The model generates directly in the resolved target language — there is no intermediate canon language. `_ui_language` resolves UI chrome/memory panel/char-state language (user's `interface_language`, else the admin's global `default_language`); `_chat_language` resolves the story's language (replies + thinking: the session's own talk language, else `_ui_language`). `build_system`/`think_instruction` take a `language` argument and instruct the model to think and write in it directly.

## Localization cache

Every translated display string (UI chrome via `/api/ui-translations`, scenarios/personas/greetings via `/api/localize`) is persisted in the `localization` table keyed by (sha256(source), lang) — each unique string is LLM-translated exactly once per language, ever (`_localize_texts`). Failures fall back to source text without caching so they retry.

## Thinking

`<think>...</think>` blocks are streamed on a separate SSE channel, stored inline in message content, but stripped before being fed back to the model as history and excluded from memory embeddings. `ThinkSplitter` in `llm.py` handles tags that arrive split across stream deltas.

## Visual-novel moods

When a character has stage moods defined, the system prompt asks the model to end replies with `[mood: X]`. `parse_mood` in `prompt.py` strips this tag before storing; the mood is sent to the UI on the `done` SSE event.

## Two modes

Characters have `mode = "character"` (first-person) or `"rpg"` (third-person GM narrator). `build_system` branches on this.

## Base URL normalization

`llm._root` tolerates URLs ending in `/chat/completions`, `/models`, `/v1`, `/api/v1`, or a bare host — always normalizes to a root ending in `/v1`.

## Separate embed URL

`embed_base_url` / `EMBED_BASE_URL`: when left blank, the chat base URL is reused. Set it when chat and embedding models are on different servers.

## Schema

The full schema is declared as SQLAlchemy Core `Table` objects in `db.py` and created with `metadata.create_all` at startup (`checkfirst` — only creates what's missing). New columns are added by editing the `Table` definition; pgvector tables are declared in `vectors.py` and created by `ensure_indexes`.

## Changing the embedding dimension

Vectors of different sizes cannot share an index. After changing the embed dimension, drop the two pgvector tables and let them be recreated:

```sql
DROP TABLE IF EXISTS memory_vectors;
DROP TABLE IF EXISTS lore_vectors;
```

Or change `embed_dim` in Settings — the API calls `vectors.reset_indexes` automatically (which does exactly the above and recreates the HNSW indexes).

## SSE stream format

`POST /api/sessions/{sid}/chat` (and `/regenerate`, `/roll`, `/continue`) return `text/event-stream`. Event types:
- `meta` — `lore`/`memory` (the rendered lines actually packed into the prompt's memory block, `meta_lore_lines`/`meta_memory_lines` from `memory_service.retrieve_block`), `user_mid`, retrieve errors
- `status` — phase marker (`generating`)
- `thinking` — chain-of-thought fragments (when thinking enabled)
- `delta` — the reply is withheld in full (not token-streamed) until generation completes, so a trailing `[mood: X]` tag can always be stripped before anything is shown; sent as a single `delta` event, plus a leading one carrying prior text on `/continue`
- `error` — generation error
- `done` — final persisted message object + `mood` (no `memory_error` field — extraction runs after the SSE stream via `memory_service.maybe_extract`, not synchronously as part of turn completion)
