import os
import io
import zipfile
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import AgentInstall
from app.db.session import get_db

router = APIRouter(tags=["setup"])

# Agents the Connect page understands. Keep the canonical names in sync
# with the frontend's `AgentId` union and with the install scripts below.
SUPPORTED_AGENTS = ("claude-code", "openclaw")
AgentLiteral = Literal["claude-code", "openclaw"]

# Buckets for the per-agent state machine on the Connect page.
ACTIVE_WINDOW_HOURS = 24
IDLE_WINDOW_DAYS = 30

_PLUGIN_DIR = Path("/plugin") if Path("/plugin/.claude-plugin").is_dir() else Path(__file__).resolve().parent.parent.parent.parent / "plugin"
_OPENCLAW_DIR = Path("/openclaw") if Path("/openclaw").is_dir() else Path(__file__).resolve().parent.parent.parent.parent / "plugin-openclaw"


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
# Refuse to extract symlink entries — unzip honors them and would let a
# compromised registry plant arbitrary symlinks on the operator's disk.
if unzip -Z /tmp/skillnote-plugin.zip 2>/dev/null | awk '{print $1}' | grep -q '^l'; then
    echo "Error: plugin bundle contains symbolic link entries; refusing to extract"
    rm -f /tmp/skillnote-plugin.zip
    exit 1
fi
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

# ── ping backend so the Connect page knows we installed ─────────────────────
# Fire-and-forget. Failure is silently ignored — the Connect page will still
# fall back to "active" detection via skill_call_events once the user runs
# their first task. We hash hostname+user so we don't ship raw PII.
MACHINE_HASH=$(printf '%s' "${HOSTNAME:-host}-${USER:-user}" \
    | shasum -a 256 2>/dev/null \
    | awk '{print $1}' \
    || echo "")
curl -sf --max-time 5 -X POST "$API_URL/v1/setup/installs" \
    -H "Content-Type: application/json" \
    -d "{\"agent\":\"claude-code\",\"machine_id_hash\":\"$MACHINE_HASH\"}" \
    >/dev/null 2>&1 || true

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


@router.get("/v1/openclaw-bundle.zip")
def get_openclaw_bundle_zip(request: Request):
    """Serve the plugin-openclaw directory as a ZIP with host URLs baked in."""
    urls = _derive_urls(request)
    api_url = urls["api"]
    web_url = urls["web"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if _OPENCLAW_DIR.is_dir():
            for fpath in _OPENCLAW_DIR.rglob("*"):
                if fpath.is_file() and "__pycache__" not in str(fpath):
                    rel = fpath.relative_to(_OPENCLAW_DIR)
                    content = fpath.read_text(errors="replace")
                    content = (content
                               .replace("{{HOST}}", api_url)
                               .replace("{{WEB_URL}}", web_url))
                    zf.writestr(str(rel), content)
    buf.seek(0)
    return Response(content=buf.read(), media_type="application/zip")


_OPENCLAW_SETUP_SCRIPT = r'''#!/bin/bash
set -euo pipefail

API_URL="__API_URL__"
WEB_URL="__WEB_URL__"
OPENCLAW_HOME="$HOME/.openclaw"
SKILLS_DIR="$OPENCLAW_HOME/skills"
SKILLNOTE_DIR="$SKILLS_DIR/skillnote"

echo ""
echo "  S K I L L N O T E   →   O P E N C L A W"
echo ""

# ── prerequisites ────────────────────────────────────────────────────────────
command -v curl &>/dev/null || { echo "Error: curl required."; exit 1; }
command -v unzip &>/dev/null || { echo "Error: unzip required."; exit 1; }
command -v python3 &>/dev/null || { echo "Error: python3 required."; exit 1; }

# ── consent prompt (interactive only) ─────────────────────────────────────────
if [ -t 0 ]; then
    echo "  This will install the SkillNote skill into $SKILLS_DIR/skillnote/"
    echo "  and configure it to talk to $API_URL"
    echo ""
    read -p "  Continue? [y/N] " yn
    case "$yn" in
        [Yy]*) ;;
        *) echo "  Aborted."; exit 0 ;;
    esac
else
    echo "  Non-interactive install (no TTY); proceeding."
fi

# ── idempotent clean install ─────────────────────────────────────────────────
# Stop any running watcher from a previous install before we touch its files
if [ -f "$SKILLNOTE_DIR/.log-watcher.pid" ]; then
    OLD_PID=$(cat "$SKILLNOTE_DIR/.log-watcher.pid" 2>/dev/null || true)
    [ -n "$OLD_PID" ] && kill "$OLD_PID" 2>/dev/null || true
fi

# Clean legacy 2-skill layout if present (skillnote-awareness / skillnote-resolver)
rm -rf "$SKILLS_DIR/skillnote-awareness" "$SKILLS_DIR/skillnote-resolver" 2>/dev/null || true

# Wipe the skillnote skill dir but preserve the user's existing config.json
PRESERVED_CONFIG=""
if [ -f "$SKILLNOTE_DIR/config.json" ]; then
    PRESERVED_CONFIG=$(mktemp -t skillnote-config.XXXXXX.json)
    cp "$SKILLNOTE_DIR/config.json" "$PRESERVED_CONFIG"
fi
rm -rf "$SKILLNOTE_DIR"

mkdir -p "$SKILLS_DIR"

# ── download bundle ──────────────────────────────────────────────────────────
TMP_ZIP=$(mktemp -t skillnote-openclaw.XXXXXX.zip) || { echo "Error: mktemp failed."; exit 1; }
trap 'rm -f "$TMP_ZIP" "$PRESERVED_CONFIG"' EXIT
curl -sf --connect-timeout 10 --max-time 30 "$API_URL/v1/openclaw-bundle.zip" -o "$TMP_ZIP" || {
    echo "Error: Could not download $API_URL/v1/openclaw-bundle.zip"
    exit 1
}

# ── refuse symlink and path-traversal entries ────────────────────────────────
if unzip -Z "$TMP_ZIP" 2>/dev/null | awk '{print $1}' | grep -q '^l'; then
    echo "Error: bundle contains symbolic link entries; refusing to extract."
    exit 1
fi
if unzip -l "$TMP_ZIP" 2>/dev/null | awk 'NR>3 && $1 ~ /^[0-9]+$/ {print $NF}' | grep -qE '^(/|\.\./|.*/\.\./)'; then
    echo "Error: bundle contains absolute or parent-directory paths; refusing to extract."
    exit 1
fi

# ── extract ──────────────────────────────────────────────────────────────────
unzip -qo "$TMP_ZIP" -d "$SKILLS_DIR"

# ── set up config.json from template (or restore preserved one) ──────────────
if [ -n "$PRESERVED_CONFIG" ] && [ -f "$PRESERVED_CONFIG" ]; then
    cp "$PRESERVED_CONFIG" "$SKILLNOTE_DIR/config.json"
    echo "  Preserved existing config.json"
else
    # Bundle ships config.template.json inside the skillnote/ dir.
    # Materialize it into a real config.json with the host pre-filled.
    if [ -f "$SKILLNOTE_DIR/config.template.json" ]; then
        python3 - "$API_URL" "$SKILLNOTE_DIR/config.template.json" "$SKILLNOTE_DIR/config.json" << 'PYEOF'
import json, sys
api_url, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    cfg = json.load(open(src))
except Exception:
    cfg = {}
cfg["host"] = api_url.rstrip("/")
cfg.setdefault("user_id", "openclaw-main")
json.dump(cfg, open(dst, "w"), indent=2)
PYEOF
    else
        # Fallback: write a minimal config so sync.sh works on first run
        cat > "$SKILLNOTE_DIR/config.json" <<EOF
{"host": "${API_URL%/}", "user_id": "openclaw-main"}
EOF
    fi
fi

# ── make sync.sh executable (CRITICAL — sync.sh needs +x to run) ─────────────
chmod +x "$SKILLNOTE_DIR/sync.sh"

# ── kick off first sync so user gets immediate feedback ──────────────────────
echo ""
echo "  Running first sync..."
if "$SKILLNOTE_DIR/sync.sh" 2>/dev/null; then
    SKILL_COUNT=$(ls "$SKILLS_DIR" 2>/dev/null | grep -c "^sn-" || echo 0)
    echo "  Synced $SKILL_COUNT skills into $SKILLS_DIR/sn-*/"
else
    echo "  First sync did not complete (will retry on next OpenClaw session)."
fi

# ── ping backend so the Connect page knows we installed ─────────────────────
# Same pattern as the claude-code installer — fire-and-forget, hashed
# machine id only (no PII).
MACHINE_HASH=$(printf '%s' "${HOSTNAME:-host}-${USER:-user}" \
    | shasum -a 256 2>/dev/null \
    | awk '{print $1}' \
    || echo "")
curl -sf --max-time 5 -X POST "$API_URL/v1/setup/installs" \
    -H "Content-Type: application/json" \
    -d "{\"agent\":\"openclaw\",\"machine_id_hash\":\"$MACHINE_HASH\"}" \
    >/dev/null 2>&1 || true

echo ""
echo "  Installed:"
echo "    $SKILLNOTE_DIR/SKILL.md         (always-loaded skill)"
echo "    $SKILLNOTE_DIR/sync.sh          (runs every 60s)"
echo "    $SKILLNOTE_DIR/log-watcher.py   (analytics daemon)"
echo "    $SKILLNOTE_DIR/config.json      (host: ${API_URL%/})"
echo ""
echo "  Restart your OpenClaw session to pick up the new skill."
echo "  Web: $WEB_URL"
echo ""
'''


@router.get("/setup/openclaw")
def get_openclaw_setup_script(request: Request):
    urls = _derive_urls(request)
    script = (_OPENCLAW_SETUP_SCRIPT
              .replace("__API_URL__", urls["api"])
              .replace("__WEB_URL__", urls["web"]))
    return PlainTextResponse(script, media_type="text/plain")


# Unified entry point: parses --agent <name> from $@ and delegates to the
# right per-agent installer. Keeps each installer's logic isolated (they
# touch different home dirs, ship different bundles) while giving users one
# command to remember:
#
#   curl -sf <host>/setup/agent | bash -s -- --agent openclaw
#   curl -sf <host>/setup/agent | bash -s -- --agent claude-code
_AGENT_DISPATCH_SCRIPT = r'''#!/bin/bash
set -euo pipefail

API_URL="__API_URL__"

# ── parse --agent flag ───────────────────────────────────────────────────────
AGENT=""
while [ $# -gt 0 ]; do
    case "$1" in
        --agent)
            AGENT="${2:-}"
            shift 2
            ;;
        --agent=*)
            AGENT="${1#--agent=}"
            shift
            ;;
        -h|--help)
            cat <<EOF
SkillNote agent installer

Usage:
  curl -sf $API_URL/setup/agent | bash -s -- --agent <name>

Supported agents:
  claude-code   Install the SkillNote plugin for Claude Code
  openclaw      Install the SkillNote skill for OpenClaw

Example:
  curl -sf $API_URL/setup/agent | bash -s -- --agent openclaw
EOF
            exit 0
            ;;
        *)
            echo "Error: unknown argument '$1'"
            echo "Run with --help for usage."
            exit 1
            ;;
    esac
done

# ── validate ─────────────────────────────────────────────────────────────────
if [ -z "$AGENT" ]; then
    echo "Error: --agent flag is required."
    echo ""
    echo "Usage:"
    echo "  curl -sf $API_URL/setup/agent | bash -s -- --agent <name>"
    echo ""
    echo "Supported agents:"
    echo "  claude-code   Install the SkillNote plugin for Claude Code"
    echo "  openclaw      Install the SkillNote skill for OpenClaw"
    exit 2
fi

case "$AGENT" in
    claude-code|claude_code|claude|cc)
        TARGET_PATH="/setup"
        AGENT_LABEL="Claude Code"
        ;;
    openclaw|open-claw|oc)
        TARGET_PATH="/setup/openclaw"
        AGENT_LABEL="OpenClaw"
        ;;
    *)
        echo "Error: unknown agent '$AGENT'."
        echo ""
        echo "Supported agents: claude-code, openclaw"
        exit 2
        ;;
esac

# ── delegate ─────────────────────────────────────────────────────────────────
echo "  Installing SkillNote for $AGENT_LABEL..."
echo "  Source: $API_URL$TARGET_PATH"
echo ""

# Download the agent-specific installer to a tempfile and exec it. We avoid
# `curl ... | bash` here because piping while also redirecting stdin from
# /dev/null causes curl to abort early (exit 23, broken pipe). The tempfile
# detour gives the installer a clean stdin (so its TTY check picks the
# non-interactive branch) without losing any output.
TMP_INSTALLER=$(mktemp -t skillnote-installer.XXXXXX.sh)
trap 'rm -f "$TMP_INSTALLER"' EXIT

if ! curl -sf --connect-timeout 10 --max-time 60 \
        "$API_URL$TARGET_PATH" -o "$TMP_INSTALLER"; then
    echo "Error: failed to download installer from $API_URL$TARGET_PATH"
    exit 3
fi

bash "$TMP_INSTALLER" < /dev/null
'''


@router.get("/setup/agent")
def get_agent_dispatch_script(request: Request):
    """Unified curl entry point that delegates to the per-agent installer."""
    urls = _derive_urls(request)
    script = _AGENT_DISPATCH_SCRIPT.replace("__API_URL__", urls["api"])
    return PlainTextResponse(script, media_type="text/plain")


# ─── Personalized agent install prompts ──────────────────────────────────────
# Returns a markdown copy-prompt with the user's actual SkillNote URL baked in.
# The Connect page renders this with a "Copy as Markdown" button so that the
# user can paste it into a fresh OpenClaw / Claude Code session and the agent
# installs everything itself.
#
# Modeled on api2cli's "One-Prompt Setup" pattern, which is the dominant
# install UX in the OpenClaw ecosystem today.

_OPENCLAW_AGENT_PROMPT = """Set up SkillNote for me end-to-end. The skill is published on clawhub and I want you to handle everything: backend, plugin, configuration, verification.

Please do the full install yourself — don't ask me to run commands.

1. **Install the SkillNote skill from clawhub:**
   ```bash
   command -v clawhub || npm i -g clawhub
   clawhub install skillnote
   ```
   (If `clawhub install skillnote` fails because the registry isn't reachable, fall back to the bundle installer: `curl -sf __API_URL__/setup/agent | bash -s -- --agent openclaw` — that will take care of installing the skill files locally.)

2. **Read the skill's SKILL.md and follow its setup steps in order:**
   ```bash
   cat ~/.openclaw/skills/skillnote/SKILL.md
   ```
   The SKILL.md tells you how to:
   - Resolve the SkillNote host (env var → config file → default `http://localhost:8082`)
   - **If the backend is not running on localhost, the SKILL.md tells you to clone and `./install.sh` it yourself** — do that, don't ask me. It takes ~3 minutes.
   - Persist the resolved host to config.json
   - Run the first sync
   - Graft `~/.openclaw/workspace/AGENTS.md` with the `<skillnote v1>` block

3. **Verify everything works** and report back to me:
   - Backend reachable: `curl -sf __API_URL__/health` (or whatever URL you ended up using)
   - Skills synced: `ls ~/.openclaw/skills/sn-* 2>/dev/null | wc -l`
   - Daemon running: `cat ~/.openclaw/skills/skillnote/.log-watcher.pid` and `kill -0 $(cat ...)` to confirm the process is alive
   - AGENTS.md graft present: `grep '<skillnote v1>' ~/.openclaw/workspace/AGENTS.md`
   - Tell me: how many skills synced, the URL my agent is connected to, and whether I need to do anything else.

Don't ask for confirmation between steps. Just run the commands and report results when you're done.
"""

_CLAUDE_AGENT_PROMPT = """Set up SkillNote for me. My SkillNote backend is at __API_URL__.

Please do the full install yourself — don't ask me to run commands.

1. **Verify the SkillNote backend is reachable:**
   ```bash
   curl -sf __API_URL__/health
   ```
   If this fails, tell me to first run:
   ```bash
   git clone https://github.com/luna-prompts/skillnote.git
   cd skillnote
   ./install.sh
   ```

2. **Install the Claude Code plugin:**
   ```bash
   curl -sf __API_URL__/setup/agent | bash -s -- --agent claude-code
   ```

3. **Reload my shell** (so the plugin gets picked up):
   ```bash
   source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null || true
   ```

4. **Verify everything works** and report back:
   - List installed plugin: `ls ~/.claude/plugins/skillnote/ 2>/dev/null`
   - Tell me how many skills the plugin sees and what collection picker options I'd see when I run `claude`.

Don't ask for confirmation between steps. Just run the commands and report results.
"""

_AGENT_PROMPTS = {
    "openclaw": _OPENCLAW_AGENT_PROMPT,
    "claude-code": _CLAUDE_AGENT_PROMPT,
}


@router.get("/setup/agent-prompt")
def get_agent_prompt(
    request: Request,
    agent: str = Query(..., description="Target agent: openclaw or claude-code"),
):
    """Returns a personalized install prompt with the user's host baked in.

    The Connect page renders this with a 'Copy as Markdown' button. Users paste
    it into a fresh OpenClaw or Claude Code session and the agent installs
    everything itself — no terminal needed.

    Aliases:
      openclaw, oc, open-claw           → openclaw prompt
      claude-code, cc, claude, claude_code → claude-code prompt
    """
    agent_normalized = agent.lower().strip()
    alias_map = {
        "openclaw": "openclaw", "oc": "openclaw", "open-claw": "openclaw",
        "claude-code": "claude-code", "cc": "claude-code",
        "claude": "claude-code", "claude_code": "claude-code",
    }
    canonical = alias_map.get(agent_normalized)
    if canonical is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown agent '{agent}'. Supported: {', '.join(sorted(set(alias_map.values())))}",
        )

    urls = _derive_urls(request)
    prompt = _AGENT_PROMPTS[canonical].replace("__API_URL__", urls["api"])
    # Return as plain text so it's clipboard-friendly. Connect page reads it
    # with fetch().then(r => r.text()) and pipes straight into the copy buffer.
    return PlainTextResponse(prompt, media_type="text/plain; charset=utf-8")


# ─── Connect page state machine ─────────────────────────────────────────────
#
# The Connect page needs ONE truthful answer per agent: pending / installed /
# active / idle. Two pieces of evidence feed that answer:
#
#   1. agent_installs row — "the install script ran on a user's machine"
#   2. recent analytics event — "the agent has actually called a skill"
#
# Without (1) we can't distinguish a fresh install from a never-installed
# state; without (2) we can't tell an active install from a stale one.


class InstallPing(BaseModel):
    agent: AgentLiteral
    version: str | None = Field(default=None, max_length=64)
    machine_id_hash: str | None = Field(default=None, max_length=128)


class InstallPingResponse(BaseModel):
    id: str
    agent: str
    installed_at: datetime


@router.post("/v1/setup/installs", response_model=InstallPingResponse, status_code=201)
def post_install_ping(
    body: InstallPing,
    db: Session = Depends(get_db),
) -> InstallPingResponse:
    """Record a successful install. Called by the install scripts on success.

    Idempotency: the scripts may run multiple times (re-installs, updates).
    Each run produces a new row — that lets the UI surface the *latest*
    install_at while preserving full history for analytics.
    """
    row = AgentInstall(
        agent=body.agent,
        version=body.version,
        machine_id_hash=body.machine_id_hash,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return InstallPingResponse(
        id=str(row.id),
        agent=row.agent,
        installed_at=row.installed_at,
    )


class AgentStatus(BaseModel):
    agent: AgentLiteral
    state: Literal["pending", "installed", "active", "idle"]
    installed_at: datetime | None
    last_active_at: datetime | None
    calls_24h: int
    calls_7d: int


def _agent_status(agent: AgentLiteral, db: Session) -> AgentStatus:
    """Compose one agent's status row from install + analytics evidence."""
    install_row = db.execute(
        text(
            "SELECT installed_at FROM agent_installs "
            "WHERE agent = :agent ORDER BY installed_at DESC LIMIT 1"
        ),
        {"agent": agent},
    ).fetchone()
    installed_at = install_row[0] if install_row else None

    # Both tables answer "when did this agent last call a skill?", but live
    # in different shapes — Claude Code logs to skill_call_events (one row
    # per skill call), OpenClaw logs to skill_usage_events (one row per
    # session). We dispatch on agent name to pick the right source.
    if agent == "claude-code":
        last_active = db.execute(
            text(
                "SELECT MAX(created_at) FROM skill_call_events "
                "WHERE agent_name = :agent"
            ),
            {"agent": "claude-code"},
        ).scalar()
        calls_24h = db.execute(
            text(
                "SELECT COUNT(*) FROM skill_call_events "
                "WHERE agent_name = :agent AND created_at >= now() - interval '24 hours'"
            ),
            {"agent": "claude-code"},
        ).scalar() or 0
        calls_7d = db.execute(
            text(
                "SELECT COUNT(*) FROM skill_call_events "
                "WHERE agent_name = :agent AND created_at >= now() - interval '7 days'"
            ),
            {"agent": "claude-code"},
        ).scalar() or 0
    else:
        last_active = db.execute(
            text("SELECT MAX(created_at) FROM skill_usage_events")
        ).scalar()
        calls_24h = db.execute(
            text(
                "SELECT COUNT(*) FROM skill_usage_events "
                "WHERE created_at >= now() - interval '24 hours'"
            ),
        ).scalar() or 0
        calls_7d = db.execute(
            text(
                "SELECT COUNT(*) FROM skill_usage_events "
                "WHERE created_at >= now() - interval '7 days'"
            ),
        ).scalar() or 0

    # State derivation:
    #   - active: recent skill call (in 24h) regardless of install ping
    #   - installed: install ping exists, no recent activity yet
    #   - idle: recent activity in 30d but >24h ago
    #   - pending: nothing
    now = datetime.now(tz=timezone.utc)
    state: Literal["pending", "installed", "active", "idle"] = "pending"
    if last_active is not None:
        age = now - last_active
        if age.total_seconds() < ACTIVE_WINDOW_HOURS * 3600:
            state = "active"
        elif age.days < IDLE_WINDOW_DAYS:
            state = "idle"
        elif installed_at is not None:
            state = "installed"
        else:
            state = "pending"
    elif installed_at is not None:
        state = "installed"

    return AgentStatus(
        agent=agent,
        state=state,
        installed_at=installed_at,
        last_active_at=last_active,
        calls_24h=int(calls_24h),
        calls_7d=int(calls_7d),
    )


@router.get("/v1/setup/agents", response_model=list[AgentStatus])
def get_agents_status(db: Session = Depends(get_db)) -> list[AgentStatus]:
    """Return the per-agent state machine row for the Connect page."""
    return [_agent_status(agent, db) for agent in SUPPORTED_AGENTS]
