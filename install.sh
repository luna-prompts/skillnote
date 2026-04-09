#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Detect container runtime ──────────────────────────────────────
# Supports: docker compose, podman compose
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
  echo "Error: Neither 'docker compose' nor 'podman compose' found."
  echo "Install Docker: https://docs.docker.com/get-docker/"
  echo "Or Podman: https://podman.io/getting-started/installation"
  exit 1
fi

# ── Podman: ensure machine is running (macOS/Windows) ─────────────
if [[ "$COMPOSE" == *podman* ]]; then
  if ! podman info &>/dev/null; then
    echo "Podman machine is not running. Starting it..."
    podman machine start 2>/dev/null || {
      echo "Error: Could not start Podman machine."
      echo "Try: podman machine init && podman machine start"
      exit 1
    }
    # Wait for Podman to be ready
    for i in $(seq 1 15); do
      podman info &>/dev/null && break
      sleep 1
    done
    podman info &>/dev/null || { echo "Error: Podman machine failed to start."; exit 1; }
    echo "Podman machine started."
  fi
fi

# ── Config ────────────────────────────────────────────────────────
# Detect LAN IP: Linux hostname -I, macOS ipconfig getifaddr
_detect_ip() {
  local ip=""
  ip=$(hostname -I 2>/dev/null | awk '{print $1}') && [ -n "$ip" ] && echo "$ip" && return
  ip=$(ipconfig getifaddr en0 2>/dev/null) && [ -n "$ip" ] && echo "$ip" && return
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

step()     { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }
ok()       { echo -e "  ${GREEN}✓${NC}  $1"; }
info()     { echo -e "  ${DIM}$1${NC}"; }
warn()     { echo -e "  ${YELLOW}!${NC}  $1"; }
err()      { echo -e "\n${RED}✗ $1${NC}"; exit 1; }
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

# Helper: run compose command
compose() {
  $COMPOSE -f "$PROJECT_DIR/docker-compose.yml" "$@"
}

# ── 1. Stop any existing stack ────────────────────────────────────
step "Stopping any existing containers"
compose down 2>/dev/null || true
sleep 1
# Check if ports are still in use (warn, don't force-kill)
for p in $WEB_PORT $API_PORT $MCP_PORT; do
  if lsof -ti :"$p" >/dev/null 2>&1; then
    warn "Port $p is in use by another process. Docker may fail to bind."
  fi
done
ok "Clean slate"

# ── 2. Build ──────────────────────────────────────────────────────
step "Building images"
info "First build takes 2-3 minutes. Subsequent builds are cached."
BUILD_LOG=$(mktemp)
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
SKILLNOTE_WEB_PORT="$WEB_PORT" \
  compose build > "$BUILD_LOG" 2>&1 &
BUILD_PID=$!
progress $BUILD_PID "Building api, mcp, web..."
if ! wait $BUILD_PID; then
  echo ""
  warn "Build failed — retrying without cache..."
  SKILLNOTE_HOST="$SKILLNOTE_HOST" \
  SKILLNOTE_API_PORT="$API_PORT" \
  SKILLNOTE_MCP_PORT="$MCP_PORT" \
  SKILLNOTE_WEB_PORT="$WEB_PORT" \
    compose build --no-cache > "$BUILD_LOG" 2>&1 &
  BUILD_PID=$!
  progress $BUILD_PID "Rebuilding from scratch..."
  if ! wait $BUILD_PID; then
    echo ""
    echo -e "${RED}Build failed. Last 10 lines:${NC}"
    tail -10 "$BUILD_LOG"
    rm -f "$BUILD_LOG"
    err "Build failed. Run: $COMPOSE -f docker-compose.yml build --no-cache"
  fi
fi
rm -f "$BUILD_LOG"
ok "Images built"

# ── 3. Start ──────────────────────────────────────────────────────
step "Starting services"
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
SKILLNOTE_WEB_PORT="$WEB_PORT" \
  compose up -d 2>&1 | tail -5
ok "Containers started"

# ── 4. Wait for API ───────────────────────────────────────────────
step "Waiting for API"
info "Running migrations and seeding skills..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    ok "API ready at ${API_URL}"
    break
  fi
  [ "$i" -eq 60 ] && err "API failed to start. Run: $COMPOSE logs api"
  sleep 2
done

# ── 5. Wait for MCP ───────────────────────────────────────────────
step "Waiting for MCP server"
for i in $(seq 1 30); do
  if curl -sf -X POST "http://localhost:${MCP_PORT}/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1"}}}' \
      >/dev/null 2>&1; then
    ok "MCP ready at ${MCP_URL}"
    break
  fi
  [ "$i" -eq 30 ] && { warn "MCP slow to start — check: $COMPOSE logs mcp"; break; }
  sleep 1
done

# ── 6. Wait for Web ───────────────────────────────────────────────
step "Waiting for Web UI"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${WEB_PORT}" >/dev/null 2>&1; then
    ok "Web UI ready at ${WEB_URL}"
    break
  fi
  [ "$i" -eq 30 ] && { warn "Web UI slow to start — check: $COMPOSE logs web"; break; }
  sleep 1
done

# ── 7. Skill count ────────────────────────────────────────────────
SKILL_COUNT=$(curl -sf "http://localhost:${API_PORT}/v1/skills" 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  SkillNote is running!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${DIM}Web:${NC}     ${WEB_URL}"
echo -e "  ${DIM}API:${NC}     ${API_URL}"
echo -e "  ${DIM}MCP:${NC}     ${MCP_URL}"
echo -e "  ${DIM}Skills:${NC}  ${SKILL_COUNT}"
echo ""

echo -e "${BOLD}  Connect Claude Code:${NC}"
echo ""
echo -e "  \$ curl -sf ${API_URL}/setup | bash"
echo ""
echo -e "  ${DIM}One command. Installs the plugin with skill sync, analytics,${NC}"
echo -e "  ${DIM}and skill creation. Works in every project.${NC}"
echo ""

echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Commands${NC}"
echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  $COMPOSE logs -f          ${DIM}# stream all logs${NC}"
echo -e "  $COMPOSE down             ${DIM}# stop (keeps data)${NC}"
echo -e "  $COMPOSE down -v          ${DIM}# stop + wipe database${NC}"
echo ""
