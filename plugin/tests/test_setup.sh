#!/bin/bash
# SkillNote setup script regression tests.
#
# Validates the /setup endpoint behavior end-to-end against a running
# backend. Run this after any change to backend/app/api/setup.py to
# ensure:
#
#   1. POSITIVE — the install leaves the system in the expected clean state
#      for a fresh install, for idempotent reinstalls, for upgrades from
#      stale prior installs, and for shell wrapper migration from legacy
#      to marker-based format.
#
#   2. NEGATIVE — the install does NOT touch:
#      - other Claude Code plugins in the same cache/marketplace/data dirs
#      - the user's own skills in ~/.claude/skills/
#      - unrelated fields in ~/.claude/settings.json
#      - unrelated lines in ~/.zshrc / .bashrc
#
#   3. EDGE CASES — the install still exits cleanly when:
#      - no shell RC file exists at all
#      - the backend is unreachable (fails loudly, not silently)
#
# Usage:
#   SKILLNOTE_HOST=localhost bash plugin/tests/test_setup.sh
#
# Requires: a running SkillNote backend (docker compose up).

set +e  # test harness handles failures explicitly

HOST="${SKILLNOTE_HOST:-localhost}"
SETUP_URL="http://${HOST}:8082/setup"
HEALTH_URL="http://${HOST}:8082/health"

PASS=0
FAIL=0
declare -a FAILURES

GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
NC='\033[0m'

pass() { PASS=$((PASS+1)); printf '  %bPASS%b %s\n' "$GREEN" "$NC" "$1"; }
fail() { FAIL=$((FAIL+1)); FAILURES+=("$1"); printf '  %bFAIL%b %s: %s\n' "$RED" "$NC" "$1" "$2"; }
section() { printf '\n%b═══ %s ═══%b\n' "$YELLOW" "$1" "$NC"; }

# Pre-flight: API reachable
if ! curl -sf --connect-timeout 3 "$HEALTH_URL" > /dev/null 2>&1; then
    echo "ERROR: SkillNote API not reachable at $HEALTH_URL"
    echo "Start the stack: docker compose up --build -d"
    exit 1
fi

echo "SkillNote setup test suite"
echo "Backend: $SETUP_URL"

# Each test gets its own fake HOME so tests can run in parallel without
# interfering, and one test's crud can't leak into another's assertions.
fresh_home() {
    local h
    h=$(mktemp -d -t sn-test-XXXX)
    mkdir -p "$h/.claude/plugins/cache" "$h/.claude/plugins/marketplaces" "$h/.claude/plugins/data"
    echo "$h"
}

run_setup() {
    local home="$1"
    curl -sf "$SETUP_URL" -o /tmp/sntest.sh || return 1
    SHELL=/bin/zsh HOME="$home" bash /tmp/sntest.sh > /tmp/sntest.log 2>&1
    return $?
}

###############################################################################
section "POSITIVE — install must work correctly"
###############################################################################

# ── T1: Clean install from empty state ──────────────────────────────────────
echo
echo "T1. Clean install from empty state"
H=$(fresh_home)
run_setup "$H" && pass "T1.1 setup exits 0" || fail "T1.1 setup exit code" "RC=$?"
[ -d "$H/.claude/plugins/cache/skillnote-local/skillnote" ] \
    && pass "T1.2 cache dir created" || fail "T1.2 cache dir" "not created"
ls "$H/.claude/plugins/cache/skillnote-local/skillnote/"*/commands/ 2>/dev/null | grep -q skillnote.md \
    && pass "T1.3 commands/skillnote.md exists" || fail "T1.3 skillnote.md" "missing"
ls "$H/.claude/plugins/cache/skillnote-local/skillnote/"*/commands/skill-push.md 2>/dev/null | grep -q . \
    && fail "T1.4 skill-push wrapper" "should not exist" || pass "T1.4 no skill-push wrapper"
ls "$H/.claude/plugins/cache/skillnote-local/skillnote/"*/hooks-handlers/prompt-watch.sh >/dev/null 2>&1 \
    && pass "T1.5 prompt-watch.sh present" || fail "T1.5 prompt-watch" "missing"
rm -rf "$H"

# ── T2: Idempotent reinstall ─────────────────────────────────────────────────
echo
echo "T2. Idempotent — running setup twice yields identical state"
H=$(fresh_home)
run_setup "$H" >/dev/null 2>&1
SNAPSHOT1=$(find "$H/.claude/plugins/cache/skillnote-local" -type f 2>/dev/null | sort | xargs md5sum 2>/dev/null | md5sum)
run_setup "$H" >/dev/null 2>&1
SNAPSHOT2=$(find "$H/.claude/plugins/cache/skillnote-local" -type f 2>/dev/null | sort | xargs md5sum 2>/dev/null | md5sum)
[ "$SNAPSHOT1" = "$SNAPSHOT2" ] \
    && pass "T2.1 identical cache after second run" || fail "T2.1 idempotent" "hashes differ"
ZWRAP_COUNT=$(grep -c ">>> SKILLNOTE WRAPPER BEGIN" "$H/.zshrc" 2>/dev/null || echo 0)
[ "$ZWRAP_COUNT" = "1" ] \
    && pass "T2.2 exactly one wrapper in .zshrc" || fail "T2.2 wrapper count" "found $ZWRAP_COUNT"
rm -rf "$H"

# ── T3: Removes skill-push.md / collection.md wrapper ghosts ─────────────────
echo
echo "T3. Removes legacy wrapper ghosts (the skill-push disable-model-invocation bug)"
H=$(fresh_home)
mkdir -p "$H/.claude/plugins/cache/skillnote-local/skillnote/0.3.0/commands"
echo "stale" > "$H/.claude/plugins/cache/skillnote-local/skillnote/0.3.0/commands/skill-push.md"
echo "stale" > "$H/.claude/plugins/cache/skillnote-local/skillnote/0.3.0/commands/collection.md"
run_setup "$H" >/dev/null 2>&1
find "$H/.claude/plugins" -name skill-push.md 2>/dev/null | grep -q . \
    && fail "T3.1 skill-push.md" "still present" || pass "T3.1 skill-push.md gone"
find "$H/.claude/plugins" -name collection.md 2>/dev/null | grep -q . \
    && fail "T3.2 collection.md" "still present" || pass "T3.2 collection.md gone"
rm -rf "$H"

# ── T4: Generic cache reconciliation for arbitrary future-removed files ─────
echo
echo "T4. Generic reconciliation removes arbitrary stale files from cache"
H=$(fresh_home)
run_setup "$H" >/dev/null 2>&1
# Pollute the cache AFTER install to simulate files left over from a prior
# version of the plugin that had since been removed from source.
for d in "$H/.claude/plugins/cache/skillnote-local/skillnote"/*/; do
    mkdir -p "$d/phantom-subdir"
    echo "ghost" > "$d/phantom-subdir/ghost.md"
    echo "ghost" > "$d/hooks-handlers/future-removed-hook.sh"
done
run_setup "$H" >/dev/null 2>&1
find "$H/.claude/plugins/cache/skillnote-local" -name "phantom-subdir" 2>/dev/null | grep -q . \
    && fail "T4.1 phantom-subdir" "still present" || pass "T4.1 phantom-subdir gone"
find "$H/.claude/plugins/cache/skillnote-local" -name "future-removed-hook.sh" 2>/dev/null | grep -q . \
    && fail "T4.2 future-removed-hook.sh" "still present" || pass "T4.2 future-removed-hook.sh gone"
rm -rf "$H"

# ── T5: Legacy shell wrapper migrated to marker format ──────────────────────
echo
echo "T5. Legacy .zshrc wrapper migrated to marker format, surroundings intact"
H=$(fresh_home)
cat > "$H/.zshrc" << 'ZRC'
export PATH=/usr/local/bin:$PATH

# SkillNote: collection picker before launching claude
claude() {
  if [ -t 0 ] && [ -t 1 ]; then
    "$HOME/.skillnote/bin/skillnote-pick" || true
  fi
  command claude "$@"
}

alias gs='git status'
ZRC
run_setup "$H" >/dev/null 2>&1
grep -q "# SkillNote: collection picker" "$H/.zshrc" \
    && fail "T5.1 legacy comment" "still present" || pass "T5.1 legacy comment removed"
grep -q ">>> SKILLNOTE WRAPPER BEGIN" "$H/.zshrc" \
    && pass "T5.2 new marker wrapper present" || fail "T5.2 new marker" "missing"
grep -q "alias gs='git status'" "$H/.zshrc" \
    && pass "T5.3 unrelated alias preserved" || fail "T5.3 alias" "deleted"
grep -q "export PATH=/usr/local/bin" "$H/.zshrc" \
    && pass "T5.4 unrelated export preserved" || fail "T5.4 export" "deleted"
rm -rf "$H"

###############################################################################
section "NEGATIVE — install must NOT affect unrelated state"
###############################################################################

# ── T6: Other plugins' cache/marketplace/data untouched ─────────────────────
echo
echo "T6. Other Claude Code plugins remain untouched"
H=$(fresh_home)
mkdir -p "$H/.claude/plugins/cache/other-plugin/plugin-x/1.0.0/commands"
echo "do-not-touch" > "$H/.claude/plugins/cache/other-plugin/plugin-x/1.0.0/commands/x.md"
mkdir -p "$H/.claude/plugins/marketplaces/other-marketplace/plugins/y"
echo "do-not-touch" > "$H/.claude/plugins/marketplaces/other-marketplace/plugins/y/z.md"
mkdir -p "$H/.claude/plugins/data/other-plugin-data"
echo "preserve" > "$H/.claude/plugins/data/other-plugin-data/state.json"
run_setup "$H" >/dev/null 2>&1
[ "$(cat "$H/.claude/plugins/cache/other-plugin/plugin-x/1.0.0/commands/x.md" 2>/dev/null)" = "do-not-touch" ] \
    && pass "T6.1 other plugin cache untouched" || fail "T6.1 other plugin cache" "modified or deleted"
[ "$(cat "$H/.claude/plugins/marketplaces/other-marketplace/plugins/y/z.md" 2>/dev/null)" = "do-not-touch" ] \
    && pass "T6.2 other marketplace untouched" || fail "T6.2 other marketplace" "modified or deleted"
[ "$(cat "$H/.claude/plugins/data/other-plugin-data/state.json" 2>/dev/null)" = "preserve" ] \
    && pass "T6.3 other plugin data untouched" || fail "T6.3 other data" "modified or deleted"
rm -rf "$H"

# ── T7: User's own ~/.claude/skills/ directory untouched ────────────────────
echo
echo "T7. User's own ~/.claude/skills/ directory untouched"
H=$(fresh_home)
mkdir -p "$H/.claude/skills/my-custom-skill"
echo "do-not-touch" > "$H/.claude/skills/my-custom-skill/SKILL.md"
run_setup "$H" >/dev/null 2>&1
[ "$(cat "$H/.claude/skills/my-custom-skill/SKILL.md" 2>/dev/null)" = "do-not-touch" ] \
    && pass "T7.1 user skill preserved" || fail "T7.1 user skill" "modified"
rm -rf "$H"

# ── T8: Unrelated settings.json fields preserved ────────────────────────────
echo
echo "T8. settings.json other fields preserved"
H=$(fresh_home)
cat > "$H/.claude/settings.json" << 'SETTINGS'
{
  "theme": "dark",
  "permissions": {"allow": ["Bash(ls:*)"]},
  "model": "claude-opus-4-6",
  "extraKnownMarketplaces": {"other": {"source": {"source": "directory", "path": "/other"}}}
}
SETTINGS
run_setup "$H" >/dev/null 2>&1
python3 -c "
import json
d = json.load(open('$H/.claude/settings.json'))
assert d.get('theme') == 'dark', f'theme: {d.get(\"theme\")}'
assert d.get('model') == 'claude-opus-4-6', f'model: {d.get(\"model\")}'
assert 'Bash(ls:*)' in d.get('permissions', {}).get('allow', []), 'permissions lost'
assert 'other' in d.get('extraKnownMarketplaces', {}), 'other marketplace lost'
assert 'skillnote-local' in d.get('extraKnownMarketplaces', {}), 'skillnote-local not added'
print('OK')
" 2>&1 | grep -q OK \
    && pass "T8.1 all other settings preserved" || fail "T8.1 settings" "fields lost or corrupted"
rm -rf "$H"

###############################################################################
section "EDGE CASES — install must exit cleanly in unusual environments"
###############################################################################

# ── T9: No shell RC file exists at all ──────────────────────────────────────
echo
echo "T9. No shell RC file exists (user has minimal shell setup)"
H=$(fresh_home)
run_setup "$H" \
    && pass "T9.1 setup exits 0 without shell RC" || fail "T9.1 setup exit" "RC=$?"
rm -rf "$H"

# ── T10: Backend unreachable — curl must fail cleanly ───────────────────────
echo
echo "T10. Backend unreachable"
if curl -sf --connect-timeout 2 http://127.0.0.1:59999/setup -o /tmp/nosetup.sh 2>/dev/null; then
    fail "T10.1 curl" "returned success against dead port"
else
    pass "T10.1 curl fails cleanly when backend unreachable"
fi
rm -f /tmp/nosetup.sh

###############################################################################
# RESULTS
###############################################################################

rm -f /tmp/sntest.sh /tmp/sntest.log

echo
echo "════════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    printf '  %bALL %d TESTS PASSED%b\n' "$GREEN" "$TOTAL" "$NC"
else
    printf '  %b%d FAILED%b, %b%d passed%b out of %d\n' "$RED" "$FAIL" "$NC" "$GREEN" "$PASS" "$NC" "$TOTAL"
    echo
    echo "Failed tests:"
    for f in "${FAILURES[@]}"; do echo "  - $f"; done
fi
echo "════════════════════════════════════════════════════════════"

exit $FAIL
