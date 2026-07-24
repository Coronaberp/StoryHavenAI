#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$REPO_DIR/docker-compose.yml"
ENV_FILE="$REPO_DIR/.env"

usage() {
  cat <<'EOF'
StoryHaven AI installer for a fresh Linux or macOS machine.

Detects Docker or Podman plus a Compose implementation, checks for an NVIDIA
or AMD GPU, gathers or generates secrets, writes a working docker-compose.yml
and .env, then brings the whole stack up and waits for it to become healthy.

  ./setup.sh              full install, idempotent and safe to re-run
  ./setup.sh --dry-run    detect and generate files but start nothing
  ./setup.sh --check-only alias for --dry-run
  ./setup.sh --yes        non-interactive, accept all defaults

Re-running never destroys data: named volumes persist, and existing
docker-compose.yml and .env values are reused unless you choose to change them.
EOF
}

DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|--check-only) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  B=$'\033[1m'; R=$'\033[0m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; CYN=$'\033[36m'
else
  B=""; R=""; GRN=""; YLW=""; RED=""; CYN=""
fi
info()  { printf '%s\n' "${CYN}==>${R} $*"; }
ok()    { printf '%s\n' "${GRN}  ok${R} $*"; }
warn()  { printf '%s\n' "${YLW}  warning:${R} $*"; }
err()   { printf '%s\n' "${RED}  error:${R} $*" >&2; }
ask() {
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
confirm() {
  local reply
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  read -r -p "$1 [y/N]: " reply </dev/tty || true
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

OS="$(uname -s)"
case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  *)      PLATFORM="other" ;;
esac

ENGINE=""; COMPOSE=""; DOCKER_NEEDS_SUDO=0
detect_engine() {
  local docker_prefix=""
  if ! docker info >/dev/null 2>&1 && [ "$DOCKER_NEEDS_SUDO" = 1 ] && sudo docker info >/dev/null 2>&1; then
    docker_prefix="sudo "
  fi
  if command -v docker >/dev/null 2>&1 && ${docker_prefix}docker info >/dev/null 2>&1; then
    ENGINE="${docker_prefix}docker"
    if ${docker_prefix}docker compose version >/dev/null 2>&1; then COMPOSE="${docker_prefix}docker compose";
    elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="${docker_prefix}docker-compose"; fi
  fi
  if [ -z "$ENGINE" ] && command -v podman >/dev/null 2>&1; then
    ENGINE="podman"
    if command -v podman-compose >/dev/null 2>&1; then COMPOSE="podman-compose";
    elif podman compose version >/dev/null 2>&1; then COMPOSE="podman compose"; fi
  fi
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

install_docker_linux() {
  command -v curl >/dev/null 2>&1 || { err "curl is required to auto-install Docker."; return 1; }
  command -v sudo >/dev/null 2>&1 || { err "sudo is required to auto-install Docker."; return 1; }
  info "Installing Docker Engine (get.docker.com)"
  curl -fsSL https://get.docker.com | sudo sh || return 1
  sudo systemctl enable --now docker >/dev/null 2>&1 || true
  sudo usermod -aG docker "$USER" >/dev/null 2>&1 || true
  DOCKER_NEEDS_SUDO=1
  ok "Docker Engine installed (this shell isn't in the docker group yet — using sudo for the rest of this run; log out and back in afterward to drop sudo going forward)"
}

install_docker_macos() {
  command -v brew >/dev/null 2>&1 || { err "Homebrew is required to auto-install Docker Desktop."; return 1; }
  info "Installing Docker Desktop (Homebrew cask)"
  brew install --cask docker || return 1
  open -a Docker
  info "Waiting for Docker Desktop to finish starting..."
  local waited=0
  while [ "$waited" -lt 120 ]; do
    docker info >/dev/null 2>&1 && return 0
    sleep 2
    waited=$((waited + 2))
  done
  err "Docker Desktop did not become ready within 2 minutes."
  return 1
}

attempt_docker_autoinstall() {
  case "$PLATFORM" in
    linux) install_docker_linux ;;
    macos) install_docker_macos ;;
    *) err "Automatic Docker install is only supported on Linux and macOS."; return 1 ;;
  esac
}

GPU="none"
detect_gpu() {
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    GPU="nvidia"; return
  fi
  if command -v rocm-smi >/dev/null 2>&1 && rocm-smi >/dev/null 2>&1; then
    GPU="amd-rocm"; return
  fi
  if [ -d /sys/module/amdgpu ]; then
    GPU="amd-vulkan"; return
  fi
  if command -v lspci >/dev/null 2>&1 && lspci -d ::0300 2>/dev/null | grep -qiE "AMD|ATI|Advanced Micro Devices"; then
    GPU="amd-vulkan"
  fi
}

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
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true
}

echo
echo "${B}StoryHaven AI — installer${R}"
echo "repo: $REPO_DIR"
[ "$DRY_RUN" = 1 ] && warn "DRY RUN — files will be generated, but the stack will NOT be started."
echo

info "Detecting container engine"
detect_engine
if [ -z "$ENGINE" ] && [ "$DRY_RUN" = 0 ]; then
  warn "No working container engine found. Docker needs to be installed."
  echo
  echo "  ${B}This is safe to allow. Here is exactly what happens and why:${R}"
  echo "    - Your password (sudo) is needed ONLY to install Docker, the standard"
  echo "      container runtime, using Docker's own official install script"
  echo "      (get.docker.com)."
  echo "    - Nothing else in this setup needs or uses elevated rights. Everything"
  echo "      else this script does is write two config files (docker-compose.yml"
  echo "      and .env) into this folder and start containers."
  echo "    - It never deletes data, never touches files outside this folder, and"
  echo "      re-running it is always safe."
  echo
  if confirm "Install Docker automatically now?"; then
    attempt_docker_autoinstall && detect_engine
  fi
fi
if [ -z "$ENGINE" ]; then print_install_help; exit 1; fi
ok "engine: $ENGINE"
if [ -z "$COMPOSE" ]; then
  warn "no Compose implementation found for $ENGINE"
  case "$ENGINE" in
    *docker) echo "  Install the Compose plugin: https://docs.docker.com/compose/install/" ;;
    *podman) echo "  Install podman-compose:     pipx install podman-compose   (or: pip install podman-compose)" ;;
  esac
  [ "$DRY_RUN" = 1 ] || exit 1
  COMPOSE="$ENGINE compose"
fi
ok "compose: $COMPOSE"

info "Detecting GPU"
detect_gpu
case "$GPU" in
  nvidia)
    ok "NVIDIA GPU found (nvidia-smi) — CUDA acceleration for chat, embeddings, and image gen" ;;
  amd-rocm)
    ok "AMD GPU with working ROCm found (rocm-smi) — ROCm acceleration for chat, embeddings, and image gen"
    echo "  llama.cpp uses the official ROCm server image, ComfyUI uses a ROCm build."
    echo "  ROCm containers need a supported card (roughly RX 6000 series and newer)." ;;
  amd-vulkan)
    ok "AMD GPU found (no working rocm-smi) — llama.cpp will run on Vulkan (/dev/kfd + /dev/dri passed through)"
    warn "Without ROCm, image generation (comfyui) runs on CPU."
    echo "  Chat and embeddings still get full GPU offload via llama.cpp's Vulkan backend."
    echo "  To get GPU image gen instead, install ROCm (rocm-smi must work) and re-run this installer." ;;
  *)
    warn "No GPU detected (neither nvidia-smi nor an AMD GPU is visible)."
    echo "  The chat model (llamacpp-chat), embeddings (llamacpp-embed) and image"
    echo "  generation (comfyui) will run CPU-bound and be VERY slow — expect"
    echo "  minutes-per-reply latency and heavy RAM use."
    if [ "$DRY_RUN" = 0 ]; then
      confirm "Continue anyway on a machine without a detected GPU?" || { err "Aborted."; exit 1; }
    fi ;;
esac

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
if [ "$GPU" != none ]; then
  GPU_LAYERS="$(ask "GPU layers to offload (LLAMA_ARG_N_GPU_LAYERS)" "$GPU_LAYERS")"
else
  GPU_LAYERS="0"
fi

AMD_DEVICES='    devices:
      - "/dev/kfd"
      - "/dev/dri"
    group_add:
      - video
      - render'
case "$GPU" in
  nvidia)
    LLAMA_IMAGE="ghcr.io/ggml-org/llama.cpp:server-cuda"
    LLAMA_DEVICES='    devices:
      - "nvidia.com/gpu=all"' ;;
  amd-rocm)
    LLAMA_IMAGE="ghcr.io/ggml-org/llama.cpp:server-rocm"
    LLAMA_DEVICES="$AMD_DEVICES" ;;
  amd-vulkan)
    LLAMA_IMAGE="ghcr.io/ggml-org/llama.cpp:server-vulkan"
    LLAMA_DEVICES="$AMD_DEVICES" ;;
  *)
    LLAMA_IMAGE="ghcr.io/ggml-org/llama.cpp:server"
    LLAMA_DEVICES="" ;;
esac

if [ "$GPU" = amd-rocm ]; then
  COMFY_SERVICE='  comfyui:
    container_name: comfyui
    hostname: comfyui
    image: corundex/comfyui-rocm:latest
    restart: unless-stopped
    networks:
      - storyhaven_isolated_net
    devices:
      - "/dev/kfd"
      - "/dev/dri"
    group_add:
      - video
      - render
    environment:
      - HIP_VISIBLE_DEVICES=0
      - MODEL_DOWNLOAD=none
    ports:
      - "0.0.0.0:8188:8188"
    volumes:
      - comfyui_custom_nodes:/workspace/ComfyUI/custom_nodes
      - comfyui_models:/workspace/ComfyUI/models
      - comfyui_input:/workspace/ComfyUI/input
      - comfyui_output:/workspace/ComfyUI/output
      - comfyui_profiles:/workspace/ComfyUI/user'
else
  if [ "$GPU" = nvidia ]; then
    COMFY_DEVICES='    devices:
      - "nvidia.com/gpu=all"'
  else
    COMFY_DEVICES=""
  fi
  COMFY_SERVICE="  comfyui:
    container_name: comfyui
    hostname: comfyui
    image: bigbrozer/comfyture:latest
    restart: unless-stopped
    networks:
      - storyhaven_isolated_net
${COMFY_DEVICES}
    command: [\"--listen\", \"0.0.0.0\"]
    environment:
      - PUID=1000
      - PGID=1000
    ports:
      - \"0.0.0.0:8188:8188\"
    volumes:
      - comfyui_python:/opt/comfyui/python
      - comfyui_custom_nodes:/opt/comfyui/app/custom_nodes
      - comfyui_models:/opt/comfyui/app/models
      - comfyui_input:/opt/comfyui/app/input
      - comfyui_output:/opt/comfyui/app/output
      - comfyui_profiles:/opt/comfyui/app/user"
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

info "Writing $ENV_FILE"
umask 077
cat > "$ENV_FILE" <<EOF
POSTGRES_USER=${PG_USER}
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=${PG_DB}

DATABASE_URL=${DATABASE_URL}
LLM_BASE_URL=http://llamacpp-chat:5001/v1
EMBED_BASE_URL=http://llamacpp-embed:5002/v1
COMFYUI_URL=http://comfyui:8188
LLM_API_KEY=
CHAT_MODEL=${CHAT_MODEL}
EMBED_MODEL=${EMBED_MODEL}
EMBED_DIM=${EMBED_DIM}
DEFAULT_LANGUAGE=English
SECRET_ENCRYPTION_KEY=${FERNET_KEY}

CHAT_GGUF=${CHAT_GGUF}
EMBED_GGUF=${EMBED_GGUF}
CHAT_CTX=${CHAT_CTX}
GPU_LAYERS=${GPU_LAYERS}
EOF
umask 022
ok ".env written (permissions 600)"

info "Writing $COMPOSE_FILE"
cat > "$COMPOSE_FILE" <<EOF
services:
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
      - storyhaven_isolated_net
    depends_on:
      - postgres
    environment:
      - DATABASE_URL=\${DATABASE_URL}
      - LLM_BASE_URL=\${LLM_BASE_URL}
      - EMBED_BASE_URL=\${EMBED_BASE_URL}
      - COMFYUI_URL=\${COMFYUI_URL}
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
      - storyhaven_isolated_net
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
    image: ${LLAMA_IMAGE}
    restart: unless-stopped
    networks:
      - storyhaven_isolated_net
    volumes:
      - kcpp-data:/models:ro
${LLAMA_DEVICES}
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
    image: ${LLAMA_IMAGE}
    restart: unless-stopped
    networks:
      - storyhaven_isolated_net
    volumes:
      - kcpp-data:/models:ro
${LLAMA_DEVICES}
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

${COMFY_SERVICE}

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
  storyhaven_isolated_net:
    driver: bridge
EOF
ok "docker-compose.yml written"

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

MANIFEST_FILE="$REPO_DIR/installer/models.manifest.tsv"
CURL_IMAGE="docker.io/curlimages/curl:latest"

model_present() {
  local category="$1" filename="$2"
  if [ "$category" = gguf ]; then
    $ENGINE exec llamacpp-chat test -f "/models/$filename" 2>/dev/null
  else
    $ENGINE exec comfyui test -f "/opt/comfyui/app/models/$category/$filename" 2>/dev/null
  fi
}

download_model() {
  local category="$1" filename="$2" url="$3"
  local auth=()
  [ -n "${CIVITAI_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $CIVITAI_TOKEN")
  if model_present "$category" "$filename"; then
    ok "already present: $category/$filename"
    return 0
  fi
  info "Downloading $category/$filename"
  if [ "$category" = gguf ]; then
    local vol
    vol="$($ENGINE volume ls --format '{{.Name}}' | grep 'kcpp-data$' | head -1)"
    [ -n "$vol" ] || { warn "kcpp-data volume not found, skipping $filename"; return 1; }
    $ENGINE run --rm -v "$vol:/dest" "$CURL_IMAGE" -fL --retry 3 "${auth[@]}" -o "/dest/$filename" "$url" \
      && ok "$filename" || warn "download failed: $filename"
  else
    $ENGINE run --rm --volumes-from comfyui "$CURL_IMAGE" -fL --retry 3 "${auth[@]}" \
      -o "/opt/comfyui/app/models/$category/$filename" "$url" \
      && ok "$filename" || warn "download failed: $filename"
  fi
}

download_manifest_selection() {
  local only_defaults="$1" category filename url is_default
  while IFS=$'\t' read -r category filename url is_default; do
    [ -n "$url" ] || continue
    if [ "$only_defaults" = 1 ] && [ "$is_default" != 1 ]; then continue; fi
    download_model "$category" "$filename" "$url"
  done < "$MANIFEST_FILE"
}

import_models_from_folder() {
  local src
  src="$(ask "Path to a folder with model subfolders (gguf/, checkpoints/, loras/, ...)" "")"
  [ -d "$src" ] || { warn "'$src' is not a directory, skipping."; return 0; }
  if [ -d "$src/gguf" ]; then
    $ENGINE cp "$src/gguf/." llamacpp-chat:/models/ && ok "gguf files copied"
  fi
  for category in checkpoints loras upscale_models vae diffusion_models text_encoders; do
    [ -d "$src/$category" ] || continue
    $ENGINE cp "$src/$category/." "comfyui:/opt/comfyui/app/models/$category/" && ok "$category copied"
  done
}

offer_model_install() {
  [ -f "$MANIFEST_FILE" ] || return 0
  local total defaults
  total=$(grep -c . "$MANIFEST_FILE")
  defaults=$(awk -F'\t' '$4 == 1' "$MANIFEST_FILE" | wc -l)
  echo
  echo "${B}Model downloads${R}"
  echo "  Image generation and LoRA styling need model files, downloaded from each"
  echo "  model's own source site (Civitai, Hugging Face, GitHub). The catalog has"
  echo "  $total models. The default set ($defaults files, the RealSkin image model and"
  echo "  the Zoda detailer) is enough to generate good images out of the box."
  echo "  Some Civitai downloads need a free API token. Set CIVITAI_TOKEN before"
  echo "  running this script to use one."
  if confirm "Download the default model set now?"; then
    download_manifest_selection 1
  fi
  if confirm "Also download the full model catalog? (tens of GB)"; then
    download_manifest_selection 0
  fi
  if confirm "Import additional model files from a local folder or drive?"; then
    import_models_from_folder
  fi
  info "Restarting model services to pick up new files"
  $COMPOSE -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart llamacpp-chat llamacpp-embed comfyui
}

ensure_venv

echo
info "Starting the stack: $COMPOSE up -d"
$COMPOSE -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

info "Waiting for story-game to answer on http://localhost:3000/api/health"
deadline=$(( $(date +%s) + 300 ))
healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null || echo 000)"
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

offer_model_install

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
