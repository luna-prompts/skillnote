#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Config ────────────────────────────────────────────────────────
SKILLNOTE_HOST="${SKILLNOTE_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
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
  local pid=$1 msg=$2
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}${spin:i++%10:1}${NC}  ${DIM}%s${NC}" "$msg"
    sleep 0.15
  done
  wait "$pid" 2>/dev/null
  printf "\r"
}

# ── Banner ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  SkillNote${NC}  ${DIM}— self-hosted skill registry for AI agents${NC}"
echo ""
echo -e "  ${DIM}Web:${NC}  ${WEB_URL}"
echo -e "  ${DIM}API:${NC}  ${API_URL}"
echo -e "  ${DIM}MCP:${NC}  ${MCP_URL}"
echo ""

# ── 1. Stop any existing stack ────────────────────────────────────
step "Stopping any existing containers"
docker compose -f "$PROJECT_DIR/docker-compose.yml" down 2>/dev/null || true
sleep 1
# Free up ports if something else is using them
for p in $WEB_PORT $API_PORT $MCP_PORT; do
  lsof -ti :"$p" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
done
sleep 1
ok "Clean slate"

# ── 2. Build ──────────────────────────────────────────────────────
step "Building Docker images"
info "First build takes 2-3 minutes. Subsequent builds are cached."
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
SKILLNOTE_WEB_PORT="$WEB_PORT" \
  docker compose -f "$PROJECT_DIR/docker-compose.yml" build --quiet 2>/dev/null &
BUILD_PID=$!
progress $BUILD_PID "Building api, mcp, web..."
ok "Images built"

# ── 3. Start ──────────────────────────────────────────────────────
step "Starting services"
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
SKILLNOTE_WEB_PORT="$WEB_PORT" \
  docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d 2>/dev/null
ok "Containers started"

# ── 4. Wait for API ───────────────────────────────────────────────
step "Waiting for API"
info "Running migrations and seeding skills..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    ok "API ready at ${API_URL}"
    break
  fi
  [ "$i" -eq 60 ] && err "API failed to start. Run: docker compose logs api"
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
  [ "$i" -eq 30 ] && { warn "MCP slow to start — check: docker compose logs mcp"; break; }
  sleep 1
done

# ── 6. Wait for Web ───────────────────────────────────────────────
step "Waiting for Web UI"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${WEB_PORT}" >/dev/null 2>&1; then
    ok "Web UI ready at ${WEB_URL}"
    break
  fi
  [ "$i" -eq 30 ] && { warn "Web UI slow to start — check: docker compose logs web"; break; }
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
echo -e "  docker compose logs -f          ${DIM}# stream all logs${NC}"
echo -e "  docker compose down             ${DIM}# stop (keeps data)${NC}"
echo -e "  docker compose down -v          ${DIM}# stop + wipe database${NC}"
echo ""
