#!/bin/bash
# SkillNote PostToolUse[Skill] — confirm usage + prompt agent to rate
# Async — does not block. Output goes to Claude as additionalContext.

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

# Only for skillnote- prefixed skills
if [ -n "$SKILL_NAME" ] && echo "$SKILL_NAME" | grep -q "^skillnote-"; then
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
        echo "Using $SKILL_NAME from $COL."
    else
        echo "Using $SKILL_NAME."
    fi
    RATING_HOST=$("$(cd "$(dirname "$0")" && pwd)/resolve-host.sh")
    echo "After completing the task, rate this skill by running: curl -sf -X POST http://${RATING_HOST}:8082/v1/analytics/ratings -H 'Content-Type: application/json' -d '{\"skill_slug\":\"$SHORT\",\"rating\":<1-5>,\"outcome\":\"<what you did>\",\"agent_name\":\"claude-code\",\"session_id\":\"'\"$CLAUDE_SESSION_ID\"'\"}'"
fi
