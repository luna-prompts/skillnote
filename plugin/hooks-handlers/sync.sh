#!/bin/bash
# SkillNote Sync — SessionStart hook
# Syncs skills from the SkillNote registry to ~/.claude/skills/ with full frontmatter.
# Manages create/update/delete via a manifest. Offline-first (silent fail).

HOST="${CLAUDE_PLUGIN_OPTION_HOST:-localhost}"
API_URL="http://${HOST}:8082"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PROJECT_CONFIG="${PROJECT_DIR}/.skillnote.json"

# Determine scope: project-level or global
if [ -f "$PROJECT_CONFIG" ]; then
    COLLECTIONS=$(python3 -c "
import json
cfg = json.load(open('${PROJECT_CONFIG}'))
cols = cfg.get('collections', [])
if cols == '*' or cols == ['*']:
    print('')
elif not cols:
    print('__NONE__')
else:
    print(','.join(cols))
" 2>/dev/null)

    if [ "$COLLECTIONS" = "__NONE__" ]; then
        exit 0
    fi

    SKILLS_DIR="${PROJECT_DIR}/.claude/skills"
else
    COLLECTIONS=""
    SKILLS_DIR="$HOME/.claude/skills"
    PROJECT_NAME=$(basename "${PROJECT_DIR}")

    # Check if folder name matches a collection (simple: folder name = collection name)
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

    # First time in this project?
    MANIFEST_CHECK="${SKILLS_DIR}/.skillnote-manifest.json"
    [ -n "$CLAUDE_PLUGIN_DATA" ] && MANIFEST_CHECK="$CLAUDE_PLUGIN_DATA/.skillnote-manifest.json"
    IS_FIRST_TIME=false
    [ ! -f "$MANIFEST_CHECK" ] && IS_FIRST_TIME=true

    TOTAL_SKILLS=$(curl -sf --connect-timeout 3 --max-time 5 "${API_URL}/v1/skills" 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [ "$IS_FIRST_TIME" = true ]; then
        if [ -n "$FOLDER_MATCH" ]; then
            # Folder name matches a collection — recommend it
            echo "SkillNote: Collection '${FOLDER_MATCH}' matches this folder."
            echo "  ACTION: Use the skillnote:collection skill to ask the user which collection to use."
            echo "  Recommend '${FOLDER_MATCH}' as the first option. Available collections: ${COLS_JSON}"
        elif [ "$TOTAL_SKILLS" -gt 15 ] 2>/dev/null; then
            # Many skills, no folder match — suggest scoping
            echo "SkillNote: ${TOTAL_SKILLS} skills available (>15 may degrade activation)."
            echo "  ACTION: Use the skillnote:collection skill to ask the user which collection to use."
            echo "  Available collections: ${COLS_JSON}"
        fi
    elif [ "$TOTAL_SKILLS" -gt 15 ] 2>/dev/null; then
        echo "SkillNote: ${TOTAL_SKILLS} skills synced. Use /skillnote:collection to scope."
    fi
fi

# Use plugin data dir for manifest if available, else alongside skills
if [ -n "$CLAUDE_PLUGIN_DATA" ]; then
    MANIFEST_DIR="$CLAUDE_PLUGIN_DATA"
else
    MANIFEST_DIR="$SKILLS_DIR"
fi
MANIFEST="${MANIFEST_DIR}/.skillnote-manifest.json"

# Build fetch URL with optional collection filter
if [ -n "$COLLECTIONS" ]; then
    FETCH_URL="${API_URL}/v1/skills?collections=${COLLECTIONS}"
else
    FETCH_URL="${API_URL}/v1/skills"
fi

# Fetch skills from API (silent fail if offline)
SKILLS=$(curl -sf --connect-timeout 5 --max-time 10 "$FETCH_URL" 2>/dev/null) || exit 0

mkdir -p "$SKILLS_DIR"
mkdir -p "$MANIFEST_DIR"

# Sync: create/update/delete skills, update manifest, return context
RESULT=$(echo "$SKILLS" | python3 -c "
import json, sys, os, shutil

skills_dir = '$SKILLS_DIR'
manifest_path = '$MANIFEST'

skills = json.load(sys.stdin)
api_slugs = set()

# Load existing manifest
old_managed = set()
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        old_managed = set(json.load(f).get('skills', []))

created, updated, deleted = 0, 0, 0

for skill in skills:
    slug = skill['slug']
    api_slugs.add(slug)
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
    web_url = api_url.replace(':8082', ':3000')
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
