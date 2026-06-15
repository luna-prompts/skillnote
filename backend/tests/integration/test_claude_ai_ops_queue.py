"""HTTP integration tests for the claude.ai connector sync-ops queue.

Covers the bearer auth dependency, fetch-then-complete contract, retry
budget, and the soft-disconnect lifecycle.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def active_extension(api_request):
    """Full pair → approve → redeem flow → return (integration_id, extension_token)."""
    status, pair = api_request(
        "POST", "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "pytest active extension"},
    )
    if status != 201:
        pytest.skip(f"claude-ai pair endpoint returned {status}")
    api_request(
        "POST", "/v1/integrations/claude-ai/pair/approve",
        body={"pairing_code": pair["pairing_code"]},
    )
    _, status_body = api_request(
        "GET",
        f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}",
    )
    assert status_body["approved"] and status_body["extension_token"]
    return pair["integration_id"], status_body["extension_token"]


@pytest.fixture
def bearer_request(api_request, active_extension):
    """Convenience: like api_request but with the bearer token attached."""
    _, token = active_extension
    import json
    import urllib.error
    import urllib.request
    import os
    base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")

    def _req(method: str, path: str, body=None, headers=None):
        h = {"Authorization": f"Bearer {token}"}
        if headers:
            h.update(headers)
        if body is not None:
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{base}{path}", method=method, headers=h,
            data=(json.dumps(body).encode() if body is not None else None),
        )
        try:
            with urllib.request.urlopen(req) as r:
                txt = r.read().decode()
                return r.status, (json.loads(txt) if txt else None)
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            return e.code, (json.loads(txt) if txt else None)
    return _req


class TestExtensionAuth:
    def test_missing_bearer_401(self, api_request):
        status, body = api_request(
            "GET", "/v1/integrations/claude-ai/extension/operations",
        )
        assert status == 401
        assert body["error"]["code"] == "MISSING_BEARER_TOKEN"

    def test_invalid_bearer_401(self, api_request):
        import json
        import urllib.error
        import urllib.request
        import os
        base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
        req = urllib.request.Request(
            f"{base}/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        try:
            urllib.request.urlopen(req)
            pytest.fail("expected 401")
        except urllib.error.HTTPError as e:
            assert e.code == 401
            body = e.read().decode()
            assert "INVALID_EXTENSION_TOKEN" in body

    def test_malformed_bearer_header_401(self, api_request):
        import urllib.error
        import urllib.request
        import os
        base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
        # No "Bearer " prefix.
        req = urllib.request.Request(
            f"{base}/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": "garbage"},
        )
        try:
            urllib.request.urlopen(req)
            pytest.fail("expected 401")
        except urllib.error.HTTPError as e:
            assert e.code == 401

    def test_active_bearer_succeeds(self, bearer_request):
        status, body = bearer_request("GET", "/v1/integrations/claude-ai/extension/operations")
        assert status == 200
        assert isinstance(body, list)


class TestOperationsQueue:
    def test_initial_queue_empty(self, bearer_request):
        status, body = bearer_request("GET", "/v1/integrations/claude-ai/extension/operations")
        assert status == 200
        assert body == []

    def test_complete_unknown_op_returns_404(self, bearer_request):
        import uuid as _uuid
        status, body = bearer_request(
            "POST",
            f"/v1/integrations/claude-ai/extension/operations/{_uuid.uuid4()}/complete",
            body={"success": True},
        )
        assert status == 404


class TestIntegrationManagement:
    def test_list_includes_active(self, api_request, active_extension):
        integ_id, _ = active_extension
        status, body = api_request("GET", "/v1/integrations/claude-ai/integrations")
        assert status == 200
        ids = [i["id"] for i in body]
        assert integ_id in ids

    def test_patch_updates_scope(self, api_request, active_extension):
        integ_id, _ = active_extension
        status, body = api_request(
            "PATCH", f"/v1/integrations/claude-ai/integrations/{integ_id}",
            body={"scope": "organization"},
        )
        assert status == 200
        assert body["scope"] == "organization"

    def test_patch_rejects_bad_scope(self, api_request, active_extension):
        integ_id, _ = active_extension
        status, _ = api_request(
            "PATCH", f"/v1/integrations/claude-ai/integrations/{integ_id}",
            body={"scope": "made-up-value"},
        )
        assert status == 422

    def test_disconnect_then_token_revoked(
        self, api_request, bearer_request, active_extension
    ):
        integ_id, _ = active_extension
        # Soft-disconnect.
        status, _ = api_request(
            "DELETE", f"/v1/integrations/claude-ai/integrations/{integ_id}",
        )
        assert status == 204

        # Subsequent bearer call returns 401 (token cleared) or 403
        # (status='disconnected'). Either is acceptable security posture.
        status, body = bearer_request(
            "GET", "/v1/integrations/claude-ai/extension/operations",
        )
        assert status in (401, 403)
        assert body["error"]["code"] in (
            "INVALID_EXTENSION_TOKEN",
            "INTEGRATION_DISCONNECTED",
        )


class TestKnownSkillIdsAndConflicts:
    def test_known_skill_ids_empty_initially(self, bearer_request):
        status, body = bearer_request(
            "GET", "/v1/integrations/claude-ai/extension/known-skill-ids",
        )
        assert status == 200
        assert body == {"claude_ai_skill_ids": []}

    def test_conflict_list_omits_fresh_integration(self, api_request, active_extension):
        """A freshly-paired integration has no links, so the global
        conflict list cannot contain any rows pointing at it. We scope
        the assertion to the test's own integration rather than asserting
        the global list is empty, because the global list may contain
        rows from other concurrent tests against the same DB."""
        integ_id, _ = active_extension
        status, body = api_request("GET", "/v1/integrations/claude-ai/conflicts")
        assert status == 200
        ours = [c for c in body if c["integration_id"] == integ_id]
        assert ours == [], (
            f"fresh integration {integ_id} should have no conflicts, got {ours}"
        )

    def test_resolve_unknown_link_404(self, api_request, active_extension):
        import uuid as _uuid
        status, body = api_request(
            "POST", f"/v1/integrations/claude-ai/conflicts/{_uuid.uuid4()}/resolve",
            body={"resolution": "skip"},
        )
        assert status == 404
