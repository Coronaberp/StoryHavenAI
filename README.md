# StoryHaven AI

> Forge worlds. Remember everything.

StoryHaven AI is a self-hosted character roleplay platform built for persistent
stories rather than disposable chats. Create characters, personas, and lorebooks;
run solo, group, or multiplayer sessions; and keep long-term memories scoped to
each story.

The platform combines a FastAPI application, PostgreSQL with pgvector,
OpenAI-compatible chat and embedding backends, optional ComfyUI media generation,
and a local fail-closed image safety classifier. The application and its data stay
under the operator's control.

## Highlights

- Character and RPG roleplay with personas, lorebooks, dice, scene direction,
  response styles, and visual-novel presentation.
- Session-scoped long-term memory with typed facts, semantic retrieval, lore
  updates, and exact rollback when a generated turn is discarded.
- Solo, group, and multiplayer conversations with shared sessions and persona
  claims.
- Character-card import and export for the TavernAI and SillyTavern ecosystem.
- Image, inpainting, upscaling, and video workflows through ComfyUI, with hosted
  image-provider fallbacks.
- Optional LoRA training through Modal.
- Multi-user accounts with passwords, passkeys, TOTP, OAuth, invite codes, and
  capability-based administration.
- Local CPU-only ONNX image moderation with bounded resource use and fail-closed
  decisions.
- A mobile-first Tailwind interface served by the same FastAPI process as the API.

## Architecture

```text
browser
  └─ FastAPI (`server.py`)
       ├─ selected SPA (`STATIC_DIR`) and uploaded media
       ├─ `backend/routers/`         HTTP and streaming API boundaries
       ├─ domain services           chat, memory, prompting, media, moderation
       ├─ `backend/repositories/`    database access by domain
       ├─ PostgreSQL + pgvector      relational data and vector retrieval
       ├─ OpenAI-compatible APIs     chat and embeddings
       ├─ ONNX Runtime               local image safety classification
       ├─ ComfyUI or hosted provider image and video generation
       └─ Modal                      optional LoRA training
```

FastAPI serves the frontend and `/api/*` from one origin. `server.py` is the
composition root: it owns application lifespan, router registration, middleware,
and static mounts. Domain behavior lives under `backend/`, and database access is
kept in repository modules.

The repository includes two browser applications:

- `new_ui/` is the current mobile-first Tailwind SPA.
- `static/` is the older compatibility SPA and remains the default value of
  `STATIC_DIR` when no deployment override is supplied.

Set `STATIC_DIR=./new_ui` to serve the current interface in a manual installation.
The production deployment chooses its frontend with the same setting.

## Repository map

```text
.
├── server.py                       FastAPI assembly and application lifespan
├── backend/
│   ├── routers/                    API routes grouped by product domain
│   ├── repositories/               PostgreSQL access grouped by domain
│   ├── safety/                     persistent ONNX classifier and policy
│   ├── imagegen*.py                ComfyUI and hosted-provider orchestration
│   ├── chat_service.py             SSE conversation generation loop
│   ├── memory_service.py           long-term memory extraction and retrieval
│   ├── retrieval.py                lore matching and vector indexing
│   ├── prompt.py                   character and RPG prompt assembly
│   ├── auth.py                     JWT, cookie, passkey, TOTP, and OAuth auth
│   ├── db.py                       schema, engine lifecycle, shared SQL helpers
│   ├── vectors.py                  pgvector storage and similarity search
│   ├── classify.py                 image-moderation facade and rollback backend
│   └── tests/                      backend pytest suite
├── new_ui/                         current Tailwind SPA
├── static/                         compatibility SPA selected by default
├── legacy_ui/                      historical frontend reference
├── tests/                          frontend and end-to-end tests
├── scripts/                        safety export, verification, and benchmarks
├── benchmarks/safety_classifier/   classifier validation format and guidance
├── modal_app/                      separately deployed LoRA training app
├── modules/py/                     one-time migrations and backfills
├── seed_content/                   first-run starter content
├── docs/                           setup, feature, and architecture guides
├── requirements.txt                application Python dependencies
├── requirements-safety-export.txt  isolated classifier-export dependencies
├── rebuild.sh                      Tailwind build and frontend dev server
├── setup.sh                        Linux and macOS installer
└── setup.ps1                       Windows installer
```

`VersionReports/` contains release-time audit snapshots. It is a historical paper
trail, not the source of truth for the current application.

## Installation

### All-in-one installer

The installer detects Docker or Podman, prepares PostgreSQL and model services,
generates secrets and compose configuration, starts the stack, and waits for it to
become healthy.

| Platform | Command |
|---|---|
| Linux or macOS | `./setup.sh` |
| Windows PowerShell | `.\setup.ps1` |
| Windows wizard | Build `installer/setup.iss` with Inno Setup |

Useful installer modes:

```bash
./setup.sh --dry-run
./setup.sh --yes
```

The installer is designed to be rerun without deleting named volumes or existing
configuration. See [the detailed setup guide](docs/SETUP.md) for hardware,
platform, GPU, and model notes.

### Manual installation

StoryHaven needs:

1. PostgreSQL with the pgvector extension.
2. An OpenAI-compatible chat endpoint.
3. An OpenAI-compatible embedding endpoint.
4. Python 3.12 or newer.
5. The pinned image-safety ONNX artifact described below.

Install and start the application:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL=postgresql+asyncpg://storyhaven:storyhaven@localhost:5432/storyhaven
export LLM_BASE_URL=http://localhost:5001/v1
export EMBED_BASE_URL=http://localhost:5002/v1
export STATIC_DIR=./new_ui

uvicorn server:app --host 0.0.0.0 --port 3000
```

Open `http://localhost:3000`. A logged-out request to `/api/health` returns `401`
when the application is listening because health details require authentication.

On the first successful startup, StoryHaven creates an `admin` account, prints a
random password to the server log, and seeds starter content. Change that password
after signing in.

## Image safety classifier

Uploaded images are moderated locally by
[`viddexa/nsfw-detection-2-nano`](https://huggingface.co/viddexa/nsfw-detection-2-nano)
through one persistent CPU-only ONNX Runtime session. The model revision, class
order, input shape, preprocessing contract, and model checksum are pinned in
`backend/safety/config.py`.

The policy is fail closed. An image is accepted only when the winning class is
`safe` or `drawing` and its confidence meets `NSFW_SAFE_THRESHOLD`, which defaults
to `0.995`. Explicit classes, uncertainty, queue saturation, timeouts, malformed
input, missing artifacts, and runtime failures all block the upload.

The ONNX binary is intentionally excluded from Git. Build and verify it in an
isolated environment:

```bash
python -m venv .safety-export
source .safety-export/bin/activate
pip install -r requirements-safety-export.txt

python scripts/export_safety_classifier.py \
  --output-dir models/nsfw-detection-2-nano
python scripts/verify_safety_artifact.py \
  --manifest models/nsfw-detection-2-nano/manifest.json
```

The normal backend is `SAFETY_CLASSIFIER_BACKEND=onnx_nano`. The previous remote
classifier remains available only as an explicit emergency rollback with
`SAFETY_CLASSIFIER_BACKEND=legacy`; it is never selected automatically after an
ONNX failure.

See [the classifier architecture guide](docs/ai/safety_classifier.md) for policy,
benchmarking, health, artifact, and rollback details.

## Model backends

All language-model calls use OpenAI-compatible routes. Chat and embeddings can run
on different servers, which is useful when a large generation model uses the GPU
and a small embedding model runs independently.

Compatible choices include llama.cpp, Ollama, LM Studio, vLLM, and hosted APIs.
Regular users may configure a personal chat endpoint. StoryHaven validates those
URLs against SSRF and protocol checks before the server contacts them; blocked
endpoints enter an administrator review queue.

ComfyUI is optional. When configured, StoryHaven supports standalone and in-chat
generation, live previews, inpainting, upscaling, model and LoRA selection, and
video workflows. Hosted image providers support the common generation paths but
not ComfyUI-specific tools.

## Accounts and authorization

Authentication uses short-lived access JWTs and refresh JWTs stored in HttpOnly
cookies:

- `sh_access` is scoped to the application.
- `sh_refresh` is scoped to `/api/auth`.

Bearer access tokens are also accepted. Token identifiers are tracked server-side,
so sessions can be revoked before JWT expiry.

New registrations normally remain pending until approved or activated by an invite
code. Passwords, passkeys, TOTP, OAuth, and backup codes are supported. The Dev,
Admin, and member experience is governed by named capabilities rather than route
names or UI visibility alone. See [the RBAC guide](docs/ai/rbac.md).

## Storage and encryption

PostgreSQL is the only application database. pgvector stores memory, lore, and
secret embeddings alongside the relational data and provides HNSW cosine search.
`DATABASE_URL` is required; startup fails when it is absent.

User-authored roleplay content and stored model credentials use the shared Fernet
encryption layer. StoryHaven can generate and retain the encryption key in the
database for a simple installation, or operators can provide
`SECRET_ENCRYPTION_KEY` externally. Losing that key makes existing encrypted data
unrecoverable.

## Configuration

Core environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL and pgvector connection |
| `LLM_BASE_URL` | `http://llamacpp-chat:5001/v1` | chat API base URL |
| `EMBED_BASE_URL` | `http://llamacpp-embed:5002/v1` | embedding API base URL |
| `LLM_API_KEY` | empty | bearer key for the configured model API |
| `CHAT_MODEL` | installer-selected | generation model identifier |
| `EMBED_MODEL` | `Qwen3-Embedding-0.6B` | embedding model identifier |
| `EMBED_DIM` | `1024` | embedding width; must match the model |
| `COMFYUI_URL` | `http://comfyui:8188` | ComfyUI API base URL |
| `STATIC_DIR` | `./static` | SPA directory served at `/` |
| `MEDIA_DIR` | `./media` | uploaded and generated media directory |
| `SECRET_ENCRYPTION_KEY` | generated if absent | Fernet data-encryption key |
| `JWT_SECRET_KEY` | generated if absent | access and refresh token signing key |
| `SAFETY_CLASSIFIER_BACKEND` | `onnx_nano` | image moderation backend |
| `NSFW_ONNX_PATH` | `./models/nsfw-detection-2-nano/model.onnx` | pinned ONNX artifact |
| `NSFW_SAFE_THRESHOLD` | `0.995` | minimum confidence for an allowed class |

Most model, generation, appearance, language, and feature settings can also be
managed in the application. Secrets are write-only in API responses.

## Development

Run backend tests with:

```bash
python -m pytest backend/tests -q
```

After changing Tailwind sources under `new_ui/css/`, rebuild the generated CSS:

```bash
./rebuild.sh --once
```

Do not edit `new_ui/css/app.css` directly. It is generated output.

Useful references:

- [Detailed setup](docs/SETUP.md)
- [Current feature guide](docs/features.md)
- [Backend architecture](docs/ai/architecture.md)
- [Memory and lore design](docs/ai/memory_design.md)
- [Image safety classifier](docs/ai/safety_classifier.md)
- [Role and capability model](docs/ai/rbac.md)
- [LoRA training](docs/ai/lora_training.md)

## License

No license file is currently included. Review the repository terms before
redistributing or offering a hosted service based on StoryHaven AI.
