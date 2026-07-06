# StoryHaven AI — a self-hosted roleplay platform

Self-hosted character chat with real per-character **lorebooks**, unlimited
long-term **memory**, multi-user accounts with an **admin/permissions** model,
and optional **ComfyUI image generation**. You run the model, you own the data;
characters import from the community card ecosystem (SillyTavern / chub.ai /
RisuAI / SpicyChat).

```
  browser ──►  server.py (FastAPI, also serves the SPA from static/)
                  │
                  ├─► SQLite + Redis, or PostgreSQL + pgvector (pick one — see "Storage backends")
                  │             users · characters · personas · lorebooks · sessions · messages
                  │             (encrypted at rest — see "Encryption" below), plus vector search
                  ├─► any OpenAI-compatible server, chat and embeddings can be different servers
                  │             (llama.cpp, Ollama, LM Studio, vLLM, a hosted API like DeepSeek/OpenAI …)
                  └─► ComfyUI (optional)   image generation for chat scenes / standalone gen
```

The frontend is served **by the backend**, so the UI and API share one origin —
nothing to configure, no CORS.

## File layout

```
ai-frontend/
├── server.py          FastAPI app assembly — lifespan, router includes, static/media mounts
├── state.py           Shared config (CFG), config-key lists, logging, upload/cookie constants
├── auth.py            Auth dependencies, session cookie, login rate limiting, /api/auth/*
├── ssrf.py            Bring-your-own chat endpoint safety checks
├── prompt.py          System prompt assembly, RPG mode prompts, macros, dice, mood parsing
├── media.py           Image upload validation/optimization/save
├── chat_service.py    Endpoint resolution, retrieval, memory, the core chat generation flow
├── routers/           One file per domain: characters, personas, lore, sessions, profile,
│                       settings, admin, misc — every route lives here, server.py just wires them up
├── db.py              SQLite (async, SQLAlchemy Core over aiosqlite) — all CRUD, schema migrations
├── vectors.py         Redis async — vector storage + similarity search
├── llm.py             OpenAI-compatible client (chat / embeddings / models)
├── imagegen.py        ComfyUI client (submit workflow, poll, websocket live preview)
├── schemas.py         Pydantic request models
├── requirements.txt
└── static/
    ├── index.html     app shell (nav, layout)
    ├── app.js          the whole SPA — vanilla JS, no build step
    └── style.css
```

`server.py` only assembles the app and includes the routers — it doesn't contain
route handlers or business logic itself anymore. Every router module only calls
into `db`/`vectors`/`chat_service` functions, never raw SQL or Redis commands
directly, so the storage layer can change underneath without touching routes.

There is no local `docker-compose.yml`/`compose.yaml` in *this* repo — this
checkout is bind-mounted into a container managed by a compose stack that lives
elsewhere (see `CLAUDE.md` for exactly how). The setup below is written for
running this standalone, e.g. for development or a from-scratch deployment.

## Setup

You need somewhere for the models to actually run. The simplest self-hosted
option is [llama.cpp's server](https://github.com/ggml-org/llama.cpp), which
speaks the OpenAI-compatible API this app expects natively and can pull models
straight from Hugging Face:

```bash
# Chat model — pick any GGUF repo/quant you like
docker run -d --name llamacpp-chat --gpus all -p 5001:5001 \
  -e LLAMA_ARG_HF_REPO=<hf-user>/<hf-repo> \
  -e LLAMA_ARG_HF_FILE=<quant-filename>.gguf \
  -e LLAMA_ARG_CTX_SIZE=32768 -e LLAMA_ARG_N_GPU_LAYERS=999 \
  -e LLAMA_ARG_HOST=0.0.0.0 -e LLAMA_ARG_PORT=5001 \
  ghcr.io/ggml-org/llama.cpp:server-cuda

# Embedding model — a small, separate instance (llama.cpp serves one model per process)
docker run -d --name llamacpp-embed --gpus all -p 5002:5002 \
  -e LLAMA_ARG_HF_REPO=nomic-ai/nomic-embed-text-v1.5-GGUF \
  -e LLAMA_ARG_EMBEDDINGS=true \
  -e LLAMA_ARG_HOST=0.0.0.0 -e LLAMA_ARG_PORT=5002 \
  ghcr.io/ggml-org/llama.cpp:server-cuda
```

A repo with several GGUF quant files needs `LLAMA_ARG_HF_FILE` set explicitly —
without it, the server can hang on startup rather than picking one on its own.
No GPU? Drop `--gpus all` and `LLAMA_ARG_N_GPU_LAYERS` (CPU inference works,
just slower). Any other OpenAI-compatible server (Ollama, LM Studio, vLLM, or a
hosted API like DeepSeek/OpenAI) works too — just point `LLM_BASE_URL`/
`EMBED_BASE_URL` at it instead.

You also need Redis Stack (for vector search) reachable at `REDIS_URL`:
```bash
docker run -d --name redis-stack -p 6379:6379 redis/redis-stack:latest
```

Then the app itself:
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export LLM_BASE_URL=http://localhost:5001/v1
export EMBED_BASE_URL=http://localhost:5002/v1
export REDIS_URL=redis://localhost:6379

uvicorn server:app --port 3000
# open http://localhost:3000
```

First run auto-creates an `admin` account and prints a random password to
stdout — log in and change it. Every route under `/api/*` requires a session
(`persona_session` cookie); `/api/auth/*` is public.

Sanity check: `http://localhost:3000/api/health` — a `401` with a JSON body
means the server is up (it's an authenticated route, so 401 is the expected
"alive" response when you're logged out). Once logged in, that same endpoint
also reports whether the chat/embedding backends are actually reachable.

Everything above (chat model, embed model, ComfyUI, encryption key) can also be
changed later from **Settings → Admin** without restarting — env vars only set
the *initial* values on first run.

## Accounts, auth & permissions

- **Sessions** are an HttpOnly cookie (`persona_session`), `SameSite=Lax`, and
  `Secure` whenever the request actually arrived over https (scheme-aware, so
  it still works over plain `http://localhost` during local dev).
- New signups land in a **pending** state until an admin approves them (or an
  admin creates the account directly).
- **Admins** manage users and review flagged bring-your-own endpoints (below).
  Admins do **not** get a bypass on ordinary content permissions — they can't
  view, edit, or export another user's private characters/lore just by being
  admin; the one deliberate exception is that an admin can delete *any*
  character (community moderation), same as its owner can.
- Characters/lore/personas are private by default; a creator can mark a
  character public (Community), allow it to be played as a persona by others,
  and/or allow other users to export/download its card.

## Storage backends: SQLite+Redis, or PostgreSQL+pgvector

Two interchangeable backend pairs, same code, same function signatures either way:

- **SQLite + Redis** (the default — nothing to configure): SQLite holds
  everything you'd want to read as plain rows — users, characters, personas,
  lorebook entries, sessions and messages — in one file (`personae.db`),
  trivial to back up or inspect with any SQLite tool. Redis holds *only*
  vectors: one embedding per memory and one per lore entry, in an HNSW cosine
  index. Lore content stays in SQLite; Redis stores the lore *id* and its
  vector, so semantic search returns ids resolved back to text from SQLite.
- **PostgreSQL + pgvector** (opt in via `DATABASE_URL`): one database instead
  of two — the same tables live in Postgres, and two additional tables
  (`memory_vectors`, `lore_vectors`) hold embeddings with an HNSW cosine index
  via the `pgvector` extension, queried with the `<=>` operator instead of
  Redis's KNN syntax. Real multi-writer transactions replace the hand-rolled
  write-serialization lock SQLite needed.

Both `db.py` and `vectors.py` are written with SQLAlchemy Core (not raw SQL
strings or Redis-specific code paths mixed into business logic), which is what
makes this a config switch rather than a rewrite. Set `DATABASE_URL` (e.g.
`postgresql+asyncpg://user:pass@host:5432/dbname`) to switch; leave it unset to
keep using SQLite + Redis. Moving *existing* data over uses the one-time
scripts `migrate_to_postgres.py` (rows) and `migrate_vectors_to_pgvector.py`
(embeddings, copied directly rather than re-run through the embedding model) —
run both once, verify row/vector counts match, then set `DATABASE_URL` and
restart. Neither the original SQLite file nor Redis's data is touched or
deleted by either script, so the old backend stays intact as a fallback.

## Encryption

Character personas/scenarios/greetings/dialogue/system prompts, lore content,
persona descriptions, and message content are encrypted at rest (Fernet) —
transparently, every caller above `db.py` just sees plain strings. Per-user
bring-your-own API keys are encrypted the same way and are never returned by
any API response, not even to an admin.

The encryption key is generated once and stored in the database by default
(safe, no setup required — protects against casually opening the SQLite file,
not against someone stealing it outright). Set `SECRET_ENCRYPTION_KEY` to keep
the key outside the database for real separation — generate one with:
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```
Once set for a deployment, it must stay stable — losing or rotating it makes
every already-encrypted value permanently undecryptable.

## OpenAI-compatible by design — and how bring-your-own-endpoint is kept safe

Every model call goes through `llm.py` against standard OpenAI routes
(`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`). The base URL is
normalized so a base ending in `/chat/completions`, `/models`, `/v1`, or
`/api/v1` is handled correctly, and anything else gets `/v1` appended — point
`LLM_BASE_URL` at Ollama, LM Studio, llama.cpp's server, vLLM, or OpenAI
itself without code changes.

**Chat** is the only endpoint a regular user can override for themselves
(Settings → bring your own chat endpoint). Because that means the *server*
makes an outbound request to a URL a regular user chose, it's guarded against
SSRF:

1. The hostname must resolve to a real public IP — anything private,
   loopback, link-local, or reserved is rejected outright (this is what stops
   a user from pointing the server at Redis, ComfyUI, or any other container
   on the internal network).
2. The endpoint must actually answer like a chat server on at least one known
   shape (OpenAI-style `/models`, Ollama-native `/api/tags`, `/api/version`) —
   a host that resolves publicly but doesn't speak a recognized protocol is
   treated as suspicious, not "misconfigured."

A failure on either check **blocks the save** (the endpoint is never applied —
equivalent to blocked until an admin says otherwise) and is logged to an
admin-only **flagged endpoints** review queue with a reason, where an admin
can explicitly **Block** or **Allow anyway** (e.g. a legitimate self-hosted
server on a private IP). The IP check also re-runs on every actual chat
request, not just at save time — a host that was safe when saved but starts
resolving to a private address later (DNS rebinding, or the domain changing
hands) falls back to the global endpoint immediately and gets flagged again,
even if previously approved. Stored API keys (per-user and pending-review) are
encrypted at rest with a key kept only in the database, never returned by any
API response — not even to an admin reviewing the queue.

**Embeddings are never user-overridable** — the vector index is shared across
every user, so a per-user embed endpoint/model would corrupt everyone's search
results. Embedding endpoint/model/dimension are global, admin-only settings.

## Personas

A persona is *you*. Define a name and a short description on the Personas page;
when you start a chat you pick one (or "just You"). The persona's name fills
`{{user}}` and its description is given to the character, so they know who
they're talking to. Mark one as default to skip the picker.

## Modes: Character vs RPG

Mode is a property of the **character**, chosen on the character sheet (and shown
as a badge on the character). Every chat with that character uses its mode:

- **Character** — first-person roleplay; the model *is* the character and talks
  with you directly.
- **RPG · Game Master** — the model runs as an impartial third-person narrator:
  it builds the world, controls NPCs, paces the scene, and calls for dice.

Change a character's mode anytime by editing it; it takes effect on the next
message. RPG characters show the dice tray in chat.

## Dice

In RPG mode a dice tray appears above the composer (d4–d100, 2d6, and a custom
box). In any mode you can also type `/roll 2d6+3` (or `/r d20`) **anywhere inside
a message** — each is resolved server-side to a real number *before* the model
sees it, so the GM reacts to the actual result rather than the literal command.
Surrounding prose is kept: `chance of tripping: /roll 1d6` becomes
`chance of tripping: 🎲 1d6 [3] = 3`. Expressions support multiple terms and
modifiers, e.g. `1d20+5`, `2d6+1d4-1`.

## Scene-style replies (per-user toggle)

Turn this on in Settings and every reply opens with a `` `DATE:` ``/`` `TIME:` ``/
`` `LOCATION:` `` header, plus an optional present NPC's inner thoughts on their
own line. Since this depends on the model actually following a formatting
instruction — and live testing shows even capable hosted models skip it on a
real fraction of turns — the server checks every reply for the header and
synthesizes one (carrying forward the last known date/time/location) if the
model didn't produce it, so the feature never silently no-ops.

## Settings (runtime model configuration)

Settings are two-tier:

- **Global** (admin-only) — seeded from env vars, then overlaid from the
  SQLite `settings` table, applied immediately without a restart. Covers the
  default chat/embed endpoints, sampling defaults, image-gen defaults, and the
  instance-wide default display language.
- **Local** (per-user) — a user's own overrides win over global for the keys
  they set (chat endpoint/key/model, sampling, history length, interface
  language, etc; see the SSRF note above for how the chat endpoint override is
  guarded). The API key field is write-only — you can set it or clear it, but
  it's never echoed back once saved.

Changing the embedding dimension rebuilds the Redis index automatically.

### Advanced sampling (SillyTavern-style)

The **Advanced sampling** panel exposes the full set: temperature, top-p, top-k,
min-p, top-a, typical-p, TFS, smoothing factor, repetition penalty + range,
frequency/presence penalty, DynaTemp (low/high), Mirostat (mode/τ/η), DRY
(multiplier/base/length), XTC (threshold/probability), seed, and stop sequences.
Each is sent to the backend **only when it differs from its neutral value**
(seed is the one exception — it's always sent explicitly, including `-1`, so
the backend randomizes it itself rather than silently reusing whatever it
defaults to when the field is simply absent), so strict OpenAI endpoints
aren't broken by unknown fields while local servers (KoboldCpp,
text-generation-webui, llama.cpp, vLLM) receive everything they support.
Parameter *names* are backend-specific; an **Extra request fields (JSON)** box
is merged verbatim into the request as an escape hatch for anything not
covered, or to rename a field for your server.

### Prompt options

**Appended system prompt** is added to every character's system prompt (global
flavor/jailbreak/style rules). **Post-history instructions** are injected as a
final system message *after* the chat history — the strongest steering position,
mirroring SillyTavern's post-history block. Both support `{{char}}`/`{{user}}`.

### Appearance (this device)

Beyond the Light/Dark theme, a per-device **Appearance** panel lets you override
the font, text color, accent/tab color, base font size, app background, and chat
background (color or `url(...)`). It previews live and is stored in the browser
(localStorage), independent of the server.

### Languages

The model generates directly in the resolved target language (no intermediate
canon language). UI chrome/memory panel language follows your own interface
language (falling back to the admin's global default); a story's language
follows the session's own 🌐 talk-language pick (falling back to your
interface language). Every translated display string is cached per
(source-text, language) so it's only ever machine-translated once, ever.

## Visual-novel stage (creator)

Each character has a **🎬 Stage** panel in the editor. Paste image/audio URLs for
a **default** background, music track, and sprite, then add **moods** — each mood
maps to its own background, music, and sprite. At runtime the chat renders the
background, overlays the sprite (bottom-right), and can play looping music
(muted by default; click 🔇/🔊 to enable, since browsers block autoplay with
sound until you interact).

Moods are driven by the model itself: when a character defines any stage moods,
the system prompt asks it to end each reply with a hidden `[mood: X]` tag chosen
from the defined list. The backend parses and strips that tag (it never appears
in the chat or in memory) and tells the UI which mood to show, swapping
background/sprite/music to match the character's reaction. If the model omits the
tag, the scene simply stays on the last mood.

## Image generation (ComfyUI)

Optional per-message or standalone image generation against a ComfyUI backend
(`COMFYUI_URL`, admin-configured):

- **Per-message**: generates danbooru-style positive/negative tags from the
  scene via a dedicated LLM call, optionally primed by per-lore-entry
  **appearance tags** (owner-only, redacted from the API response for anyone
  else viewing that character) which take priority over the model's own
  paraphrase. You can edit the generated tags before hitting Generate, and
  regenerate later — each generation uses a fresh random seed, so
  regenerating doesn't just return the same cached image back.
- **Standalone** (`Generate Image` page): a free-form prompt page with a live
  websocket preview of the in-progress denoising, independent of any chat.
  Nothing is saved automatically — you choose to Save, Regenerate, or Discard
  once it finishes.
- **Image Gallery** page: every image you've generated in chat, grouped by
  session, with the scene text and copyable generation tags.
- Checkpoint/LoRA pickers are populated live from ComfyUI's own `/object_info`,
  so they always match whatever's actually installed.

## Thinking (model reasoning)

A **🧠 thinking** toggle in the chat header asks the model to reason inside a
`<think>...</think>` block before replying. The backend parses that block out of
the stream as a separate channel and the UI shows it as a collapsible **💭 Thought
process** panel — expanded live while it streams, collapsed once the reply lands,
and re-expandable later. If your model server emits native reasoning
(`reasoning_content`), that's captured too, even without the prompt instruction.

The chain-of-thought is stored with the message so it stays viewable, but it is
**never fed back to the model** as history and is **excluded from memory** — only
the final reply is embedded. Default on; set `ENABLE_THINKING=false` to default it
off (the per-chat toggle still overrides).

## How memory stays "unlimited"

Your whole history is never stuffed into the prompt — context windows are finite.
Each exchange becomes one vector; each turn pulls back only the few most relevant
memories (`TOP_K_MEMORY`) plus the recent verbatim turns (`HISTORY_TURNS`).
Hundreds of chats is tens of MB of vectors and the prompt size never grows.

Memory is **scoped to the session**: each chat keeps its own recollections, so two
separate chats with the same character don't bleed into one another. Browse or
clear a chat's memory from the **◷ memory** button in the chat header. (Deleting a
session also clears its memory; deleting a character clears all of its sessions'.)
Each memory is keyed to the user turn that produced it. A reply never recalls its
own turn (the current turn is excluded from retrieval), and **regenerating a reply
drops the discarded answer's memory** and re-stores only the kept one — so an
abandoned generation is never remembered.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `LLM_BASE_URL` | `http://llamacpp-chat:5001/v1` | OpenAI-compatible base URL |
| `EMBED_BASE_URL` | `http://llamacpp-embed:5002/v1` | llama.cpp serves one model per instance, so chat and embeddings are separate containers |
| `LLM_API_KEY` | _(empty)_ | sent as `Authorization: Bearer …` if set |
| `CHAT_MODEL` | `Gemma-4-E4B-Uncensored-HauhauCS-Aggressive` | generation model |
| `EMBED_MODEL` | `nomic-embed-text` | embedding model |
| `EMBED_DIM` | `768` | must match the embedding model |
| `REDIS_URL` | `redis://roleplay-redis:6379` | Redis location (ignored if `DATABASE_URL` is set) |
| `DATABASE_URL` | _(empty = use SQLite + Redis)_ | set to a `postgresql+asyncpg://` URL to run on PostgreSQL + pgvector instead |
| `DB_PATH` | `./personae.db` | SQLite file |
| `HISTORY_TURNS` | `16` | recent messages kept verbatim |
| `TOP_K_MEMORY` / `TOP_K_LORE` | `4` / `6` | items retrieved per turn |
| `MEM_MAX_DIST` / `LORE_MAX_DIST` | `0.80` | cosine-distance cutoffs (lower = stricter) |
| `GEN_TEMP` / `GEN_TOP_P` / `GEN_MAX_TOKENS` | `0.85` / `0.9` / `4096` | sampling |
| `ENABLE_THINKING` | `true` | default thinking toggle |
| `DEFAULT_LANGUAGE` | `English` | instance-wide default display language |
| `SECRET_ENCRYPTION_KEY` | _(auto-generated, stored in the DB)_ | see "Encryption" above |

`COMFYUI_URL`, `COMFYUI_CHECKPOINT`, `COMFYUI_WORKFLOW` are admin-settings-only
(no env-var default worth documenting here — configure them from Settings).

If you change the embedding model, set `EMBED_DIM` to match and rebuild the
indexes (vectors of different sizes can't share an index) — or just change it
from Settings, which does this for you automatically:

```bash
redis-cli FT.DROPINDEX mem_idx DD
redis-cli FT.DROPINDEX lore_idx DD
```

## Notes

- Card import reads V1, V2 (`chara`) and V3 (`ccv3`) PNG cards and `.json`;
  embedded lorebooks import alongside the character, and the PNG becomes the avatar.
- Card export ("⤓ Export card" on a character) writes a SillyTavern/TavernAI V2
  JSON card with the character's lorebook embedded as `character_book`, so it
  re-imports cleanly into Tavern, chub, RisuAI, or back into StoryHaven AI. Export
  is owner-only unless the character explicitly allows others to download it.
- Static assets (`app.js`, `style.css`) are served with `Cache-Control:
  no-cache`, so front-end edits show up without a container restart; an
  in-app update banner polls `/version` to prompt a refresh when they change.
# StoryHavenAI
