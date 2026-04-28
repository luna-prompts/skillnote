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
        f"-d '{{\"author\":\"main\",\"author_type\":\"agent\","
        f"\"comment_type\":\"agent_success_note\",\"rating\":5,"
        f"\"body\":\"<one line: what helped or what failed>\"}}'"
    )
    rating_footer = (
        '\n\n---\n'
        '*Used this skill? Rate it now (in this same turn):*\n\n'
        f'`{rating_cmd}`\n\n'
        'Change `agent_success_note` → `agent_issue` if it failed. '
        'Skip entirely if you did not use this skill.'
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

with open(manifest_path, 'w') as f:
    json.dump({'skills': sorted(local_names)}, f, indent=2)

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

# ── Launch log-watcher daemon (once, PID-guarded) ─────────────────────────────
WATCHER="$SKILLNOTE_DIR/log-watcher.py"
WATCHER_PID="$SKILLNOTE_DIR/.log-watcher.pid"
SESSIONS_DIR="$HOME/.openclaw/agents/main/sessions"

if [ -f "$WATCHER" ] && [ -d "$SESSIONS_DIR" ]; then
    _needs_launch=1
    if [ -f "$WATCHER_PID" ]; then
        _pid=$(cat "$WATCHER_PID" 2>/dev/null)
        if kill -0 "$_pid" 2>/dev/null; then
            _needs_launch=0
        fi
    fi
    if [ "$_needs_launch" -eq 1 ]; then
        python3 "$WATCHER" "$HOST" "$SESSIONS_DIR" "$SKILLNOTE_DIR" \
            >>"$SKILLNOTE_DIR/.log-watcher.log" 2>&1 &
        echo $! > "$WATCHER_PID"
    fi
fi
