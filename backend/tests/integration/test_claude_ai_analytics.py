"""Iter 18 — /v1/integrations/claude-ai/analytics endpoint.

Returns the 24h/7d sync rollup that drives the analytics panel.

Contract:
  - skills_synced_{24h,7d} / failed_{24h,7d} count terminal ops in window.
  - sync_success_rate_7d defaults to 1.0 when there are no ops in window.
  - avg_attempts_per_sync_7d is a float; honest 0.0 when no data.
  - top_skills_7d max-5 rows, ordered by sync_count desc, with skill name/slug.
  - per_integration list never drops integrations (LEFT JOIN), only filters
    out disconnected ones.
  - sparkline_7d has EXACTLY 7 entries (oldest-first, even for days with 0).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _get(path):
    req = urllib.request.Request(f"{BASE}{path}", method="GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:  # pragma: no cover
        pytest.skip(f"API not reachable: {e}")


class TestAnalyticsShape:
    def test_endpoint_returns_200_with_full_shape(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        assert s == 200, body
        # All required top-level keys present.
        for k in [
            "skills_synced_24h",
            "skills_synced_7d",
            "failed_24h",
            "failed_7d",
            "sync_success_rate_7d",
            "avg_attempts_per_sync_7d",
            "top_skills_7d",
            "per_integration",
            "sparkline_7d",
        ]:
            assert k in body, f"missing key {k}"

    def test_sparkline_always_has_7_entries(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        assert s == 200
        assert len(body["sparkline_7d"]) == 7
        # Oldest-first ordering.
        dates = [p["date"] for p in body["sparkline_7d"]]
        assert dates == sorted(dates), (
            "sparkline_7d must be oldest-first, got " + str(dates)
        )

    def test_each_sparkline_point_has_required_keys(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        for p in body["sparkline_7d"]:
            assert set(p.keys()) >= {"date", "syncs", "failed"}
            assert isinstance(p["syncs"], int)
            assert isinstance(p["failed"], int)

    def test_success_rate_is_between_zero_and_one(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        rate = body["sync_success_rate_7d"]
        assert 0.0 <= rate <= 1.0, rate

    def test_top_skills_is_at_most_5(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        assert len(body["top_skills_7d"]) <= 5

    def test_top_skills_have_skill_name_and_slug(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        for skill in body["top_skills_7d"]:
            assert skill["skill_slug"]
            assert skill["skill_name"]
            assert skill["sync_count"] > 0

    def test_top_skills_ordered_desc_by_count(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        counts = [s["sync_count"] for s in body["top_skills_7d"]]
        assert counts == sorted(counts, reverse=True), counts

    def test_per_integration_excludes_disconnected_rows(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        # We don't directly know which integrations are disconnected from
        # the analytics endpoint, but the integrations endpoint does. Any
        # integration that's not in per_integration shouldn't be reachable
        # via /integrations as active either. Soft check: confirm we at
        # least don't see "disconnected" status leak through, by verifying
        # no per_integration row corresponds to a disconnected integration
        # in /integrations.
        s2, integ_list = _get("/v1/integrations/claude-ai/integrations")
        if s2 != 200:
            pytest.skip("integrations endpoint unavailable")
        disconnected = {
            i["id"] for i in integ_list if i["status"] == "disconnected"
        }
        analytics_ids = {p["integration_id"] for p in body["per_integration"]}
        assert disconnected.isdisjoint(analytics_ids), (
            "per_integration must not include disconnected integrations"
        )

    def test_avg_attempts_is_a_number(self):
        s, body = _get("/v1/integrations/claude-ai/analytics")
        assert isinstance(body["avg_attempts_per_sync_7d"], (int, float))
        assert body["avg_attempts_per_sync_7d"] >= 0.0
