#!/bin/bash
# SkillNote Auto-Sync (Codex) — UserPromptSubmit hook
# Throttled mid-session re-sync: only runs if >60s since the last SUCCESSFUL
# online sync, so a collection change shows up without restarting Codex.
# Throttle is PER-PROJECT (lives in the project's .codex/skills). sync.sh takes
# its own per-project lock, so overlap is safe.
#
# Codex hook contract (0.142.x): any exit code other than 0 renders as a FAILED
# hook in the TUI (exit 2 would even block the user's prompt), and plain
# non-JSON stdout at exit 0 is injected into the model context verbatim. So
# this hook always exits 0 and only ever prints a well-formed hook JSON object
# carrying a clean additionalContext line when skills actually changed.

SYNC_INTERVAL=60  # seconds between syncs

PROJECT_DIR="${PWD:-.}"
[ -f "$PROJECT_DIR/.skillnote.json" ] || exit 0

THROTTLE_DIR="$PROJECT_DIR/.codex/skills"
LAST_SYNC_FILE="$THROTTLE_DIR/.last-sync-time"

NOW=$(date +%s)
if [ -f "$LAST_SYNC_FILE" ]; then
    LAST=$(cat "$LAST_SYNC_FILE" 2>/dev/null || echo 0)
    case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac
    # A stamp in the future means the clock was stepped back (DST, NTP
    # correction, VM resume). Treat it as "never synced" rather than
    # suppressing every auto-sync until wall-clock catches up.
    [ "$LAST" -gt "$NOW" ] && LAST=0
    [ "$((NOW - LAST))" -lt "$SYNC_INTERVAL" ] && exit 0
fi

if [ -n "$PLUGIN_ROOT" ]; then
    SYNC_SH="$PLUGIN_ROOT/hooks/handlers/sync.sh"
else
    SYNC_SH="$(cd "$(dirname "$0")" && pwd)/sync.sh"
fi

# SKILLNOTE_CALLER puts sync.sh in programmatic mode: plain one-line summary on
# stdout when something changed, exit 3 when offline. Status notices go to
# stderr, so control flow here never scrapes user-controlled content (a
# collection named "offline" is safe).
SYNC_OUTPUT=$(SKILLNOTE_CALLER=auto-sync "$SYNC_SH" </dev/null 2>/dev/null)
SYNC_EXIT=$?

# Advance the throttle only on a successful online sync (exit 0). Offline
# (exit 3) leaves the timestamp so the next prompt retries promptly.
if [ "$SYNC_EXIT" -eq 0 ]; then
    mkdir -p "$THROTTLE_DIR" 2>/dev/null
    printf '%s' "$NOW" > "$LAST_SYNC_FILE" 2>/dev/null
    if [ -n "$SYNC_OUTPUT" ]; then
        # Defense in depth: the summary is built from validated slugs and fixed
        # ASCII, but whitelist printable ASCII (minus " and \) anyway — a stray
        # control byte or a head-cut multibyte tail would otherwise make the
        # JSON unparseable, which Codex renders as a failed hook.
        SAFE=$(printf '%s' "$SYNC_OUTPUT" | head -c 600 | LC_ALL=C tr -cd '\40-\176' | tr -d '"\\')
        printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$SAFE"
    fi
fi

exit 0
