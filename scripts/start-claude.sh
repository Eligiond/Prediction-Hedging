#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CLAUDE_CONNECTOR=1
export OPEN_BROWSER=0
exec "$ROOT/scripts/start-local.sh"
