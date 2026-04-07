#!/bin/bash
# SkillNote PostToolUse[Skill] — inject usage confirmation into Claude's context
# This runs alongside the HTTP analytics hook (both fire on PostToolUse[Skill])

INPUT=$(cat)
SKILL_NAME=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    name = d.get('tool_input', {}).get('name', '') or d.get('tool_name', '')
    if name:
        print(name)
except:
    pass
" 2>/dev/null)

# Only show for skillnote- prefixed skills (our synced skills)
if [ -n "$SKILL_NAME" ] && echo "$SKILL_NAME" | grep -q "^skillnote-"; then
    # Read collection from .skillnote.json
    PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
    COL=""
    if [ -f "$PROJECT_DIR/.skillnote.json" ]; then
        COL=$(python3 -c "
import json
try:
    c = json.load(open('${PROJECT_DIR}/.skillnote.json')).get('collections', [])
    if c: print(c[0])
except: pass
" 2>/dev/null)
    fi

    SHORT=$(echo "$SKILL_NAME" | sed 's/^skillnote-//')
    if [ -n "$COL" ]; then
        echo "Using $SKILL_NAME from $COL"
    else
        echo "Using $SKILL_NAME"
    fi
fi
