#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

install_cloudflared() {
  local version="2026.5.2"
  local machine archive checksum url actual
  machine="$(uname -m)"
  case "$machine" in
    arm64)
      archive="cloudflared-darwin-arm64.tgz"
      checksum="ba94054c9fd4297645093d59d51442e5e546d07bb0516120e694a13d5b216d38"
      ;;
    x86_64)
      archive="cloudflared-darwin-amd64.tgz"
      checksum="7240f709506bc2c1eb9da4d89cf2555499c60280ecb854b7d80e8f17d4b7903d"
      ;;
    *)
      echo "The one-click Claude tunnel currently supports Apple Silicon and Intel Macs."
      exit 1
      ;;
  esac

  mkdir -p .local/bin .local/downloads
  if [[ -x .local/bin/cloudflared ]] && [[ "$(.local/bin/cloudflared version 2>/dev/null)" == *"$version"* ]]; then
    return
  fi

  url="https://github.com/cloudflare/cloudflared/releases/download/$version/$archive"
  echo "Downloading the pinned Cloudflare HTTPS tunnel helper..."
  curl --fail --location --silent --show-error "$url" --output ".local/downloads/$archive"
  actual="$(shasum -a 256 ".local/downloads/$archive" | awk '{print $1}')"
  if [[ "$actual" != "$checksum" ]]; then
    echo "cloudflared checksum verification failed; refusing to run it."
    exit 1
  fi
  tar -xzf ".local/downloads/$archive" -C .local/bin
  chmod +x .local/bin/cloudflared
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required: https://nodejs.org/"
  read -r -p "Press Enter to close..."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3.9+ is required: https://www.python.org/downloads/"
  read -r -p "Press Enter to close..."
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "Setting up Prediction Hedging MCP..."
npm install --no-audit --no-fund

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi

MEMPALACE_VERSION="3.5.0"
MEMPALACE_MARKER=".venv/.prediction-hedging-mempalace-version"
if [[ ! -f "$MEMPALACE_MARKER" ]] || [[ "$(<"$MEMPALACE_MARKER")" != "$MEMPALACE_VERSION" ]]; then
  .venv/bin/python -m pip install --disable-pip-version-check -e vendor/mempalace
  echo "$MEMPALACE_VERSION" > "$MEMPALACE_MARKER"
else
  echo "MemPalace $MEMPALACE_VERSION is already installed locally."
fi
npm run build

export PROJECT_ROOT="$ROOT"
export MEMPALACE_PYTHON="${MEMPALACE_PYTHON:-$ROOT/.venv/bin/python}"
export MEMPALACE_PATH="${MEMPALACE_PATH:-$ROOT/.local/mempalace/palace}"
export DATA_DIR="${DATA_DIR:-$ROOT/data}"
export MCP_TRANSPORT=http
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3000}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://127.0.0.1:$PORT,http://localhost:$PORT}"

if [[ "${CLAUDE_CONNECTOR:-0}" == "1" ]]; then
  export ALLOWED_ORIGINS="$ALLOWED_ORIGINS,https://claude.ai,https://claude.com"
  install_cloudflared
fi

mkdir -p "$MEMPALACE_PATH" "$DATA_DIR"

if [[ "${CLAUDE_CONNECTOR:-0}" == "1" ]]; then
  SERVER_LOG=".local/prediction-hedging-server.log"
  TUNNEL_LOG=".local/prediction-hedging-tunnel.log"
  : > "$SERVER_LOG"
  : > "$TUNNEL_LOG"

  node dist/src/index.js > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  TUNNEL_PID=""
  cleanup() {
    [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM

  for _ in {1..40}; do
    if curl --silent --fail "http://$HOST:$PORT/health" >/dev/null; then
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "The MCP server failed to start:"
      sed -n '1,120p' "$SERVER_LOG"
      exit 1
    fi
    sleep 0.25
  done

  .local/bin/cloudflared tunnel --no-autoupdate --url "http://$HOST:$PORT" > "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  PUBLIC_BASE=""
  for _ in {1..120}; do
    PUBLIC_BASE="$(grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
    [[ -n "$PUBLIC_BASE" ]] && break
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      echo "The HTTPS tunnel failed to start:"
      sed -n '1,160p' "$TUNNEL_LOG"
      exit 1
    fi
    sleep 0.25
  done

  if [[ -z "$PUBLIC_BASE" ]]; then
    echo "Timed out waiting for the HTTPS tunnel."
    sed -n '1,160p' "$TUNNEL_LOG"
    exit 1
  fi

  CONNECTOR_URL="$PUBLIC_BASE/mcp"
  printf '%s' "$CONNECTOR_URL" | pbcopy
  echo
  echo "CLAUDE CONNECTOR IS READY"
  echo
  echo "Paste this URL into Claude (it is already copied):"
  echo "$CONNECTOR_URL"
  echo
  echo "Use Settings > Connectors > Add custom connector."
  echo "Leave OAuth Client ID and Secret blank."
  echo "Keep this window open. Control-C stops the connector."
  echo
  if [[ "${OPEN_CLAUDE_SETTINGS:-1}" != "0" ]]; then
    open "https://claude.ai/settings/connectors"
  fi
  wait "$TUNNEL_PID"
  exit 0
fi

echo
echo "Prediction Hedging MCP is starting locally."
echo "MCP endpoint: http://$HOST:$PORT/mcp"
echo "Status page:  http://$HOST:$PORT/"
echo "Press Control-C to stop it."
echo

if [[ "${OPEN_BROWSER:-1}" != "0" ]] && command -v open >/dev/null 2>&1; then
  (sleep 2 && open "http://$HOST:$PORT/") &
fi

exec node dist/src/index.js
