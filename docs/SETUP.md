# StoryHaven AI — fresh-machine setup

Three installers, all doing the same job: detect Docker/Podman, check for an
NVIDIA or AMD GPU, offer to auto-install Docker if none is present, generate a
working `docker-compose.yml` + `.env` for the full stack (story-game,
storyhaven-postgres, llamacpp-chat, llamacpp-embed, comfyui), and bring it up
on its own isolated network (`storyhaven_isolated_net`).

> **This installer is for a fresh machine/host only — one that does not
> already have this app's stack running.** It generates its own
> `docker-compose.yml` using the container names `story-game` and
> `storyhaven-postgres`. If the host already has a StoryHaven/SillyTavern
> deployment, it already runs containers with those exact names — running this
> installer there will collide on container names and ports even though the
> network name is distinct. **Do not run this on such a host.**
>
> Before proceeding, check whether `~/.sillytavern/docker-compose.yml` already
> exists on this machine, or ask whoever administers it. If it does exist,
> don't run this installer — instead add this app's service definitions
> (`story-game`, plus any of `postgres`/`llamacpp-*`/`comfyui` not already
> present) into that existing compose file by hand.

## Minimum requirements

| | Minimum | Recommended |
|---|---|---|
| OS | 64-bit Linux, Windows 10/11 with WSL2, or macOS 12+ | Linux or Windows 11 |
| CPU | 4 cores | 8+ cores |
| RAM | 16 GB | 32 GB |
| GPU | none (CPU works but replies take minutes) | NVIDIA or AMD with **12 GB+ VRAM** |
| Disk | 40 GB free (app, database, chat/embed models, default image models) | 250 GB+ for the full model catalog |
| Network | broadband for the initial model downloads (~11 GB default set) | — |

Notes:
- The default chat model is an ~8 GB file that wants to sit in VRAM. 8 GB
  cards work with fewer GPU layers offloaded (the installer asks), at reduced
  speed. Image generation wants 8 GB+ VRAM on its own.
- On macOS the stack runs inside Docker's VM without GPU access, so
  generation is CPU-speed. Fine for trying the app, not for daily image gen.
- On Windows, NVIDIA needs a driver with WSL2 CUDA support. AMD is handled
  natively by the installer (no WSL2 GPU needed).
- **No GPU, or replies too slow? Use DeepSeek for chat.** The app speaks any
  OpenAI-compatible API, and [DeepSeek](https://platform.deepseek.com) is the
  recommended hosted option: cheap, fast, and good at roleplay. Get an API key
  from the [DeepSeek platform](https://platform.deepseek.com/api_keys), then
  in the app set Settings → chat endpoint to `https://api.deepseek.com` with
  model `deepseek-chat` (docs: [api-docs.deepseek.com](https://api-docs.deepseek.com)).
  Embeddings stay local either way — the embedding model is small (~0.6 GB)
  and runs fine on CPU, so memory and lore retrieval work even on a machine
  with no GPU at all.

## Pick your starting point

| You have… | Use |
|---|---|
| Linux or macOS shell | `./setup.sh` |
| Windows PowerShell | `.\setup.ps1` |
| A fresh Windows box, want a wizard | the compiled `.exe` from `installer/setup.iss` |

All three are **idempotent** — re-running reuses existing secrets in `.env`,
regenerates the compose file, and never deletes named volumes (your data).

## 1. `setup.sh` (Linux / macOS)

```bash
./setup.sh              # full install
./setup.sh --dry-run    # detect + generate files only, do NOT start anything
./setup.sh --yes        # non-interactive, accept all defaults
```

It detects Docker (or Podman as a Docker-compatible fallback) and its Compose
implementation, and offers to auto-install Docker Engine (get.docker.com on
Linux, Homebrew cask on macOS) when neither is present. GPU detection picks
one of four paths:

| Detected | llama.cpp image | ComfyUI |
|---|---|---|
| `nvidia-smi` works | `server-cuda` | CUDA (`bigbrozer/comfyture`) |
| `rocm-smi` works | `server-rocm` | ROCm (`corundex/comfyui-rocm`), full GPU image gen |
| AMD GPU without ROCm | `server-vulkan` | CPU only, install ROCm and re-run for GPU image gen |
| none | `server` (CPU) | CPU |

AMD paths pass `/dev/kfd` + `/dev/dri` through and add the `video`/`render`
groups. It then prompts for the Postgres password, models, and a
`SECRET_ENCRYPTION_KEY` (auto-generated via `python3` + `cryptography` if
available), writes the files, validates with `<engine> compose config`, ensures
the app `venv` exists, brings the stack up, and polls
`http://localhost:3000/api/health` until it answers (a `401` means "up").

## 2. `setup.ps1` (Windows PowerShell)

```powershell
.\setup.ps1              # full install
.\setup.ps1 -DryRun      # detect + generate files only
.\setup.ps1 -Yes         # non-interactive
```

Same job for Docker Desktop. GPU detection uses `nvidia-smi.exe` and falls back
to a `Win32_VideoController` WMI query, which also spots AMD adapters. The
Fernet key is generated with Python if present, otherwise natively via .NET
RNG. Health-wait uses `Invoke-WebRequest` (treating `401`/`200` as up).

**AMD on Windows uses ZLUDA.** Windows containers cannot access AMD GPUs, so
on an AMD machine the generated stack contains only `story-game` and
`postgres`, with `LLM_BASE_URL`/`EMBED_BASE_URL` pointed at
`host.docker.internal:5001`/`:5002`. The script then installs the model
services natively itself, no manual steps:

- [ComfyUI-Zluda](https://github.com/patientx/ComfyUI-Zluda) is cloned into
  `native\comfyui` and its own `install.bat` is run, which installs ZLUDA and
  the Python deps and serves on port 8188
- llama.cpp's official prebuilt Vulkan build is downloaded into
  `native\llama`, one `llama-server` for chat on port 5001 and a second with
  `--embeddings` on port 5002, both AMD-accelerated through Vulkan
- model files from `installer\models.manifest.tsv` land in
  `native\llama\models` (gguf) and `native\comfyui\models\<category>`
- a generated `native\start-services.ps1` launches all three, registered as
  the per-user scheduled task "StoryHaven Model Services" at logon and also
  run immediately

Re-running `setup.ps1` repairs or resumes this install: existing binaries,
clones, and model files are detected and skipped, only what is missing gets
downloaded or set up again.

## 3. Windows `.exe` (Inno Setup)

The script is `installer/setup.iss`. It bundles `setup.ps1` + a short readme,
clones the app repo with Git **during install** (so the `.exe` stays small),
and offers to run `setup.ps1` elevated on the finish screen.

Compile on a Windows machine with [Inno Setup 6](https://jrsoftware.org/isdl.php):

```
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\setup.iss
```

Output: `installer\Output\StoryHavenAI-Setup.exe`.

> The `.exe` cannot be produced in this Linux dev environment — Inno Setup's
> compiler (`ISCC.exe`) is Windows-only and is not installed here. Run the
> command above on Windows to produce the real installer. Adjust `RepoUrl` in
> `setup.iss` if your app repo lives elsewhere.

## Model downloads

After the stack is healthy, the installers offer to download model files from
each model's own source site (Civitai, Hugging Face, GitHub), driven by
`installer/models.manifest.tsv`. That manifest is **gitignored** — it lists the
operator's curated model catalog and is generated from a running deployment
with `installer/build_models_manifest.py` (reads the app's implemented model
requests via `DATABASE_URL`; `--default <slug>` marks default downloads,
`--extra "category|filename|url|1"` adds models the request table doesn't
know). The default set (the RealSkin image model and the Zoda detailer) is
enough for good image generation out of the box; the full catalog and a
copy-from-local-folder import are offered as follow-ups. Set `CIVITAI_TOKEN`
for Civitai downloads that need an API token. The Windows wizard bundles the
manifest at compile time if it exists next to `setup.iss`.

## Bundled starter content

A fresh install seeds three items on first startup, alongside the auto-created
admin account: the persona **Tarion Bluerose**, the character **Luna**, and
the RPG **Magic Academy RPG** (with its full lorebook), all owned by the admin
and public. The seed data lives in `seed_content/` and is applied by
`backend/seed_content.py` only when the user table is empty, so existing
deployments never re-seed.

## What gets generated

- `docker-compose.yml` — the full stack, with `story-game` bind-mounting this
  repo directory.
- `.env` — Postgres credentials, `DATABASE_URL`, LLM/embed URLs + model names,
  `EMBED_DIM`, `SECRET_ENCRYPTION_KEY`, and the llama.cpp GGUF filenames.

Both are git-ignored (see `.gitignore`) because `.env` holds secrets.

## Notes / prerequisites the installers do not handle for you

- **Model files.** `llamacpp-chat`/`llamacpp-embed` expect the GGUF files named
  in `.env` (`CHAT_GGUF`, `EMBED_GGUF`) to already be present in the `kcpp-data`
  volume. Download them into that volume before those services will serve.
- **GPU runtime.** The compose file declares `nvidia.com/gpu=all`; the host
  needs the NVIDIA Container Toolkit (Linux) or Docker Desktop WSL2 CUDA
  (Windows) for real acceleration. Without a GPU the services fall back to CPU
  and are very slow — the scripts warn and ask for confirmation.
- **App venv.** `run.sh` execs `venv/bin/uvicorn`; on a fresh checkout the
  scripts offer to build the venv from `requirements.txt` in a throwaway
  `python:3.12-alpine` container.
