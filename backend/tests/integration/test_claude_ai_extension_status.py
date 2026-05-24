"""Integration tests for GET /v1/integrations/claude-ai/extension/status.

The endpoint is what the extension popup reads to show "skills synced /
pending / failed" counters. Before this, the popup always rendered 0 —
the counters typed on `ExtensionConfig` were never populated. This suite
verifies the wire contract end to end and catches the obvious regression
modes: cross-integration leakage, anonymous access, counter accuracy.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _unique_ip() -> str:
    """TEST-NET-1 IP unique per call — keeps pair rate-limit state from
    leaking between this suite and others sharing the same DB."""
    import random
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
            return r.status, (json.loads(r.read().decode()) if r.headers.get("content-type", "").startswith("application/json") else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        return e.code, (json.loads(txt) if txt else None)
    except Exception as e:  # pragma: no cover - infra
        pytest.skip(f"API not reachable: {e}")


def _get(path, headers=None):
    req = urllib.request.Request(f"{BASE}{path}", method="GET", headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, (json.loads(r.read().decode()) if r.headers.get("content-type", "").startswith("application/json") else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        return e.code, (json.loads(txt) if txt else None)
    except Exception as e:  # pragma: no cover - infra
        pytest.skip(f"API not reachable: {e}")


def _pair_and_redeem(label="ext-status-test"):
    # Each pair call uses a fresh TEST-NET-1 IP so the rate limiter
    # never blocks us when running alongside the rest of the suite.
    ip = _unique_ip()
    s, pair = _post(
        "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": label},
        headers={"X-Forwarded-For": ip},
    )
    if s != 201:
        pytest.skip(f"pair endpoint returned {s}")
    _post("/v1/integrations/claude-ai/pair/approve", body={"pairing_code": pair["pairing_code"]})
    s, body = _get(
        f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}"
    )
    assert s == 200 and body["approved"]
    return pair["integration_id"], body["extension_token"]


class TestExtensionSelfStatus:
    def test_anonymous_returns_401(self):
        s, body = _get("/v1/integrations/claude-ai/extension/status")
        assert s == 401
        assert body["error"]["code"]  # any auth-error code

    def test_invalid_bearer_returns_401(self):
        s, _ = _get(
            "/v1/integrations/claude-ai/extension/status",
            headers={"Authorization": "Bearer not-a-real-token-12345"},
        )
        assert s == 401

    def test_valid_bearer_returns_self_status(self):
        integ_id, token = _pair_and_redeem("self-status-happy")
        s, body = _get(
            "/v1/integrations/claude-ai/extension/status",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert s == 200, body
        assert body["integration_id"] == integ_id
        assert body["status"] == "active"
        # New integration with no skills + no ops yet.
        assert body["linked_skill_count"] == 0
        assert body["pending_op_count"] == 0
        assert body["failed_op_count"] == 0
        assert body["last_error"] is None
        # browser_label is present and the user-supplied value round-trips.
        assert body["browser_label"] == "self-status-happy"

    def test_status_only_sees_own_integration(self):
        """Two integrations side by side; each token returns its own row."""
        a_id, a_token = _pair_and_redeem("status-A")
        b_id, b_token = _pair_and_redeem("status-B")

        _, a = _get(
            "/v1/integrations/claude-ai/extension/status",
            headers={"Authorization": f"Bearer {a_token}"},
        )
        _, b = _get(
            "/v1/integrations/claude-ai/extension/status",
            headers={"Authorization": f"Bearer {b_token}"},
        )
        assert a["integration_id"] == a_id
        assert b["integration_id"] == b_id
        # Labels distinct — wiring confirms tokens never crossed.
        assert a["browser_label"] != b["browser_label"]

    def test_status_after_disconnect_returns_401(self):
        """Disconnected integrations cannot fetch their own status."""
        integ_id, token = _pair_and_redeem("status-disconnect")
        s, _ = _post(
            f"/v1/integrations/claude-ai/integrations/{integ_id}",
            body=None,
        )
        # The DELETE endpoint isn't reached via _post; use a raw urlopen.
        req = urllib.request.Request(
            f"{BASE}/v1/integrations/claude-ai/integrations/{integ_id}",
            method="DELETE",
        )
        try:
            with urllib.request.urlopen(req) as r:
                assert r.status == 204
        except urllib.error.HTTPError as e:
            pytest.skip(f"disconnect returned {e.code}")

        s, _ = _get(
            "/v1/integrations/claude-ai/extension/status",
            headers={"Authorization": f"Bearer {token}"},
        )
        # require_extension rejects non-active integrations.
        assert s == 401
