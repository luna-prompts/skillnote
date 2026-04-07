#!/bin/bash
# SkillNote PostCompact — re-inject skill context after compaction
# When context compacts, Claude may lose awareness of active skills.
# This hook re-injects a summary so skills keep working in long sessions.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
CONFIG="$PROJECT_DIR/.skillnote.json"

# Resolve host
HOST="${CLAUDE_PLUGIN_OPTION_HOST:-}"
if [ -z "$HOST" ] && [ -f "$HOME/.skillnote/host" ]; then
    HOST=$(cat "$HOME/.skillnote/host" 2>/dev/null)
fi
HOST="${HOST:-localhost}"
API_URL="http://${HOST}:8082"

# Read active collections
if [ ! -f "$CONFIG" ]; then
    exit 0
fi

COLLECTIONS=$(python3 -c "
import json, sys
try:
    cfg = json.load(open('${CONFIG}'))
    cols = cfg.get('collections', [])
    if cols:
        print(','.join(cols))
except:
    pass
" 2>/dev/null)

if [ -z "$COLLECTIONS" ]; then
    exit 0
fi

# Fetch skill names for the active collection
SKILLS=$(curl -sf --connect-timeout 3 --max-time 5 "${API_URL}/v1/skills?collections=${COLLECTIONS}" 2>/dev/null | python3 -c "
import json, sys
try:
    skills = json.load(sys.stdin)
    names = [s['slug'] for s in skills]
    print(', '.join(names))
except:
    pass
" 2>/dev/null)

if [ -n "$SKILLS" ]; then
    echo "SkillNote: active collection is ${COLLECTIONS} with skills: ${SKILLS}. Use /skillnote:collection to change."
fi
