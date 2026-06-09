"""Iter 17 — /v1/integrations/claude-ai/queue endpoint.

The endpoint surfaces the live pending + in-progress sync operations
to the SkillNote settings UI. Drives the "Sync activity" panel.

Contract:
  - Returns ONLY pending and in_progress ops (no completed/failed).
  - Sorted oldest-first so the queue reads FIFO.
  - Eager-joins skill name/slug and integration label so the UI doesn't
    need N+1 follow-up requests.
  - Provides total/pending/in_progress counts even when the page is
    truncated by limit.
  - oldest_age_seconds lets the UI flag a stalled extension.
  - integration_id query param filters to one integration.
  - limit clamps to [1, 200].
"""
from __future__ import annotations

import json
import os
import random
import urllib.error
import urllib.request
import uuid

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _unique_ip() -> str:
    return f"192.0.2.{random.randint(1, 254)}"


def _post(path, body=None, headers=None):
    h = {"Content-Type": "application/json"} if body is not None else {}
    if headers:
        h.update(headers)
    req = urllib.request.Request(
        f"{BASE}{path}",
        method="POST",
        data=(json.dumps(body).encode() if body is not None else None),
        headers=h,
    )
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        return e.code, (json.loads(txt) if txt else None)
    except Exception as e:  # pragma: no cover
        pytest.skip(f"API not reachable: {e}")


def _get(path):
    req = urllib.request.Request(f"{BASE}{path}", method="GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:  # pragma: no cover
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture
def paired_with_seeded_op():
    """Pair an extension and create a skill so an upload op lands in the queue."""
    ip = _unique_ip()
    s, pair = _post(
        "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "queue-test"},
        headers={"X-Forwarded-For": ip},
    )
    if s != 201:
        pytest.skip(f"pair returned {s}")
    _post(
        "/v1/integrations/claude-ai/pair/approve",
        body={"pairing_code": pair["pairing_code"]},
    )
    _, body = _get(
        f"/v1/integrations/claude-ai/extension/pair/status"
        f"?pairing_token={pair['pairing_token']}"
    )
    assert body["approved"]

    name = f"queue-skill-{uuid.uuid4().hex[:6]}"
    collection = f"q-{uuid.uuid4().hex[:10]}"
    s, _ = _post(
        "/v1/skills",
        body={
            "name": name,
            "slug": name,
            "description": "queue test seed",
            "content_md": "# seed\n",
            "collections": [collection],
        },
    )
    if s != 201:
        pytest.skip(f"could not seed skill (status {s})")
    return pair["integration_id"], body["extension_token"], name


class TestQueueContract:
    def test_returns_pending_op_after_seeding_a_skill(self, paired_with_seeded_op):
        integ_id, _token, _name = paired_with_seeded_op
        # Scope to THIS integration — global queue can hold ops from
        # other tests / past runs.
        s, body = _get(
            f"/v1/integrations/claude-ai/queue?integration_id={integ_id}"
        )
        assert s == 200, body
        assert body["pending_count"] + body["in_progress_count"] >= 1
        # Named-group model: creating a skill enqueues ONE whole-group
        # `publish_group` op (skill_id None), not a per-skill upload op.
        ours = [it for it in body["items"] if it["kind"] == "publish_group"]
        assert len(ours) >= 1, body["items"]
        item = ours[0]
        assert item["integration_id"] == integ_id
        assert item["status"] in ("pending", "in_progress")
        assert item["integration_label"] == "queue-test"

    def test_oldest_age_seconds_is_populated_when_queue_nonempty(
        self, paired_with_seeded_op
    ):
        _, _, _ = paired_with_seeded_op
        s, body = _get("/v1/integrations/claude-ai/queue")
        assert s == 200
        if body["total"] > 0:
            assert body["oldest_age_seconds"] is not None
            assert body["oldest_age_seconds"] >= 0

    def test_completed_ops_are_excluded(self, paired_with_seeded_op):
        """After we complete an op the queue stops listing it."""
        integ_id, token, name = paired_with_seeded_op
        # Pull the op into in_progress.
        s, ops = _get("/v1/integrations/claude-ai/extension/operations")
        # Without the bearer this would 401; the get helper here doesn't
        # attach one. Use a direct request instead.
        req = urllib.request.Request(
            f"{BASE}/v1/integrations/claude-ai/extension/operations",
            method="GET",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req) as r:
            ops_payload = json.loads(r.read().decode())
        ours = [o for o in ops_payload if o.get("payload", {}).get("name") == name]
        if not ours:
            pytest.skip("seed op didn't materialize")
        op_id = ours[0]["id"]

        _post(
            f"/v1/integrations/claude-ai/extension/operations/{op_id}/complete",
            body={
                "success": True,
                "result": {
                    "claude_ai_skill_id": "skill_test_" + uuid.uuid4().hex[:6],
                    "claude_ai_version": "v1",
                },
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        s, body = _get(
            f"/v1/integrations/claude-ai/queue?integration_id={integ_id}"
        )
        assert s == 200
        remaining = [it for it in body["items"] if it["id"] == op_id]
        assert remaining == [], (
            f"completed op should be excluded from queue, got {remaining}"
        )


class TestQueueFiltering:
    def test_integration_id_filter_scopes_results(self, paired_with_seeded_op):
        integ_id, _, _ = paired_with_seeded_op
        s, body = _get(
            f"/v1/integrations/claude-ai/queue?integration_id={integ_id}"
        )
        assert s == 200
        # Every row in the filtered response is for THIS integration only.
        for it in body["items"]:
            assert it["integration_id"] == integ_id

    def test_unknown_integration_returns_empty(self):
        s, body = _get(
            f"/v1/integrations/claude-ai/queue?integration_id={uuid.uuid4()}"
        )
        assert s == 200
        assert body["items"] == []
        assert body["total"] == 0
        assert body["pending_count"] == 0
        assert body["in_progress_count"] == 0
        assert body["oldest_age_seconds"] is None


class TestQueueLimitBounds:
    def test_limit_below_min_returns_422(self):
        s, _ = _get("/v1/integrations/claude-ai/queue?limit=0")
        assert s == 422

    def test_limit_above_max_returns_422(self):
        s, _ = _get("/v1/integrations/claude-ai/queue?limit=201")
        assert s == 422

    def test_limit_at_max_succeeds(self):
        s, _ = _get("/v1/integrations/claude-ai/queue?limit=200")
        assert s == 200
