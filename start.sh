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
NC='\033[0m'

log()  { echo -e "${CYAN}[skillnote]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Banner ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  SkillNote${NC}"
echo -e "  Self-hosted skill registry for AI agents"
echo ""
echo -e "  Host:     ${SKILLNOTE_HOST}"
echo -e "  Web:      ${WEB_URL}"
echo -e "  API:      ${API_URL}"
echo -e "  MCP:      ${MCP_URL}"
echo ""

# ── 1. Stop any existing stack ────────────────────────────────────
log "Stopping existing containers..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" down 2>/dev/null || true
ok "Clean slate"

# ── 2. Start full stack ───────────────────────────────────────────
log "Starting stack (postgres + api + mcp + web)..."
SKILLNOTE_HOST="$SKILLNOTE_HOST" \
SKILLNOTE_API_PORT="$API_PORT" \
SKILLNOTE_MCP_PORT="$MCP_PORT" \
  docker compose -f "$PROJECT_DIR/docker-compose.yml" up --build -d

# ── 3. Wait for API ───────────────────────────────────────────────
log "Waiting for API..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    ok "API ready"
    break
  fi
  [ "$i" -eq 60 ] && err "API failed to start — run: docker compose logs api"
  sleep 2
done

# ── 4. Wait for MCP ───────────────────────────────────────────────
log "Waiting for MCP server..."
for i in $(seq 1 30); do
  if curl -sf -X POST "http://localhost:${MCP_PORT}/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1"}}}' \
      >/dev/null 2>&1; then
    ok "MCP server ready"
    break
  fi
  [ "$i" -eq 30 ] && { warn "MCP server slow to start — check: docker compose logs mcp"; break; }
  sleep 1
done

# ── 5. Wait for Web ───────────────────────────────────────────────
log "Waiting for web UI..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:3000" >/dev/null 2>&1; then
    ok "Web UI ready"
    break
  fi
  [ "$i" -eq 30 ] && { warn "Web UI slow to start — check: docker compose logs web"; break; }
  sleep 1
done

# ── 6. Done ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  SkillNote is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}Web UI${NC}   →  ${WEB_URL}"
echo -e "  ${BOLD}API${NC}      →  ${API_URL}"
echo -e "  ${BOLD}MCP${NC}      →  ${MCP_URL}"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Connect your AI agent${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}Claude Code${NC}"
echo -e "  $ claude mcp add --transport http skillnote ${MCP_URL} --scope user"
echo ""
echo -e "  ${BOLD}Cursor / Windsurf${NC}  — add to your mcp.json:"
echo -e '  { "mcpServers": { "skillnote": { "url": "'"${MCP_URL}"'" } } }'
echo ""
echo -e "  ${BOLD}OpenClaw${NC}"
echo -e "  $ openclaw mcp add --transport http skillnote ${MCP_URL} --scope user"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Useful commands${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  docker compose logs -f          # tail all logs"
echo -e "  docker compose logs -f api      # API logs only"
echo -e "  docker compose logs -f mcp      # MCP logs only"
echo -e "  docker compose down             # stop (keeps data)"
echo -e "  docker compose down -v          # stop + wipe database"
echo ""
