#!/bin/bash
# SkillNote Plugin Test Suite
# Tests all plugin components against a live SkillNote API.
#
# Usage: SKILLNOTE_HOST=localhost bash plugin/tests/test_plugin.sh
# Requirements: SkillNote stack running (docker compose up)

set -euo pipefail

HOST="${SKILLNOTE_HOST:-localhost}"
API_URL="http://${HOST}:8082"
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_SKILLS_DIR=$(mktemp -d)
PASS=0
FAIL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { PASS=$((PASS + 1)); echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { FAIL=$((FAIL + 1)); echo -e "  ${RED}FAIL${NC} $1: $2"; }
section() { echo -e "\n${YELLOW}== $1 ==${NC}"; }

cleanup() {
    # Remove test skills from API
    for slug in e2e-plugin-test e2e-plugin-update e2e-plugin-ef e2e-plugin-empty; do
        curl -sf -X DELETE "$API_URL/v1/skills/$slug" 2>/dev/null || true
    done
    rm -rf "$TEST_SKILLS_DIR"
}
trap cleanup EXIT

# Pre-check: API reachable
if ! curl -sf --connect-timeout 3 "$API_URL/health" > /dev/null 2>&1; then
    echo "ERROR: SkillNote API not reachable at $API_URL"
    echo "Start the stack: docker compose up --build -d"
    exit 1
fi

echo "SkillNote Plugin Test Suite"
echo "API: $API_URL"
echo "Plugin: $PLUGIN_DIR"
echo ""

###############################################################################
section "1. PLUGIN STRUCTURE VALIDATION"
###############################################################################

# 1.1 Required files exist
[ -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ] && pass "plugin.json exists" || fail "plugin.json exists" "missing"
[ -f "$PLUGIN_DIR/.mcp.json" ] && pass ".mcp.json exists" || fail ".mcp.json exists" "missing"
[ -f "$PLUGIN_DIR/hooks/hooks.json" ] && pass "hooks.json exists" || fail "hooks.json exists" "missing"
[ -f "$PLUGIN_DIR/hooks-handlers/sync.sh" ] && pass "sync.sh exists" || fail "sync.sh exists" "missing"
[ -f "$PLUGIN_DIR/hooks-handlers/track-usage.sh" ] && pass "track-usage.sh exists" || fail "track-usage.sh exists" "missing"
[ -f "$PLUGIN_DIR/skills/skill-push/SKILL.md" ] && pass "skill-push SKILL.md exists" || fail "skill-push SKILL.md" "missing"
[ -f "$PLUGIN_DIR/agents/skill-creator.md" ] && pass "skill-creator agent exists" || fail "skill-creator agent" "missing"
[ -f "$PLUGIN_DIR/bin/skillnote-sync" ] && pass "bin/skillnote-sync exists" || fail "bin/skillnote-sync" "missing"
[ -f "$PLUGIN_DIR/README.md" ] && pass "README.md exists" || fail "README.md" "missing"

# 1.2 Scripts are executable
[ -x "$PLUGIN_DIR/hooks-handlers/sync.sh" ] && pass "sync.sh is executable" || fail "sync.sh executable" "not executable"
[ -x "$PLUGIN_DIR/hooks-handlers/track-usage.sh" ] && pass "track-usage.sh is executable" || fail "track-usage.sh executable" "not executable"
[ -x "$PLUGIN_DIR/bin/skillnote-sync" ] && pass "skillnote-sync is executable" || fail "skillnote-sync executable" "not executable"

###############################################################################
section "2. PLUGIN.JSON VALIDATION"
###############################################################################

PJ="$PLUGIN_DIR/.claude-plugin/plugin.json"

# 2.1 Valid JSON
python3 -c "import json; json.load(open('$PJ'))" 2>/dev/null && pass "plugin.json is valid JSON" || fail "plugin.json JSON" "invalid"

# 2.2 Required fields
python3 -c "
import json, sys
d = json.load(open('$PJ'))
errs = []
if d.get('name') != 'skillnote': errs.append('name != skillnote')
if 'version' not in d: errs.append('missing version')
if 'description' not in d: errs.append('missing description')
if 'userConfig' not in d: errs.append('missing userConfig')
if 'host' not in d.get('userConfig', {}): errs.append('missing userConfig.host')
if errs:
    print('|'.join(errs))
    sys.exit(1)
" 2>/dev/null && pass "plugin.json has required fields" || fail "plugin.json fields" "$(python3 -c "import json; d=json.load(open('$PJ')); print(d.get('name','?'))" 2>/dev/null)"

# 2.3 userConfig.host is not sensitive
python3 -c "
import json, sys
d = json.load(open('$PJ'))
if d.get('userConfig', {}).get('host', {}).get('sensitive', False):
    sys.exit(1)
" 2>/dev/null && pass "userConfig.host is not sensitive" || fail "userConfig.host sensitive" "should be false"

###############################################################################
section "3. HOOKS.JSON VALIDATION"
###############################################################################

HJ="$PLUGIN_DIR/hooks/hooks.json"

# 3.1 Valid JSON
python3 -c "import json; json.load(open('$HJ'))" 2>/dev/null && pass "hooks.json is valid JSON" || fail "hooks.json JSON" "invalid"

# 3.2 Has SessionStart hook
python3 -c "
import json, sys
d = json.load(open('$HJ'))
hooks = d.get('hooks', {})
if 'SessionStart' not in hooks: sys.exit(1)
ss = hooks['SessionStart']
if not ss or 'hooks' not in ss[0]: sys.exit(1)
h = ss[0]['hooks'][0]
if h.get('type') != 'command': sys.exit(1)
if 'sync.sh' not in h.get('command', ''): sys.exit(1)
" 2>/dev/null && pass "SessionStart hook configured (sync.sh)" || fail "SessionStart hook" "missing or wrong"

# 3.3 Has PostToolUse[Skill] hook
python3 -c "
import json, sys
d = json.load(open('$HJ'))
hooks = d.get('hooks', {})
if 'PostToolUse' not in hooks: sys.exit(1)
ptu = hooks['PostToolUse']
if not ptu or ptu[0].get('matcher') != 'Skill': sys.exit(1)
h = ptu[0]['hooks'][0]
if h.get('type') != 'command': sys.exit(1)
if 'track-usage.sh' not in h.get('command', ''): sys.exit(1)
if h.get('async') is not True: sys.exit(1)
" 2>/dev/null && pass "PostToolUse[Skill] hook configured (async)" || fail "PostToolUse hook" "missing or wrong"

# 3.4 SessionStart has statusMessage
python3 -c "
import json, sys
d = json.load(open('$HJ'))
h = d['hooks']['SessionStart'][0]['hooks'][0]
if 'statusMessage' not in h: sys.exit(1)
" 2>/dev/null && pass "SessionStart has statusMessage" || fail "statusMessage" "missing"

# 3.5 SessionStart has timeout
python3 -c "
import json, sys
d = json.load(open('$HJ'))
h = d['hooks']['SessionStart'][0]['hooks'][0]
if h.get('timeout', 0) < 5: sys.exit(1)
" 2>/dev/null && pass "SessionStart has timeout >= 5s" || fail "timeout" "too low or missing"

###############################################################################
section "4. MCP.JSON VALIDATION"
###############################################################################

MJ="$PLUGIN_DIR/.mcp.json"

# 4.1 Valid JSON
python3 -c "import json; json.load(open('$MJ'))" 2>/dev/null && pass ".mcp.json is valid JSON" || fail ".mcp.json JSON" "invalid"

# 4.2 Has skillnote server
python3 -c "
import json, sys
d = json.load(open('$MJ'))
sn = d.get('mcpServers', {}).get('skillnote', {})
if 'url' not in sn: sys.exit(1)
if 'CLAUDE_PLUGIN_OPTION_HOST' not in sn['url']: sys.exit(1)
if ':8083/mcp' not in sn['url']: sys.exit(1)
" 2>/dev/null && pass ".mcp.json has skillnote server with host variable" || fail ".mcp.json server" "missing or wrong URL"

###############################################################################
section "5. SKILL-PUSH SKILL.MD VALIDATION"
###############################################################################

SP="$PLUGIN_DIR/skills/skill-push/SKILL.md"

# 5.1 Has frontmatter
head -1 "$SP" | grep -q "^---$" && pass "skill-push has frontmatter start" || fail "frontmatter" "missing ---"

# 5.2 Has name field
grep -q "^name: skill-push$" "$SP" && pass "name: skill-push" || fail "name field" "wrong or missing"

# 5.3 Has description
grep -q "^description:" "$SP" && pass "has description field" || fail "description" "missing"

# 5.4 Description under 250 chars (for MCP activation)
DESC_LEN=$(grep "^description:" "$SP" | head -1 | sed 's/^description: //' | wc -c)
[ "$DESC_LEN" -lt 260 ] && pass "description under 260 chars ($DESC_LEN)" || fail "description length" "$DESC_LEN chars"

# 5.5 References CLAUDE_PLUGIN_OPTION_HOST (not {{API_URL}})
grep -q "CLAUDE_PLUGIN_OPTION_HOST" "$SP" && pass "uses env var for API URL" || fail "API URL" "should use CLAUDE_PLUGIN_OPTION_HOST"

# 5.6 Does NOT contain raw {{API_URL}} (that's for MCP-served version)
! grep -q '{{API_URL}}' "$SP" && pass "no raw {{API_URL}} placeholders" || fail "placeholder" "found {{API_URL}} in local skill"

# 5.7 Has all 6 steps
for step in "Step 1" "Step 2" "Step 3" "Step 4" "Step 5" "Step 6"; do
    grep -q "$step" "$SP" && pass "has $step" || fail "$step" "missing"
done

# 5.8 Uses Python urllib (not curl)
grep -q "urllib.request" "$SP" && pass "uses Python urllib (not curl)" || fail "urllib" "should use urllib, not curl"

###############################################################################
section "6. SKILL-CREATOR AGENT VALIDATION"
###############################################################################

SC="$PLUGIN_DIR/agents/skill-creator.md"

# 6.1 Has frontmatter with required fields
python3 -c "
import sys
content = open('$SC').read()
# Simple YAML frontmatter check
if not content.startswith('---'):
    sys.exit(1)
fm = content.split('---')[1]
required = ['name:', 'description:', 'model:', 'effort:', 'tools:']
for r in required:
    if r not in fm:
        print(f'missing {r}')
        sys.exit(1)
" 2>/dev/null && pass "skill-creator has all required frontmatter" || fail "agent frontmatter" "missing fields"

# 6.2 Has effort: high
grep -q "effort: high" "$SC" && pass "effort: high set" || fail "effort" "not high"

# 6.3 Lists required tools
for tool in Read Write Bash Grep Glob; do
    grep -q "$tool" "$SC" && pass "agent has $tool tool" || fail "agent tool" "missing $tool"
done

###############################################################################
section "7. SYNC.SH FUNCTIONAL TESTS"
###############################################################################

export CLAUDE_PLUGIN_OPTION_HOST="$HOST"
export CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR"
SYNC="$PLUGIN_DIR/hooks-handlers/sync.sh"

# 7.1 Create test skill in registry
curl -sf -X POST "$API_URL/v1/skills" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-plugin-test","slug":"e2e-plugin-test","description":"Plugin test skill","content_md":"# Test\nContent.","collections":["test-col"]}' > /dev/null

# 7.2 Fresh sync — creates skills
rm -rf "$TEST_SKILLS_DIR"/*
rm -f "$TEST_SKILLS_DIR/.skillnote-manifest.json"
export SKILLS_DIR_OVERRIDE="$TEST_SKILLS_DIR"
# Override SKILLS_DIR by temporarily modifying HOME
ORIG_HOME="$HOME"
export HOME="$TEST_SKILLS_DIR/fakehome"
mkdir -p "$HOME/.claude/skills"
SKILLS_DIR="$HOME/.claude/skills"

OUTPUT=$(bash "$SYNC" 2>/dev/null)
echo "$OUTPUT" | grep -q "new" && pass "fresh sync creates skills" || fail "fresh sync" "no 'new' in output: $OUTPUT"

# 7.3 Skill files created
[ -f "$SKILLS_DIR/e2e-plugin-test/SKILL.md" ] && pass "test skill SKILL.md created" || fail "skill file" "not created"

# 7.4 SKILL.md has correct frontmatter
grep -q "name: e2e-plugin-test" "$SKILLS_DIR/e2e-plugin-test/SKILL.md" && pass "SKILL.md has correct name" || fail "SKILL.md name" "wrong"
grep -q "description: Plugin test skill" "$SKILLS_DIR/e2e-plugin-test/SKILL.md" && pass "SKILL.md has correct description" || fail "SKILL.md desc" "wrong"
grep -q "collections: \[test-col\]" "$SKILLS_DIR/e2e-plugin-test/SKILL.md" && pass "SKILL.md has collections" || fail "SKILL.md collections" "missing"

# 7.5 SKILL.md has content body
grep -q "# Test" "$SKILLS_DIR/e2e-plugin-test/SKILL.md" && pass "SKILL.md has content body" || fail "SKILL.md body" "missing"

# 7.6 Manifest created
[ -f "$SKILLS_DIR/.skillnote-manifest.json" ] && pass "manifest created" || fail "manifest" "not created"

# 7.7 Manifest contains test skill
python3 -c "
import json, sys
m = json.load(open('$SKILLS_DIR/.skillnote-manifest.json'))
if 'e2e-plugin-test' not in m.get('skills', []):
    sys.exit(1)
" 2>/dev/null && pass "manifest lists test skill" || fail "manifest content" "test skill not listed"

# 7.8 Idempotent re-sync
OUTPUT=$(bash "$SYNC" 2>/dev/null)
echo "$OUTPUT" | grep -q "all current" && pass "re-sync is idempotent" || fail "idempotent" "expected 'all current': $OUTPUT"

# 7.9 Update detection
curl -sf -X PATCH "$API_URL/v1/skills/e2e-plugin-test" \
  -H "Content-Type: application/json" \
  -d '{"content_md":"# Updated\nNew content."}' > /dev/null

OUTPUT=$(bash "$SYNC" 2>/dev/null)
echo "$OUTPUT" | grep -q "updated" && pass "detects updates" || fail "update detection" "expected 'updated': $OUTPUT"
grep -q "# Updated" "$SKILLS_DIR/e2e-plugin-test/SKILL.md" && pass "local file updated" || fail "local update" "content not changed"

# 7.10 Delete detection
curl -sf -X DELETE "$API_URL/v1/skills/e2e-plugin-test"
OUTPUT=$(bash "$SYNC" 2>/dev/null)
echo "$OUTPUT" | grep -q "removed" && pass "detects deletes" || fail "delete detection" "expected 'removed': $OUTPUT"
[ ! -d "$SKILLS_DIR/e2e-plugin-test" ] && pass "local dir removed" || fail "local delete" "dir still exists"

# 7.11 User skills not touched (not in manifest)
mkdir -p "$SKILLS_DIR/my-custom-skill"
echo "# My Custom" > "$SKILLS_DIR/my-custom-skill/SKILL.md"
bash "$SYNC" 2>/dev/null
[ -f "$SKILLS_DIR/my-custom-skill/SKILL.md" ] && pass "user skills preserved" || fail "user skills" "custom skill deleted!"
rm -rf "$SKILLS_DIR/my-custom-skill"

# 7.12 extra_frontmatter in synced SKILL.md
curl -sf -X POST "$API_URL/v1/skills" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-plugin-ef","slug":"e2e-plugin-ef","description":"EF test","content_md":"# EF","collections":["testing"],"extra_frontmatter":"allowed-tools: Read Write\neffort: high"}' > /dev/null
rm -f "$SKILLS_DIR/.skillnote-manifest.json"
bash "$SYNC" 2>/dev/null
grep -q "allowed-tools: Read Write" "$SKILLS_DIR/e2e-plugin-ef/SKILL.md" && pass "extra_frontmatter in local SKILL.md" || fail "extra_frontmatter" "not in SKILL.md"
grep -q "effort: high" "$SKILLS_DIR/e2e-plugin-ef/SKILL.md" && pass "effort: high in local SKILL.md" || fail "effort frontmatter" "not in SKILL.md"
curl -sf -X DELETE "$API_URL/v1/skills/e2e-plugin-ef" > /dev/null

# 7.13 Empty content_md skill
curl -sf -X POST "$API_URL/v1/skills" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-plugin-empty","slug":"e2e-plugin-empty","description":"Empty test","content_md":"","collections":["testing"]}' > /dev/null
rm -f "$SKILLS_DIR/.skillnote-manifest.json"
bash "$SYNC" 2>/dev/null
[ -f "$SKILLS_DIR/e2e-plugin-empty/SKILL.md" ] && pass "empty content skill synced" || fail "empty content" "not synced"
curl -sf -X DELETE "$API_URL/v1/skills/e2e-plugin-empty" > /dev/null

# Restore HOME
export HOME="$ORIG_HOME"

###############################################################################
section "8. SYNC.SH OFFLINE & TIMEOUT TESTS"
###############################################################################

# 8.1 Offline — unreachable host
export HOME="$TEST_SKILLS_DIR/fakehome"
TIME_START=$(date +%s)
CLAUDE_PLUGIN_OPTION_HOST=192.168.99.99 bash "$SYNC" 2>/dev/null
RC=$?
TIME_END=$(date +%s)
ELAPSED=$((TIME_END - TIME_START))

[ "$RC" -eq 0 ] && pass "offline exits 0 (graceful)" || fail "offline exit" "code $RC"
[ "$ELAPSED" -lt 15 ] && pass "offline completes in <15s (was ${ELAPSED}s)" || fail "offline timeout" "${ELAPSED}s too slow"
export HOME="$ORIG_HOME"

###############################################################################
section "9. SYNC.SH PROJECT SCOPING"
###############################################################################

PROJECT_DIR=$(mktemp -d)

# 9.1 .skillnote.json with specific collection
curl -sf -X POST "$API_URL/v1/skills" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-plugin-update","slug":"e2e-plugin-update","description":"Scoped test","content_md":"# Scoped","collections":["scope-test"]}' > /dev/null

echo '{"collections": ["scope-test"]}' > "$PROJECT_DIR/.skillnote.json"
mkdir -p "$PROJECT_DIR/.claude/skills"
export CLAUDE_PROJECT_DIR="$PROJECT_DIR"

bash "$SYNC" 2>/dev/null
SCOPED_COUNT=$(ls "$PROJECT_DIR/.claude/skills/" 2>/dev/null | wc -l)
# Should have exactly 1 skill (the one in scope-test collection)
[ "$SCOPED_COUNT" -eq 1 ] && pass "project scoping filters correctly ($SCOPED_COUNT)" || fail "project scoping" "expected 1, got $SCOPED_COUNT"
[ -d "$PROJECT_DIR/.claude/skills/e2e-plugin-update" ] && pass "scoped skill present" || fail "scoped skill" "missing"

# 9.2 .skillnote.json with empty collections = opt out
echo '{"collections": []}' > "$PROJECT_DIR/.skillnote.json"
rm -rf "$PROJECT_DIR/.claude/skills/"*
bash "$SYNC" 2>/dev/null
OPT_OUT_COUNT=$(ls "$PROJECT_DIR/.claude/skills/" 2>/dev/null | wc -l)
[ "$OPT_OUT_COUNT" -eq 0 ] && pass "empty collections = opt out (0 skills)" || fail "opt out" "expected 0, got $OPT_OUT_COUNT"

# 9.3 .skillnote.json with wildcard = all skills
echo '{"collections": "*"}' > "$PROJECT_DIR/.skillnote.json"
bash "$SYNC" 2>/dev/null
WILD_COUNT=$(ls "$PROJECT_DIR/.claude/skills/" 2>/dev/null | wc -l)
[ "$WILD_COUNT" -gt 1 ] && pass "wildcard = all skills ($WILD_COUNT)" || fail "wildcard" "expected >1, got $WILD_COUNT"

unset CLAUDE_PROJECT_DIR
curl -sf -X DELETE "$API_URL/v1/skills/e2e-plugin-update" > /dev/null
rm -rf "$PROJECT_DIR"

###############################################################################
section "10. TRACK-USAGE.SH TESTS"
###############################################################################

TRACK="$PLUGIN_DIR/hooks-handlers/track-usage.sh"
export CLAUDE_PLUGIN_OPTION_HOST="$HOST"

# 10.1 Valid skill usage event
echo '{"tool_name":"Skill","tool_input":{"name":"skill-creator"},"session_id":"test-plugin-001"}' | bash "$TRACK" 2>/dev/null
RC=$?
[ "$RC" -eq 0 ] && pass "track-usage exits 0 on valid input" || fail "track exit" "code $RC"

# 10.2 Event recorded in DB
CALL_COUNT=$(curl -sf "$API_URL/v1/analytics/skill-calls?days=1" | python3 -c "
import json,sys
for s in json.load(sys.stdin):
    if s.get('slug')=='skill-creator':
        print(s['call_count'])
        sys.exit(0)
print(0)
" 2>/dev/null)
[ "$CALL_COUNT" -gt 0 ] && pass "usage event recorded (count=$CALL_COUNT)" || fail "usage recording" "count=0"

# 10.3 Empty input — graceful
echo '{}' | bash "$TRACK" 2>/dev/null
RC=$?
[ "$RC" -eq 0 ] && pass "track-usage exits 0 on empty input" || fail "empty input" "code $RC"

# 10.4 Malformed JSON — graceful
echo 'not json' | bash "$TRACK" 2>/dev/null
RC=$?
[ "$RC" -eq 0 ] && pass "track-usage exits 0 on malformed input" || fail "malformed input" "code $RC"

# 10.5 Offline — graceful
CLAUDE_PLUGIN_OPTION_HOST=192.168.99.99 echo '{"tool_name":"Skill","tool_input":{"name":"test"},"session_id":"x"}' | timeout 10 bash "$TRACK" 2>/dev/null
RC=$?
[ "$RC" -eq 0 ] && pass "track-usage exits 0 when offline" || fail "offline track" "code $RC"

###############################################################################
section "11. BIN/SKILLNOTE-SYNC TESTS"
###############################################################################

BIN="$PLUGIN_DIR/bin/skillnote-sync"

# 11.1 Runs successfully
export CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR"
export CLAUDE_PLUGIN_OPTION_HOST="$HOST"
export HOME="$TEST_SKILLS_DIR/fakehome2"
mkdir -p "$HOME/.claude/skills"

OUTPUT=$(bash "$BIN" 2>/dev/null)
[ $? -eq 0 ] && pass "bin/skillnote-sync runs" || fail "bin run" "non-zero exit"
echo "$OUTPUT" | grep -q "SkillNote:" && pass "bin produces sync output" || fail "bin output" "no SkillNote: line"

# 11.2 --force clears manifest and re-syncs
bash "$BIN" 2>/dev/null  # First run
OUTPUT=$(bash "$BIN" --force 2>/dev/null)
echo "$OUTPUT" | grep -q "new\|updated" && pass "bin --force triggers re-sync" || fail "bin --force" "expected new/updated: $OUTPUT"

export HOME="$ORIG_HOME"

###############################################################################
section "12. AUTO-SYNC (BACKGROUND RE-SYNC)"
###############################################################################

export CLAUDE_PLUGIN_OPTION_HOST="$HOST"
export CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR"
AUTOSYNC="$PLUGIN_DIR/hooks-handlers/auto-sync.sh"
AS_DATA=$(mktemp -d)
export CLAUDE_PLUGIN_DATA="$AS_DATA"

# 12.1 auto-sync.sh exists and is executable
[ -f "$AUTOSYNC" ] && pass "auto-sync.sh exists" || fail "auto-sync.sh" "missing"
[ -x "$AUTOSYNC" ] && pass "auto-sync.sh is executable" || fail "auto-sync.sh" "not executable"

# 12.2 hooks.json has UserPromptSubmit hook
python3 -c "
import json, sys
d = json.load(open('$PLUGIN_DIR/hooks/hooks.json'))
if 'UserPromptSubmit' not in d.get('hooks', {}): sys.exit(1)
h = d['hooks']['UserPromptSubmit'][0]['hooks'][0]
if h.get('async') is not True: sys.exit(1)
if 'auto-sync' not in h.get('command', ''): sys.exit(1)
" 2>/dev/null && pass "UserPromptSubmit hook (async, auto-sync)" || fail "UPS hook" "missing or wrong"

# 12.3 SessionStart matcher includes compact
python3 -c "
import json, sys
d = json.load(open('$PLUGIN_DIR/hooks/hooks.json'))
m = d['hooks']['SessionStart'][0].get('matcher', '')
if 'compact' not in m: sys.exit(1)
" 2>/dev/null && pass "SessionStart matcher includes compact" || fail "matcher" "missing compact"

# 12.4 First run creates timestamp
rm -f "$AS_DATA/.last-sync-time"
bash "$AUTOSYNC" 2>/dev/null
[ -f "$AS_DATA/.last-sync-time" ] && pass "auto-sync creates timestamp" || fail "timestamp" "not created"

# 12.5 Throttled — second run within interval is a no-op
TS_BEFORE=$(cat "$AS_DATA/.last-sync-time")
bash "$AUTOSYNC" 2>/dev/null
TS_AFTER=$(cat "$AS_DATA/.last-sync-time")
[ "$TS_BEFORE" = "$TS_AFTER" ] && pass "throttled (same timestamp)" || fail "throttle" "timestamp changed"

# 12.6 Expired timestamp triggers sync
echo "0" > "$AS_DATA/.last-sync-time"
bash "$AUTOSYNC" 2>/dev/null
TS_NEW=$(cat "$AS_DATA/.last-sync-time")
[ "$TS_NEW" != "0" ] && pass "expired timestamp triggers sync" || fail "expired" "timestamp still 0"

# 12.7 Mid-session skill create picked up
curl -sf -X POST "$API_URL/v1/skills" \
  -H "Content-Type: application/json" \
  -d '{"name":"autosync-test","slug":"autosync-test","description":"Auto-sync test","content_md":"# Auto","collections":["testing"]}' > /dev/null
export HOME="$TEST_SKILLS_DIR/fakehome3"
mkdir -p "$HOME/.claude/skills"
SKILLS_DIR="$HOME/.claude/skills"
rm -f "$SKILLS_DIR/.skillnote-manifest.json"
bash "$PLUGIN_DIR/hooks-handlers/sync.sh" 2>/dev/null  # baseline
echo "0" > "$AS_DATA/.last-sync-time"
curl -sf -X PATCH "$API_URL/v1/skills/autosync-test" \
  -H "Content-Type: application/json" \
  -d '{"content_md":"# Auto Updated"}' > /dev/null
bash "$AUTOSYNC" 2>/dev/null
grep -q "Auto Updated" "$SKILLS_DIR/autosync-test/SKILL.md" 2>/dev/null && pass "mid-session update detected" || fail "mid-session update" "content not updated"

# 12.8 Mid-session delete picked up
curl -sf -X DELETE "$API_URL/v1/skills/autosync-test" > /dev/null
echo "0" > "$AS_DATA/.last-sync-time"
bash "$AUTOSYNC" 2>/dev/null
[ ! -d "$SKILLS_DIR/autosync-test" ] && pass "mid-session delete detected" || fail "mid-session delete" "still exists"

# 12.9 Offline — graceful
echo "0" > "$AS_DATA/.last-sync-time"
CLAUDE_PLUGIN_OPTION_HOST=192.168.99.99 bash "$AUTOSYNC" 2>/dev/null
RC=$?
[ "$RC" -eq 0 ] && pass "auto-sync offline exits 0" || fail "offline" "exit $RC"

# 12.10 Fallback when CLAUDE_PLUGIN_DATA is unset
SAVED_PD="$CLAUDE_PLUGIN_DATA"
unset CLAUDE_PLUGIN_DATA
rm -f "$SKILLS_DIR/.last-sync-time"
bash "$AUTOSYNC" 2>/dev/null
[ -f "$SKILLS_DIR/.last-sync-time" ] && pass "fallback path (no PLUGIN_DATA)" || fail "fallback" "no timestamp"
rm -f "$SKILLS_DIR/.last-sync-time"
export CLAUDE_PLUGIN_DATA="$SAVED_PD"

export HOME="$ORIG_HOME"
rm -rf "$AS_DATA"

###############################################################################
# RESULTS
###############################################################################

echo ""
echo "=========================================="
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}ALL $TOTAL TESTS PASSED${NC}"
else
    echo -e "${RED}$FAIL FAILED${NC}, ${GREEN}$PASS passed${NC} out of $TOTAL"
fi
echo "=========================================="

exit $FAIL
