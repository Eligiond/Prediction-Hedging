#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="2026.5.2"
MACHINE="$(uname -m)"

case "$MACHINE" in
  arm64)
    ARCHIVE="cloudflared-darwin-arm64.tgz"
    CHECKSUM="ba94054c9fd4297645093d59d51442e5e546d07bb0516120e694a13d5b216d38"
    ;;
  x86_64)
    ARCHIVE="cloudflared-darwin-amd64.tgz"
    CHECKSUM="7240f709506bc2c1eb9da4d89cf2555499c60280ecb854b7d80e8f17d4b7903d"
    ;;
  *)
    echo "Unsupported macOS architecture: $MACHINE" >&2
    exit 1
    ;;
esac

mkdir -p "$ROOT/.local/bin" "$ROOT/.local/downloads"
TARGET="$ROOT/.local/bin/cloudflared"
if [[ -x "$TARGET" ]] && [[ "$("$TARGET" version 2>/dev/null)" == *"$VERSION"* ]]; then
  exit 0
fi

URL="https://github.com/cloudflare/cloudflared/releases/download/$VERSION/$ARCHIVE"
curl --fail --location --silent --show-error "$URL" --output "$ROOT/.local/downloads/$ARCHIVE"
ACTUAL="$(shasum -a 256 "$ROOT/.local/downloads/$ARCHIVE" | awk '{print $1}')"
if [[ "$ACTUAL" != "$CHECKSUM" ]]; then
  echo "cloudflared checksum verification failed" >&2
  exit 1
fi
tar -xzf "$ROOT/.local/downloads/$ARCHIVE" -C "$ROOT/.local/bin"
chmod +x "$TARGET"
