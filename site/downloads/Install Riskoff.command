#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="https://api.github.com/repos/Eligiond/Prediction-Hedging"
REF="codex/mcp-product-pivot"
INSTALL_ROOT="$HOME/Library/Application Support/Riskoff"
SOURCE_DIR="$INSTALL_ROOT/source"
WORK_DIR="$INSTALL_ROOT/installing"
ARCHIVE="$INSTALL_ROOT/riskoff.zip"

echo "Riskoff installer"
echo
echo "This downloads Riskoff and its bundled MemPalace source from GitHub."
echo "Runtime data stays on this Mac. A temporary HTTPS tunnel connects Claude."
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install it from https://nodejs.org/"
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close..."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3.9 or newer is required. Install it from https://python.org/"
  open "https://www.python.org/downloads/macos/"
  read -r -p "Press Enter to close..."
  exit 1
fi

mkdir -p "$INSTALL_ROOT"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

echo "Downloading Riskoff..."
curl --fail --location --progress-bar \
  "$REPOSITORY/zipball/$REF" \
  --output "$ARCHIVE"

ditto -x -k "$ARCHIVE" "$WORK_DIR"
DOWNLOADED_SOURCE="$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "$DOWNLOADED_SOURCE" ]] || [[ ! -f "$DOWNLOADED_SOURCE/Connect Riskoff to Claude.command" ]]; then
  echo "The downloaded Riskoff package is incomplete."
  read -r -p "Press Enter to close..."
  exit 1
fi

rm -rf "$SOURCE_DIR"
mv "$DOWNLOADED_SOURCE" "$SOURCE_DIR"
chmod +x "$SOURCE_DIR/Connect Riskoff to Claude.command" \
  "$SOURCE_DIR/Start Riskoff.command" \
  "$SOURCE_DIR/scripts/start-local.sh" \
  "$SOURCE_DIR/scripts/start-claude.sh" \
  "$SOURCE_DIR/python/mempalace_bridge.py"

rm -rf "$WORK_DIR" "$ARCHIVE"
echo
echo "Riskoff is installed. Starting the Claude connector..."
echo
exec "$SOURCE_DIR/Connect Riskoff to Claude.command"
