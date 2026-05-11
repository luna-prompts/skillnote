#!/bin/bash
# SkillNote Sync for OpenClaw
# 1. Skills sync  — every 60s: fetch all skills → write sn-{slug}/SKILL.md
# 2. Self-update  — every 24h: compare versions → auto-install if newer

export PYTHONIOENCODING=utf-8

SYNC_INTERVAL=60
UPDATE_INTERVAL=86400  # 24 hours

SKILLNOTE_DIR="$HOME/.openclaw/skills/skillnote"
CONFIG="$SKILLNOTE_DIR/config.json"

[ ! -f "$CONFIG" ] && exit 0

HOST=$(python3 -c "
import json
try:
    cfg = json.load(open('$CONFIG'))
    print(cfg.get('host','').rstrip('/'))
except Exception:
    pass
" 2>/dev/null)

[ -z "$HOST" ] && exit 0

NOW=$(date +%s)

# ── Self-update check (daily) ─────────────────────────────────────────────────

VERSION_CHECK_FILE="$SKILLNOTE_DIR/.last-version-check"
VERSION_FILE="$SKILLNOTE_DIR/VERSION"

_due_for_update=1
if [ -f "$VERSION_CHECK_FILE" ]; then
    LAST_CHECK=$(cat "$VERSION_CHECK_FILE" 2>/dev/null || echo 0)
    [ $(( NOW - LAST_CHECK )) -lt $UPDATE_INTERVAL ] && _due_for_update=0
fi

if [ "$_due_for_update" -eq 1 ]; then
    REMOTE=$(curl -sf --connect-timeout 5 --max-time 10 "$HOST/v1/openclaw-skill" 2>/dev/null)
    if [ -n "$REMOTE" ]; then
        REMOTE_VER=$(python3 -c "import json,sys; print(json.loads('$REMOTE'.replace(\"'\",\"'\")).get('version',''))" 2>/dev/null || \
                     echo "$REMOTE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version',''))" 2>/dev/null)
        LOCAL_VER=""
        [ -f "$VERSION_FILE" ] && LOCAL_VER=$(cat "$VERSION_FILE" 2>/dev/null | tr -d '[:space:]')

        if [ -n "$REMOTE_VER" ] && [ "$REMOTE_VER" != "$LOCAL_VER" ]; then
            # Version mismatch — install latest
            if command -v clawhub >/dev/null 2>&1; then
                clawhub install "skillnote@$REMOTE_VER" --yes >/dev/null 2>&1 && \
                    echo "SkillNote updated to v$REMOTE_VER — restart your session to apply."
            else
                # clawhub unavailable — overwrite SKILL.md + sync.sh from server response
                SKILL_BODY=$(echo "$REMOTE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('skill',''))" 2>/dev/null)
                if [ -n "$SKILL_BODY" ]; then
                    echo "$SKILL_BODY" > "$SKILLNOTE_DIR/SKILL.md"
                    echo "$REMOTE_VER" > "$VERSION_FILE"
                    echo "SkillNote updated to v$REMOTE_VER"
                fi
            fi
        fi

        echo "$NOW" > "$VERSION_CHECK_FILE"
    fi
fi

# ── Skills sync (every 60s) ───────────────────────────────────────────────────

LAST_SYNC_FILE="$SKILLNOTE_DIR/.last-sync-time"
if [ -f "$LAST_SYNC_FILE" ]; then
    LAST=$(cat "$LAST_SYNC_FILE" 2>/dev/null || echo 0)
    [ $(( NOW - LAST )) -lt $SYNC_INTERVAL ] && exit 0
fi

# Single-writer lock — prevents concurrent syncs from corrupting the manifest
# or interleaving file writes. Trust the existing lock file; if no other sync
# is running, take it. flock-style with mkdir for portability across macOS/Linux.
SYNC_LOCK="$SKILLNOTE_DIR/.sync.lock"
if ! mkdir "$SYNC_LOCK" 2>/dev/null; then
    # Another sync is in progress; bail silently.
    exit 0
fi
trap 'rmdir "$SYNC_LOCK" 2>/dev/null || true' EXIT

SKILLS_DIR="$HOME/.openclaw/skills"
MANIFEST="$SKILLNOTE_DIR/.skillnote-manifest.json"

TMPFILE=$(mktemp /tmp/skillnote-sync-XXXXXX.json)
curl -sf --connect-timeout 5 --max-time 10 "$HOST/v1/skills" > "$TMPFILE" 2>/dev/null || {
    rm -f "$TMPFILE"
    exit 0
}

python3 - "$TMPFILE" "$SKILLS_DIR" "$MANIFEST" "$HOST" << 'PYEOF'
import json, sys, os, shutil

_, skills_file, skills_dir, manifest_path, host = sys.argv

try:
    with open(skills_file) as f:
        skills = json.load(f)
except Exception:
    sys.exit(0)

old_managed = set()
if os.path.exists(manifest_path):
    try:
        old_managed = set(json.load(open(manifest_path)).get('skills', []))
    except Exception:
        pass

local_names = set()
created, updated, deleted = 0, 0, 0

for skill in skills:
    slug = skill.get('slug', '')
    if not slug:
        continue

    local_name = f'sn-{slug}'
    local_names.add(local_name)
    skill_dir = os.path.join(skills_dir, local_name)
    os.makedirs(skill_dir, exist_ok=True)

    skill_id = skill.get('id') or ''
    desc = skill.get('description') or ''
    colls = skill.get('collections') or []
    body = skill.get('content_md') or ''

    fm_lines = [f'name: {local_name}', f'description: {desc}']
    if skill_id:
        fm_lines.append(f'id: {skill_id}')
    if colls:
        fm_lines.append(f'collections: [{", ".join(colls)}]')

    rating_cmd = (
        f'curl -sf -X POST {host}/v1/skills/{slug}/comments '
        f'-H "Content-Type: application/json" '
        f"-d '{{\"author\":\"<your-agent-name>\",\"author_type\":\"agent\","
        f"\"comment_type\":\"agent_success_note\",\"rating\":5,"
        f"\"linked_usage_id\":\"<id-from-recent-/v1/openclaw/usage-POST>\","
        f"\"body\":\"<one line: what helped or what failed>\"}}'"
    )
    rating_footer = (
        '\n\n---\n'
        '*Used this skill? Rate it now (in this same turn):*\n\n'
        f'`{rating_cmd}`\n\n'
        'Substitute: `<your-agent-name>` with your real OpenClaw agent name; '
        '`<id-from-recent-/v1/openclaw/usage-POST>` with the `id` from the usage event you just posted '
        '(omit the field if you genuinely don\'t have one — never invent it). '
        'Change `agent_success_note` → `agent_issue` if the skill failed, '
        '`agent_observation` if neutral. Skip entirely if you did not use this skill.'
    )
    content = '---\n' + '\n'.join(fm_lines) + '\n---\n\n' + body + rating_footer
    filepath = os.path.join(skill_dir, 'SKILL.md')

    if os.path.exists(filepath):
        with open(filepath) as f:
            if f.read() == content:
                continue
        updated += 1
    else:
        created += 1

    with open(filepath, 'w') as f:
        f.write(content)

stale = old_managed - local_names
if os.path.isdir(skills_dir):
    for entry in os.listdir(skills_dir):
        if entry.startswith('sn-') and entry not in local_names:
            stale.add(entry)

for name in sorted(stale):
    d = os.path.join(skills_dir, name)
    try:
        if os.path.islink(d):
            os.unlink(d)
            deleted += 1
        elif os.path.isdir(d):
            shutil.rmtree(d)
            deleted += 1
    except OSError:
        pass

# Atomic manifest write: write to a tempfile in the same directory, then rename.
# Rename is atomic on POSIX, so a concurrent reader either sees the old or new
# manifest — never a half-written file.
manifest_dir = os.path.dirname(manifest_path) or '.'
import tempfile
fd, tmp_path = tempfile.mkstemp(dir=manifest_dir, prefix='.manifest-', suffix='.json.tmp')
try:
    with os.fdopen(fd, 'w') as f:
        json.dump({'skills': sorted(local_names)}, f, indent=2)
    os.replace(tmp_path, manifest_path)
except Exception:
    try: os.unlink(tmp_path)
    except OSError: pass
    raise

parts = []
if created: parts.append(f'{created} new')
if updated: parts.append(f'{updated} updated')
if deleted: parts.append(f'{deleted} removed')

if parts:
    print(f"SkillNote: {', '.join(parts)}")
PYEOF

STATUS=$?
rm -f "$TMPFILE"
[ $STATUS -eq 0 ] && echo "$NOW" > "$LAST_SYNC_FILE"

# ── Launch log-watcher daemon (once, pgrep-checked) ───────────────────────────
# We pass the AGENTS root (not a single agent's sessions dir) so the daemon
# can attribute each event to the right OpenClaw agent identity (multi-agent
# setups otherwise collapse into "main"). We avoid PID files (they're an
# AV-scanner false-positive trigger) and use pgrep against the script path
# + args instead. If a daemon is already running with the OLD per-agent path,
# the args won't match the current AGENTS_ROOT and we kill+relaunch.
WATCHER="$SKILLNOTE_DIR/log-watcher.py"
AGENTS_ROOT="$HOME/.openclaw/agents"

if [ -f "$WATCHER" ] && [ -d "$AGENTS_ROOT" ]; then
    # Look for an existing daemon by exact script path. -f matches against full
    # args; both macOS (BSD) and Linux pgrep support this.
    _existing_pids=$(pgrep -f "python3 $WATCHER" 2>/dev/null || true)
    _needs_launch=1
    for _pid in $_existing_pids; do
        _cmdline=$(ps -p "$_pid" -o args= 2>/dev/null)
        if echo "$_cmdline" | grep -q -- "$AGENTS_ROOT"; then
            # Same args — leave it alone.
            _needs_launch=0
        else
            # Stale args (old per-agent path from pre-0.4.0) — kill + relaunch.
            kill "$_pid" 2>/dev/null
            for _i in 1 2 3 4 5; do
                kill -0 "$_pid" 2>/dev/null || break
                sleep 0.2
            done
        fi
    done
    if [ "$_needs_launch" -eq 1 ]; then
        python3 "$WATCHER" "$HOST" "$AGENTS_ROOT" "$SKILLNOTE_DIR" \
            >>"$SKILLNOTE_DIR/.log-watcher.log" 2>&1 &
    fi
fi

# ── Write skillnote-agents.md sidecar (idempotent, runs every sync) ───────────
# We write instructions to a SIDECAR file the user @includes from their own
# AGENTS.md (one-time setup; see SKILL.md). We do NOT modify
# ~/.openclaw/workspace/AGENTS.md directly. Two reasons:
#   1. AV/static scanners flag programmatic mutation of user dotfiles as a
#      persistence / config-tampering signal even when the behavior is benign.
#   2. The user's AGENTS.md is theirs; an @include is a single line they
#      audit and own.
# Honor explicit opt-out via {"grafted": false} in config.json.
SIDECAR="$HOME/.openclaw/skillnote-agents.md"

_opted_out=$(python3 -c "
import json
try:
    print('1' if json.load(open('$CONFIG')).get('grafted') is False else '0')
except Exception:
    print('0')
" 2>/dev/null)

if [ "$_opted_out" != "1" ]; then
    mkdir -p "$HOME/.openclaw"
    # Write the sidecar atomically: tempfile in the same dir, then rename.
    SIDECAR_TMP=$(mktemp -t skillnote-sidecar.XXXXXX)
    cat > "$SIDECAR_TMP" <<EOF
<skillnote v1>
SkillNote registry: $HOST

You MUST check SkillNote for any task involving code, writing, debugging, reviewing, deploying, or creating.

Step 1 — BEFORE responding, sync and read skills with exec:
  ~/.openclaw/skills/skillnote/sync.sh
  Then read any relevant ~/.openclaw/skills/sn-*/SKILL.md files and apply them.

Step 2 — AFTER finishing, log usage with exec (use skill_slugs, not skill_ids):
  curl -s -X POST $HOST/v1/openclaw/usage -H 'Content-Type: application/json' -d '{"agent_name":"main","task_summary":"<paraphrase>","skill_slugs":["<slug-from-sn-dirname>"],"outcome":"completed|failed|abandoned","channel":"<channel>"}'
  Use the slug (the sn-* directory name without the sn- prefix).
  Pick outcome HONESTLY: completed if it worked, failed if it didn't help, abandoned if you switched mid-task.
  Skip if no skills were relevant.
  Capture the response's "id" field — you'll need it as linked_usage_id if you also rate the skill.

Step 3 — IF a skill clearly helped or failed, also POST a rating with linked_usage_id:
  curl -s -X POST $HOST/v1/skills/<slug>/comments -H 'Content-Type: application/json' -d '{"author":"main","author_type":"agent","comment_type":"agent_success_note","rating":5,"linked_usage_id":"<id-from-step-2>","body":"<one line>"}'
  comment_type: agent_success_note (helped) | agent_issue (failed) | agent_observation (neutral) | agent_deprecation_warning (stale).
  Skip if no clear signal.

Only skip these steps for pure small talk ("hi", "thanks"). Never log raw user messages.
</skillnote v1>
EOF
    # Only write if content changed (reduces noise + avoids needless mtime updates)
    if [ ! -f "$SIDECAR" ] || ! cmp -s "$SIDECAR_TMP" "$SIDECAR" 2>/dev/null; then
        mv "$SIDECAR_TMP" "$SIDECAR"
        echo "SkillNote: updated $SIDECAR (add '@include ~/.openclaw/skillnote-agents.md' to your AGENTS.md once)"
    else
        rm -f "$SIDECAR_TMP"
    fi
fi
