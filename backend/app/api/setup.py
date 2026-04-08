import os
import io
import zipfile
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, Response

router = APIRouter(tags=["setup"])

_PLUGIN_DIR = Path("/plugin") if Path("/plugin/.claude-plugin").is_dir() else Path(__file__).resolve().parent.parent.parent.parent / "plugin"


import re as _re

def _derive_urls(request: Request):
    raw_host = request.headers.get("host", "localhost:8082").split(":")[0]
    # Sanitize host to prevent shell injection when embedded in setup script
    host = raw_host if _re.match(r'^[a-zA-Z0-9._-]+$', raw_host) else "localhost"
    return {
        "api": os.environ.get("SKILLNOTE_API_URL", f"http://{host}:8082"),
        "mcp": os.environ.get("SKILLNOTE_MCP_URL", f"http://{host}:8083/mcp"),
        "web": os.environ.get("SKILLNOTE_WEB_URL", f"http://{host}:3000"),
        "host": host,
    }


@router.get("/v1/config")
def get_config(request: Request):
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
                if fpath.is_file() and "__pycache__" not in str(fpath) and "/tests/" not in str(fpath):
                    rel = fpath.relative_to(_PLUGIN_DIR)
                    content = fpath.read_text(errors="replace")
                    content = (content
                               .replace("${CLAUDE_PLUGIN_OPTION_HOST:-localhost}", f"${{CLAUDE_PLUGIN_OPTION_HOST:-{host}}}")
                               .replace("'CLAUDE_PLUGIN_OPTION_HOST', 'localhost'", f"'CLAUDE_PLUGIN_OPTION_HOST', '{host}'")
                               .replace("${CLAUDE_PLUGIN_OPTION_HOST}", f"${{CLAUDE_PLUGIN_OPTION_HOST:-{host}}}")
                               .replace("http://localhost:8082", api_url)
                               .replace("http://localhost:8083/mcp", mcp_url)
                               .replace("http://localhost:3000", web_url))
                    zf.writestr(str(rel), content)
    buf.seek(0)
    return Response(content=buf.read(), media_type="application/zip")


_SETUP_SCRIPT = r'''#!/bin/bash
set -euo pipefail

API_URL="__API_URL__"
# MCP server removed — skills delivered via sync hooks
WEB_URL="__WEB_URL__"
CLAUDE_HOME="$HOME/.claude"
MKT_DIR="$CLAUDE_HOME/plugins/marketplaces/skillnote-local"
PLUGIN_SRC="$MKT_DIR/plugins/skillnote"

echo "SkillNote: setting up..."

# ── prerequisites ────────────────────────────────────────────────────────────
command -v python3 &>/dev/null || { echo "Error: python3 required."; exit 1; }
command -v curl &>/dev/null || { echo "Error: curl required."; exit 1; }
command -v unzip &>/dev/null || { echo "Error: unzip required."; exit 1; }

# ── download plugin into marketplace dir ─────────────────────────────────────
rm -rf "$MKT_DIR"
mkdir -p "$MKT_DIR/.claude-plugin" "$PLUGIN_SRC"

# Download and extract plugin files
curl -sf --connect-timeout 10 --max-time 30 "$API_URL/v1/plugin.zip" -o /tmp/skillnote-plugin.zip || {
    echo "Error: Could not download plugin from $API_URL/v1/plugin.zip"
    exit 1
}
unzip -qo /tmp/skillnote-plugin.zip -d "$PLUGIN_SRC"
rm -f /tmp/skillnote-plugin.zip
chmod +x "$PLUGIN_SRC/hooks-handlers/"*.sh "$PLUGIN_SRC/bin/"* 2>/dev/null || true

# ── write marketplace manifest ───────────────────────────────────────────────
cat > "$MKT_DIR/.claude-plugin/marketplace.json" << MKTEOF
{"name":"skillnote-local","version":"1.0.0","description":"SkillNote skill registry","owner":{"name":"SkillNote"},"plugins":[{"name":"skillnote","description":"SkillNote — auto-sync, analytics, and skill creation","source":"./plugins/skillnote","version":"1.0.0"}]}
MKTEOF

# ── define paths early (used by settings registration and later steps) ───────
SKILLNOTE_HOME="$HOME/.skillnote"

# ── register marketplace in settings ─────────────────────────────────────────
USER_SETTINGS="$CLAUDE_HOME/settings.json"
python3 -c "
import json, os, sys
path = '$USER_SETTINGS'
data = {}
if os.path.exists(path):
    try:
        with open(path) as f: data = json.load(f)
    except (json.JSONDecodeError, ValueError):
        # Backup corrupted file instead of silently overwriting
        import shutil
        shutil.copy2(path, path + '.bak')
        print(f'Warning: {path} was invalid JSON. Backed up to {path}.bak', file=sys.stderr)
        data = {}
# Add marketplace
data.setdefault('extraKnownMarketplaces', {})
data['extraKnownMarketplaces']['skillnote-local'] = {
    'source': {'source': 'directory', 'path': os.path.expanduser('$MKT_DIR')}
}
# Add SkillNote status line (only if not already set)
if 'statusLine' not in data:
    data['statusLine'] = {
        'type': 'command',
        'command': os.path.expanduser('$SKILLNOTE_HOME/bin/skillnote-statusline')
    }
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null

# ── install plugin via claude CLI ────────────────────────────────────────────
if command -v claude &>/dev/null; then
    # Register marketplace, then install plugin
    claude plugin marketplace add "$MKT_DIR" 2>/dev/null || true
    claude plugin uninstall skillnote@skillnote-local --scope user 2>/dev/null || true
    claude plugin install skillnote@skillnote-local --scope user 2>/dev/null || {
        echo "Warning: plugin install failed. Try manually:"
        echo "  claude plugin install skillnote@skillnote-local --scope user"
    }
else
    echo "Warning: claude CLI not found. After installing claude, run:"
    echo "  claude plugin marketplace add $MKT_DIR"
    echo "  claude plugin install skillnote@skillnote-local --scope user"
fi

# ── clean up legacy rules file (picker handles collection selection now) ──────
rm -f "$CLAUDE_HOME/rules/skillnote-collection.md" 2>/dev/null

# ── first sync ────────────────────────────────────────────────────────────────
# Find the installed plugin path (claude plugin install copies it to cache)
INSTALLED_PATH=$(python3 -c "
import json, os
try:
    d = json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))
    entry = d.get('plugins', {}).get('skillnote@skillnote-local', [{}])[0]
    print(entry.get('installPath', ''))
except: print('')
" 2>/dev/null)

if [ -n "$INSTALLED_PATH" ] && [ -f "$INSTALLED_PATH/hooks-handlers/sync.sh" ]; then
    export CLAUDE_PLUGIN_ROOT="$INSTALLED_PATH"
    export CLAUDE_PLUGIN_OPTION_HOST="$(echo "$API_URL" | sed -E 's|https?://||;s|:.*||')"
    "$INSTALLED_PATH/hooks-handlers/sync.sh" 2>/dev/null || true
fi

SKILL_COUNT=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/skills" 2>/dev/null \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

COLLECTIONS_LIST=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/collections" 2>/dev/null \
  | python3 -c "import json,sys; [print(f'    {c[\"name\"]} ({c[\"count\"]} skills)') for c in json.load(sys.stdin)]" 2>/dev/null || echo "    (none)")

echo ""
echo "  Web:  $WEB_URL"
echo "  API:  $API_URL"
echo ""
echo "  ★ github.com/luna-prompts/skillnote — Star us!"
echo ""
# ── shell wrapper (collection picker before claude) ───────────────────────────
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"; fi

# ── install skillnote-pick to stable location ─────────────────────────────────
SKILL_HOST=$(echo "$API_URL" | sed -E 's|https?://||;s|:.*||')
mkdir -p "$SKILLNOTE_HOME/bin"
cp "$PLUGIN_SRC/bin/skillnote-pick" "$SKILLNOTE_HOME/bin/skillnote-pick"
cp "$PLUGIN_SRC/bin/skillnote-statusline" "$SKILLNOTE_HOME/bin/skillnote-statusline"
chmod +x "$SKILLNOTE_HOME/bin/skillnote-pick" "$SKILLNOTE_HOME/bin/skillnote-statusline"
# Save host for the picker to read at runtime
echo "$SKILL_HOST" > "$SKILLNOTE_HOME/host"
PICKER_PATH="$SKILLNOTE_HOME/bin/skillnote-pick"
# Remove any old wrapper first (handles updates cleanly)
if [ -n "$SHELL_RC" ]; then
    # macOS sed needs '' after -i, Linux doesn't — use Python for portability
    python3 -c "
import re
path = '$SHELL_RC'
content = open(path).read()
# Remove old SkillNote wrapper block
content = re.sub(r'\n# SkillNote:.*?command claude.*?\n\}', '', content, flags=re.DOTALL)
open(path, 'w').write(content)
" 2>/dev/null
fi

if [ -n "$SHELL_RC" ]; then
    cat >> "$SHELL_RC" << WRAPEOF

# SkillNote: collection picker before launching claude
claude() {
  if [ -t 0 ] && [ -t 1 ]; then
    "$PICKER_PATH" || true
  fi
  command claude "\$@"
}
WRAPEOF
    echo "  Shell wrapper added to $SHELL_RC"
else
    echo "  Warning: No .zshrc or .bashrc found."
    echo "  Collection picker won't auto-run. Run skillnote-pick manually."
fi

echo ""
python3 -c "
rc = '$SHELL_RC'
bw = 60

def row(text=''):
    print('  │' + text.ljust(bw - 2) + '│')

print('  ╭─ Getting started ' + '─' * (bw - 20) + '╮')
row()
if rc:
    row('  1. source ' + rc)
    row('     or open a new terminal')
else:
    row('  1. Open a new terminal')
row()
row('  2. claude')
row('     the skill collection picker will appear')
row()
print('  ╰' + '─' * (bw - 2) + '╯')
" 2>/dev/null
echo ""
'''


@router.get("/setup")
def get_setup_script(request: Request):
    urls = _derive_urls(request)
    script = (_SETUP_SCRIPT
              .replace("__API_URL__", urls["api"])
              .replace("__MCP_URL__", urls["mcp"])
              .replace("__WEB_URL__", urls["web"]))
    return PlainTextResponse(script, media_type="text/plain")
