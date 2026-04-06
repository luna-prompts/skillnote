#!/bin/bash
set -e

API_URL="__API_URL__"
MCP_URL="__MCP_URL__"
WEB_URL="__WEB_URL__"
CLAUDE_HOME="$HOME/.claude"
PLUGIN_DIR="$CLAUDE_HOME/plugins/cache/skillnote-local/skillnote/1.0.0"

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
{"hooks":{"SessionStart":[{"matcher":"startup","hooks":[{"type":"command","command":"\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/sync.sh\"","timeout":15,"statusMessage":"SkillNote: syncing skills..."}]}],"PostToolUse":[{"matcher":"Skill","hooks":[{"type":"command","command":"\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/track-usage.sh\"","async":true}]}]}}
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
    content='---\n'+'\n'.join(fm_lines)+'\n---\n\n'+(skill.get('content_md') or '')
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
sed -i "s|__SYNC_HOST__|$SYNC_HOST|g" "$PLUGIN_DIR/hooks-handlers/sync.sh"
chmod +x "$PLUGIN_DIR/hooks-handlers/sync.sh"

# ── usage tracker ────────────────────────────────────────────────────────────
cat > "$PLUGIN_DIR/hooks-handlers/track-usage.sh" << 'TRACKEOF'
#!/bin/bash
HOST="${CLAUDE_PLUGIN_OPTION_HOST:-__TRACK_HOST__}"
API_URL="http://${HOST}:8082"
INPUT=$(cat)
python3 -c "
import json,urllib.request,sys
try:
    import os
    hook_input=json.loads(os.environ.get('HOOK_INPUT','{}'))
except:
    hook_input={}
tool_input=hook_input.get('tool_input',{})
skill_name=tool_input.get('name','') or hook_input.get('tool_name','')
session_id=hook_input.get('session_id','')
if not skill_name: sys.exit(0)
payload=json.dumps({'skill_slug':skill_name,'agent_name':'claude-code','session_id':session_id}).encode()
req=urllib.request.Request('${API_URL}/v1/hooks/skill-used',data=payload,headers={'Content-Type':'application/json'},method='POST')
try: urllib.request.urlopen(req,timeout=3)
except: pass
" 2>/dev/null
exit 0
TRACKEOF

sed -i "s|__TRACK_HOST__|$SYNC_HOST|g" "$PLUGIN_DIR/hooks-handlers/track-usage.sh"
chmod +x "$PLUGIN_DIR/hooks-handlers/track-usage.sh"

# ── add MCP server ───────────────────────────────────────────────────────────
if command -v claude &>/dev/null; then
    claude mcp add --transport http --scope user skillnote "$MCP_URL" 2>/dev/null || true
fi

# ── first sync ───────────────────────────────────────────────────────────────
"$PLUGIN_DIR/hooks-handlers/sync.sh" 2>/dev/null || true

SKILL_COUNT=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/skills" 2>/dev/null \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

echo ""
echo "  SkillNote connected!"
echo ""
echo "  API:  $API_URL"
echo "  MCP:  $MCP_URL"
echo "  Web:  $WEB_URL"
echo "  Skills: $SKILL_COUNT synced"
echo ""
echo "  Start claude in any project."
echo ""
