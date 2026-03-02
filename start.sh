#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Config ────────────────────────────────────────────────────────
SKILLNOTE_HOST="${SKILLNOTE_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
SKILLNOTE_HOST="${SKILLNOTE_HOST:-localhost}"
API_PORT="${SKILLNOTE_API_PORT:-8082}"
MCP_PORT="${SKILLNOTE_MCP_PORT:-8083}"
WEB_URL="http://${SKILLNOTE_HOST}:3000"
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

step() { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC}  $1"; }
info() { echo -e "  ${DIM}$1${NC}"; }
warn() { echo -e "  ${YELLOW}!${NC}  $1"; }
err()  { echo -e "\n${RED}✗ $1${NC}"; exit 1; }

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
ok "Clean slate"

# ── 2. Build and start full stack ─────────────────────────────────
step "Building and starting all services"
info "This may take a minute on first run (building Docker images)..."
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
  docker compose -f "$PROJECT_DIR/docker-compose.yml" up --build -d
ok "Containers started (postgres, api, mcp, web)"

# ── 3. Wait for API ───────────────────────────────────────────────
step "Waiting for API to be ready"
info "Running database migrations and seeding default skills..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    ok "API is ready at ${API_URL}"
    break
  fi
  [ "$i" -eq 60 ] && err "API failed to start. Run: docker compose logs api"
  sleep 2
done

# ── 4. Wait for MCP ───────────────────────────────────────────────
step "Waiting for MCP server to be ready"
for i in $(seq 1 30); do
  if curl -sf -X POST "http://localhost:${MCP_PORT}/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1"}}}' \
      >/dev/null 2>&1; then
    ok "MCP server is ready at ${MCP_URL}"
    break
  fi
  [ "$i" -eq 30 ] && { warn "MCP server is slow to start. Check: docker compose logs mcp"; break; }
  sleep 1
done

# ── 5. Wait for Web ───────────────────────────────────────────────
step "Waiting for Web UI to be ready"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:3000" >/dev/null 2>&1; then
    ok "Web UI is ready at ${WEB_URL}"
    break
  fi
  [ "$i" -eq 30 ] && { warn "Web UI is slow to start. Check: docker compose logs web"; break; }
  sleep 1
done

# ── 6. Done ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  SkillNote is running!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${BOLD}  What to do next:${NC}"
echo ""
echo -e "  ${BOLD}1. Open the Web UI${NC}"
echo -e "     ${WEB_URL}"
echo -e "     ${DIM}Browse, create, and manage skills from your browser.${NC}"
echo ""
echo -e "  ${BOLD}2. Connect your AI agent${NC}"
echo -e "     ${DIM}Choose the command for your editor:${NC}"
echo ""
echo -e "     ${BOLD}Claude Code${NC}"
echo -e "     \$ claude mcp add --transport http skillnote ${MCP_URL} --scope user"
echo ""
echo -e "     ${BOLD}OpenClaw${NC}"
echo -e "     \$ openclaw mcp add --transport http skillnote ${MCP_URL} --scope user"
echo ""
echo -e "     ${BOLD}Cursor / Windsurf${NC}  (add to mcp.json)"
echo -e '     { "mcpServers": { "skillnote": { "url": "'"${MCP_URL}"'" } } }'
echo ""
echo -e "  ${BOLD}3. Use a skill in your agent${NC}"
echo -e "     ${DIM}Type /skill-name in your chat, or ask your agent to use a skill.${NC}"
echo -e "     ${DIM}New skills you create in the Web UI appear instantly — no restart needed.${NC}"
echo ""

echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Useful commands${NC}"
echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  docker compose logs -f          ${DIM}# stream all logs${NC}"
echo -e "  docker compose logs -f api      ${DIM}# API logs only${NC}"
echo -e "  docker compose logs -f mcp      ${DIM}# MCP logs only${NC}"
echo -e "  docker compose down             ${DIM}# stop (keeps your data)${NC}"
echo -e "  docker compose down -v          ${DIM}# stop + wipe database${NC}"
echo ""
