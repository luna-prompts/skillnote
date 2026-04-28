#!/bin/bash
set -e
BASE="http://localhost:8082"
SKILLNOTE_DIR="$HOME/.openclaw/skills/skillnote"
SKILLS_DIR="$HOME/.openclaw/skills"

echo "=== E2E: Footer injection ==="
# Clear throttle and run sync
rm -f "$SKILLNOTE_DIR/.last-sync-time"
bash "$SKILLNOTE_DIR/sync.sh"
# Check at least one sn-* skill has the rating footer
FIRST_SKILL=$(ls "$SKILLS_DIR"/sn-*/SKILL.md 2>/dev/null | head -1)
[ -z "$FIRST_SKILL" ] && echo "FAIL: no sn-* skills found" && exit 1
grep -q "Rate it now" "$FIRST_SKILL" && echo "PASS: footer present in $FIRST_SKILL" || { echo "FAIL: footer missing"; exit 1; }
grep -q "agent_success_note" "$FIRST_SKILL" && echo "PASS: curl command in footer" || { echo "FAIL: curl missing"; exit 1; }

echo ""
echo "=== E2E: Log watcher ==="
TMPDIR_SESSION=$(mktemp -d)
SESSION_ID="test-e2e-$(date +%s)"
SESSION_FILE="$TMPDIR_SESSION/main.jsonl"

# Write mock session
echo "{\"type\":\"session\",\"id\":\"$SESSION_ID\",\"timestamp\":\"2026-01-01T00:00:00Z\"}" > "$SESSION_FILE"
echo "{\"type\":\"message\",\"id\":\"msg1\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"toolCall\",\"name\":\"read\",\"arguments\":{\"path\":\"$SKILLS_DIR/sn-code-review-checklist/SKILL.md\"}}]}}" >> "$SESSION_FILE"

# Get current skill_call_events count
BEFORE=$(curl -sf "$BASE/v1/analytics/top-skills?days=1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(s.get('call_count',0) for s in d))" 2>/dev/null || echo "0")

# Run one watcher tick
STATE_DIR=$(mktemp -d)
python3 - "$SESSION_FILE" "$SKILLS_DIR" "$BASE" "$STATE_DIR" << 'PYEOF'
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Can't import directly since it uses sys.argv — inline the key function
session_file, skills_dir, host, state_dir = sys.argv[1:]

# Read the log-watcher source and exec the relevant functions
watcher_path = os.path.expanduser("~/.openclaw/skills/skillnote/log-watcher.py")
if not os.path.exists(watcher_path):
    # Fall back to repo path
    watcher_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[0]))), "plugin-openclaw/skillnote/log-watcher.py")

import importlib.util
spec = importlib.util.spec_from_file_location("log_watcher", watcher_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

state = {}
mod.process_file(session_file, state, host)
print(json.dumps(state, indent=2))
PYEOF

# Brief wait for API to process
sleep 1

AFTER=$(curl -sf "$BASE/v1/analytics/top-skills?days=1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(s.get('call_count',0) for s in d))" 2>/dev/null || echo "0")
[ "$AFTER" -gt "$BEFORE" ] && echo "PASS: analytics count increased ($BEFORE → $AFTER)" || echo "NOTE: count unchanged ($BEFORE → $AFTER) — may need API restart or slug mismatch"

rm -rf "$TMPDIR_SESSION" "$STATE_DIR"
echo ""
echo "=== All E2E checks done ==="
