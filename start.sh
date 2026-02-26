#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"

# Auto-detect LAN IP, fallback to localhost
SKILLNOTE_HOST="${SKILLNOTE_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
SKILLNOTE_HOST="${SKILLNOTE_HOST:-localhost}"
API_PORT="${SKILLNOTE_API_PORT:-8082}"
API_URL="http://${SKILLNOTE_HOST}:${API_PORT}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[skillnote]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

echo ""
log "Host: ${SKILLNOTE_HOST}"
log "API URL (baked into frontend): ${API_URL}"
echo ""

# ── 1. Kill existing containers ──────────────────────────────────
log "Stopping existing containers..."

docker rm -f skillnote 2>/dev/null && warn "Removed standalone 'skillnote' container" || true
docker compose -f "$PROJECT_DIR/docker-compose.yml" down 2>/dev/null && warn "Stopped root compose stack" || true
docker compose -f "$BACKEND_DIR/docker-compose.yml" down 2>/dev/null && warn "Stopped backend compose stack" || true

ok "All containers stopped"

# ── 2. Start backend (postgres + api) ────────────────────────────
log "Starting backend (postgres + api)..."
SKILLNOTE_API_PORT="$API_PORT" docker compose -f "$BACKEND_DIR/docker-compose.yml" up --build -d

log "Waiting for postgres..."
for i in $(seq 1 30); do
  if docker compose -f "$BACKEND_DIR/docker-compose.yml" exec -T postgres pg_isready -U skillnote >/dev/null 2>&1; then
    ok "Postgres ready"
    break
  fi
  [ "$i" -eq 30 ] && { err "Postgres failed to start"; exit 1; }
  sleep 1
done

log "Waiting for API (migrations + seed)..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    ok "API ready on port ${API_PORT}"
    break
  fi
  [ "$i" -eq 60 ] && { err "API failed to start"; exit 1; }
  sleep 2
done

# Get the backend network name
BACKEND_NETWORK=$(docker network ls --format '{{.Name}}' | grep -m1 backend || echo "")
if [ -z "$BACKEND_NETWORK" ]; then
  err "Backend network not found"
  exit 1
fi

# ── 3. Build frontend (with correct API URL baked in) ─────────────
log "Building frontend with NEXT_PUBLIC_API_BASE_URL=${API_URL}..."
docker build \
  --build-arg "NEXT_PUBLIC_API_BASE_URL=${API_URL}" \
  -t skillnote "$PROJECT_DIR"
ok "Frontend image built"

# ── 4. Start frontend ────────────────────────────────────────────
log "Starting frontend..."
docker run -d \
  --name skillnote \
  -p 3000:3000 \
  --network "$BACKEND_NETWORK" \
  skillnote

log "Waiting for frontend..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then
    ok "Frontend ready on port 3000"
    break
  fi
  [ "$i" -eq 30 ] && { err "Frontend failed to start"; exit 1; }
  sleep 1
done

# ── 5. Done ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  SkillNote is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Frontend:  http://${SKILLNOTE_HOST}:3000"
echo -e "  API:       ${API_URL}"
echo -e "  Postgres:  localhost:5433"
echo ""
echo -e "  ${CYAN}Containers:${NC}"
docker ps --filter "name=skillnote" --filter "name=backend" --format "    {{.Names}}\t{{.Status}}" 2>/dev/null
echo ""
