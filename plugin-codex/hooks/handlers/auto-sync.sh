#!/bin/bash
# SkillNote Auto-Sync (Codex) — UserPromptSubmit hook
# Throttled mid-session re-sync: only runs if >60s since last sync, so a
# collection change shows up without restarting Codex. Per-project throttle.

SYNC_INTERVAL=60  # seconds between syncs

PROJECT_DIR="${PWD:-.}"
[ ! -f "$PROJECT_DIR/.skillnote.json" ] && exit 0

THROTTLE_DIR="$PROJECT_DIR/.codex/skills"
if [ -n "$PLUGIN_DATA" ]; then
    THROTTLE_DIR="$PLUGIN_DATA"
fi
LAST_SYNC_FILE="$THROTTLE_DIR/.last-sync-time"

# Check throttle
NOW=$(date +%s)
if [ -f "$LAST_SYNC_FILE" ]; then
    LAST=$(cat "$LAST_SYNC_FILE" 2>/dev/null || echo 0)
    DIFF=$((NOW - LAST))
    [ "$DIFF" -lt "$SYNC_INTERVAL" ] && exit 0
fi

# Run the full sync
if [ -n "$PLUGIN_ROOT" ]; then
    SYNC_OUTPUT=$("$PLUGIN_ROOT/hooks/handlers/sync.sh" 2>/dev/null)
    SYNC_EXIT=$?
else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    SYNC_OUTPUT=$("$SCRIPT_DIR/sync.sh" 2>/dev/null)
    SYNC_EXIT=$?
fi

# Only update timestamp if sync succeeded
if [ $SYNC_EXIT -eq 0 ]; then
    mkdir -p "$THROTTLE_DIR"
    echo "$(date +%s)" > "$LAST_SYNC_FILE"
fi

# Show output only if there were actual changes (not just "all current")
if [ -n "$SYNC_OUTPUT" ] && ! echo "$SYNC_OUTPUT" | grep -q "all current"; then
    echo "$SYNC_OUTPUT"
fi
