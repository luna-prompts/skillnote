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

# ── wipe ALL prior SkillNote plugin state (idempotent clean install) ────────
# Nuke every known location Claude Code might read SkillNote files from, so
# the new install cannot inherit stale wrapper commands, old hooks, or
# version-pinned cache directories from previous installs.
rm -rf "$MKT_DIR"
rm -rf "$CLAUDE_HOME/plugins/cache/skillnote-local"
rm -rf "$CLAUDE_HOME/plugins/data/skillnote-skillnote-local"
# Temp staging dirs created by `claude plugin install` sometimes persist
find "$CLAUDE_HOME/plugins/cache" -maxdepth 1 -type d -name "temp_local_*" -exec rm -rf {} + 2>/dev/null || true

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

# ── generic cache reconciliation (catches ANY stale file, not just wrappers) ──
# After `claude plugin install`, compare the cache directory file-by-file
# against the freshly-unzipped marketplace source. Delete any file in the
# cache that doesn't exist in the current marketplace. This is the generic
# safety net for ALL future file removals — not just the skill-push.md /
# collection.md wrappers. Whenever we delete a file from the plugin source,
# existing installs will automatically drop it on the next setup run.
MKT_ROOT="$MKT_DIR/plugins/skillnote" \
CACHE_GLOB="$CLAUDE_HOME/plugins/cache/skillnote-local/skillnote/*/" \
python3 - << 'RECONCILE_EOF' 2>/dev/null || true
import os, sys, glob

market_root = os.environ.get("MKT_ROOT", "")
cache_glob  = os.environ.get("CACHE_GLOB", "")

if not market_root or not os.path.isdir(market_root):
    sys.exit(0)

# Set of relative paths that SHOULD exist in every cache copy
expected = set()
for dirpath, _dirs, files in os.walk(market_root):
    rel_dir = os.path.relpath(dirpath, market_root)
    for f in files:
        expected.add(os.path.normpath(os.path.join(rel_dir, f)))

removed_files = 0
for cache_root in glob.glob(cache_glob):
    if not os.path.isdir(cache_root):
        continue
    for dirpath, _dirs, files in os.walk(cache_root):
        rel_dir = os.path.relpath(dirpath, cache_root)
        for f in files:
            rel = os.path.normpath(os.path.join(rel_dir, f))
            if rel not in expected:
                try:
                    os.unlink(os.path.join(dirpath, f))
                    removed_files += 1
                except OSError:
                    pass
    # Prune empty directories left behind
    for dirpath, _dirs, _files in os.walk(cache_root, topdown=False):
        if dirpath == cache_root:
            continue
        try:
            os.rmdir(dirpath)
        except OSError:
            pass

if removed_files:
    print(f"  Cleaned up {removed_files} stale file(s) from plugin cache.")
RECONCILE_EOF

# ── clean up legacy rules file (picker handles collection selection now) ──────
rm -f "$CLAUDE_HOME/rules/skillnote-collection.md" 2>/dev/null

COLLECTIONS_LIST=$(curl -sf --connect-timeout 5 --max-time 10 "$API_URL/v1/collections" 2>/dev/null \
  | python3 -c "import json,sys; [print(f'    {c[\"name\"]} ({c[\"count\"]} skills)') for c in json.load(sys.stdin)]" 2>/dev/null || echo "    (none)")

echo ""
echo "  Web:  $WEB_URL"
echo "  API:  $API_URL"
echo ""
echo "  ★ github.com/luna-prompts/skillnote — Star us!"
echo ""
# ── shell wrapper (collection picker before claude) ───────────────────────────
# Detect RC file from the user's actual shell
SHELL_RC=""
case "$(basename "${SHELL:-/bin/sh}")" in
  zsh)  SHELL_RC="$HOME/.zshrc" ;;
  bash) # bash: prefer .bashrc, fall back to .bash_profile (macOS pre-Catalina)
        if [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then SHELL_RC="$HOME/.bash_profile"
        else SHELL_RC="$HOME/.bashrc"; fi ;;
  fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
  *)    # Fallback: try common RC files in order
        for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc" "$HOME/.profile"; do
            if [ -f "$rc" ]; then SHELL_RC="$rc"; break; fi
        done ;;
esac

# ── install skillnote-pick to stable location ─────────────────────────────────
SKILL_HOST=$(echo "$API_URL" | sed -E 's|https?://||;s|:.*||')
mkdir -p "$SKILLNOTE_HOME/bin"
cp "$PLUGIN_SRC/bin/skillnote-pick" "$SKILLNOTE_HOME/bin/skillnote-pick"
cp "$PLUGIN_SRC/bin/skillnote-statusline" "$SKILLNOTE_HOME/bin/skillnote-statusline"
chmod +x "$SKILLNOTE_HOME/bin/skillnote-pick" "$SKILLNOTE_HOME/bin/skillnote-statusline"
# Save host for the picker to read at runtime
echo "$SKILL_HOST" > "$SKILLNOTE_HOME/host"
PICKER_PATH="$SKILLNOTE_HOME/bin/skillnote-pick"
# Remove any old wrapper first (handles updates cleanly). Uses explicit
# BEGIN/END markers so future format changes can still be detected and
# scrubbed reliably, and also matches the old regex-based format for
# migration from pre-marker installs.
if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
    SHELL_RC_PATH="$SHELL_RC" python3 - << 'WRAPCLEAN_EOF' 2>/dev/null || true
import os, re
path = os.environ.get("SHELL_RC_PATH", "")
if not path or not os.path.isfile(path):
    raise SystemExit(0)
content = open(path).read()
# New marker-based format (SkillNote v3+)
content = re.sub(r'\n?# >>> SKILLNOTE WRAPPER BEGIN.*?# <<< SKILLNOTE WRAPPER END\n?',
                 '', content, flags=re.DOTALL)
# Legacy bash/zsh format (pre-marker)
content = re.sub(r'\n# SkillNote:[^\n]*\nclaude\(\) \{.*?\n\}\n?',
                 '', content, flags=re.DOTALL)
# Legacy fish format (pre-marker)
content = re.sub(r'\n# SkillNote:[^\n]*\nfunction claude.*?\nend\n?',
                 '', content, flags=re.DOTALL)
# Collapse multiple blank lines that may be left behind
content = re.sub(r'\n{3,}', '\n\n', content)
open(path, 'w').write(content)
WRAPCLEAN_EOF
fi

if [ -n "$SHELL_RC" ]; then
    case "$SHELL_RC" in
      *config.fish)
        cat >> "$SHELL_RC" << WRAPEOF

# >>> SKILLNOTE WRAPPER BEGIN (do not edit; managed by skillnote setup)
function claude
  if isatty stdin; and isatty stdout
    "$PICKER_PATH"; or true
  end
  command claude \$argv
end
# <<< SKILLNOTE WRAPPER END
WRAPEOF
        ;;
      *)
        cat >> "$SHELL_RC" << WRAPEOF

# >>> SKILLNOTE WRAPPER BEGIN (do not edit; managed by skillnote setup)
claude() {
  if [ -t 0 ] && [ -t 1 ]; then
    "$PICKER_PATH" || true
  fi
  command claude "\$@"
}
# <<< SKILLNOTE WRAPPER END
WRAPEOF
        ;;
    esac
    echo "  Shell wrapper added to $SHELL_RC"
else
    echo "  Warning: Could not detect shell RC file."
    echo "  Collection picker won't auto-run. Run skillnote-pick manually before claude."
fi

echo ""
python3 -c "
rc = '$SHELL_RC'
bw = 60

def row(text=''):
    print('  │' + text.ljust(bw - 2) + '│')

print('  ╭─ Getting started ' + '─' * (bw - 20) + '╮')
row()
row('  1. Quit any running Claude Code sessions')
row()
if rc:
    row('  2. source ' + rc)
    row('     or open a new terminal')
else:
    row('  2. Open a new terminal')
row()
row('  3. claude')
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
