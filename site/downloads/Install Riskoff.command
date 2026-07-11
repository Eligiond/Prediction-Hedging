#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$PACKAGE_DIR/riskoff-source.tar.gz"
INSTALL_ROOT="$HOME/Library/Application Support/Riskoff"
SOURCE_DIR="$INSTALL_ROOT/source"
WORK_DIR="$INSTALL_ROOT/installing"

echo "Riskoff installer"
echo
echo "This installs the bundled Riskoff and MemPalace source."
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

if [[ ! -f "$BUNDLE" ]]; then
  echo "riskoff-source.tar.gz must stay beside this installer."
  read -r -p "Press Enter to close..."
  exit 1
fi

echo "Unpacking Riskoff..."
tar -xzf "$BUNDLE" -C "$WORK_DIR"
if [[ ! -f "$WORK_DIR/Connect Riskoff to Claude.command" ]]; then
  echo "The bundled Riskoff package is incomplete."
  read -r -p "Press Enter to close..."
  exit 1
fi

rm -rf "$SOURCE_DIR"
mv "$WORK_DIR" "$SOURCE_DIR"
chmod +x "$SOURCE_DIR/Connect Riskoff to Claude.command" \
  "$SOURCE_DIR/Start Riskoff.command" \
  "$SOURCE_DIR/scripts/start-local.sh" \
  "$SOURCE_DIR/scripts/start-claude.sh" \
  "$SOURCE_DIR/python/mempalace_bridge.py"

echo
echo "Riskoff is installed. Starting the Claude connector..."
echo
exec "$SOURCE_DIR/Connect Riskoff to Claude.command"
