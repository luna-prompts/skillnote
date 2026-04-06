#!/bin/bash
# SkillNote Usage Tracker — PostToolUse[Skill] hook
# Posts skill invocation data to SkillNote for analytics.
# Async, non-blocking. Always exits 0.

HOST="${CLAUDE_PLUGIN_OPTION_HOST:-localhost}"
API_URL="http://${HOST}:8082"

# Read hook input from stdin
INPUT=$(cat)

python3 -c "
import json, urllib.request, os, sys

try:
    hook_input = json.loads(sys.argv[1]) if len(sys.argv) > 1 else json.loads('$INPUT' if '$INPUT' else '{}')
except:
    hook_input = {}

# Extract skill name from tool_input
tool_input = hook_input.get('tool_input', {})
skill_name = tool_input.get('name', '') or hook_input.get('tool_name', '')
session_id = hook_input.get('session_id', '')

if not skill_name:
    sys.exit(0)

payload = json.dumps({
    'skill_slug': skill_name,
    'agent_name': 'claude-code',
    'session_id': session_id,
}).encode()

req = urllib.request.Request(
    '${API_URL}/v1/hooks/skill-used',
    data=payload,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
try:
    urllib.request.urlopen(req, timeout=3)
except:
    pass
" 2>/dev/null

exit 0
