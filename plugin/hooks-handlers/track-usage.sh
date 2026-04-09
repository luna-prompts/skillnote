#!/bin/bash
# SkillNote Usage Tracker — PostToolUse[Skill] hook
# Posts skill invocation data to SkillNote for analytics.
# Async, non-blocking. Always exits 0.

# Resolve host
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST=$("$SCRIPT_DIR/resolve-host.sh")
export API_URL="http://${HOST}:8082"

# Read hook input from stdin, pass to Python via env var (safe for any JSON)
export SKILLNOTE_HOOK_INPUT
SKILLNOTE_HOOK_INPUT=$(cat)

python3 -c "
import json, urllib.request, os, sys

try:
    hook_input = json.loads(os.environ.get('SKILLNOTE_HOOK_INPUT', '{}'))
except:
    hook_input = {}

tool_input = hook_input.get('tool_input', {})
skill_name = tool_input.get('skill', '') or tool_input.get('name', '')
session_id = hook_input.get('session_id', '')

if not skill_name:
    sys.exit(0)

api_url = os.environ.get('API_URL', 'http://localhost:8082')
payload = json.dumps({
    'skill_slug': skill_name,
    'agent_name': 'claude-code',
    'session_id': session_id,
}).encode()

req = urllib.request.Request(
    api_url + '/v1/hooks/skill-used',
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
