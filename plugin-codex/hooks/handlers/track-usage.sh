#!/bin/bash
# SkillNote Usage Tracker (Codex) — PostToolUse hook
# Best-effort: posts skill-invocation data to SkillNote for analytics.
# Codex's PostToolUse payload schema is not contractually documented for
# skill identity, so we probe several likely locations and no-op if none
# carry a skill name. Always exits 0; never blocks the session.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST=$("$SCRIPT_DIR/resolve-host.sh")
export API_URL="http://${HOST}:8082"

# Read hook input from stdin, pass to Python via env var (safe for any JSON)
export SKILLNOTE_HOOK_INPUT
SKILLNOTE_HOOK_INPUT=$(cat)

python3 -c "
import json, urllib.request, os, sys

try:
    h = json.loads(os.environ.get('SKILLNOTE_HOOK_INPUT', '{}'))
except Exception:
    h = {}

def first(*vals):
    for v in vals:
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ''

tool_input = h.get('tool_input', {}) if isinstance(h.get('tool_input'), dict) else {}
payload_in = h.get('payload', {}) if isinstance(h.get('payload'), dict) else {}

# Only count skill invocations. Codex names the skill tool variously across
# versions; probe the common shapes and bail if this PostToolUse wasn't a skill.
tool_name = first(h.get('tool_name'), h.get('tool'), payload_in.get('tool_name'))
skill_name = first(
    tool_input.get('skill'), tool_input.get('name'),
    payload_in.get('skill'), payload_in.get('name'),
    h.get('skill'),
)

# If the tool clearly isn't a skill and no skill name was found, skip.
if not skill_name:
    if tool_name and 'skill' not in tool_name.lower():
        sys.exit(0)
    sys.exit(0)

# Strip our sync prefix so analytics keys match the registry slug.
if skill_name.startswith('skillnote-'):
    skill_name = skill_name[len('skillnote-'):]

session_id = first(h.get('session_id'), h.get('thread_id'), payload_in.get('session_id'))

api_url = os.environ.get('API_URL', 'http://localhost:8082')
data = json.dumps({
    'skill_slug': skill_name,
    'agent_name': 'codex',
    'session_id': session_id,
}).encode()

req = urllib.request.Request(
    api_url + '/v1/hooks/skill-used',
    data=data,
    headers={'Content-Type': 'application/json'},
    method='POST',
)
try:
    urllib.request.urlopen(req, timeout=3)
except Exception:
    pass
" 2>/dev/null

exit 0
