"""Round 12 — cookie_expired flip + audit event.

Before: extension's only auth-failure signal was the generic `error` string
on a complete_operation call. Backend couldn't distinguish "claude.ai 500"
from "claude.ai 401 / session gone," so it never flipped the integration to
`cookie_expired` and never wrote a matching audit row. UI saw a parade of
generic op_failed events with no remediation hint.

After: `auth_expired: true` on the complete payload (a) flips
integration.status to `cookie_expired` and (b) emits a `cookie_expired`
audit event. Tests below verify both effects and the validator change
(`cookie_expired` is now in _VALID_AUDIT_EVENTS).
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
        f"{BASE}{path}", method="POST",
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


def _get(path, headers=None):
    req = urllib.request.Request(f"{BASE}{path}", method="GET", headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        return e.code, (json.loads(txt) if txt else None)
    except Exception as e:  # pragma: no cover
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture
def paired_with_pending_op():
    """Pair an extension AND seed a skill so an upload op is queued.

    Right after `pair → approve → status`, the operations queue is empty.
    The cookie_expired tests need at least one pending op to complete.
    Creating a skill via POST /v1/skills auto-enqueues an upload op for
    every active integration (see enqueue_skill_upload in
    services/claude_ai_sync.py)."""
    ip = _unique_ip()
    s, pair = _post(
        "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "cookie-expired-test"},
        headers={"X-Forwarded-For": ip},
    )
    if s != 201:
        pytest.skip(f"pair endpoint returned {s}")
    _post(
        "/v1/integrations/claude-ai/pair/approve",
        body={"pairing_code": pair["pairing_code"]},
    )
    _, body = _get(
        f"/v1/integrations/claude-ai/extension/pair/status"
        f"?pairing_token={pair['pairing_token']}"
    )
    assert body["approved"]

    # Seed a skill — auto-enqueues an `upload` sync op against the
    # integration. Unique collection slug avoids the 15-skill collection
    # limit that bit us in earlier rounds.
    name = f"cookie-test-{uuid.uuid4().hex[:6]}"
    collection = f"cookie-{uuid.uuid4().hex[:10]}"
    s, _ = _post(
        "/v1/skills",
        body={
            "name": name,
            "slug": name,
            "description": "cookie-expired fixture seed",
            "content_md": "# seed\n",
            "collections": [collection],
        },
    )
    if s != 201:
        pytest.skip(f"could not seed skill (status {s})")

    return pair["integration_id"], body["extension_token"]


class TestCookieExpiredFlip:
    def test_auth_expired_true_flips_integration_status(self, paired_with_pending_op):
        integ_id, token = paired_with_pending_op
        # Queue an op by toggling sync (a simpler way: just look at any
        # op pulled by the extension). For the cookie_expired path we just
        # need an op to complete with auth_expired=true. We'll trigger
        # `list` reverse sync by hitting the operations endpoint and
        # synthesizing a completion below.
        # Approach: directly use the extension's complete endpoint on a
        # bogus op id — it 404s. So instead, we pull pending ops first.
        s, ops = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": f"Bearer {token}"},
        )
        if s != 200 or len(ops) == 0:
            pytest.skip("no pending ops — would need to create a skill first")
        op = ops[0]
        s, _ = _post(
            f"/v1/integrations/claude-ai/extension/operations/{op['id']}/complete",
            body={"success": False, "error": "claude.ai 401", "auth_expired": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert s == 204
        # Now read the integrations list and confirm status flipped.
        s, rows = _get("/v1/integrations/claude-ai/integrations")
        row = next((r for r in rows if r["id"] == integ_id), None)
        assert row is not None
        assert row["status"] == "cookie_expired", row

    def test_cookie_expired_audit_event_is_written(self, paired_with_pending_op):
        integ_id, token = paired_with_pending_op
        s, ops = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": f"Bearer {token}"},
        )
        if s != 200 or len(ops) == 0:
            pytest.skip("no pending ops")
        op = ops[0]
        _post(
            f"/v1/integrations/claude-ai/extension/operations/{op['id']}/complete",
            body={"success": False, "error": "claude.ai 401", "auth_expired": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        s, events = _get(
            f"/v1/integrations/claude-ai/activity?integration_id={integ_id}&event=cookie_expired"
        )
        assert s == 200
        assert len(events) >= 1
        # The event detail should include the op_kind that hit the auth
        # error — that's how the activity feed can render a useful row.
        assert events[0]["event"] == "cookie_expired"
        assert "op_kind" in events[0]["detail"]


class TestAuthExpiredDefault:
    def test_auth_expired_defaults_to_false(self, paired_with_pending_op):
        """A vanilla op_failed (without auth_expired) must NOT flip status
        to cookie_expired. Only an explicit auth_expired=true does."""
        integ_id, token = paired_with_pending_op
        s, ops = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": f"Bearer {token}"},
        )
        if s != 200 or len(ops) == 0:
            pytest.skip("no pending ops")
        op = ops[0]
        # 3 failures to exhaust retry budget — finalizes as op_failed,
        # not cookie_expired.
        for _ in range(3):
            _post(
                f"/v1/integrations/claude-ai/extension/operations/{op['id']}/complete",
                body={"success": False, "error": "claude.ai 500"},
                headers={"Authorization": f"Bearer {token}"},
            )
        s, rows = _get("/v1/integrations/claude-ai/integrations")
        row = next((r for r in rows if r["id"] == integ_id), None)
        assert row is not None
        assert row["status"] != "cookie_expired"


class TestActivityFilter:
    def test_cookie_expired_is_a_valid_event_filter(self, api_request):
        s, body = api_request(
            "GET", "/v1/integrations/claude-ai/activity?event=cookie_expired"
        )
        assert s == 200, body
        assert isinstance(body, list)
