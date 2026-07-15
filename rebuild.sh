#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$ROOT/bin"
BIN="$BIN_DIR/tailwindcss"
INPUT="$ROOT/new_ui/css/input.css"
OUTPUT="$ROOT/new_ui/css/app.css"
VERSION="v4.1.14"
DEV_PORT="3001"
ENV_DEV="$ROOT/.env.dev"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) ASSET="tailwindcss-linux-x64" ;;
  Linux-aarch64) ASSET="tailwindcss-linux-arm64" ;;
  Darwin-x86_64) ASSET="tailwindcss-macos-x64" ;;
  Darwin-arm64) ASSET="tailwindcss-macos-arm64" ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

if [ ! -x "$BIN" ]; then
  echo "Downloading Tailwind CLI $VERSION ($ASSET)..."
  mkdir -p "$BIN_DIR"
  curl -sLo "$BIN" "https://github.com/tailwindlabs/tailwindcss/releases/download/$VERSION/$ASSET"
  chmod +x "$BIN"
fi

DEVUI_VENV="$ROOT/.devui-venv"
if [ ! -x "$DEVUI_VENV/bin/uvicorn" ] || ! "$DEVUI_VENV/bin/python3" -c "import sqlalchemy, asyncpg, pgvector, cryptography, pyotp, jwt" 2>/dev/null; then
  echo "Setting up dev-server venv (full backend deps, host-only, separate from the app's container venv)..."
  python3 -m venv "$DEVUI_VENV"
  "$DEVUI_VENV/bin/pip" install -q -r "$ROOT/requirements.txt"
fi

if [ "$1" = "--once" ]; then
  "$BIN" -i "$INPUT" -o "$OUTPUT" --minify
  echo "Built $OUTPUT"
  exit 0
fi

cleanup() {
  echo "Stopping..."
  kill "$UVICORN_PID" "$TAILWIND_PID" 2>/dev/null
  wait "$UVICORN_PID" "$TAILWIND_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

cd "$ROOT"
if [ ! -f "$ENV_DEV" ]; then
  cat > "$ENV_DEV" <<'EOF'
# Host-side dev DATABASE_URL for rebuild.sh, pointed at the same real
# storyhaven-postgres DB the story-game container uses on :3000 — but via
# the port actually published to the host (see `podman ps`), since the
# container's own DATABASE_URL uses the docker-network hostname
# (storyhaven-postgres:5432), which the host can't resolve.
# Fill this in yourself; rebuild.sh sources it but never prints it.
DATABASE_URL=postgresql+asyncpg://user:pass@127.0.0.1:PORT/dbname
EOF
  echo "Created $ENV_DEV — fill in the real DATABASE_URL (see the file's comment) before running again."
  exit 1
fi
set -a
. "$ENV_DEV"
set +a
COMFYUI_MODELS_DIR="${COMFYUI_MODELS_DIR:-$ROOT/.devui-comfyui-models}"
mkdir -p "$COMFYUI_MODELS_DIR"
export COMFYUI_MODELS_DIR
STATIC_DIR="$ROOT/new_ui" "$DEVUI_VENV/bin/uvicorn" server:app --host 0.0.0.0 --port "$DEV_PORT" --reload --reload-exclude 'modal_app/*' --app-dir "$ROOT" &
UVICORN_PID=$!

"$BIN" -i "$INPUT" -o "$OUTPUT" --watch &
TAILWIND_PID=$!

echo "new_ui dev server (real backend, same DB as :3000): http://localhost:$DEV_PORT  (Ctrl+C to stop)"
wait "$UVICORN_PID" "$TAILWIND_PID"
