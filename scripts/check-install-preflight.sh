#!/usr/bin/env bash
# Smoke test for `install.sh --check`. Asserts:
#   1. The flag exits 0 when curl + python3 + a container runtime are
#      present (the common dev-laptop case).
#   2. The output mentions which runtime was detected (so a regression
#      that silently passes without finding a runtime would be caught).
#
# Usage:
#   bash scripts/check-install-preflight.sh

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_SH="$ROOT_DIR/install.sh"

if [ ! -x "$INSTALL_SH" ]; then
  echo "install.sh not executable at $INSTALL_SH" >&2
  exit 1
fi

# Run the preflight in a subshell so the script's `exit` doesn't kill us.
output=$(bash "$INSTALL_SH" --check 2>&1)
status=$?

if [ "$status" -ne 0 ]; then
  echo "FAIL: install.sh --check exited $status"
  echo "output:"
  echo "$output" | sed 's/^/  /'
  exit 1
fi

if ! echo "$output" | grep -qE 'preflight ok'; then
  echo "FAIL: install.sh --check exited 0 but did not say 'preflight ok'"
  echo "output:"
  echo "$output" | sed 's/^/  /'
  exit 1
fi

echo "ok: $output"
