#!/usr/bin/env python3
"""JSON bridge from the TypeScript MCP to the vendored MemPalace package."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
from pathlib import Path

PROTOCOL_FD = os.dup(1)


def safe_user_wing(user_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", user_id.strip())[:80].strip("_")
    if not safe:
        raise ValueError("user_id must contain at least one letter or number")
    return f"user_{safe}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("recall", "store", "status"))
    parser.add_argument("--palace", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--query")
    parser.add_argument("--text")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    palace = str(Path(args.palace).expanduser().resolve())
    Path(palace).mkdir(parents=True, exist_ok=True)
    os.environ["MEMPALACE_PALACE_PATH"] = palace
    os.environ.setdefault("MEMPALACE_EMBEDDING_MODEL", "minilm")
    wing = safe_user_wing(args.user)

    noise = io.StringIO()
    with contextlib.redirect_stdout(noise):
        if args.action == "recall":
            if not args.query:
                raise ValueError("--query is required for recall")
            from mempalace.searcher import search_memories

            result = search_memories(
                args.query,
                palace,
                wing=wing,
                room="investment_context",
                n_results=max(1, min(args.limit, 20)),
            )
        elif args.action == "store":
            if not args.text:
                raise ValueError("--text is required for store")
            from mempalace.mcp_server import tool_add_drawer

            result = tool_add_drawer(
                wing=wing,
                room="investment_context",
                content=args.text,
                source_file=f"riskoff/{wing}",
                added_by="riskoff-mcp",
            )
        else:
            result = {
                "available": True,
                "palace": palace,
                "wing": wing,
                "databaseExists": (Path(palace) / "chroma.sqlite3").exists(),
            }

    os.write(PROTOCOL_FD, (json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8"))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        payload = json.dumps({"error": str(error), "type": type(error).__name__}) + "\n"
        os.write(PROTOCOL_FD, payload.encode("utf-8"))
        raise SystemExit(1)
