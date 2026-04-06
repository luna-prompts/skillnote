#!/bin/bash
# SkillNote Auto-Sync — UserPromptSubmit hook (async)
# Throttled background re-sync: only runs if >60s since last sync.
# If skills changed on the server, local SKILL.md files update and
# Claude Code hot-reloads them mid-session. User never waits.

SYNC_INTERVAL=60  # seconds between syncs

# Determine where to store the timestamp
if [ -n "$CLAUDE_PLUGIN_DATA" ]; then
    LAST_SYNC_FILE="$CLAUDE_PLUGIN_DATA/.last-sync-time"
else
    LAST_SYNC_FILE="$HOME/.claude/skills/.last-sync-time"
fi

# Check throttle
NOW=$(date +%s)
if [ -f "$LAST_SYNC_FILE" ]; then
    LAST=$(cat "$LAST_SYNC_FILE" 2>/dev/null || echo 0)
    DIFF=$((NOW - LAST))
    [ "$DIFF" -lt "$SYNC_INTERVAL" ] && exit 0
fi

# Run the full sync (reuses the same script as SessionStart)
if [ -n "$CLAUDE_PLUGIN_ROOT" ]; then
    "$CLAUDE_PLUGIN_ROOT/hooks-handlers/sync.sh" > /dev/null 2>&1
else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    "$SCRIPT_DIR/sync.sh" > /dev/null 2>&1
fi

# Update timestamp
mkdir -p "$(dirname "$LAST_SYNC_FILE")"
echo "$NOW" > "$LAST_SYNC_FILE"
