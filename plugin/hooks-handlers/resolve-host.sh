#!/bin/bash
# SkillNote host resolution — single source of truth
# Called by all hooks and scripts. Prints the resolved host to stdout.
#
# Priority:
#   1. CLAUDE_PLUGIN_OPTION_HOST env var (set by Claude Code plugin config)
#   2. ~/.skillnote/host file (written by setup script at install time)
#   3. "localhost" fallback (local dev only)
#
# The setup script writes ~/.skillnote/host with the server address.
# This is the primary mechanism. The env var is a manual override.

HOST="${CLAUDE_PLUGIN_OPTION_HOST:-}"

if [ -z "$HOST" ]; then
    HOST_FILE="$HOME/.skillnote/host"
    if [ -f "$HOST_FILE" ]; then
        HOST=$(cat "$HOST_FILE" 2>/dev/null | tr -d '[:space:]')
    fi
fi

echo "${HOST:-localhost}"
