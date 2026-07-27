#!/bin/bash
# SkillNote host resolution (Codex) — single source of truth.
# Called by all hooks. Prints the resolved host to stdout.
#
# Priority:
#   1. SKILLNOTE_HOST env var (manual override)
#   2. ~/.skillnote/host file (written by `skillnote connect codex` at install)
#   3. "localhost" fallback (local dev only)

HOST="${SKILLNOTE_HOST:-}"

if [ -z "$HOST" ]; then
    HOST_FILE="$HOME/.skillnote/host"
    if [ -f "$HOST_FILE" ]; then
        HOST=$(cat "$HOST_FILE" 2>/dev/null | tr -d '[:space:]')
    fi
fi

echo "${HOST:-localhost}"
