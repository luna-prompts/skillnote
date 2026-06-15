"""HTTP integration tests for the polish-layer endpoints (0020):
   - GET /activity
   - GET /health
   - PATCH /skills/{id}/sync
   - Rate limit on POST /pair
"""
from __future__ import annotations

import os
import uuid

import pytest


def _bearer(token: str):
    import json
    import urllib.error
    import urllib.request
    base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")

    def _req(method, path, body=None):
        h = {"Authorization": f"Bearer {token}"}
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


@pytest.fixture
def paired_extension(api_request):
    status, pair = api_request(
        "POST", "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "polish test"},
    )
    if status != 201:
        pytest.skip(f"pair endpoint returned {status}")
    api_request(
        "POST", "/v1/integrations/claude-ai/pair/approve",
        body={"pairing_code": pair["pairing_code"]},
    )
    _, body = api_request(
        "GET",
        f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}",
    )
    return pair["integration_id"], body["extension_token"]


class TestActivityEndpoint:
    def test_pair_flow_writes_audit_events(self, api_request, paired_extension):
        integ_id, _ = paired_extension
        # The pair → approve → redeem flow should emit 3 events for this integration.
        status, body = api_request(
            "GET",
            f"/v1/integrations/claude-ai/activity?integration_id={integ_id}",
        )
        assert status == 200
        events = [r["event"] for r in body]
        assert "pair_started" in events
        assert "pair_approved" in events
        assert "pair_redeemed" in events

    def test_disconnect_writes_audit(self, api_request, paired_extension):
        integ_id, _ = paired_extension
        api_request("DELETE", f"/v1/integrations/claude-ai/integrations/{integ_id}")
        _, body = api_request(
            "GET",
            f"/v1/integrations/claude-ai/activity?integration_id={integ_id}&event=integration_disconnected",
        )
        assert any(r["event"] == "integration_disconnected" for r in body)

    def test_event_filter_narrows_results(self, api_request, paired_extension):
        integ_id, _ = paired_extension
        _, body = api_request(
            "GET",
            f"/v1/integrations/claude-ai/activity?integration_id={integ_id}&event=pair_redeemed",
        )
        assert all(r["event"] == "pair_redeemed" for r in body)

    def test_limit_out_of_range_returns_422(self, api_request):
        # Round-9 hardening: limit is bounded [1, 500] at the API layer
        # (previously the service silently clamped). A misbehaving client
        # gets an explicit 422 instead of an apparent-success-with-cap.
        status, _ = api_request("GET", "/v1/integrations/claude-ai/activity?limit=999999")
        assert status == 422

    def test_limit_at_max_succeeds(self, api_request):
        status, body = api_request("GET", "/v1/integrations/claude-ai/activity?limit=500")
        assert status == 200
        assert isinstance(body, list)
        assert len(body) <= 500

    def test_unknown_integration_returns_empty(self, api_request):
        status, body = api_request(
            "GET",
            f"/v1/integrations/claude-ai/activity?integration_id={uuid.uuid4()}",
        )
        assert status == 200
        assert body == []


class TestHealthEndpoint:
    def test_returns_metrics_shape(self, api_request, paired_extension):
        status, body = api_request("GET", "/v1/integrations/claude-ai/health")
        assert status == 200
        for field in (
            "integrations_active",
            "integrations_with_errors",
            "pending_ops_total",
            "failed_ops_total",
            "diverged_links_total",
            "schema_version",
        ):
            assert field in body, f"missing field {field}"
        assert isinstance(body["integrations_active"], int)
        assert isinstance(body["schema_version"], str)

    def test_active_count_reflects_recent_pair(self, api_request, paired_extension):
        _, body = api_request("GET", "/v1/integrations/claude-ai/health")
        # At least our just-paired integration should be in the active count.
        assert body["integrations_active"] >= 1


class TestSkillSyncToggleEndpoint:
    @pytest.fixture
    def skill_id(self, api_request):
        slug = f"toggle-api-{uuid.uuid4().hex[:6]}"
        status, body = api_request(
            "POST", "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "toggle endpoint test",
                "content_md": "# x",
                "collections": [f"tg-bucket-{uuid.uuid4().hex[:8]}"],
            },
        )
        assert status == 201
        return body["id"]

    def test_toggle_off_then_on(self, api_request, skill_id):
        # Off
        status, _ = api_request(
            "PATCH",
            f"/v1/integrations/claude-ai/skills/{skill_id}/sync",
            body={"enabled": False},
        )
        assert status == 204
        # On
        status, _ = api_request(
            "PATCH",
            f"/v1/integrations/claude-ai/skills/{skill_id}/sync",
            body={"enabled": True},
        )
        assert status == 204

    def test_unknown_skill_404(self, api_request):
        status, body = api_request(
            "PATCH",
            f"/v1/integrations/claude-ai/skills/{uuid.uuid4()}/sync",
            body={"enabled": True},
        )
        assert status == 404
        assert body["error"]["code"] == "SKILL_NOT_FOUND"

    def test_invalid_payload_422(self, api_request, skill_id):
        # Missing 'enabled' field — Pydantic rejects.
        status, _ = api_request(
            "PATCH",
            f"/v1/integrations/claude-ai/skills/{skill_id}/sync",
            body={},
        )
        assert status == 422


class TestSkillDetailExposesSyncFlag:
    """SkillDetail response must include claude_ai_sync_enabled so the
    skill detail page can render the badge in the right state."""

    def test_field_present_in_detail(self, api_request):
        slug = f"detail-flag-{uuid.uuid4().hex[:6]}"
        status, body = api_request(
            "POST", "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "detail flag test",
                "content_md": "# x",
                "collections": [f"detail-bucket-{uuid.uuid4().hex[:8]}"],
            },
        )
        assert status == 201
        assert "claude_ai_sync_enabled" in body
        assert body["claude_ai_sync_enabled"] is True

    def test_toggling_persists_in_detail(self, api_request):
        slug = f"detail-persist-{uuid.uuid4().hex[:6]}"
        _, created = api_request(
            "POST", "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "persistence test",
                "content_md": "# x",
                "collections": [f"persist-bucket-{uuid.uuid4().hex[:8]}"],
            },
        )
        skill_id = created["id"]
        # Disable.
        api_request(
            "PATCH",
            f"/v1/integrations/claude-ai/skills/{skill_id}/sync",
            body={"enabled": False},
        )
        # Re-fetch detail.
        _, detail = api_request("GET", f"/v1/skills/{slug}")
        assert detail["claude_ai_sync_enabled"] is False


class TestDisabledSkillDoesNotEnqueue:
    """When claude_ai_sync_enabled=False, _create_content_version should
    NOT enqueue an upload op. Verified by checking the queue is empty for
    a paired extension after creating a disabled skill."""

    def test_disabled_skill_skips_enqueue(self, api_request, paired_extension):
        integ_id, token = paired_extension
        # Create a skill, immediately disable sync, then update it.
        slug = f"disabled-{uuid.uuid4().hex[:6]}"
        _, created = api_request(
            "POST", "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "disabled sync test",
                "content_md": "# v1",
                "collections": [f"disabled-bucket-{uuid.uuid4().hex[:8]}"],
            },
        )
        skill_id = created["id"]

        # Drain whatever ops were enqueued for the initial create.
        bearer = _bearer(token)
        bearer("GET", "/v1/integrations/claude-ai/extension/operations")

        # Disable sync.
        api_request(
            "PATCH",
            f"/v1/integrations/claude-ai/skills/{skill_id}/sync",
            body={"enabled": False},
        )
        # Update the skill — should NOT enqueue an op.
        api_request(
            "PATCH", f"/v1/skills/{slug}",
            body={"content_md": "# v2 updated"},
        )

        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op.get("payload", {}).get("name") == slug]
        assert ours == [], f"disabled skill should not enqueue ops; got {ours}"


class TestRateLimit:
    """The /pair endpoint rate-limits per source IP. Hard to fully prove
    without flooding 60+ requests; we verify the 429 response shape via a
    manual high-volume run, gated behind a marker."""

    def _unique_ip(self) -> str:
        # TEST-NET-1 (192.0.2.0/24, RFC 5737) is reserved for tests and
        # never collides with real traffic. Random within-class keeps each
        # run isolated from any prior state in the shared DB.
        import random
        return f"192.0.2.{random.randint(1, 254)}"

    def test_pair_endpoint_returns_201_under_threshold(self, api_request):
        ip = self._unique_ip()
        for _ in range(5):
            status, _ = api_request(
                "POST", "/v1/integrations/claude-ai/extension/pair",
                body={"browser_label": "rate test"},
                headers={"X-Forwarded-For": ip},
            )
            assert status == 201

    @pytest.mark.slow
    def test_pair_endpoint_returns_429_above_threshold(self, api_request):
        """Skipped unless run with --runslow because it floods the endpoint."""
        ip = self._unique_ip()
        rejected = 0
        for _ in range(65):
            status, body = api_request(
                "POST", "/v1/integrations/claude-ai/extension/pair",
                body={"browser_label": "flood test"},
                headers={"X-Forwarded-For": ip},
            )
            if status == 429:
                rejected += 1
                assert body["error"]["code"] == "RATE_LIMITED"
                break
        assert rejected > 0, "expected at least one 429 in 65 attempts"
