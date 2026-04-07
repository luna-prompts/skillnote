import os
import io
import zipfile
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, Response

router = APIRouter(tags=["setup"])

# Plugin source directory: Docker mount at /plugin, or relative in dev
_PLUGIN_DIR = Path("/plugin") if Path("/plugin/.claude-plugin").is_dir() else Path(__file__).resolve().parent.parent.parent.parent / "plugin"


def _derive_urls(request: Request):
    host = request.headers.get("host", "localhost:8082").split(":")[0]
    return {
        "api": os.environ.get("SKILLNOTE_API_URL", f"http://{host}:8082"),
        "mcp": os.environ.get("SKILLNOTE_MCP_URL", f"http://{host}:8083/mcp"),
        "web": os.environ.get("SKILLNOTE_WEB_URL", f"http://{host}:3000"),
        "host": host,
    }


@router.get("/v1/config")
def get_config(request: Request):
    """Return service URLs for plugin/hook discovery."""
    urls = _derive_urls(request)
    return {"api_url": urls["api"], "mcp_url": urls["mcp"], "web_url": urls["web"]}


@router.get("/v1/plugin.zip")
def get_plugin_zip(request: Request):
    """Serve the plugin directory as a ZIP with host URLs baked in."""
    urls = _derive_urls(request)
    host = urls["host"]
    api_url = urls["api"]
    mcp_url = urls["mcp"]
    web_url = urls["web"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if _PLUGIN_DIR.is_dir():
            for fpath in _PLUGIN_DIR.rglob("*"):
                if fpath.is_file() and "__pycache__" not in str(fpath) and "tests/" not in str(fpath):
                    rel = fpath.relative_to(_PLUGIN_DIR)
                    content = fpath.read_text(errors="replace")
                    # Substitute ALL host placeholders
                    content = (content
                               .replace("${CLAUDE_PLUGIN_OPTION_HOST:-localhost}", f"${{CLAUDE_PLUGIN_OPTION_HOST:-{host}}}")
                               .replace("'CLAUDE_PLUGIN_OPTION_HOST', 'localhost'", f"'CLAUDE_PLUGIN_OPTION_HOST', '{host}'")
                               .replace("${CLAUDE_PLUGIN_OPTION_HOST}", f"${{CLAUDE_PLUGIN_OPTION_HOST:-{host}}}")
                               .replace("http://localhost:8082", api_url)
                               .replace("http://localhost:8083/mcp", mcp_url)
                               .replace("http://localhost:3000", web_url))
                    zf.writestr(str(rel), content)

    buf.seek(0)
    return Response(content=buf.read(), media_type="application/zip",
                    headers={"Content-Disposition": "attachment; filename=skillnote-plugin.zip"})


_SETUP_SCRIPT = r'''#!/bin/bash
set -euo pipefail

API_URL="__API_URL__"
MCP_URL="__MCP_URL__"
WEB_URL="__WEB_URL__"
CLAUDE_HOME="$HOME/.claude"
PLUGIN_DIR="$CLAUDE_HOME/plugins/cache/skillnote-local/skillnote/1.0.0"

echo "SkillNote: setting up..."

# ── prerequisites ────────────────────────────────────────────────────────────
command -v python3 &>/dev/null || { echo "Error: python3 required."; exit 1; }
command -v curl &>/dev/null || { echo "Error: curl required."; exit 1; }
command -v unzip &>/dev/null || { echo "Error: unzip required."; exit 1; }

# ── download plugin ──────────────────────────────────────────────────────────
rm -rf "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
curl -sf --connect-timeout 10 --max-time 30 "$API_URL/v1/plugin.zip" -o /tmp/skillnote-plugin.zip || {
    echo "Error: Could not download plugin from $API_URL/v1/plugin.zip"
    exit 1
}
unzip -qo /tmp/skillnote-plugin.zip -d "$PLUGIN_DIR"
rm -f /tmp/skillnote-plugin.zip
chmod +x "$PLUGIN_DIR/hooks-handlers/"*.sh "$PLUGIN_DIR/bin/"* 2>/dev/null || true

# ── register marketplace ──────────────────────────────────────────────────────
MARKETPLACE_DIR="$CLAUDE_HOME/plugins/marketplaces/skillnote-local"
mkdir -p "$MARKETPLACE_DIR"
cat > "$MARKETPLACE_DIR/marketplace.json" << 'MKTEOF'
{"name":"skillnote-local","owner":{"name":"SkillNote"},"plugins":[{"name":"skillnote","source":"./","version":"1.0.0"}]}
MKTEOF

KNOWN_MKT="$CLAUDE_HOME/plugins/known_marketplaces.json"
python3 -c "
import json, os
from datetime import datetime, timezone

path = '$KNOWN_MKT'
data = {}
if os.path.exists(path):
    try:
        with open(path) as f: data = json.load(f)
    except: data = {}

now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
data['skillnote-local'] = {
    'source': {'source': 'directory', 'path': '$MARKETPLACE_DIR'},
    'installLocation': '$MARKETPLACE_DIR',
    'lastUpdated': now,
}
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null

# ── register plugin ──────────────────────────────────────────────────────────
INSTALLED="$CLAUDE_HOME/plugins/installed_plugins.json"
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

if 'version' not in data: data['version'] = 2
if 'plugins' not in data: data['plugins'] = {}

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
"

# ── enable plugin ─────────────────────────────────────────────────────────────
USER_SETTINGS="$CLAUDE_HOME/settings.json"
python3 -c "
import json, os
path = '$USER_SETTINGS'
data = {}
if os.path.exists(path):
    try:
        with open(path) as f: data = json.load(f)
    except: data = {}
data.setdefault('enabledPlugins', {})['skillnote@skillnote-local'] = True
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
"

# ── add MCP server ────────────────────────────────────────────────────────────
if command -v claude &>/dev/null; then
    claude mcp add --transport http --scope user skillnote "$MCP_URL" 2>/dev/null || true
fi

# ── first sync ────────────────────────────────────────────────────────────────
"$PLUGIN_DIR/hooks-handlers/sync.sh" 2>/dev/null || true

SKILL_COUNT=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/skills" 2>/dev/null \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

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
echo "  IMPORTANT: Restart Claude Code for skills to take effect."
echo "  (quit and reopen — /reload-plugins alone is not sufficient)"
echo ""
'''


@router.get("/setup")
def get_setup_script(request: Request):
    """Serve the curl|bash install script."""
    urls = _derive_urls(request)
    script = (_SETUP_SCRIPT
              .replace("__API_URL__", urls["api"])
              .replace("__MCP_URL__", urls["mcp"])
              .replace("__WEB_URL__", urls["web"]))
    return PlainTextResponse(script, media_type="text/plain")
