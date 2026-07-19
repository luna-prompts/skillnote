#!/bin/bash
# SkillNote Usage Tracker (Codex) — PostToolUse hook
# Records skill invocations for analytics. In Codex, a skill is "used" when the
# model reads its SKILL.md (typically via a Bash tool, e.g.
#   {"tool_name":"Bash","tool_input":{"command":"sed -n ... .codex/skills/skillnote-<slug>/SKILL.md"}}
# ), so we detect a reference to skillnote-<slug>/SKILL.md in the tool payload
# and post that slug. Also honors an explicit skill tool shape if Codex ever
# adds one. Async, non-blocking, always exits 0.

# Cheap pre-filter: this hook fires on EVERY PostToolUse. Read stdin once and
# bail immediately (no Python spawn) unless the payload references a skillnote
# SKILL.md or an explicit skill field. Keeps per-tool overhead negligible.
PAYLOAD=$(cat)
case "$PAYLOAD" in
    *skillnote-*SKILL.md*|*'"skill"'*) ;;
    *) exit 0 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST=$("$SCRIPT_DIR/resolve-host.sh")
API_URL="http://${HOST}:8082"

# Pass the payload via a temp file: a heredoc program (python3 - <<PY) already
# occupies stdin, so we can't also pipe the JSON in. A file also sidesteps the
# ARG_MAX limit that a large tool_response would hit as an env var.
PAYLOAD_FILE=$(mktemp -t skillnote-hook.XXXXXX.json) || exit 0
trap 'rm -f "$PAYLOAD_FILE"' EXIT
printf '%s' "$PAYLOAD" > "$PAYLOAD_FILE"

API_URL="$API_URL" PAYLOAD_FILE="$PAYLOAD_FILE" python3 - <<'PY'
import json, os, re, sys, urllib.request

try:
    with open(os.environ["PAYLOAD_FILE"], encoding="utf-8") as f:
        h = json.load(f)
except Exception:
    sys.exit(0)
if not isinstance(h, dict):
    sys.exit(0)

def as_str(v):
    return v.strip() if isinstance(v, str) and v.strip() else ""

tool_input = h.get("tool_input") if isinstance(h.get("tool_input"), dict) else {}

# 1) Explicit skill shape (future-proof): tool_input.skill / .name.
slug = as_str(tool_input.get("skill")) or as_str(tool_input.get("name")) or as_str(h.get("skill"))

# 2) The real Codex path: a SKILL.md read. Scan the tool_input (command/paths)
#    and the tool_response for skillnote-<slug>/SKILL.md.
if not slug:
    haystack = json.dumps(tool_input) + " " + (h.get("tool_response") if isinstance(h.get("tool_response"), str) else "")
    m = re.search(r"skillnote-([a-z0-9_-]+(?::[a-z0-9_-]+)?)/SKILL\.md", haystack)
    if m:
        slug = "skillnote-" + m.group(1)

if not slug:
    sys.exit(0)

# Strip our sync prefix so analytics keys match the registry slug.
if slug.startswith("skillnote-"):
    slug = slug[len("skillnote-"):]

# Guard against noise: only accept a well-formed slug.
if not re.match(r"^[a-z0-9_-]+(?::[a-z0-9_-]+)?$", slug):
    sys.exit(0)

session_id = as_str(h.get("session_id")) or as_str(h.get("turn_id"))

data = json.dumps({
    "skill_slug": slug,
    "agent_name": "codex",
    "session_id": session_id,
}).encode()
req = urllib.request.Request(
    os.environ.get("API_URL", "http://localhost:8082") + "/v1/hooks/skill-used",
    data=data,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    urllib.request.urlopen(req, timeout=3)
except Exception:
    pass
PY

exit 0
