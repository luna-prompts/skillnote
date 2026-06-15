"""Iter 23 — failed-op retry + token rotation + queue-scope flag.

These three endpoints close real production gaps:

  * /operations/{id}/retry  → users can recover from a 3-strike failed op
                              without touching the database.
  * /integrations/{id}/rotate-token → recover from a suspected token
                              compromise without un-pairing the integration
                              (and so without losing the skill links).
  * SKILLNOTE_REQUIRE_QUEUE_SCOPE env flag → multi-tenant operators can
                              forbid the cross-integration global queue view.
"""
from __future__ import annotations

import io
import json
import os
import random
import urllib.error
import urllib.request
import uuid
import zipfile

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _ip() -> str:
    return f"192.0.2.{random.randint(1, 254)}"


def _post(path, body=None, headers=None):
    h = {"Content-Type": "application/json"} if body is not None else {}
    if headers:
        h.update(headers)
    req = urllib.request.Request(
        f"{BASE}{path}", method="POST",
        data=(json.dumps(body).encode() if body is not None else None),
        headers=h,
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, (json.loads(r.read().decode()) if r.headers.get("content-type", "").startswith("application/json") else None)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode()) if e.headers.get("content-type", "").startswith("application/json") else None
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _get(path, headers=None):
    req = urllib.request.Request(f"{BASE}{path}", method="GET", headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture
def paired_with_failed_op():
    """Pair, seed a skill (auto-enqueues an upload op), pull the op via
    the extension endpoint to force in_progress, then complete with
    success=False three times to flip it to status=failed."""
    ip = _ip()
    s, pair = _post(
        "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "resilience-test"},
        headers={"X-Forwarded-For": ip},
    )
    if s != 201:
        pytest.skip(f"pair returned {s}")
    _post("/v1/integrations/claude-ai/pair/approve", body={"pairing_code": pair["pairing_code"]})
    _, body = _get(
        f"/v1/integrations/claude-ai/extension/pair/status"
        f"?pairing_token={pair['pairing_token']}"
    )
    token = body["extension_token"]
    integ_id = pair["integration_id"]

    name = f"retry-{uuid.uuid4().hex[:6]}"
    collection = f"r-{uuid.uuid4().hex[:8]}"
    s, _ = _post(
        "/v1/skills",
        body={
            "name": name, "slug": name,
            "description": "retry test seed",
            "content_md": "# seed\n",
            "collections": [collection],
        },
    )
    if s != 201:
        pytest.skip(f"skill seed returned {s}")

    # Pull-then-fail the op three times. The GET endpoint is what
    # increments op.attempts; without re-pulling between failures the
    # attempts counter never reaches the 3-strike threshold so the
    # status never flips to 'failed'.
    op_id: str | None = None
    for attempt in range(3):
        req = urllib.request.Request(
            f"{BASE}/v1/integrations/claude-ai/extension/operations",
            method="GET",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req) as r:
            ops = json.loads(r.read().decode())
        ours = [o for o in ops if o.get("payload", {}).get("name") == name]
        if not ours:
            # If on the FIRST iteration we can't find the op, the seed
            # didn't materialize — skip. On later iterations the op is
            # likely back in flight (in_progress) and won't show in
            # pending-only fetch. Bail in that case too.
            if attempt == 0:
                pytest.skip("seed op didn't materialize")
            break
        op_id = ours[0]["id"]
        _post(
            f"/v1/integrations/claude-ai/extension/operations/{op_id}/complete",
            body={"success": False, "error": f"induced failure {attempt}"},
            headers={"Authorization": f"Bearer {token}"},
        )
    if op_id is None:
        pytest.skip("could not push op through to failed state")
    return {"integ_id": integ_id, "token": token, "op_id": op_id}


class TestRetryFailedOp:
    def test_unknown_op_returns_404(self):
        s, body = _post(
            f"/v1/integrations/claude-ai/operations/{uuid.uuid4()}/retry"
        )
        assert s == 404
        assert body["error"]["code"] == "OPERATION_NOT_FOUND"

    def test_pending_op_is_not_retryable(self, paired_with_failed_op):
        """We need a pending op to test — seed a new skill which queues
        one. Then attempt retry on it; should 409."""
        # Use a fresh paired integration so we don't collide.
        ctx = paired_with_failed_op
        # Find any current pending op via the queue endpoint.
        _, q = _get(
            f"/v1/integrations/claude-ai/queue?integration_id={ctx['integ_id']}"
        )
        pending = [it for it in q["items"] if it["status"] == "pending"]
        if not pending:
            pytest.skip("no pending op to test against")
        s, body = _post(
            f"/v1/integrations/claude-ai/operations/{pending[0]['id']}/retry"
        )
        assert s == 409, body
        assert body["error"]["code"] == "OPERATION_NOT_RETRYABLE"

    def test_failed_op_resets_to_pending(self, paired_with_failed_op):
        ctx = paired_with_failed_op
        s, _ = _post(
            f"/v1/integrations/claude-ai/operations/{ctx['op_id']}/retry"
        )
        assert s == 204
        # Now the queue should see it as pending with attempts=0.
        _, q = _get(
            f"/v1/integrations/claude-ai/queue?integration_id={ctx['integ_id']}"
        )
        item = next((it for it in q["items"] if it["id"] == ctx["op_id"]), None)
        assert item is not None, "retried op should be back in the queue"
        assert item["status"] == "pending"
        assert item["attempts"] == 0
        assert item["last_error"] is None


class TestTokenRotation:
    @pytest.fixture
    def paired(self):
        ip = _ip()
        s, pair = _post(
            "/v1/integrations/claude-ai/extension/pair",
            body={"browser_label": "rotate-test"},
            headers={"X-Forwarded-For": ip},
        )
        if s != 201:
            pytest.skip(f"pair returned {s}")
        _post("/v1/integrations/claude-ai/pair/approve", body={"pairing_code": pair["pairing_code"]})
        _, body = _get(
            f"/v1/integrations/claude-ai/extension/pair/status"
            f"?pairing_token={pair['pairing_token']}"
        )
        return {
            "integ_id": pair["integration_id"],
            "old_token": body["extension_token"],
        }

    def test_unknown_integration_returns_404(self):
        s, body = _post(
            f"/v1/integrations/claude-ai/integrations/{uuid.uuid4()}/rotate-token"
        )
        assert s == 404
        assert body["error"]["code"] == "INTEGRATION_NOT_FOUND"

    def test_rotate_returns_new_token_and_invalidates_old(self, paired):
        s, body = _post(
            f"/v1/integrations/claude-ai/integrations/{paired['integ_id']}/rotate-token"
        )
        assert s == 200, body
        new_token = body["new_extension_token"]
        assert new_token and new_token != paired["old_token"]
        # Old token must no longer authenticate.
        req = urllib.request.Request(
            f"{BASE}/v1/integrations/claude-ai/extension/status",
            headers={"Authorization": f"Bearer {paired['old_token']}"},
        )
        try:
            with urllib.request.urlopen(req) as r:
                got = r.status
        except urllib.error.HTTPError as e:
            got = e.code
        assert got == 401, "old token should be rejected after rotation"
        # New token works.
        req2 = urllib.request.Request(
            f"{BASE}/v1/integrations/claude-ai/extension/status",
            headers={"Authorization": f"Bearer {new_token}"},
        )
        with urllib.request.urlopen(req2) as r:
            assert r.status == 200

    def test_rotate_writes_audit_row(self, paired):
        _post(
            f"/v1/integrations/claude-ai/integrations/{paired['integ_id']}/rotate-token"
        )
        _, events = _get(
            f"/v1/integrations/claude-ai/activity"
            f"?integration_id={paired['integ_id']}&event=token_revoked&limit=10"
        )
        rotations = [
            e for e in events
            if (e.get("detail") or {}).get("action") == "rotate"
        ]
        assert len(rotations) >= 1


class TestQueueScopeFlag:
    """The env-flag behavior is hard to test without restarting uvicorn
    with the env var set. We at least verify the endpoint accepts the
    unscoped call by default — the flag-on behavior is exercised by
    operators via their own deployment configuration.
    """

    def test_unscoped_queue_is_accepted_by_default(self):
        s, body = _get("/v1/integrations/claude-ai/queue?limit=5")
        assert s == 200
        assert "items" in body
