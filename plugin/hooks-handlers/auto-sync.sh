#!/bin/bash
# SkillNote Auto-Sync — UserPromptSubmit hook (async)
# Throttled background re-sync: only runs if >60s since last sync.
# If skills changed on the server, local SKILL.md files update and
# Claude Code picks them up. User never waits (async hook).

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

# Run the full sync — don't swallow output so Claude sees changes
if [ -n "$CLAUDE_PLUGIN_ROOT" ]; then
    SYNC_OUTPUT=$("$CLAUDE_PLUGIN_ROOT/hooks-handlers/sync.sh" 2>/dev/null)
    SYNC_EXIT=$?
else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    SYNC_OUTPUT=$("$SCRIPT_DIR/sync.sh" 2>/dev/null)
    SYNC_EXIT=$?
fi

# Only update timestamp if sync succeeded
if [ $SYNC_EXIT -eq 0 ]; then
    mkdir -p "$(dirname "$LAST_SYNC_FILE")"
    echo "$NOW" > "$LAST_SYNC_FILE"
fi

# Show output if there were actual changes (not just "all current")
if [ -n "$SYNC_OUTPUT" ] && ! echo "$SYNC_OUTPUT" | grep -q "all current"; then
    echo "$SYNC_OUTPUT"
fi
