#!/bin/bash
# SkillNote SubagentStart — inject active skill context into subagents
# Must output JSON hookSpecificOutput for Claude to see it.

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

python3 -c "
import json
ctx = 'SkillNote: this project uses the ${COLLECTIONS} skill collection. Available commands: /skillnote:collection (change), /skillnote:skill-push (create).'
print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'SubagentStart',
        'additionalContext': ctx
    }
}))
" 2>/dev/null
