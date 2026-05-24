"""Iter 21 — GET /v1/integrations/claude-ai/diagnostic.

One-click connector health audit. Bundles 8 checks into a single
pass/warn/fail verdict.

Contract:
  - Always returns 200 (failures live INSIDE the response, not as HTTP
    errors). Operators want one structured payload to scrape, not
    branching on status codes.
  - Each check has {id, label, status: pass|warn|fail, detail}.
  - overall = fail > warn > pass precedence.
  - generated_at is a real timestamp.
  - The check `id`s are stable string keys (used by ops as dashboard
    selectors), so renaming one is a contract break.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")

EXPECTED_CHECK_IDS = {
    "backend_db",
    "schema_migrated",
    "integrations_paired",
    "no_cookie_expired",
    "no_stuck_in_progress",
    "conflicts_low",
    "pair_attempts_quiet",
    # `sync_recent` is conditional — only included when at least one
    # integration is paired.
}


def _get(path):
    req = urllib.request.Request(f"{BASE}{path}", method="GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:  # pragma: no cover
        pytest.skip(f"API not reachable: {e}")


class TestDiagnostic:
    def test_endpoint_returns_200(self):
        s, body = _get("/v1/integrations/claude-ai/diagnostic")
        assert s == 200, body

    def test_response_shape(self):
        s, body = _get("/v1/integrations/claude-ai/diagnostic")
        assert s == 200
        assert "overall" in body
        assert body["overall"] in ("pass", "warn", "fail")
        assert "checks" in body
        assert isinstance(body["checks"], list)
        assert "generated_at" in body
        # Every check carries all 4 fields with correct types.
        for c in body["checks"]:
            assert set(c.keys()) >= {"id", "label", "status", "detail"}
            assert c["status"] in ("pass", "warn", "fail")
            assert isinstance(c["label"], str)
            assert isinstance(c["detail"], str)

    def test_includes_required_check_ids(self):
        s, body = _get("/v1/integrations/claude-ai/diagnostic")
        ids = {c["id"] for c in body["checks"]}
        # Mandatory subset always present regardless of integration state.
        missing = EXPECTED_CHECK_IDS - ids
        assert missing == set(), f"missing required check ids: {missing}"

    def test_check_ids_are_unique(self):
        s, body = _get("/v1/integrations/claude-ai/diagnostic")
        ids = [c["id"] for c in body["checks"]]
        assert len(ids) == len(set(ids)), f"duplicate ids in {ids}"

    def test_backend_db_check_passes(self):
        # The diagnostic ITSELF can't run unless the DB is reachable, so
        # this check should always pass when we get a 200.
        s, body = _get("/v1/integrations/claude-ai/diagnostic")
        backend_db = next(c for c in body["checks"] if c["id"] == "backend_db")
        assert backend_db["status"] == "pass"

    def test_overall_dominated_by_worst_status(self):
        s, body = _get("/v1/integrations/claude-ai/diagnostic")
        statuses = {c["status"] for c in body["checks"]}
        if "fail" in statuses:
            assert body["overall"] == "fail"
        elif "warn" in statuses:
            assert body["overall"] == "warn"
        else:
            assert body["overall"] == "pass"

    def test_generated_at_is_a_recent_timestamp(self):
        from datetime import datetime, timezone

        s, body = _get("/v1/integrations/claude-ai/diagnostic")
        ts = datetime.fromisoformat(body["generated_at"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta = abs((now - ts).total_seconds())
        # The diagnostic ran milliseconds ago; allow a generous 60s
        # clock-skew window for slow CI runners.
        assert delta < 60, f"generated_at off by {delta}s"
