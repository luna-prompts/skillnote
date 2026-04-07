#!/bin/bash
# SkillNote Sync — SessionStart hook
# Syncs skills from the SkillNote registry to ~/.claude/skills/ with full frontmatter.
# Manages create/update/delete via a manifest. Offline-first (silent fail).

# Resolve host: env var > ~/.skillnote/host file > localhost
HOST="${CLAUDE_PLUGIN_OPTION_HOST:-}"
if [ -z "$HOST" ] && [ -f "$HOME/.skillnote/host" ]; then
    HOST=$(cat "$HOME/.skillnote/host" 2>/dev/null)
fi
HOST="${HOST:-localhost}"
API_URL="http://${HOST}:8082"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PROJECT_CONFIG="${PROJECT_DIR}/.skillnote.json"

# Determine scope: project-level or global

if [ -f "$PROJECT_CONFIG" ]; then
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

    SKILLS_DIR="${PROJECT_DIR}/.claude/skills"
else
    COLLECTIONS=""
    SKILLS_DIR="$HOME/.claude/skills"
    PROJECT_NAME=$(basename "${PROJECT_DIR}")

    # Check if folder name matches a collection — auto-filter if so
    COLS_JSON=$(curl -sf --connect-timeout 3 --max-time 5 "${API_URL}/v1/collections" 2>/dev/null || echo "[]")
    FOLDER_MATCH=$(echo "$COLS_JSON" | python3 -c "
import json,sys
try:
    cols = json.load(sys.stdin)
    folder = '${PROJECT_NAME}'.lower()
    for c in cols:
        if c['name'].lower() == folder:
            print(c['name'])
            break
except: pass
" 2>/dev/null)

    if [ -n "$FOLDER_MATCH" ]; then
        COLLECTIONS="$FOLDER_MATCH"
    fi
fi

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
api_slugs = set()
has_filter = bool('$COLLECTIONS')

# Skip skills that the plugin already provides as commands (prevent duplicates in / autocomplete)
plugin_provided = {'skill-push', 'collection'}

# Load existing manifest
old_managed = set()
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        old_managed = set(json.load(f).get('skills', []))

# Safety: if filtered query returned 0 results but we have cached skills, keep them
# (the collection may have been deleted or renamed on the server)
if not skills and has_filter and old_managed:
    print('SkillNote: collection not found on server (keeping cached skills)')
    sys.exit(0)

created, updated, deleted = 0, 0, 0

for skill in skills:
    slug = skill['slug']
    api_slugs.add(slug)
    if slug in plugin_provided:
        continue  # Plugin handles these as commands — don't create duplicate local skills
    skill_dir = os.path.join(skills_dir, slug)
    os.makedirs(skill_dir, exist_ok=True)

    # Build SKILL.md with full frontmatter
    fm_lines = [f'name: {slug}', f'description: {skill[\"description\"]}']
    if skill.get('collections'):
        fm_lines.append(f'collections: [{\", \".join(skill[\"collections\"])}]')
    extra = skill.get('extra_frontmatter') or ''
    if extra.strip():
        fm_lines.append(extra.strip())

    raw_body = skill.get('content_md') or ''
    # Substitute URL placeholders (same as MCP server does at serve time)
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

# Delete skills removed from registry (only managed ones)
for slug in old_managed - api_slugs:
    skill_dir = os.path.join(skills_dir, slug)
    if os.path.isdir(skill_dir):
        shutil.rmtree(skill_dir)
        deleted += 1

# Write updated manifest
with open(manifest_path, 'w') as f:
    json.dump({'skills': sorted(api_slugs)}, f, indent=2)

# Build output
total = len(skills)
parts = []
if created: parts.append(str(created) + ' new')
if updated: parts.append(str(updated) + ' updated')
if deleted: parts.append(str(deleted) + ' removed')

detail = ', '.join(parts) if parts else 'all current'
print('SkillNote: ' + str(total) + ' skills (' + detail + ')')
" 2>/dev/null) || exit 0

# Output as additionalContext for Claude's session
if [ -n "$RESULT" ]; then
    echo "$RESULT"
fi
