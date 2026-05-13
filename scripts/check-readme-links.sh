#!/usr/bin/env bash
# Smoke-checks every absolute external URL in README.md to catch link rot
# before a user hits a 404 on the landing page. HEAD requests only; runs
# in parallel with a tight timeout.
#
# Exit 0 if all OK, exit 1 with the failing list otherwise.
# Skips localhost / 127.0.0.1 / shields.io badge URLs (the latter are
# served dynamically and respond with various non-2xx codes that aren't
# meaningful link-rot signals).
#
# Usage:
#   bash scripts/check-readme-links.sh
#   bash scripts/check-readme-links.sh --verbose

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
README="$ROOT_DIR/README.md"
VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

if [ ! -f "$README" ]; then
  echo "README.md not found at $README" >&2
  exit 1
fi

# Strip trailing punctuation that often follows URLs in prose. Use a
# tempfile + read loop (bash 3-compatible — macOS ships bash 3.2, no
# mapfile available).
URL_LIST=$(mktemp)
trap 'rm -f "$URL_LIST"' EXIT
grep -Eo 'https?://[^)" ]+' "$README" \
  | sed -E 's/[.,;:`>]+$//' \
  | grep -Ev '^https?://(localhost|127\.0\.0\.1)' \
  | grep -Ev '^https?://img\.shields\.io' \
  | grep -Ev '^https?://(your-server|<)' \
  | grep -Ev 'raw\.githubusercontent\.com/luna-prompts/skillnote/cli-v[0-9]+\.[0-9]+\.[0-9]+/' \
  | sort -u > "$URL_LIST"

url_count=$(wc -l < "$URL_LIST" | tr -d ' ')
if [ "$url_count" = "0" ]; then
  echo "no external URLs found"
  exit 0
fi

[ "$VERBOSE" -eq 1 ] && echo "checking $url_count URLs..."

fail_count=0
while IFS= read -r url; do
  [ -z "$url" ] && continue
  # -L follow redirects, -I HEAD, -f fail on >=400, -s silent, -o discard
  # body, -w status only; some hosts reject HEAD so fall back to GET range.
  code=$(curl -sS -L -o /dev/null -w '%{http_code}' --max-time 8 -I "$url" 2>/dev/null || echo "000")
  if [ "$code" = "405" ] || [ "$code" = "000" ] || [ "$code" = "403" ]; then
    # Retry with GET (some CDNs / GitHub reject HEAD)
    code=$(curl -sS -L -o /dev/null -w '%{http_code}' --max-time 8 -r 0-1 "$url" 2>/dev/null || echo "000")
  fi
  # 2xx and 3xx are healthy. 401/403/429 are common from CDNs / npm /
  # Cloudflare that block programmatic probes — the page exists, the
  # link isn't rotten, so don't flag. Only 404/410/5xx/timeout count
  # as real failures.
  case "$code" in
    2*|3*|401|403|429)
      [ "$VERBOSE" -eq 1 ] && echo "  ok    $code  $url"
      ;;
    *)
      echo "  FAIL  $code  $url"
      fail_count=$((fail_count + 1))
      ;;
  esac
done < "$URL_LIST"

if [ "$fail_count" -gt 0 ]; then
  echo ""
  echo "$fail_count link(s) failed."
  exit 1
fi

echo "all $url_count README links ok"
