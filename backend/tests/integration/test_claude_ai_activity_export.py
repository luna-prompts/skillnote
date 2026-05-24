"""Iter 19 — activity log review tools.

Tests:
  - /activity now accepts since/until/skill_id query params.
  - since > until returns 422 INVALID_DATE_RANGE.
  - /activity/export.csv streams a CSV with proper headers + Content-Disposition.
  - Export honors all the filter params (since/until/skill_id/event).
"""
from __future__ import annotations

import csv
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import pytest


def _enc(s: str) -> str:
    """URL-encode an ISO datetime so the `+` in the timezone doesn't get
    interpreted as a space by the query-string parser."""
    return urllib.parse.quote(s, safe="")


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _get(path, headers=None):
    req = urllib.request.Request(f"{BASE}{path}", method="GET", headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            ct = r.headers.get("content-type", "")
            text = r.read().decode()
            if ct.startswith("application/json"):
                return r.status, json.loads(text), dict(r.headers)
            return r.status, text, dict(r.headers)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode()), dict(e.headers)
        except Exception:
            return e.code, e.read().decode(), dict(e.headers)
    except Exception as e:  # pragma: no cover
        pytest.skip(f"API not reachable: {e}")


class TestDateRangeFilter:
    def test_since_accepted(self):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        s, body, _ = _get(
            f"/v1/integrations/claude-ai/activity?since={_enc(cutoff)}"
        )
        assert s == 200, body
        assert isinstance(body, list)

    def test_until_accepted(self):
        cutoff = datetime.now(timezone.utc).isoformat()
        s, body, _ = _get(
            f"/v1/integrations/claude-ai/activity?until={_enc(cutoff)}"
        )
        assert s == 200, body
        assert isinstance(body, list)

    def test_since_until_window_returns_only_in_range(self):
        since = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        until = datetime.now(timezone.utc).isoformat()
        s, body, _ = _get(
            f"/v1/integrations/claude-ai/activity"
            f"?since={_enc(since)}&until={_enc(until)}&limit=10"
        )
        assert s == 200, body
        for row in body:
            t = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
            assert datetime.fromisoformat(since) <= t <= datetime.fromisoformat(until)

    def test_inverted_range_returns_422(self):
        since = datetime.now(timezone.utc).isoformat()
        until = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        s, body, _ = _get(
            f"/v1/integrations/claude-ai/activity"
            f"?since={_enc(since)}&until={_enc(until)}"
        )
        assert s == 422, body
        assert body.get("error", {}).get("code") == "INVALID_DATE_RANGE"

    def test_skill_id_filter_scopes_to_skill(self):
        s, body, _ = _get(
            "/v1/integrations/claude-ai/activity"
            "?skill_id=00000000-0000-0000-0000-000000000001"
        )
        assert s == 200
        # Either empty (no audit rows for that skill) or every row matches.
        for row in body:
            assert row["skill_id"] == "00000000-0000-0000-0000-000000000001"


class TestCsvExport:
    def test_export_returns_csv_content_type(self):
        s, body, headers = _get("/v1/integrations/claude-ai/activity/export.csv?limit=5")
        assert s == 200
        assert headers["content-type"].startswith("text/csv")
        # Disposition header instructs the browser to save the file.
        cd = headers.get("content-disposition", "")
        assert "attachment" in cd
        assert "claude-ai-activity.csv" in cd

    def test_export_includes_header_row(self):
        s, body, _ = _get("/v1/integrations/claude-ai/activity/export.csv?limit=3")
        assert s == 200
        reader = csv.reader(io.StringIO(body))
        rows = list(reader)
        assert len(rows) >= 1
        assert rows[0] == ["created_at", "event", "integration_id", "skill_id", "detail"]

    def test_export_rejects_invalid_event_with_422(self):
        s, body, _ = _get(
            "/v1/integrations/claude-ai/activity/export.csv?event=not_a_kind"
        )
        assert s == 422
        assert body.get("error", {}).get("code") == "INVALID_EVENT"

    def test_export_rejects_inverted_date_range(self):
        since = datetime.now(timezone.utc).isoformat()
        until = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        s, body, _ = _get(
            f"/v1/integrations/claude-ai/activity/export.csv"
            f"?since={_enc(since)}&until={_enc(until)}"
        )
        assert s == 422
        assert body.get("error", {}).get("code") == "INVALID_DATE_RANGE"

    def test_export_limit_capped_at_50000(self):
        s, _, _ = _get(
            "/v1/integrations/claude-ai/activity/export.csv?limit=999999"
        )
        # ge=1, le=50000 — over-limit is 422.
        assert s == 422

    def test_export_limit_50000_accepted(self):
        s, _, _ = _get(
            "/v1/integrations/claude-ai/activity/export.csv?limit=50000"
        )
        assert s == 200

    def test_export_cache_headers_disable_caching(self):
        """A re-export must always reflect fresh state — no stale cached
        downloads. The handler sets Cache-Control: no-store."""
        s, _, headers = _get(
            "/v1/integrations/claude-ai/activity/export.csv?limit=1"
        )
        assert s == 200
        assert headers.get("cache-control") == "no-store"
