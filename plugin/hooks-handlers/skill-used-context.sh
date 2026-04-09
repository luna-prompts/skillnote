#!/bin/bash
# SkillNote PostToolUse[Skill] — prompt Claude to rate the skill
# Output JSON with hookSpecificOutput.additionalContext so Claude sees it.
# Plain text stdout is shown to user only, NOT injected into Claude's context.

INPUT=$(cat)

# Extract and output as JSON — all in Python for safe string handling
echo "$INPUT" | python3 -c "
import json, sys, os, subprocess

try:
    d = json.load(sys.stdin)
except:
    sys.exit(0)

ti = d.get('tool_input', {})
name = ti.get('skill', '') or ti.get('name', '')
sid = d.get('session_id', 'unknown')

if not name:
    sys.exit(0)

short = name.replace('skillnote-', '', 1) if name.startswith('skillnote-') else name

# Resolve host
script_dir = os.path.dirname(os.path.abspath('$0'))
try:
    host_script = os.path.join(os.path.dirname(os.path.realpath(__file__ if '__file__' in dir() else '.')), 'resolve-host.sh')
except:
    host_script = None

# Try resolve-host.sh, fall back to env var, fall back to host file
host = os.environ.get('CLAUDE_PLUGIN_OPTION_HOST', '').strip()
if not host:
    hf = os.path.expanduser('~/.skillnote/host')
    if os.path.isfile(hf):
        try:
            host = open(hf).read().strip()
        except:
            pass
host = host or 'localhost'

# Read collection
project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '.')
col = ''
config = os.path.join(project_dir, '.skillnote.json')
if os.path.isfile(config):
    try:
        cols = json.load(open(config)).get('collections', [])
        if cols:
            col = cols[0]
    except:
        pass

ctx_parts = []
if col:
    ctx_parts.append(f'Used {name} from {col}.')
else:
    ctx_parts.append(f'Used {name}.')

rating_url = f'http://{host}:8082/v1/analytics/ratings'
curl_cmd = f'curl -sf -X POST {rating_url} -H \"Content-Type: application/json\" -d \'{{\"skill_slug\":\"{short}\",\"rating\":<1-5>,\"outcome\":\"<what you did>\",\"agent_name\":\"claude-code\",\"session_id\":\"{sid}\"}}\''
ctx_parts.append(f'After completing the task, rate this skill by running: {curl_cmd}')

ctx = ' '.join(ctx_parts)

print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'PostToolUse',
        'additionalContext': ctx
    }
}))
" 2>/dev/null
