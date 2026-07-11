#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
  # The bundled package uses Hatchling. A normal install works with older
  # macOS Python environments where pip cannot perform a PEP 660 editable install.
  if .venv/bin/python -m pip install --disable-pip-version-check vendor/mempalace; then
    echo "$MEMPALACE_VERSION" > "$MEMPALACE_MARKER"
  else
    echo "WARNING: MemPalace could not be installed. Continuing with local profile memory only."
    rm -f "$MEMPALACE_MARKER"
  fi
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

mkdir -p "$MEMPALACE_PATH" "$DATA_DIR"

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
