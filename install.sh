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

# ── Header ────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}S K I L L N O T E${NC}"
echo ""

# ── 1. Stop previous SkillNote containers ─────────────────────────
# Only stops SkillNote containers, not other Docker apps
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
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
SKILLNOTE_WEB_PORT="$WEB_PORT" \
  compose up -d > /dev/null 2>&1
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
  [ "$i" -eq 60 ] && err "API failed to start. Run: $COMPOSE logs api"
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

echo ""
echo -e "  ${GREEN}${BOLD}SkillNote is running${NC}"
echo ""
echo -e "  ${DIM}Web${NC}     ${WEB_URL}"
echo -e "  ${DIM}API${NC}     ${API_URL}"
echo -e "  ${DIM}Skills${NC}  ${SKILL_COUNT}"
echo ""
echo -e "  ${BOLD}Connect Claude Code:${NC}"
echo -e "  ${DIM}\$${NC} curl -sf ${API_URL}/setup | bash"
echo ""
echo -e "  ${DIM}Manage:${NC}"
echo -e "  ${DIM}\$${NC} $COMPOSE logs -f          ${DIM}# logs${NC}"
echo -e "  ${DIM}\$${NC} $COMPOSE down             ${DIM}# stop${NC}"
echo -e "  ${DIM}\$${NC} $COMPOSE down -v          ${DIM}# reset${NC}"
echo ""
