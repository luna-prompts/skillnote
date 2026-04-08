#!/bin/bash
# SkillNote SubagentStart — inject active skill context into subagents
# Subagents (Explore, Plan, etc.) don't know about SkillNote skills.
# This hook injects a brief context so subagents can reference skills.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
CONFIG="$PROJECT_DIR/.skillnote.json"

if [ ! -f "$CONFIG" ]; then
    exit 0
fi

COLLECTIONS=$(python3 -c "
import json
try:
    cfg = json.load(open('${CONFIG}'))
    cols = cfg.get('collections', [])
    if cols == '*' or cols == ['*']:
        print('all')
    elif cols:
        print(','.join(cols))
except:
    pass
" 2>/dev/null)

if [ -z "$COLLECTIONS" ]; then
    exit 0
fi

echo "SkillNote: this project uses the ${COLLECTIONS} skill collection. Available commands: /skillnote:collection (change), /skillnote:skill-push (create)."
