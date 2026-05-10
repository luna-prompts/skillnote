#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Detect container runtime ──────────────────────────────────────
_detect_compose() {
  if command -v docker &>/dev/null && docker compose version &>/dev/null; then
    echo "docker compose"
    return
  fi
  if command -v podman &>/dev/null && command -v podman-compose &>/dev/null; then
    echo "podman-compose"
    return
  fi
  if command -v podman &>/dev/null && podman compose version &>/dev/null; then
    echo "podman compose"
    return
  fi
  echo ""
}

COMPOSE=$(_detect_compose)
if [ -z "$COMPOSE" ]; then
  echo ""
  echo "  Error: Docker or Podman not found."
  echo ""
  echo "  Install Docker: https://docs.docker.com/get-docker/"
  echo "  Or Podman:      https://podman.io/getting-started/installation"
  echo ""
  exit 1
fi

# ── Podman: ensure machine is running (macOS/Windows) ─────────────
if [[ "$COMPOSE" == *podman* ]]; then
  if ! podman info &>/dev/null; then
    echo "  Starting Podman machine..."
    podman machine start 2>/dev/null || {
      echo "  Error: Could not start Podman machine."
      echo "  Try: podman machine init && podman machine start"
      exit 1
    }
    for i in $(seq 1 15); do
      podman info &>/dev/null && break
      sleep 1
    done
    podman info &>/dev/null || { echo "  Error: Podman machine failed to start."; exit 1; }
  fi
fi

# ── Config ────────────────────────────────────────────────────────
_detect_ip() {
  local ip=""
  ip=$(hostname -I 2>/dev/null | awk '{print $1}') && [ -n "$ip" ] && echo "$ip" && return
  if command -v ipconfig &>/dev/null; then
    local iface
    iface=$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')
    if [ -n "$iface" ]; then
      ip=$(ipconfig getifaddr "$iface" 2>/dev/null) && [ -n "$ip" ] && echo "$ip" && return
    fi
    for iface in en0 en1 en6 en8; do
      ip=$(ipconfig getifaddr "$iface" 2>/dev/null) && [ -n "$ip" ] && echo "$ip" && return
    done
  fi
  echo ""
}
SKILLNOTE_HOST="${SKILLNOTE_HOST:-$(_detect_ip)}"
SKILLNOTE_HOST="${SKILLNOTE_HOST:-localhost}"
API_PORT="${SKILLNOTE_API_PORT:-8082}"
MCP_PORT="${SKILLNOTE_MCP_PORT:-8083}"
WEB_PORT="${SKILLNOTE_WEB_PORT:-3000}"
WEB_URL="http://${SKILLNOTE_HOST}:${WEB_PORT}"
API_URL="http://${SKILLNOTE_HOST}:${API_PORT}"
MCP_URL="http://${SKILLNOTE_HOST}:${MCP_PORT}/mcp"

# ── Colors ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ok()       { echo -e "  ${GREEN}✓${NC}  $1"; }
info()     { echo -e "  ${DIM}$1${NC}"; }
warn()     { echo -e "  ${YELLOW}!${NC}  $1"; }
err()      { echo -e "\n  ${RED}✗ $1${NC}\n"; exit 1; }
progress() {
  local pid="$1" msg="$2"
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    local c="${spin:$((i % 10)):1}"
    printf "\r  ${CYAN}%s${NC}  ${DIM}%s${NC}" "$c" "$msg"
    i=$((i + 1))
    sleep 0.2
  done
  printf "\r                                                    \r"
}

compose() {
  $COMPOSE -f "$PROJECT_DIR/docker-compose.yml" "$@"
}

# ── Port availability check ──────────────────────────────────────
# Returns: 0 if free, 1 if in use.
# Sets PORT_HOLDER_PID and PORT_HOLDER_NAME when in use.
check_port() {
  local port="$1"
  PORT_HOLDER_PID=""
  PORT_HOLDER_NAME=""
  # Try lsof first (macOS + most Linuxes)
  if command -v lsof &>/dev/null; then
    PORT_HOLDER_PID=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
    if [ -n "$PORT_HOLDER_PID" ]; then
      PORT_HOLDER_NAME=$(ps -p "$PORT_HOLDER_PID" -o comm= 2>/dev/null | awk '{print $1}')
      return 1
    fi
    return 0
  fi
  # Fallback: ss (Linux)
  if command -v ss &>/dev/null; then
    if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
      PORT_HOLDER_NAME="unknown"
      return 1
    fi
    return 0
  fi
  # No port-checker available — assume free so we don't block install.
  return 0
}

# Prints a guided error for a port that's already in use and exits.
port_conflict_hint() {
  local name="$1" port="$2"
  echo ""
  echo -e "  ${RED}✗ Port ${port} (${name}) is already in use${NC}"
  echo ""
  if [ -n "${PORT_HOLDER_PID:-}" ]; then
    echo -e "  ${DIM}Held by:${NC}  PID ${PORT_HOLDER_PID} (${PORT_HOLDER_NAME:-?})"
    echo ""
    echo -e "  ${BOLD}Fix options:${NC}"
    echo -e "    ${DIM}1.${NC} Kill the running process:"
    echo -e "       ${CYAN}kill ${PORT_HOLDER_PID}${NC}"
    echo -e "    ${DIM}2.${NC} Or move SkillNote to a different port:"
    case "$name" in
      Web) echo -e "       ${CYAN}SKILLNOTE_WEB_PORT=3001 ./install.sh${NC}" ;;
      API) echo -e "       ${CYAN}SKILLNOTE_API_PORT=8182 ./install.sh${NC}" ;;
      MCP) echo -e "       ${CYAN}SKILLNOTE_MCP_PORT=8183 ./install.sh${NC}" ;;
    esac
  else
    echo -e "  ${DIM}Install lsof or ss to see which process is holding it.${NC}"
  fi
  echo ""
  exit 1
}

# ── Header ────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}S K I L L N O T E${NC}"
echo ""

# ── 0. Pre-flight: check ports are free ──────────────────────────
# Catches the common "npm run dev still running" / "old container orphan" /
# "another service on 8082" cases BEFORE we waste time building images.
for port_spec in "Web:${WEB_PORT}" "API:${API_PORT}" "MCP:${MCP_PORT}"; do
  name="${port_spec%%:*}"
  port="${port_spec##*:}"
  if ! check_port "$port"; then
    # Stop any existing SkillNote containers first — they legitimately own these ports
    # and will be recreated by compose up. Re-check after compose-down.
    compose down 2>/dev/null || true
    if ! check_port "$port"; then
      port_conflict_hint "$name" "$port"
    fi
  fi
done

# ── 1. Stop previous SkillNote containers ─────────────────────────
# Only stops SkillNote containers, not other Docker apps.
# (Also runs during pre-flight when a port is busy, but re-run here so the
#  "stopped" confirmation is visible on a clean install too.)
compose down 2>/dev/null || true
ok "Stopped previous SkillNote containers"

# ── 2. Build ──────────────────────────────────────────────────────
echo ""
info "Building images (first run takes 2-3 min, subsequent ~30s)..."
BUILD_LOG=$(mktemp)
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
SKILLNOTE_WEB_PORT="$WEB_PORT" \
  compose build > "$BUILD_LOG" 2>&1 &
BUILD_PID=$!
progress $BUILD_PID "Building..."
if ! wait $BUILD_PID; then
  warn "Retrying without cache..."
  SKILLNOTE_HOST="$SKILLNOTE_HOST" \
  SKILLNOTE_API_PORT="$API_PORT" \
  SKILLNOTE_MCP_PORT="$MCP_PORT" \
  SKILLNOTE_WEB_PORT="$WEB_PORT" \
    compose build --no-cache > "$BUILD_LOG" 2>&1 &
  BUILD_PID=$!
  progress $BUILD_PID "Rebuilding..."
  if ! wait $BUILD_PID; then
    echo ""
    tail -10 "$BUILD_LOG"
    rm -f "$BUILD_LOG"
    err "Build failed. Run: $COMPOSE -f docker-compose.yml build --no-cache"
  fi
fi
rm -f "$BUILD_LOG"
ok "Images built"

# ── 3. Start ──────────────────────────────────────────────────────
# Capture both stdout and stderr so a bind-address-in-use or similar failure
# gets surfaced to the user instead of the script silently exiting.
UP_LOG=$(mktemp)
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
SKILLNOTE_WEB_PORT="$WEB_PORT" \
  compose up -d > "$UP_LOG" 2>&1 || {
  echo ""
  echo -e "  ${RED}✗ Failed to start containers${NC}"
  echo ""
  echo -e "  ${DIM}Last 12 lines of output:${NC}"
  tail -12 "$UP_LOG" | sed 's/^/    /'
  echo ""
  # Heuristics for the most common failures
  if grep -qi "address already in use\|port is already allocated" "$UP_LOG"; then
    echo -e "  ${BOLD}Likely cause:${NC} a port (${WEB_PORT}, ${API_PORT}, or ${MCP_PORT}) was freed"
    echo -e "  between the pre-flight check and now. Re-run ${CYAN}./install.sh${NC}."
  elif grep -qi "permission denied\|cannot connect to the docker daemon" "$UP_LOG"; then
    echo -e "  ${BOLD}Likely cause:${NC} the container runtime needs attention."
    echo -e "  Ensure ${CYAN}${COMPOSE%% *}${NC} daemon/machine is running."
  else
    echo -e "  ${BOLD}To inspect:${NC}"
    echo -e "    ${CYAN}$COMPOSE -f docker-compose.yml logs${NC}"
  fi
  echo ""
  rm -f "$UP_LOG"
  exit 1
}
rm -f "$UP_LOG"
ok "Containers started"

# ── 4. Health checks ─────────────────────────────────────────────
echo ""
info "Waiting for services..."

# API
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    ok "API ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo ""
    echo -e "  ${RED}✗ API didn't become healthy within 120s${NC}"
    echo ""
    echo -e "  ${DIM}Last 20 lines of API logs:${NC}"
    compose logs --tail 20 api 2>/dev/null | sed 's/^/    /' || true
    echo ""
    echo -e "  ${BOLD}Common causes:${NC}"
    echo -e "    ${DIM}•${NC} Database still migrating (wait + retry)"
    echo -e "    ${DIM}•${NC} Alembic migration error — check logs above"
    echo -e "    ${DIM}•${NC} Port ${API_PORT} bound by another process on the container-side"
    echo ""
    echo -e "  ${BOLD}To inspect:${NC}  ${CYAN}$COMPOSE -f docker-compose.yml logs api${NC}"
    echo ""
    exit 1
  fi
  sleep 2
done

# MCP
for i in $(seq 1 30); do
  if curl -sf -X POST "http://localhost:${MCP_PORT}/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1"}}}' \
      >/dev/null 2>&1; then
    ok "MCP ready"
    break
  fi
  [ "$i" -eq 30 ] && warn "MCP slow to start"
  sleep 1
done

# Web
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${WEB_PORT}" >/dev/null 2>&1; then
    ok "Web ready"
    break
  fi
  [ "$i" -eq 30 ] && warn "Web slow to start"
  sleep 1
done

# ── Done ──────────────────────────────────────────────────────────
SKILL_COUNT=$(curl -sf "http://localhost:${API_PORT}/v1/skills" 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

# Detect which agents are present on this machine so we can recommend
# the right Stage-2 command (and skip the ones that aren't applicable).
HAS_CLAUDE=0
HAS_OPENCLAW=0
[ -d "$HOME/.claude" ] && HAS_CLAUDE=1
[ -d "$HOME/.openclaw" ] && HAS_OPENCLAW=1

ORANGE='\033[38;5;208m'

echo ""
echo -e "  ${GREEN}${BOLD}✓ Stage 1 complete — SkillNote is running${NC}"
echo ""
echo -e "  ${DIM}Web${NC}     ${WEB_URL}"
echo -e "  ${DIM}API${NC}     ${API_URL}"
echo -e "  ${DIM}Skills${NC}  ${SKILL_COUNT}"
echo ""
echo -e "  ${BOLD}Next — Stage 2: connect an AI agent${NC}"
echo -e "  ${DIM}One unified installer; pick your agent with --agent.${NC}"
echo ""

# ── Tailored Stage-2 hint ────────────────────────────────────────
# Each curl-installer command is paired with the clone+install commands
# above it so the printed output is self-contained when copied/shared
# (e.g., a user sends the install.sh tail to a teammate). For the user
# who literally just ran install.sh on this machine the clone+install
# is redundant — they can ignore those two lines and run only the
# trailing connect command.
HAS_CLAWHUB=0
command -v clawhub >/dev/null 2>&1 && HAS_CLAWHUB=1

# Default vs custom host: clawhub doesn't accept a host argument, so a
# non-default URL is set via env var read by the skill on first sync.
if [ "$API_URL" = "http://localhost:8082" ]; then
    OPENCLAW_CLAWHUB_CMD="clawhub install skillnote"
else
    OPENCLAW_CLAWHUB_CMD="SKILLNOTE_BASE_URL=${API_URL} clawhub install skillnote"
fi
OPENCLAW_CURL_CMD="curl -sf ${API_URL}/setup/agent | bash -s -- --agent openclaw"
CLAUDE_CURL_CMD="curl -sf ${API_URL}/setup/agent | bash -s -- --agent claude-code"
CLONE_INSTALL="git clone https://github.com/luna-prompts/skillnote.git && cd skillnote && ./install.sh"

_print_clone_install() {
    echo -e "  ${DIM}# fresh machine? run these two first to bring up the backend:${NC}"
    echo -e "  ${ORANGE}\$${NC} ${CLONE_INSTALL}"
    echo ""
}

_print_claude_install() {
    _print_clone_install
    echo -e "  ${ORANGE}\$${NC} ${CLAUDE_CURL_CMD}"
}

# OpenClaw: lead with the canonical clawhub install (auto-bootstraps the
# backend if unreachable, so it's truly one command on a fresh machine).
# Curl form is the no-clawhub fallback and gets paired with clone+install.
_print_openclaw_install() {
    if [ "$HAS_CLAWHUB" -eq 1 ]; then
        echo -e "  ${ORANGE}\$${NC} ${OPENCLAW_CLAWHUB_CMD}     ${DIM}# canonical (clawhub detected; auto-installs backend if needed)${NC}"
    else
        echo -e "  ${ORANGE}\$${NC} ${OPENCLAW_CLAWHUB_CMD}     ${DIM}# canonical (install clawhub: 'npm i -g clawhub')${NC}"
    fi
    echo ""
    echo -e "  ${DIM}or without clawhub:${NC}"
    _print_clone_install
    echo -e "  ${ORANGE}\$${NC} ${OPENCLAW_CURL_CMD}"
}

if [ "$HAS_CLAUDE" -eq 1 ] && [ "$HAS_OPENCLAW" -eq 1 ]; then
    # Both agents detected on this host
    echo -e "  ${DIM}Detected:${NC}  ${GREEN}Claude Code${NC}  +  ${GREEN}OpenClaw${NC}"
    echo ""
    echo -e "  ${ORANGE}${BOLD}Claude Code${NC}"
    _print_claude_install
    echo ""
    echo -e "  ${ORANGE}${BOLD}OpenClaw${NC}"
    _print_openclaw_install
elif [ "$HAS_CLAUDE" -eq 1 ]; then
    echo -e "  ${DIM}Detected:${NC}  ${GREEN}Claude Code${NC}  ${DIM}(~/.claude exists)${NC}"
    echo ""
    echo -e "  ${ORANGE}${BOLD}Connect Claude Code${NC}"
    _print_claude_install
    echo ""
    echo -e "  ${DIM}Also using OpenClaw? Run:${NC} ${ORANGE}${OPENCLAW_CLAWHUB_CMD}${NC}"
elif [ "$HAS_OPENCLAW" -eq 1 ]; then
    echo -e "  ${DIM}Detected:${NC}  ${GREEN}OpenClaw${NC}  ${DIM}(~/.openclaw exists)${NC}"
    echo ""
    echo -e "  ${ORANGE}${BOLD}Connect OpenClaw${NC}"
    _print_openclaw_install
    echo ""
    echo -e "  ${DIM}Also using Claude Code? Run:${NC}"
    _print_claude_install
else
    # No agent detected — the user is probably setting up the registry
    # on a server they don't run agents on. Show both, no preference.
    echo -e "  ${DIM}No agent home directory detected on this machine.${NC}"
    echo -e "  ${DIM}If you'll use SkillNote from another machine, run one of these there:${NC}"
    echo ""
    echo -e "  ${ORANGE}${BOLD}Claude Code${NC}"
    _print_claude_install
    echo ""
    echo -e "  ${ORANGE}${BOLD}OpenClaw${NC}"
    _print_openclaw_install
fi

echo ""
echo -e "  ${DIM}Or use the web UI walkthrough:${NC}  ${CYAN}${WEB_URL}/integrations${NC}"
echo ""
echo -e "  ${DIM}Manage this stack:${NC}"
echo -e "  ${DIM}\$${NC} $COMPOSE logs -f          ${DIM}# tail logs${NC}"
echo -e "  ${DIM}\$${NC} $COMPOSE down             ${DIM}# stop${NC}"
echo -e "  ${DIM}\$${NC} $COMPOSE down -v          ${DIM}# reset (drops the database)${NC}"
echo ""
