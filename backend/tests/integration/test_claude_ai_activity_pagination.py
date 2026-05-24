"""Activity-feed pagination + event-kind validation tests (round 9).

Before this round:
  * The `event` query param accepted any string. A typo (e.g. `?event=foo`)
    returned 0 rows silently, leading to debugging confusion.
  * `limit` was effectively unbounded — handler-side default 50, but a
    client passing `?limit=99999` would get clamped to 500 by the service
    layer without an error response, hiding the misuse.
  * The service supported `before=` for cursor pagination but the API
    didn't expose it, so the UI could only ever see the most recent page.
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


class TestEventKindValidation:
    def test_known_event_kind_is_accepted(self):
        s, body = _get("/v1/integrations/claude-ai/activity?event=pair_started&limit=1")
        assert s == 200
        assert isinstance(body, list)

    def test_unknown_event_kind_returns_422_with_helpful_message(self):
        s, body = _get("/v1/integrations/claude-ai/activity?event=nope")
        assert s == 422, body
        # FastAPI puts validation errors under `detail`; our custom api_error
        # uses the `error.code` envelope. Either is acceptable; just check
        # the unknown kind doesn't silently return 200 with an empty list.
        text = json.dumps(body)
        assert "nope" in text or "INVALID_EVENT" in text or "event" in text


class TestLimitBounds:
    def test_negative_limit_is_rejected(self):
        s, body = _get("/v1/integrations/claude-ai/activity?limit=-1")
        # Pydantic/FastAPI validates ge=1 — should be 422.
        assert s == 422, body

    def test_oversized_limit_is_rejected(self):
        s, body = _get("/v1/integrations/claude-ai/activity?limit=10000")
        assert s == 422, body

    def test_limit_at_max_is_accepted(self):
        s, _ = _get("/v1/integrations/claude-ai/activity?limit=500")
        assert s == 200

    def test_zero_limit_is_rejected(self):
        s, _ = _get("/v1/integrations/claude-ai/activity?limit=0")
        assert s == 422


class TestBeforeCursor:
    def test_before_param_is_accepted(self):
        """A valid ISO timestamp doesn't 4xx — the wire contract is honored
        even if the dataset is empty."""
        s, body = _get(
            "/v1/integrations/claude-ai/activity"
            "?before=2030-01-01T00:00:00Z&limit=5"
        )
        assert s == 200, body
        assert isinstance(body, list)

    def test_malformed_before_returns_422(self):
        s, _ = _get("/v1/integrations/claude-ai/activity?before=not-a-date")
        assert s == 422

    def test_before_filters_to_older_rows(self):
        """If the suite has emitted any audit events at all, ordering
        guarantees should hold: first row's timestamp must be > second row's
        when sorted desc; using that timestamp as `before` returns the rest."""
        s, page1 = _get("/v1/integrations/claude-ai/activity?limit=2")
        if s != 200 or len(page1) < 2:
            pytest.skip("Not enough audit history to exercise pagination")
        # page1 is desc-by-created_at. The 'before' of page1[1].created_at
        # should NOT include page1[0].
        cursor = page1[0]["created_at"]
        s, page2 = _get(
            f"/v1/integrations/claude-ai/activity?before={cursor}&limit=5"
        )
        assert s == 200
        ids_page1 = {row["id"] for row in page1[:1]}
        ids_page2 = {row["id"] for row in page2}
        assert ids_page1.isdisjoint(ids_page2), (
            "before= cursor should EXCLUDE the cursor row itself"
        )
