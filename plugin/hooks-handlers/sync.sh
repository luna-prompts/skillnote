#!/bin/bash
# SkillNote Sync — SessionStart hook
# Syncs skills from the SkillNote registry to PROJECT_DIR/.claude/skills/ with full frontmatter.
# Manages create/update/delete via a manifest. Offline-first (silent fail).

# Ensure Python outputs UTF-8 for box-drawing chars on any locale
export PYTHONIOENCODING=utf-8

# Resolve host
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST=$("$SCRIPT_DIR/resolve-host.sh")
API_URL="http://${HOST}:8082"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PROJECT_CONFIG="${PROJECT_DIR}/.skillnote.json"

# No .skillnote.json = no sync. Picker must run first.
if [ ! -f "$PROJECT_CONFIG" ]; then
    exit 0
fi

COLLECTIONS=$(python3 -c "
import json, sys
try:
    cfg = json.load(open('${PROJECT_CONFIG}'))
except Exception:
    print('__ERROR__')
    sys.exit(0)
cols = cfg.get('collections', [])
if cols == '*' or cols == ['*']:
    print('')
elif not cols:
    print('__NONE__')
else:
    print(','.join(cols))
" 2>/dev/null)

if [ "$COLLECTIONS" = "__NONE__" ] || [ "$COLLECTIONS" = "__ERROR__" ]; then
    if [ "$COLLECTIONS" = "__ERROR__" ]; then
        echo "SkillNote: invalid .skillnote.json"
    fi
    exit 0
fi

# Always project-level — never write to global ~/.claude/skills/
SKILLS_DIR="${PROJECT_DIR}/.claude/skills"

# Use plugin data dir for manifest if available, else alongside skills
if [ -n "$CLAUDE_PLUGIN_DATA" ]; then
    MANIFEST_DIR="$CLAUDE_PLUGIN_DATA"
else
    MANIFEST_DIR="$SKILLS_DIR"
fi
MANIFEST="${MANIFEST_DIR}/.skillnote-manifest.json"

# Build fetch URL with optional collection filter (URL-encode for safety)
if [ -n "$COLLECTIONS" ]; then
    ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${COLLECTIONS}'))" 2>/dev/null || echo "$COLLECTIONS")
    FETCH_URL="${API_URL}/v1/skills?collections=${ENCODED}"
else
    FETCH_URL="${API_URL}/v1/skills"
fi

# Fetch skills from API
SKILLS=$(curl -sf --connect-timeout 5 --max-time 10 "$FETCH_URL" 2>/dev/null) || {
    echo "SkillNote: offline (using cached skills)"
    exit 0
}

mkdir -p "$SKILLS_DIR"
mkdir -p "$MANIFEST_DIR"

# Sync: create/update/delete skills, update manifest, return context
RESULT=$(echo "$SKILLS" | python3 -c "
import json, sys, os, shutil

skills_dir = '$SKILLS_DIR'
manifest_path = '$MANIFEST'

skills = json.load(sys.stdin)
api_slugs = set()      # raw slugs from API
local_names = set()    # prefixed directory names on disk
has_filter = bool('$COLLECTIONS')

# Skip skills that the plugin already provides as commands (prevent duplicates in / autocomplete)
plugin_provided = {'skill-push', 'collection'}

# Load existing manifest
old_managed = set()
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        old_managed = set(json.load(f).get('skills', []))

# Safety: if filtered query returned 0 results but we have cached skills, keep them
if not skills and has_filter and old_managed:
    print('SkillNote: collection not found on server (keeping cached skills)')
    sys.exit(0)

created, updated, deleted = 0, 0, 0

for skill in skills:
    slug = skill['slug']
    api_slugs.add(slug)
    if slug in plugin_provided:
        continue  # Plugin handles these as commands — don't create duplicate local skills

    # Prefix with skillnote- so all skills group under /skillnote in autocomplete
    local_name = f'skillnote-{slug}'
    local_names.add(local_name)
    skill_dir = os.path.join(skills_dir, local_name)
    os.makedirs(skill_dir, exist_ok=True)

    # Build SKILL.md with full frontmatter
    desc = skill['description']
    colls = skill.get('collections', [])
    if colls:
        desc = colls[0] + ' · ' + desc
    fm_lines = [f'name: {local_name}', f'description: {desc}']
    if colls:
        fm_lines.append(f'collections: [{\", \".join(colls)}]')
    extra = skill.get('extra_frontmatter') or ''
    if extra.strip():
        fm_lines.append(extra.strip())

    raw_body = skill.get('content_md') or ''
    # Substitute URL placeholders
    api_url = '$API_URL'
    host = api_url.split('://')[1].split(':')[0] if '://' in api_url else 'localhost'
    web_url = f'http://{host}:3000'
    raw_body = raw_body.replace('{{API_URL}}', api_url).replace('{{WEB_URL}}', web_url)
    content = '---\n' + '\n'.join(fm_lines) + '\n---\n\n' + raw_body
    filepath = os.path.join(skill_dir, 'SKILL.md')

    # Skip if unchanged
    if os.path.exists(filepath):
        with open(filepath) as f:
            if f.read() == content:
                continue
        updated += 1
    else:
        created += 1

    with open(filepath, 'w') as f:
        f.write(content)

# Delete skills not in current collection
# Check manifest (tracked skills) AND scan disk (catches orphans from before manifest existed)
stale = old_managed - local_names
if os.path.isdir(skills_dir):
    for entry in os.listdir(skills_dir):
        if entry.startswith('skillnote-') and entry not in local_names:
            stale.add(entry)
for name in sorted(stale):
    skill_dir = os.path.join(skills_dir, name)
    if os.path.isdir(skill_dir):
        try:
            shutil.rmtree(skill_dir)
            deleted += 1
        except Exception:
            pass  # permission error — skip

# Write updated manifest (uses local_names for directory tracking)
with open(manifest_path, 'w') as f:
    json.dump({'skills': sorted(local_names)}, f, indent=2)

# Build output
total = len(skills)
parts = []
if created: parts.append(str(created) + ' new')
if updated: parts.append(str(updated) + ' updated')
if deleted: parts.append(str(deleted) + ' removed')

detail = ', '.join(parts) if parts else 'all current'
col_name = '$COLLECTIONS' if '$COLLECTIONS' else 'all'

vis = [s for s in skills if s['slug'] not in plugin_provided]
slugs = [s['slug'] for s in vis]

import os as _os
skills_path = _os.path.abspath('$SKILLS_DIR')
home = _os.path.expanduser('~')
if skills_path.startswith(home):
    skills_path = '~' + skills_path[len(home):]

# ── ANSI colors ──
O = chr(27) + '[38;5;208m'  # orange
C = chr(27) + '[1;36m'      # cyan bold
G = chr(27) + '[32m'         # green
D = chr(27) + '[2m'          # dim
B = chr(27) + '[1m'          # bold
R = chr(27) + '[0m'          # reset

# ── Branded header (aligned with Claude Code's logo) ──
print()
print(f' {C}✦ S K I L L N O T E{R}')
print()

if slugs:
    col_w = max(len(s) for s in slugs) + 6
    bw = max(col_w * 2 + 6, len(skills_path) + 10, 50)
    dash = chr(9472)

    import re as _re
    def _vis_len(s):
        return len(_re.sub(chr(27) + r'\[[0-9;]*m', '', s))
    def row_line(content):
        pad = bw - 2 - _vis_len(content)
        print(f'    {D}{chr(9474)}{R}' + content + ' ' * max(0, pad) + f'{D}{chr(9474)}{R}')
    def row_empty():
        print(f'    {D}{chr(9474)}{R}' + ' ' * (bw - 2) + f'{D}{chr(9474)}{R}')
    def border_top(label):
        inner = bw - 2
        prefix = dash + ' ' + label + ' '
        fill = dash * max(0, inner - _vis_len(prefix))
        print(f'    {D}{chr(9581)}{prefix}{fill}{chr(9582)}{R}')
    def border_bot(label):
        inner = bw - 2
        prefix = dash + dash + ' ' + label + ' '
        fill = dash * max(0, inner - _vis_len(prefix))
        print(f'    {D}{chr(9584)}{prefix}{fill}{chr(9583)}{R}')

    border_top(f'{R}{B}{col_name}{R}{D} {dash}{dash} {G}{str(len(vis))} skills ({detail}){R}{D}')
    row_empty()

    for i in range(0, len(slugs), 2):
        left = (str(i+1).rjust(2) + '. ' + slugs[i]).ljust(col_w)
        right = ''
        if i + 1 < len(slugs):
            right = (str(i+2).rjust(2) + '. ' + slugs[i+1]).ljust(col_w)
        row_line(f'  {C}' + left + right + f'{R}')

    row_empty()
    row_line(f'  {D}' + dash * (bw - 6) + f'{R}  ')
    row_empty()
    row_line(f'  {D}{chr(8594)} {skills_path}{R}')
    row_empty()

    border_bot(f'{R}{C}/skillnote{R}{D} {chr(183)} {C}/skillnote:collection{R}{D}')
else:
    print(f'    {C}{col_name}{R} {D}{chr(183)}{R} {str(len(vis))} skills ({detail})')

print()
" 2>/dev/null) || exit 0

# Output as additionalContext for Claude's session
if [ -n "$RESULT" ]; then
    echo "$RESULT"
fi
