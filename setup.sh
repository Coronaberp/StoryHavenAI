#!/usr/bin/env bash
# StoryHaven AI — fresh-machine installer (Linux / macOS)
#
# Detects Docker or Podman + a Compose implementation, checks for an NVIDIA
# GPU, gathers/generates secrets, writes a working docker-compose.yml and .env,
# then brings the whole stack up and waits for it to become healthy.
#
#   ./setup.sh              full install (idempotent — safe to re-run)
#   ./setup.sh --dry-run    detect + generate files, but DO NOT start anything
#   ./setup.sh --check-only alias for --dry-run
#   ./setup.sh --yes        non-interactive: accept all defaults, auto-generate
#
# Re-running never destroys data: named volumes persist, and existing
# docker-compose.yml/.env values are reused unless you choose to change them.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$REPO_DIR/docker-compose.yml"
ENV_FILE="$REPO_DIR/.env"

DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|--check-only) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- output helpers
if [ -t 1 ]; then
  B=$'\033[1m'; R=$'\033[0m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; CYN=$'\033[36m'
else
  B=""; R=""; GRN=""; YLW=""; RED=""; CYN=""
fi
info()  { printf '%s\n' "${CYN}==>${R} $*"; }
ok()    { printf '%s\n' "${GRN}  ok${R} $*"; }
warn()  { printf '%s\n' "${YLW}  warning:${R} $*"; }
err()   { printf '%s\n' "${RED}  error:${R} $*" >&2; }
ask() { # ask "prompt" "default"  -> echoes answer
  local prompt="$1" default="${2:-}" reply
  if [ "$ASSUME_YES" = 1 ]; then printf '%s' "$default"; return; fi
  if [ -n "$default" ]; then
    read -r -p "$prompt [$default]: " reply </dev/tty || true
    printf '%s' "${reply:-$default}"
  else
    read -r -p "$prompt: " reply </dev/tty || true
    printf '%s' "$reply"
  fi
}
confirm() { # confirm "question"  -> 0 if yes
  local reply
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  read -r -p "$1 [y/N]: " reply </dev/tty || true
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- OS detection
OS="$(uname -s)"
case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  *)      PLATFORM="other" ;;
esac

# ---------------------------------------------------------------- engine detection
ENGINE=""; COMPOSE=""
detect_engine() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ENGINE="docker"
    if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose";
    elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose"; fi
  fi
  if [ -z "$ENGINE" ] && command -v podman >/dev/null 2>&1; then
    ENGINE="podman"
    if command -v podman-compose >/dev/null 2>&1; then COMPOSE="podman-compose";
    elif podman compose version >/dev/null 2>&1; then COMPOSE="podman compose"; fi
  fi
  # docker CLI may be an alias/shim over podman (as in this dev environment)
  if [ -z "$ENGINE" ] && command -v podman >/dev/null 2>&1; then
    ENGINE="podman"
  fi
}

print_install_help() {
  err "No working container engine found."
  echo
  case "$PLATFORM" in
    macos)
      echo "  Install Docker Desktop:   https://www.docker.com/products/docker-desktop/"
      echo "  or with Homebrew:         brew install --cask docker    (then launch Docker.app)"
      echo "  Podman alternative:       brew install podman podman-compose && podman machine init && podman machine start"
      ;;
    linux)
      echo "  Docker Engine + Compose:  https://docs.docker.com/engine/install/"
      echo "    convenience script:     curl -fsSL https://get.docker.com | sh"
      echo "  Podman alternative:       https://podman.io/docs/installation"
      echo "    Debian/Ubuntu:          sudo apt-get install -y podman podman-compose"
      echo "    Fedora/RHEL:            sudo dnf install -y podman podman-compose"
      ;;
    *)
      echo "  See https://docs.docker.com/engine/install/ or https://podman.io/docs/installation"
      ;;
  esac
  echo
  echo "  After installing, re-run: ./setup.sh"
}

# ---------------------------------------------------------------- GPU detection
GPU="none"
detect_gpu() {
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    GPU="nvidia"
  fi
}

# ---------------------------------------------------------------- secret helpers
gen_fernet() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null && return 0
  fi
  return 1
}
gen_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24; return
  fi
  head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32; echo
}
# read KEY=value out of an existing .env, empty if absent
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true
}

# ================================================================ main
echo
echo "${B}StoryHaven AI — installer${R}"
echo "repo: $REPO_DIR"
[ "$DRY_RUN" = 1 ] && warn "DRY RUN — files will be generated, but the stack will NOT be started."
echo

info "Detecting container engine"
detect_engine
if [ -z "$ENGINE" ]; then print_install_help; exit 1; fi
ok "engine: $ENGINE"
if [ -z "$COMPOSE" ]; then
  warn "no Compose implementation found for $ENGINE"
  case "$ENGINE" in
    docker) echo "  Install the Compose plugin: https://docs.docker.com/compose/install/" ;;
    podman) echo "  Install podman-compose:     pipx install podman-compose   (or: pip install podman-compose)" ;;
  esac
  [ "$DRY_RUN" = 1 ] || exit 1
  COMPOSE="$ENGINE compose"
fi
ok "compose: $COMPOSE"

info "Detecting NVIDIA GPU"
detect_gpu
if [ "$GPU" = nvidia ]; then
  ok "nvidia-smi found — GPU acceleration available"
else
  warn "No NVIDIA GPU detected (nvidia-smi missing or non-functional)."
  echo "  The chat model (llamacpp-chat), embeddings (llamacpp-embed) and image"
  echo "  generation (comfyui) will run CPU-bound and be VERY slow."
  echo "  The generated compose file still declares GPU reservations; on a"
  echo "  CPU-only host those services fall back to CPU (llama.cpp) — expect"
  echo "  minutes-per-reply latency and heavy RAM use."
  if [ "$DRY_RUN" = 0 ]; then
    confirm "Continue anyway on a machine without a detected GPU?" || { err "Aborted."; exit 1; }
  fi
fi

# ---------------------------------------------------------------- gather config
echo
info "Configuration (press Enter to accept defaults / reuse existing values)"

PG_USER="$(env_get POSTGRES_USER)";      PG_USER="${PG_USER:-storyhaven}"
PG_DB="$(env_get POSTGRES_DB)";          PG_DB="${PG_DB:-storyhaven}"
PG_PASS="$(env_get POSTGRES_PASSWORD)"
CHAT_MODEL="$(env_get CHAT_MODEL)";      CHAT_MODEL="${CHAT_MODEL:-Gemma-4-E4B-Uncensored-HauhauCS-Aggressive}"
EMBED_MODEL="$(env_get EMBED_MODEL)";    EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"
EMBED_DIM="$(env_get EMBED_DIM)";        EMBED_DIM="${EMBED_DIM:-768}"
CHAT_GGUF="$(env_get CHAT_GGUF)";        CHAT_GGUF="${CHAT_GGUF:-Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf}"
EMBED_GGUF="$(env_get EMBED_GGUF)";      EMBED_GGUF="${EMBED_GGUF:-nomic-embed-text-v2-moe.Q8_0.gguf}"
CHAT_CTX="$(env_get CHAT_CTX)";          CHAT_CTX="${CHAT_CTX:-131072}"
GPU_LAYERS="$(env_get GPU_LAYERS)";      GPU_LAYERS="${GPU_LAYERS:-999}"
FERNET_KEY="$(env_get SECRET_ENCRYPTION_KEY)"

PG_USER="$(ask "PostgreSQL user" "$PG_USER")"
PG_DB="$(ask "PostgreSQL database" "$PG_DB")"
if [ -z "$PG_PASS" ]; then
  PG_PASS="$(gen_password)"
  ok "generated a new PostgreSQL password"
else
  ok "reusing existing PostgreSQL password from .env"
fi

CHAT_MODEL="$(ask "Chat model name (CHAT_MODEL)" "$CHAT_MODEL")"
CHAT_GGUF="$(ask "Chat model GGUF filename (in the models volume)" "$CHAT_GGUF")"
EMBED_MODEL="$(ask "Embedding model name (EMBED_MODEL)" "$EMBED_MODEL")"
EMBED_GGUF="$(ask "Embedding model GGUF filename" "$EMBED_GGUF")"
EMBED_DIM="$(ask "Embedding dimension (EMBED_DIM)" "$EMBED_DIM")"
if [ "$GPU" = nvidia ]; then
  GPU_LAYERS="$(ask "GPU layers to offload (LLAMA_ARG_N_GPU_LAYERS)" "$GPU_LAYERS")"
else
  GPU_LAYERS="0"
fi

if [ -z "$FERNET_KEY" ]; then
  if confirm "Auto-generate a SECRET_ENCRYPTION_KEY now? (recommended)"; then
    if FERNET_KEY="$(gen_fernet)"; then
      ok "generated SECRET_ENCRYPTION_KEY"
    else
      warn "python3/cryptography not available to generate a Fernet key."
      echo "  Leaving it unset is safe — the app generates one and stores it in the DB."
      echo "  To set your own later, run on any machine with Python + cryptography:"
      echo "    python3 -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
      FERNET_KEY=""
    fi
  fi
else
  ok "reusing existing SECRET_ENCRYPTION_KEY from .env"
fi

DATABASE_URL="postgresql+asyncpg://${PG_USER}:${PG_PASS}@storyhaven-postgres:5432/${PG_DB}"

# ---------------------------------------------------------------- write .env
info "Writing $ENV_FILE"
umask 077
cat > "$ENV_FILE" <<EOF
# Generated by setup.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Safe to edit and re-run.
# --- PostgreSQL (storyhaven-postgres) ---
POSTGRES_USER=${PG_USER}
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=${PG_DB}

# --- StoryHaven app (story-game) ---
DATABASE_URL=${DATABASE_URL}
LLM_BASE_URL=http://llamacpp-chat:5001/v1
EMBED_BASE_URL=http://llamacpp-embed:5002/v1
LLM_API_KEY=
CHAT_MODEL=${CHAT_MODEL}
EMBED_MODEL=${EMBED_MODEL}
EMBED_DIM=${EMBED_DIM}
DEFAULT_LANGUAGE=English
SECRET_ENCRYPTION_KEY=${FERNET_KEY}

# --- llama.cpp model files (must exist inside the shared models volume) ---
CHAT_GGUF=${CHAT_GGUF}
EMBED_GGUF=${EMBED_GGUF}
CHAT_CTX=${CHAT_CTX}
GPU_LAYERS=${GPU_LAYERS}
EOF
umask 022
ok ".env written (permissions 600)"

# ---------------------------------------------------------------- write compose
info "Writing $COMPOSE_FILE"
cat > "$COMPOSE_FILE" <<EOF
# Generated by setup.sh — StoryHaven AI full stack.
# Re-running setup.sh regenerates this file; named volumes below persist data.
services:
  # NOTE: alpine:latest, pgvector/pgvector:pg16, ghcr.io/ggml-org/llama.cpp:server-cuda,
  # and bigbrozer/comfyture:latest below are mutable tags with no digest pinning or
  # signature verification. If you need supply-chain guarantees, pin to a specific
  # digest yourself (image@sha256:...) after generation.
  story-game:
    container_name: story-game
    image: alpine:latest
    restart: unless-stopped
    working_dir: /app
    ports:
      - "3000:3000"
    volumes:
      - ${REPO_DIR}:/app/ai-frontend
    networks:
      - sillytavern_net
    depends_on:
      - postgres
    environment:
      - DATABASE_URL=\${DATABASE_URL}
      - LLM_BASE_URL=\${LLM_BASE_URL}
      - EMBED_BASE_URL=\${EMBED_BASE_URL}
      - LLM_API_KEY=\${LLM_API_KEY}
      - CHAT_MODEL=\${CHAT_MODEL}
      - EMBED_MODEL=\${EMBED_MODEL}
      - EMBED_DIM=\${EMBED_DIM}
      - DEFAULT_LANGUAGE=\${DEFAULT_LANGUAGE}
      - SECRET_ENCRYPTION_KEY=\${SECRET_ENCRYPTION_KEY}
    command: ["/app/ai-frontend/run.sh"]
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:3000/api/health >/dev/null 2>&1 || wget -q -S -O- http://localhost:3000/api/health 2>&1 | grep -q '401 ' || exit 1"]
      interval: 15s
      timeout: 10s
      start_period: 90s
      retries: 10

  postgres:
    container_name: storyhaven-postgres
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    networks:
      - sillytavern_net
    environment:
      - POSTGRES_USER=\${POSTGRES_USER}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
      - POSTGRES_DB=\${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  llamacpp-chat:
    container_name: llamacpp-chat
    image: ghcr.io/ggml-org/llama.cpp:server-cuda
    restart: unless-stopped
    networks:
      - sillytavern_net
    volumes:
      - kcpp-data:/models:ro
    devices:
      - "nvidia.com/gpu=all"
    environment:
      - LLAMA_ARG_MODEL=/models/\${CHAT_GGUF}
      - LLAMA_ARG_CTX_SIZE=\${CHAT_CTX}
      - LLAMA_ARG_N_GPU_LAYERS=\${GPU_LAYERS}
      - LLAMA_ARG_HOST=0.0.0.0
      - LLAMA_ARG_PORT=5001
    ports:
      - "0.0.0.0:5001:5001"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:5001/health || exit 1"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

  llamacpp-embed:
    container_name: llamacpp-embed
    image: ghcr.io/ggml-org/llama.cpp:server-cuda
    restart: unless-stopped
    networks:
      - sillytavern_net
    volumes:
      - kcpp-data:/models:ro
    devices:
      - "nvidia.com/gpu=all"
    environment:
      - LLAMA_ARG_MODEL=/models/\${EMBED_GGUF}
      - LLAMA_ARG_EMBEDDINGS=true
      - LLAMA_ARG_HOST=0.0.0.0
      - LLAMA_ARG_PORT=5002
    ports:
      - "0.0.0.0:5002:5002"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:5002/health || exit 1"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

  comfyui:
    container_name: comfyui
    hostname: comfyui
    image: bigbrozer/comfyture:latest
    restart: unless-stopped
    networks:
      - sillytavern_net
    devices:
      - "nvidia.com/gpu=all"
    command: ["--listen", "0.0.0.0"]
    environment:
      - PUID=1000
      - PGID=1000
    ports:
      - "0.0.0.0:8188:8188"
    volumes:
      - comfyui_python:/opt/comfyui/python
      - comfyui_custom_nodes:/opt/comfyui/app/custom_nodes
      - comfyui_models:/opt/comfyui/app/models
      - comfyui_input:/opt/comfyui/app/input
      - comfyui_output:/opt/comfyui/app/output
      - comfyui_profiles:/opt/comfyui/app/user

volumes:
  kcpp-data:
  postgres_data:
  comfyui_python:
  comfyui_custom_nodes:
  comfyui_models:
  comfyui_input:
  comfyui_output:
  comfyui_profiles:

networks:
  sillytavern_net:
    driver: bridge
EOF
ok "docker-compose.yml written"

# ---------------------------------------------------------------- validate
info "Validating generated compose file"
err_file="$(mktemp)"
trap 'rm -f "$err_file"' EXIT
if $COMPOSE -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config >/dev/null 2>"$err_file"; then
  ok "compose config is valid"
elif command -v python3 >/dev/null 2>&1 && python3 -c "import yaml,sys; yaml.safe_load(open('$COMPOSE_FILE'))" 2>/dev/null; then
  warn "'$COMPOSE config' failed but YAML parses; see $err_file"
else
  err "compose file failed validation:"; cat "$err_file" >&2; exit 1
fi

# ---------------------------------------------------------------- ensure venv
ensure_venv() {
  [ -x "$REPO_DIR/venv/bin/uvicorn" ] && { ok "python venv present"; return; }
  warn "story-game's venv (with app dependencies) is missing."
  echo "  run.sh execs venv/bin/uvicorn, so the venv must exist with requirements installed."
  [ "$DRY_RUN" = 1 ] && { warn "dry-run: skipping venv bootstrap"; return; }
  if confirm "Build the venv now in a throwaway python container?"; then
    info "Creating venv + installing requirements.txt"
    $ENGINE run --rm -v "$REPO_DIR:/app" -w /app python:3.12-alpine sh -c \
      "apk add --no-cache build-base 2>/dev/null; python3 -m venv venv && venv/bin/pip install --upgrade pip && venv/bin/pip install -r requirements.txt"
    ok "venv built"
  else
    warn "Skipped — story-game will not start until venv/bin/uvicorn exists."
  fi
}

if [ "$DRY_RUN" = 1 ]; then
  echo
  ok "Dry run complete. Generated:"
  echo "    $COMPOSE_FILE"
  echo "    $ENV_FILE"
  echo "  Review them, then run ./setup.sh (without --dry-run) to start the stack."
  exit 0
fi

ensure_venv

# ---------------------------------------------------------------- bring up
echo
info "Starting the stack: $COMPOSE up -d"
$COMPOSE -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# ---------------------------------------------------------------- wait healthy
info "Waiting for story-game to answer on http://localhost:3000/api/health"
deadline=$(( $(date +%s) + 300 ))
healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null || echo 000)"
  # 401 = server up but unauthenticated (expected); 200 = up
  if [ "$code" = "401" ] || [ "$code" = "200" ]; then healthy=1; break; fi
  printf '.'; sleep 5
done
echo
if [ "$healthy" = 1 ]; then
  ok "story-game is up (HTTP $code from /api/health)"
else
  warn "story-game did not respond healthy within timeout."
  echo "  Check logs: $ENGINE logs story-game"
fi

echo
echo "${B}First-run admin password${R}"
echo "  On first startup the app auto-creates an 'admin' user and prints a random"
echo "  password to story-game's stdout. Retrieve it with:"
echo "    ${CYN}$ENGINE logs story-game 2>&1 | grep -i -A1 'admin'${R}"
echo
echo "${B}Open the app:${R} http://localhost:3000"
echo "  ComfyUI:        http://localhost:8188"
echo "  Chat model API: http://localhost:5001/v1"
echo "  Embed API:      http://localhost:5002/v1"
echo
ok "Done."
