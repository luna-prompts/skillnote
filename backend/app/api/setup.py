from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["setup"])


@router.get("/v1/config")
def get_config(request: Request):
    """Return service URLs for plugin/hook discovery."""
    import os
    host = request.headers.get("host", "localhost:8082").split(":")[0]
    return {
        "api_url": os.environ.get("SKILLNOTE_API_URL", f"http://{host}:8082"),
        "mcp_url": os.environ.get("SKILLNOTE_MCP_URL", f"http://{host}:8083/mcp"),
        "web_url": os.environ.get("SKILLNOTE_WEB_URL", f"http://{host}:3000"),
    }


_SETUP_SCRIPT = r'''#!/bin/bash
set -e

API_URL="__API_URL__"
MCP_URL="__MCP_URL__"
WEB_URL="__WEB_URL__"
CLAUDE_HOME="$HOME/.claude"

echo "SkillNote: Setting up Claude Code integration..."

# 1. Create plugin directory
PLUGIN_DIR="$CLAUDE_HOME/plugins/cache/skillnote-local/skillnote/1.0.0"
mkdir -p "$PLUGIN_DIR/.claude-plugin"
mkdir -p "$PLUGIN_DIR/hooks"
mkdir -p "$PLUGIN_DIR/hooks-handlers"

# 2. Write plugin.json
cat > "$PLUGIN_DIR/.claude-plugin/plugin.json" << 'PJEOF'
{"name":"skillnote","version":"1.0.0","description":"SkillNote skill registry - auto-sync with full features."}
PJEOF

# 3. Write .mcp.json
cat > "$PLUGIN_DIR/.mcp.json" << MCPEOF
{"mcpServers":{"skillnote":{"type":"http","url":"$MCP_URL"}}}
MCPEOF

# 4. Write hooks.json
cat > "$PLUGIN_DIR/hooks/hooks.json" << 'HEOF'
{"hooks":{"SessionStart":[{"matcher":"startup","hooks":[{"type":"command","command":"\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/sync.sh\"","timeout":15,"statusMessage":"SkillNote: syncing skills..."}]}]}}
HEOF

# 5. Write sync script
cat > "$PLUGIN_DIR/hooks-handlers/sync.sh" << 'SEOF'
#!/bin/bash
API_URL="__SYNC_API_URL__"
SKILLS_DIR="$HOME/.claude/skills"
MANIFEST="$SKILLS_DIR/.skillnote-manifest.json"
SKILLS=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/skills" 2>/dev/null) || exit 0
mkdir -p "$SKILLS_DIR"
echo "$SKILLS" | python3 -c "
import json,sys,os,shutil
skills=json.load(sys.stdin)
sd=os.path.expanduser('~/.claude/skills')
mp=os.path.join(sd,'.skillnote-manifest.json')
api_slugs=set()
old=set()
if os.path.exists(mp):
    with open(mp) as f: old=set(json.load(f).get('skills',[]))
c,u,d=0,0,0
for s in skills:
    slug=s['slug'];api_slugs.add(slug)
    dd=os.path.join(sd,slug);os.makedirs(dd,exist_ok=True)
    fm=['name: '+slug,'description: '+s['description']]
    if s.get('collections'):fm.append('collections: ['+', '.join(s['collections'])+']')
    ex=s.get('extra_frontmatter') or ''
    if ex.strip():fm.append(ex.strip())
    content='---\n'+'\n'.join(fm)+'\n---\n\n'+(s.get('content_md') or '')
    fp=os.path.join(dd,'SKILL.md')
    if os.path.exists(fp):
        with open(fp) as f:
            if f.read()==content:continue
        u+=1
    else:c+=1
    with open(fp,'w') as f:f.write(content)
for slug in old-api_slugs:
    dd=os.path.join(sd,slug)
    if os.path.isdir(dd):shutil.rmtree(dd);d+=1
with open(mp,'w') as f:json.dump({'skills':sorted(api_slugs)},f)
p=[]
if c:p.append(f'{c} new')
if u:p.append(f'{u} updated')
if d:p.append(f'{d} removed')
t=len(skills)
msg=f'SkillNote: {t} skills ({chr(44).join(p)})' if p else f'SkillNote: {t} skills (all current)'
print(msg)
" 2>/dev/null
SEOF
sed -i "s|__SYNC_API_URL__|$API_URL|g" "$PLUGIN_DIR/hooks-handlers/sync.sh"
chmod +x "$PLUGIN_DIR/hooks-handlers/sync.sh"

# 6. Add MCP server (user scope)
if command -v claude &>/dev/null; then
    claude mcp add --transport http --scope user skillnote "$MCP_URL" 2>/dev/null || true
fi

# 7. First sync
"$PLUGIN_DIR/hooks-handlers/sync.sh" 2>/dev/null || true

SKILL_COUNT=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/skills" 2>/dev/null | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

echo ""
echo "  SkillNote connected!"
echo ""
echo "  API:  $API_URL"
echo "  MCP:  $MCP_URL"
echo "  Web:  $WEB_URL"
echo "  Skills synced: $SKILL_COUNT"
echo ""
echo "  Start claude in any project."
echo ""
'''


@router.get("/setup")
def get_setup_script(request: Request):
    """Serve the curl|bash install script with URLs baked in from the request."""
    import os
    host = request.headers.get("host", "localhost:8082").split(":")[0]
    api_url = os.environ.get("SKILLNOTE_API_URL", f"http://{host}:8082")
    mcp_url = os.environ.get("SKILLNOTE_MCP_URL", f"http://{host}:8083/mcp")
    web_url = os.environ.get("SKILLNOTE_WEB_URL", f"http://{host}:3000")

    script = _SETUP_SCRIPT.replace("__API_URL__", api_url).replace("__MCP_URL__", mcp_url).replace("__WEB_URL__", web_url)
    return PlainTextResponse(script, media_type="text/plain")
