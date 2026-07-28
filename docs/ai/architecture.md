# Architecture

> Part of `docs/ai/` — git-tracked, public. Code-architecture facts only. Never add host
> paths, container/network names, ports, domains, or credentials here — those live in the
> gitignored `CLAUDE.md` at the repo root instead. See CLAUDE.md's pointer index for the
> rest of this doc set.

**StoryHaven AI** — a self-hosted character roleplay platform. A single FastAPI process serves both the REST API and the SPA from `static/index.html` (+ `static/js/*.js`, `static/css/*.css` — vanilla JS, no framework, no build step, no separate frontend server).

```
browser ──► server.py (FastAPI app assembly — thin composition root; the only .py outside backend/)
               ├─► backend/routers/*      (one file per domain — all route handlers live here)
               ├─► backend/repositories/*  (one file per domain — all DB access lives here, plain
               │                             function modules, not classes — see the OOP section
               │                             in CLAUDE.md)
               ├─► backend/chat_service.py (endpoint resolution, session ownership, the _run SSE loop)
               ├─► backend/retrieval.py   (keyword lore matching, index_lore())
               ├─► backend/lore_memory.py (unified lore+memory candidate assembly, lore-update detection)
               ├─► backend/classify.py    (NSFW image classification)
               ├─► backend/ai_helpers.py  (side LLM calls: image-prompt gen, char-from-description, persona expand)
               ├─► backend/prompt.py      (build_system prompt assembly)
               ├─► backend/sampling.py    (sampling param building)
               ├─► backend/mood.py        (character mood parsing/tags)
               ├─► backend/dice.py        (dice mechanics)
               ├─► backend/auth.py        (session cookies, user/admin/dev deps, login throttle, /api/auth/*)
               ├─► backend/ssrf.py        (bring-your-own LLM endpoint validation)
               ├─► backend/media.py       (image validation/optimization/save)
               ├─► backend/state.py       (CFG dict, logging, shared api/auth_router objects)
               ├─► backend/db.py          (schema + engine lifecycle + shared SQL helpers only —
               │                             actual CRUD lives in backend/repositories/*)
               ├─► backend/vectors.py     (pgvector, same Postgres engine)
               ├─► backend/imagegen.py    (ComfyUI HTTP client: submit/poll/websocket preview)
               ├─► backend/imagegen_workflows.py (pure ComfyUI workflow-graph builders, no I/O)
               ├─► backend/imagegen_options.py   (ComfyUI /object_info-backed option listing)
               ├─► backend/llm.py         (any OpenAI-compatible endpoint)
               ├─► backend/modal_client.py    (HTTP client for the Modal-deployed LoRA trainer)
               └─► backend/modal_provision.py (auto-deploys/redeploys modal_app/lora_train.py)

modal_app/lora_train.py  (deployed separately onto Modal — not part of this FastAPI process)
```

`server.py`'s own docstring lists this same module breakdown — check it first if this section and the code ever disagree. Everything under `backend/` imports its siblings with absolute `from backend.x import y` / `from backend import x` — never bare `import x`, since `server.py` at the root is not itself part of the package.

## Module responsibilities

| File | Owns |
|---|---|
| `server.py` | App assembly only — lifespan, router includes (in registration order), static/media mounts, background session cleanup. The only `.py` file at the repo root; everything else app-side lives under `backend/` |
| `backend/routers/*.py` | Every `/api/*` route handler, one file per domain: `characters`, `personas`, `lore`, `session_lore` (session-scoped lore content overrides + per-secret reveal state — a distinct router from `lore`, not just a section of it), `sessions` (session/message CRUD), `chat` (chat/regenerate/roll/continue SSE + unified lore/memory retrieval), `imagegen` (in-chat + standalone image gen), `model_previews` (checkpoint/LoRA/sampler/scheduler/upscaler admin curation), `lora_training`, `profile`, `settings`, `admin`, `comments`, `emojis`, `forum`, `health`, `notifications`, `misc` (translation/localization/summarize), `rbac` (Dev-only role/capability management — see `rbac.md`) |
| `backend/repositories/*.py` | All DB access, one plain-function module per domain (29 files: `characters`, `personas`, `chat_sessions`, `lore`, `lore_links`, `lore_secrets`, `memory_facts` (typed-fact store — see `memory_design.md`), `lora_training`, `standalone_images`, `image_rating_reports`, `flagged_endpoints`, `model_requests`, `content_reports`, `password_reset_requests`, `users`, `blocks`, `settings`, `checkpoints`, `loras`, `samplers`, `schedulers`, `upscalers`, `localization`, `health`, `comments`, `admin_notes`, `emojis`, `forum`, `notifications`, `roles` and `role_capabilities` (the RBAC grant tables — see `rbac.md`)) — see the OOP section in CLAUDE.md for why these are functions, not classes |
| `backend/chat_service.py` | Endpoint resolution (`_endpoints`), session ownership (`_own_session`), the SSE generation loop (`_run`) |
| `backend/retrieval.py` | Keyword-triggered lore matching for a turn (`retrieve`, always-on or key-match against recent text) and `index_lore()` (lore embedding) — no memory logic lives here anymore |
| `backend/lore_memory.py` | Unified lore+memory candidate assembly for retrieval — see `memory_design.md` |
| `backend/memory_service.py` / `backend/memory_extraction.py` / `backend/memory_ranking.py` / `backend/memory_block.py` | The typed-fact memory system — see `memory_design.md` |
| `backend/classify.py` | NSFW image classification (`classify_image_nsfw`, `classify_image_background`) — animated GIF/WebP is never trusted to the classifier, always pre-flagged for human review |
| `backend/ai_helpers.py` | Side LLM calls: in-chat image-prompt generation, character-from-description, persona-description expansion |
| `backend/prompt.py` | `build_system` (character/RPG-mode prompt assembly) |
| `backend/sampling.py` | Sampling param building |
| `backend/mood.py` | `parse_mood`, `character_moods` |
| `backend/dice.py` | Dice mechanics (`roll_dice`, `format_roll`, `resolve_inline_rolls`) |
| `backend/auth.py` | Session cookie plumbing, `get_current_user`/`get_admin`/`get_dev` deps, login rate limiting, `/api/auth/*` |
| `backend/ssrf.py` | Validates bring-your-own chat/embed endpoints a user or admin points the app at |
| `backend/media.py` | Image upload validation, optimization, save |
| `backend/state.py` | The `CFG` dict, config-key lists, logging setup, the shared `api`/`auth_router` FastAPI router objects every `backend/routers/*` file imports and attaches to |
| `backend/db.py` | Schema (SQLAlchemy Core `Table` objects) + engine lifecycle + shared SQL helpers (`_q`/`_q1`/`_w`/`_scalar`, `nid`, encryption helpers) only — actual CRUD lives in `backend/repositories/*`, which import these |
| `backend/vectors.py` | pgvector: `memory_vectors`/`lore_vectors`/`secret_vectors` tables with HNSW cosine indexes, store/search/delete/count for memory, lore and secret vectors |
| `backend/llm.py` | OpenAI-compatible HTTP client: `chat_stream`, `embed`, `list_models`, base-URL normalization, `ThinkSplitter`, `strip_json_fence` |
| `backend/imagegen.py` | ComfyUI HTTP client: submit a workflow, poll for completion, websocket live preview |
| `backend/imagegen_workflows.py` | Pure ComfyUI workflow-graph builders (`_build_workflow`, `_build_anima_workflow`, `_build_upscale_workflow`, LoRA/reference-image splicing) — no I/O |
| `backend/imagegen_options.py` | ComfyUI `/object_info`-backed option listing: checkpoints/LoRAs/samplers/schedulers/upscalers/VAEs/CLIP models |
| `backend/ratelimit.py` | Shared rate-limit helper used across routers |
| `backend/guest_quota.py` | Guest tier limits. `reserve()` is a single conditional UPDATE that increments only if the result stays inside the limit, `refund()` decrements clamped at zero. Every mutating path reserves up front and refunds on failure or cancel, including per reply on the group path. `check()` remains only as a cheap advisory read before prompt building |
| `backend/feature_flags.py` | Per-module maintenance kill switch (`FEATURE_KEYS`, `require_feature_enabled` dependency). Devs bypass it, everyone else sees the disabled state |
| `backend/tts.py` | Dual-voice speech: `segment_speech` splits narration from quoted dialogue, synthesis is cached per message |
| `backend/repositories/lore_chunks.py` | Paragraph-aware lore chunks. An entry short enough to fit one chunk stores a vector with `part_id=0` and no chunk row, which is why chunk and vector counts legitimately differ |
| `backend/repositories/persona_claims.py` | Which participant has claimed which session-scoped persona. Replaced the old inferred `session_participants.persona_id` |
| `backend/routers/lora_training.py` | Admin-only LoRA training: job CRUD, background training task, retry loop, single-job-at-a-time queue, real task cancellation on abort — see `lora_training.md` |
| `backend/modal_client.py` | Client for the deployed Modal app — see `lora_training.md` |
| `backend/modal_provision.py` | Auto-deploys/redeploys `modal_app/lora_train.py` — see `lora_training.md` |
| `modal_app/lora_train.py` | The actual Modal app (deployed onto Modal's infra, not run in this container) — dispatches `sdxl_train_network.py`/`anima_train_network.py` from vendored `modal_app/sd_scripts/` (kohya-ss/sd-scripts) as subprocesses on a rented GPU |
| `modules/py/migrate_hash_totp_backup_codes.py` | One-time migration that decrypted, hashed and rewrote TOTP backup codes. Idempotent. Kept as the reference for how to migrate a reversibly-stored secret in place |
| `modules/py/*.py` | Standalone scripts not imported by the running app — one-time migrations (`migrate_to_postgres.py`, `migrate_vectors_to_pgvector.py`) and backfills (`backfill_encrypt.py`, `backfill_nsfw.py`), run manually, never at startup |
| `backend/schemas.py` | Pydantic request bodies only |
| `static/index.html` + `static/js/*.js` + `static/css/*.css` | Entire legacy SPA — see `frontend_map.md` for current frontend status |
| `new_ui/` | The live Tailwind SPA — see `frontend_map.md` |

## Naming hazard across `new_ui/js/`

Every `new_ui/js/*.js` file is a classic script sharing one global scope, so two files defining the same function name silently overwrite each other by load order, and the symptom appears far from the cause. This has already shipped twice — a duplicate top-level function name broke every model preview tile and made clicks no-op. Before naming a new top-level function, grep for the name across `new_ui/js/`.
