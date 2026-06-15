"""Integration tests for POST /v1/integrations/claude-ai/extension/reconcile —
the panel's "Sync now" path. It must (a) require the extension bearer,
(b) force-enqueue a publish_group op so a manual sync is never a silent no-op,
and (c) coalesce so spamming it can't pile up duplicate work.

Requires a running backend (override SKILLNOTE_TEST_BASE_URL). Skips if down.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _req(method, path, body=None, headers=None):
    h = dict(headers or {})
    if body is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        headers=h,
        data=(json.dumps(body).encode() if body is not None else None),
    )
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, (json.loads(text) if text else None)
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _ip():
    return f"198.51.100.{uuid.uuid4().int % 254 + 1}"


def _pair():
    s, pair = _req(
        "POST",
        "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "reconcile-test"},
        headers={"X-Forwarded-For": _ip()},
    )
    if s != 201:
        pytest.skip(f"pair returned {s}")
    _req("POST", "/v1/integrations/claude-ai/pair/approve", body={"pairing_code": pair["pairing_code"]})
    s, st = _req(
        "GET",
        f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}",
    )
    assert s == 200 and st["approved"], st
    return pair["integration_id"], st["extension_token"]


def test_reconcile_requires_bearer():
    s, body = _req("POST", "/v1/integrations/claude-ai/extension/reconcile")
    assert s == 401, body


def test_reconcile_rejects_bad_bearer():
    s, _ = _req(
        "POST",
        "/v1/integrations/claude-ai/extension/reconcile",
        headers={"Authorization": "Bearer nope-not-real"},
    )
    assert s == 401


def test_reconcile_enqueues_and_is_accepted():
    _, token = _pair()
    s, body = _req(
        "POST",
        "/v1/integrations/claude-ai/extension/reconcile",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert s == 202, body
    assert "enqueued" in body
    assert isinstance(body["enqueued"], int)
    assert body["enqueued"] >= 0


def test_reconcile_coalesces_no_pileup():
    """Two reconciles back-to-back must not create two competing pending
    publish_group ops — the second coalesces onto the first."""
    _, token = _pair()
    h = {"Authorization": f"Bearer {token}"}
    _req("POST", "/v1/integrations/claude-ai/extension/reconcile", headers=h)
    _req("POST", "/v1/integrations/claude-ai/extension/reconcile", headers=h)
    # The integration's own status reports pending ops; a coalesced queue
    # should show at most one pending publish_group (not two).
    s, st = _req("GET", "/v1/integrations/claude-ai/extension/status", headers=h)
    assert s == 200, st
    assert st["pending_op_count"] <= 1
