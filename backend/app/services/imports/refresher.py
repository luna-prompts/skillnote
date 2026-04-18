"""HEAD-SHA probe for drift detection."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from app.db.models import ImportSource


_cache = {}  # (url, ref) -> (timestamp, sha)
_TTL = 600  # 10 min


def probe_head_sha(source: ImportSource, token: str = None, timeout_s: int = 3) -> None:
    """Probe upstream HEAD SHA. Updates source.upstream_sha, status, last_checked_at in place.

    Only handles GitHub source_type for v1. Other types are skipped.
    """
    if source.pinned:
        return
    if source.source_type != "github" or not source.owner or not source.repo:
        return

    key = (source.url, source.ref)
    now = time.time()
    if key in _cache and now - _cache[key][0] < _TTL:
        new_sha = _cache[key][1]
    else:
        api_base = os.environ.get("SKILLNOTE_IMPORT_GITHUB_API_BASE", "https://api.github.com").rstrip("/")
        url = f"{api_base}/repos/{source.owner}/{source.repo}/commits/{source.ref or 'main'}"
        headers = {"User-Agent": "skillnote-import/0.3.3"}
        if token:
            headers["Authorization"] = f"token {token}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                body = json.loads(resp.read())
            new_sha = body.get("sha")
            _cache[key] = (now, new_sha)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            source.status = "unreachable"
            source.last_checked_at = datetime.now(timezone.utc)
            return

    source.last_checked_at = datetime.now(timezone.utc)
    source.upstream_sha = new_sha
    if new_sha and new_sha != source.imported_at_sha:
        source.status = "drift"
    else:
        source.status = "up_to_date"
