# StoryHaven AI — fresh-machine setup

Three installers, all doing the same job: detect Docker/Podman, check for an
NVIDIA GPU, generate a working `docker-compose.yml` + `.env` for the full stack
(story-game, storyhaven-postgres, llamacpp-chat, llamacpp-embed, comfyui), and
bring it up.

> **This installer is for a fresh machine/host only — one that does not
> already have this app's stack running.** It generates its own
> `docker-compose.yml` using the container names `story-game` and
> `storyhaven-postgres` and the network `sillytavern_net`. If the host already
> has a StoryHaven/SillyTavern deployment (see the project's `CLAUDE.md`), it
> already runs containers with those exact names on that exact network —
> running this installer there will collide on container names, ports, and
> the network. **Do not run this on such a host.**
>
> Before proceeding, check whether `~/.sillytavern/docker-compose.yml` already
> exists on this machine, or ask whoever administers it. If it does exist,
> don't run this installer — instead add this app's service definitions
> (`story-game`, plus any of `postgres`/`llamacpp-*`/`comfyui` not already
> present) into that existing compose file by hand.

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
implementation, checks `nvidia-smi`, prompts for the Postgres password, models,
and a `SECRET_ENCRYPTION_KEY` (auto-generated via `python3` + `cryptography` if
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
to a `Win32_VideoController` WMI query. The Fernet key is generated with Python
if present, otherwise natively via .NET RNG. Health-wait uses
`Invoke-WebRequest` (treating `401`/`200` as up).

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
