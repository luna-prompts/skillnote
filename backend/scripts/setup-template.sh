#!/bin/bash
set -e

API_URL="__API_URL__"
MCP_URL="__MCP_URL__"
WEB_URL="__WEB_URL__"
CLAUDE_HOME="$HOME/.claude"
PLUGIN_DIR="$CLAUDE_HOME/plugins/cache/skillnote-local/skillnote/1.0.0"

# ── prerequisites ────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "Error: python3 is required but not found."
    echo "Install it: https://www.python.org/downloads/"
    exit 1
fi

if ! command -v curl &>/dev/null; then
    echo "Error: curl is required but not found."
    exit 1
fi

# Cross-platform sed -i (GNU Linux vs BSD macOS)
sedi() {
    if sed --version 2>/dev/null | grep -q GNU; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

echo "SkillNote: setting up..."

# ── plugin skeleton ──────────────────────────────────────────────────────────
mkdir -p "$PLUGIN_DIR/.claude-plugin" "$PLUGIN_DIR/hooks" "$PLUGIN_DIR/hooks-handlers"

cat > "$PLUGIN_DIR/.claude-plugin/plugin.json" << 'EOF'
{"name":"skillnote","version":"1.0.0","description":"SkillNote skill registry — auto-sync, analytics, and skill creation."}
EOF

cat > "$PLUGIN_DIR/.mcp.json" << MCPEOF
{"mcpServers":{"skillnote":{"type":"http","url":"$MCP_URL"}}}
MCPEOF

# ── hooks ────────────────────────────────────────────────────────────────────
cat > "$PLUGIN_DIR/hooks/hooks.json" << 'EOF'
{"hooks":{"SessionStart":[{"matcher":"startup|compact","hooks":[{"type":"command","command":"\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/sync.sh\"","timeout":15,"statusMessage":"SkillNote: syncing skills..."}]}],"UserPromptSubmit":[{"hooks":[{"type":"command","command":"\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/auto-sync.sh\"","async":true}]}],"PostToolUse":[{"matcher":"Skill","hooks":[{"type":"command","command":"\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/track-usage.sh\"","async":true}]}]}}
EOF

# ── sync script ──────────────────────────────────────────────────────────────
cat > "$PLUGIN_DIR/hooks-handlers/sync.sh" << 'SYNCEOF'
#!/bin/bash
HOST="${CLAUDE_PLUGIN_OPTION_HOST:-__SYNC_HOST__}"
API_URL="http://${HOST}:8082"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PROJECT_CONFIG="${PROJECT_DIR}/.skillnote.json"

if [ -f "$PROJECT_CONFIG" ]; then
    COLLECTIONS=$(python3 -c "
import json
cfg = json.load(open('${PROJECT_CONFIG}'))
cols = cfg.get('collections', [])
if cols == '*' or cols == ['*']: print('')
elif not cols: print('__NONE__')
else: print(','.join(cols))
" 2>/dev/null)
    [ "$COLLECTIONS" = "__NONE__" ] && exit 0
    SKILLS_DIR="${PROJECT_DIR}/.claude/skills"
else
    COLLECTIONS=""
    SKILLS_DIR="$HOME/.claude/skills"
fi

if [ -n "$CLAUDE_PLUGIN_DATA" ]; then MANIFEST_DIR="$CLAUDE_PLUGIN_DATA"
else MANIFEST_DIR="$SKILLS_DIR"; fi
MANIFEST="${MANIFEST_DIR}/.skillnote-manifest.json"

if [ -n "$COLLECTIONS" ]; then FETCH_URL="${API_URL}/v1/skills?collections=${COLLECTIONS}"
else FETCH_URL="${API_URL}/v1/skills"; fi

SKILLS=$(curl -sf --connect-timeout 5 --max-time 10 "$FETCH_URL" 2>/dev/null) || exit 0
mkdir -p "$SKILLS_DIR" "$MANIFEST_DIR"

RESULT=$(echo "$SKILLS" | python3 -c "
import json,sys,os,shutil
skills_dir='$SKILLS_DIR'; manifest_path='$MANIFEST'
skills=json.load(sys.stdin); api_slugs=set()
old_managed=set()
if os.path.exists(manifest_path):
    with open(manifest_path) as f: old_managed=set(json.load(f).get('skills',[]))
created,updated,deleted=0,0,0
for skill in skills:
    slug=skill['slug']; api_slugs.add(slug)
    skill_dir=os.path.join(skills_dir,slug); os.makedirs(skill_dir,exist_ok=True)
    fm_lines=['name: '+slug,'description: '+skill['description']]
    if skill.get('collections'): fm_lines.append('collections: ['+', '.join(skill['collections'])+']')
    extra=skill.get('extra_frontmatter') or ''
    if extra.strip(): fm_lines.append(extra.strip())
    raw_body=skill.get('content_md') or ''
    api_url='$API_URL'; web_url=api_url.replace(':8082',':3000')
    raw_body=raw_body.replace('{{API_URL}}',api_url).replace('{{WEB_URL}}',web_url)
    content='---\n'+'\n'.join(fm_lines)+'\n---\n\n'+raw_body
    filepath=os.path.join(skill_dir,'SKILL.md')
    if os.path.exists(filepath):
        with open(filepath) as f:
            if f.read()==content: continue
        updated+=1
    else: created+=1
    with open(filepath,'w') as f: f.write(content)
for slug in old_managed-api_slugs:
    d=os.path.join(skills_dir,slug)
    if os.path.isdir(d): shutil.rmtree(d); deleted+=1
with open(manifest_path,'w') as f: json.dump({'skills':sorted(api_slugs)},f,indent=2)
parts=[]
if created: parts.append(str(created)+' new')
if updated: parts.append(str(updated)+' updated')
if deleted: parts.append(str(deleted)+' removed')
total=len(skills)
detail=', '.join(parts) if parts else 'all current'
print('SkillNote: '+str(total)+' skills ('+detail+')')
" 2>/dev/null) || exit 0

[ -n "$RESULT" ] && echo "$RESULT"
SYNCEOF

# Replace host placeholder
SYNC_HOST=$(echo "$API_URL" | sed -E 's|https?://||;s|:.*||')
sedi "s|__SYNC_HOST__|$SYNC_HOST|g" "$PLUGIN_DIR/hooks-handlers/sync.sh"
chmod +x "$PLUGIN_DIR/hooks-handlers/sync.sh"

# ── usage tracker ────────────────────────────────────────────────────────────
cat > "$PLUGIN_DIR/hooks-handlers/track-usage.sh" << 'TRACKEOF'
#!/bin/bash
HOST="${CLAUDE_PLUGIN_OPTION_HOST:-__TRACK_HOST__}"
export API_URL="http://${HOST}:8082"
export SKILLNOTE_HOOK_INPUT
SKILLNOTE_HOOK_INPUT=$(cat)
python3 -c "
import json,urllib.request,os,sys
try: hook_input=json.loads(os.environ.get('SKILLNOTE_HOOK_INPUT','{}'))
except: hook_input={}
tool_input=hook_input.get('tool_input',{})
skill_name=tool_input.get('name','') or hook_input.get('tool_name','')
session_id=hook_input.get('session_id','')
if not skill_name: sys.exit(0)
api_url=os.environ.get('API_URL','http://localhost:8082')
payload=json.dumps({'skill_slug':skill_name,'agent_name':'claude-code','session_id':session_id}).encode()
req=urllib.request.Request(api_url+'/v1/hooks/skill-used',data=payload,headers={'Content-Type':'application/json'},method='POST')
try: urllib.request.urlopen(req,timeout=3)
except: pass
" 2>/dev/null
exit 0
TRACKEOF

sedi "s|__TRACK_HOST__|$SYNC_HOST|g" "$PLUGIN_DIR/hooks-handlers/track-usage.sh"
chmod +x "$PLUGIN_DIR/hooks-handlers/track-usage.sh"

# ── auto-sync (background re-sync every 60s) ────────────────────────────────
cat > "$PLUGIN_DIR/hooks-handlers/auto-sync.sh" << 'AUTOSYNCEOF'
#!/bin/bash
SYNC_INTERVAL=60
if [ -n "$CLAUDE_PLUGIN_DATA" ]; then LAST_SYNC_FILE="$CLAUDE_PLUGIN_DATA/.last-sync-time"
else LAST_SYNC_FILE="$HOME/.claude/skills/.last-sync-time"; fi
NOW=$(date +%s)
if [ -f "$LAST_SYNC_FILE" ]; then
    LAST=$(cat "$LAST_SYNC_FILE" 2>/dev/null || echo 0)
    [ $((NOW - LAST)) -lt $SYNC_INTERVAL ] && exit 0
fi
"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/sync.sh" > /dev/null 2>&1
mkdir -p "$(dirname "$LAST_SYNC_FILE")"
echo "$NOW" > "$LAST_SYNC_FILE"
AUTOSYNCEOF
chmod +x "$PLUGIN_DIR/hooks-handlers/auto-sync.sh"

# ── skills ───────────────────────────────────────────────────────────────────
mkdir -p "$PLUGIN_DIR/skills/skill-push" "$PLUGIN_DIR/skills/collection"

cat > "$PLUGIN_DIR/skills/skill-push/SKILL.md" << 'SKILLPUSHEOF'
---
name: skill-push
description: Create and push reusable skills to SkillNote when repeated instructions are detected or user says "create a skill", "save this pattern", "push a skill". Guides drafting, review, collection selection, and publishing.
---

# Skill Push

Create and push reusable skills to the SkillNote registry.

The SkillNote API is at: http://__SKILL_HOST__:8082

## Steps

1. **Confirm** the pattern with the user
2. **Draft** name (lowercase-hyphens, max 64), description (with trigger keywords), content
3. **Check** if exists: `curl -sf http://__SKILL_HOST__:8082/v1/skills/<SLUG>`
4. **Collection** (required): fetch `http://__SKILL_HOST__:8082/v1/collections` and let user pick. Every skill needs at least one collection.
5. **Review** with user
6. **Push** via Python urllib:

```python
import json, urllib.request, os
api = "http://__SKILL_HOST__:8082"
payload = json.dumps({"name": "<NAME>", "slug": "<NAME>", "description": "<DESC>", "content_md": "<CONTENT>", "collections": ["<COL>"]}).encode()
req = urllib.request.Request(f"{api}/v1/skills", data=payload, headers={"Content-Type": "application/json"}, method="POST")
try:
    result = json.loads(urllib.request.urlopen(req).read())
    print(f"Created: {result['slug']} v{result['current_version']}")
except urllib.error.HTTPError as e:
    print(f"Error: {json.loads(e.read())}")
```

For updates use PATCH: `urllib.request.Request(f"{api}/v1/skills/<SLUG>", ..., method="PATCH")`
SKILLPUSHEOF
sedi "s|__SKILL_HOST__|$SYNC_HOST|g" "$PLUGIN_DIR/skills/skill-push/SKILL.md"

cat > "$PLUGIN_DIR/skills/collection/SKILL.md" << 'COLLEOF'
---
name: collection
description: Choose which SkillNote skill collection is active for this project. Use when user says "change collection", "switch skills", "use frontend skills", "show collections", or at first session in a new project when recommended.
---

# SkillNote Collection Manager

Help the user choose which skill collection to sync for the current project.

## Step 1: Fetch Collections

```python
import urllib.request, json
api = "http://__COL_HOST__:8082"
cols = json.loads(urllib.request.urlopen(f"{api}/v1/collections").read())
for c in cols: print(f"{c['name']} ({c['count']} skills)")
```

## Step 2: Ask the User

Use **AskUserQuestion** with multiSelect: true. Show up to 3 collections sorted by skill count + a 4th option "Browse all in browser" that opens the web UI picker.

If user picks "Browse all in browser":
1. Create a session: POST http://__COL_HOST__:8082/v1/sessions
2. Open the pick_url in the browser
3. Poll GET /v1/sessions/{token} every 3s until completed
4. Apply the returned collections

## Step 3: Apply

Write .skillnote.json: `{"collections": ["name1", "name2"]}`
Then run: `skillnote-sync --force`

## Guidelines

- Every skill must belong to at least one collection
- Keep 12-15 skills per collection for best performance
- The user can change collections anytime with this command
COLLEOF
sedi "s|__COL_HOST__|$SYNC_HOST|g" "$PLUGIN_DIR/skills/collection/SKILL.md"

# ── agents ───────────────────────────────────────────────────────────────────
mkdir -p "$PLUGIN_DIR/agents"
cat > "$PLUGIN_DIR/agents/skill-creator.md" << 'AGENTEOF'
---
name: skill-creator
description: Create, refine, and push reusable skills to the SkillNote registry. Use when patterns are detected or user requests a new skill.
model: inherit
effort: high
tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
---

# SkillNote Skill Creator

Dedicated agent for creating high-quality skills. Use the skill-push skill for the push mechanics.
AGENTEOF

# ── bin ──────────────────────────────────────────────────────────────────────
mkdir -p "$PLUGIN_DIR/bin"
cat > "$PLUGIN_DIR/bin/skillnote-sync" << 'BINEOF'
#!/bin/bash
if [ "$1" = "--force" ]; then
    SKILLS_DIR="$HOME/.claude/skills"
    MANIFEST="$SKILLS_DIR/.skillnote-manifest.json"
    [ -n "$CLAUDE_PLUGIN_DATA" ] && MANIFEST="$CLAUDE_PLUGIN_DATA/.skillnote-manifest.json"
    if [ -f "$MANIFEST" ]; then
        python3 -c "
import json, os, shutil
m = json.load(open('$MANIFEST'))
sd = '$SKILLS_DIR'
for slug in m.get('skills', []):
    d = os.path.join(sd, slug)
    if os.path.isdir(d): shutil.rmtree(d)
" 2>/dev/null
    fi
    rm -f "$MANIFEST"
fi
if [ -n "$CLAUDE_PLUGIN_ROOT" ]; then exec "$CLAUDE_PLUGIN_ROOT/hooks-handlers/sync.sh"
else SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"; exec "$SCRIPT_DIR/hooks-handlers/sync.sh"; fi
BINEOF
chmod +x "$PLUGIN_DIR/bin/skillnote-sync"

# ── register plugin ───────────────────────────────────────────────────────────
INSTALLED="$HOME/.claude/plugins/installed_plugins.json"
mkdir -p "$(dirname "$INSTALLED")"
python3 -c "
import json, os
from datetime import datetime, timezone

path = '$INSTALLED'
data = {}
if os.path.exists(path):
    try:
        with open(path) as f: data = json.load(f)
    except: data = {}

# Ensure correct top-level structure (version 2 format)
if 'version' not in data:
    data['version'] = 2
if 'plugins' not in data:
    data['plugins'] = {}

now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
data['plugins']['skillnote@skillnote-local'] = [{
    'scope': 'user',
    'installPath': '$PLUGIN_DIR',
    'version': '1.0.0',
    'installedAt': now,
    'lastUpdated': now,
}]

with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null

# ── enable plugin in user settings ────────────────────────────────────────────
USER_SETTINGS="$HOME/.claude/settings.json"
python3 -c "
import json, os
path = '$USER_SETTINGS'
data = {}
if os.path.exists(path):
    try:
        with open(path) as f: data = json.load(f)
    except: data = {}
ep = data.setdefault('enabledPlugins', {})
ep['skillnote@skillnote-local'] = True
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null

# ── add MCP server ───────────────────────────────────────────────────────────
if command -v claude &>/dev/null; then
    claude mcp add --transport http --scope user skillnote "$MCP_URL" 2>/dev/null || true
fi

# ── first sync ───────────────────────────────────────────────────────────────
"$PLUGIN_DIR/hooks-handlers/sync.sh" 2>/dev/null || true

SKILL_COUNT=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/skills" 2>/dev/null \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

# Fetch collections for display
COLLECTIONS_LIST=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/collections" 2>/dev/null \
  | python3 -c "import json,sys; [print(f'    {c[\"name\"]} ({c[\"count\"]} skills)') for c in json.load(sys.stdin)]" 2>/dev/null || echo "    (none)")

echo ""
echo "  SkillNote connected!"
echo ""
echo "  API:  $API_URL"
echo "  MCP:  $MCP_URL"
echo "  Web:  $WEB_URL"
echo "  Skills: $SKILL_COUNT synced"
echo ""
echo "  Collections:"
echo "$COLLECTIONS_LIST"
echo ""
echo "  Change collection: /skillnote:collection"
echo "  Create skills:     /skillnote:skill-push"
echo "  Browse all:        $WEB_URL/collections"
echo ""
echo "  Start claude in any project."
echo ""
