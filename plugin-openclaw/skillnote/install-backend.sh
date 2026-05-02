#!/usr/bin/env bash
# SkillNote OpenClaw skill — backend bootstrap.
#
# This script ships INSIDE the SkillNote OpenClaw skill bundle (alongside
# SKILL.md / sync.sh / log-watcher.py). It lands on disk as part of either:
#   • clawhub install skillnote          (clawhub unpacks the skill files)
#   • curl <host>/setup/agent | bash …   (our installer extracts the bundle)
#
# When the SKILL.md detects no SkillNote backend on localhost, it tells the
# agent to invoke this file directly:
#
#     bash ~/.openclaw/skills/skillnote/install-backend.sh
#
# We invoke via `bash <path>` (not `<path>` directly) so it works even if
# clawhub stripped the executable bit at install time.
#
# Two install routes for the BACKEND, depending on context:
#   • This script   → invoked by the OpenClaw agent on the user's behalf
#   • ./install.sh  → run manually by anyone who has already cloned the repo
#
# Optional env vars:
#   SKILLNOTE_INSTALL_DIR  — clone target (default: $HOME/skillnote)
#   SKILLNOTE_BRANCH       — git branch to clone (default: master)
#   SKILLNOTE_API_PORT     — host port for API   (default: 8082)
#   SKILLNOTE_WEB_PORT     — host port for Web   (default: 3000)

set -euo pipefail

# Resolve $HOME defensively. Under `env -i` or other stripped-environment
# invocations it may not be set, which combined with `set -u` would crash
# the script before it gets a chance to print a useful error. macOS doesn't
# ship `getent`, so we use `eval echo ~user` which works on both Linux and
# macOS, then fall through to /tmp as the absolute last resort.
HOME="${HOME:-$(eval echo "~$(id -un 2>/dev/null)" 2>/dev/null)}"
HOME="${HOME:-/tmp}"

TARGET_DIR="${SKILLNOTE_INSTALL_DIR:-$HOME/skillnote}"
BRANCH="${SKILLNOTE_BRANCH:-master}"
API_PORT="${SKILLNOTE_API_PORT:-8082}"
WEB_PORT="${SKILLNOTE_WEB_PORT:-3000}"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

step() { printf "\n${CYAN}==>${NC} ${BOLD}%s${NC}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${NC}  %s\n" "$1"; }
err()  { printf "\n  ${RED}✗ %s${NC}\n\n" "$1" >&2; exit 1; }

# ── 1. Prereqs ──────────────────────────────────────────────────────────────
step "Checking prerequisites"
for cmd in git curl; do
    command -v "$cmd" >/dev/null 2>&1 || err "Missing: $cmd. Install it and re-run."
    ok "$cmd"
done
if command -v docker >/dev/null 2>&1; then
    ok "docker"
elif command -v podman >/dev/null 2>&1; then
    ok "podman"
else
    err "Missing: docker or podman. Install one: https://docs.docker.com/get-docker/"
fi

# ── 2. Clone (or reuse existing checkout) ──────────────────────────────────
step "Preparing $TARGET_DIR"
if [ -d "$TARGET_DIR/.git" ]; then
    ok "Using existing checkout at $TARGET_DIR"
elif [ -e "$TARGET_DIR" ]; then
    err "$TARGET_DIR exists but is not a git checkout. Move it aside or set SKILLNOTE_INSTALL_DIR to a different path."
else
    git clone --branch "$BRANCH" --depth 1 https://github.com/luna-prompts/skillnote.git "$TARGET_DIR"
    ok "Cloned into $TARGET_DIR"
fi

# ── 3. Run the main installer ───────────────────────────────────────────────
step "Running ./install.sh (Docker build, ~2-3 min on first run)"
cd "$TARGET_DIR"
SKILLNOTE_API_PORT="$API_PORT" SKILLNOTE_WEB_PORT="$WEB_PORT" ./install.sh

# ── 4. Wait for the API to respond ──────────────────────────────────────────
step "Waiting for the API to be ready"
for i in $(seq 1 30); do
    if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
        ok "API responded after ${i}× 2s"
        break
    fi
    [ "$i" -eq 30 ] && err "API didn't respond within 60s. Inspect: cd $TARGET_DIR && docker compose logs api"
    sleep 2
done

# ── 5. Done ─────────────────────────────────────────────────────────────────
SKILL_COUNT=$(curl -sf "http://localhost:${API_PORT}/v1/skills" 2>/dev/null \
    | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null \
    || echo "?")

printf "\n${GREEN}${BOLD}✓ SkillNote backend ready${NC}\n"
printf "  ${DIM}Web${NC}     http://localhost:${WEB_PORT}\n"
printf "  ${DIM}API${NC}     http://localhost:${API_PORT}\n"
printf "  ${DIM}Skills${NC}  ${SKILL_COUNT}\n"
printf "  ${DIM}Repo${NC}    ${TARGET_DIR}\n\n"
