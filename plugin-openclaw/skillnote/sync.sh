#!/bin/bash
# SkillNote Sync for OpenClaw
# Fetches skills from SkillNote and writes them to ~/.openclaw/skills/sn-{slug}/SKILL.md
# Handles create/update/delete via manifest. Offline-first (silent fail).
# Throttled: skips if run within last 60 seconds.

export PYTHONIOENCODING=utf-8

SYNC_INTERVAL=60

SKILLNOTE_DIR="$HOME/.openclaw/skills/skillnote"
CONFIG="$SKILLNOTE_DIR/config.json"

[ ! -f "$CONFIG" ] && exit 0

HOST=$(python3 -c "
import json, sys
try:
    cfg = json.load(open('$CONFIG'))
    h = cfg.get('host','').rstrip('/')
    print(h)
except Exception:
    pass
" 2>/dev/null)

[ -z "$HOST" ] && exit 0

# Throttle
LAST_SYNC_FILE="$SKILLNOTE_DIR/.last-sync-time"
NOW=$(date +%s)
if [ -f "$LAST_SYNC_FILE" ]; then
    LAST=$(cat "$LAST_SYNC_FILE" 2>/dev/null || echo 0)
    DIFF=$((NOW - LAST))
    [ "$DIFF" -lt "$SYNC_INTERVAL" ] && exit 0
fi

SKILLS_DIR="$HOME/.openclaw/skills"
MANIFEST="$SKILLNOTE_DIR/.skillnote-manifest.json"

# Write skills JSON to a temp file to avoid quoting issues in the Python script
TMPFILE=$(mktemp /tmp/skillnote-sync-XXXXXX.json)
curl -sf --connect-timeout 5 --max-time 10 "$HOST/v1/skills" > "$TMPFILE" 2>/dev/null || {
    rm -f "$TMPFILE"
    exit 0
}

python3 - "$TMPFILE" "$SKILLS_DIR" "$MANIFEST" << 'PYEOF'
import json, sys, os, shutil

_, skills_file, skills_dir, manifest_path = sys.argv

try:
    with open(skills_file) as f:
        skills = json.load(f)
except Exception:
    sys.exit(0)

# Load manifest
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

    # id in frontmatter so agents can log usage without a separate API call
    fm_lines = [f'name: {local_name}', f'description: {desc}']
    if skill_id:
        fm_lines.append(f'id: {skill_id}')
    if colls:
        fm_lines.append(f'collections: [{", ".join(colls)}]')

    content = '---\n' + '\n'.join(fm_lines) + '\n---\n\n' + body
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

# Delete skills no longer in SkillNote
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
if [ $STATUS -eq 0 ]; then
    echo "$NOW" > "$LAST_SYNC_FILE"
fi
