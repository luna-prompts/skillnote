"""End-to-end HTTP tests for the claude.ai connector pairing flow.

Uses the shared `api_request` fixture (HTTP against a running backend).
These tests skip cleanly when the API isn't reachable.
"""
from __future__ import annotations

import time

import pytest


@pytest.fixture
def fresh_pairing(api_request):
    """Start a pairing, return (status, body) so each test starts clean.

    Failing-fast: skips the whole module if the API doesn't accept the
    pair POST (e.g. older deployment without the connector wired in).
    """
    status, body = api_request(
        "POST", "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "pytest pair-fixture"},
    )
    if status != 201:
        pytest.skip(f"claude-ai pair endpoint returned {status}; deployment may not have phase 1")
    return body


class TestPairingHandshake:
    def test_pair_returns_all_required_fields(self, fresh_pairing):
        b = fresh_pairing
        assert "integration_id" in b
        assert "pairing_code" in b
        assert "pairing_token" in b
        assert "redemption_url" in b
        assert "expires_at" in b

    def test_pairing_code_is_six_chars(self, fresh_pairing):
        assert len(fresh_pairing["pairing_code"]) == 6

    def test_pairing_token_is_substantial(self, fresh_pairing):
        # Long opaque random — at minimum 32 chars.
        assert len(fresh_pairing["pairing_token"]) >= 32

    def test_pairing_token_different_from_code(self, fresh_pairing):
        assert fresh_pairing["pairing_token"] != fresh_pairing["pairing_code"]

    def test_status_returns_unapproved_initially(self, api_request, fresh_pairing):
        status, body = api_request(
            "GET",
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={fresh_pairing['pairing_token']}",
        )
        assert status == 200
        assert body == {"approved": False, "extension_token": None}

    def test_approve_returns_204(self, api_request, fresh_pairing):
        status, _ = api_request(
            "POST",
            "/v1/integrations/claude-ai/pair/approve",
            body={"pairing_code": fresh_pairing["pairing_code"]},
        )
        assert status == 204

    def test_approve_idempotent(self, api_request, fresh_pairing):
        # Approving twice is harmless.
        api_request("POST", "/v1/integrations/claude-ai/pair/approve",
                    body={"pairing_code": fresh_pairing["pairing_code"]})
        status, _ = api_request("POST", "/v1/integrations/claude-ai/pair/approve",
                                 body={"pairing_code": fresh_pairing["pairing_code"]})
        assert status == 204

    def test_approve_unknown_code_404(self, api_request):
        status, body = api_request(
            "POST", "/v1/integrations/claude-ai/pair/approve",
            body={"pairing_code": "NOPENO"},
        )
        assert status == 404
        assert body["error"]["code"] == "PAIRING_NOT_FOUND"

    def test_approve_short_code_422(self, api_request):
        # Below min length — Pydantic rejects before reaching the handler.
        status, body = api_request(
            "POST", "/v1/integrations/claude-ai/pair/approve",
            body={"pairing_code": "AB"},
        )
        assert status == 422

    def test_token_issuance_after_approval(self, api_request, fresh_pairing):
        """The full Device Code Flow: approve, then status poll returns
        the extension token exactly once."""
        api_request(
            "POST", "/v1/integrations/claude-ai/pair/approve",
            body={"pairing_code": fresh_pairing["pairing_code"]},
        )
        status, body = api_request(
            "GET",
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={fresh_pairing['pairing_token']}",
        )
        assert status == 200
        assert body["approved"] is True
        assert body["extension_token"] is not None
        # Tokens are urlsafe-base64 random — should be substantial length.
        assert len(body["extension_token"]) >= 40

    def test_token_is_one_shot(self, api_request, fresh_pairing):
        """Second status-poll after redemption must NOT return the token
        again. The pairing_token_hash is cleared atomically with issuance,
        so the row becomes un-findable via the pending-pairing path."""
        api_request(
            "POST", "/v1/integrations/claude-ai/pair/approve",
            body={"pairing_code": fresh_pairing["pairing_code"]},
        )
        # First poll redeems.
        status1, body1 = api_request(
            "GET",
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={fresh_pairing['pairing_token']}",
        )
        assert status1 == 200 and body1["extension_token"]

        # Second poll with the same pairing_token must NOT return another token.
        status2, body2 = api_request(
            "GET",
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={fresh_pairing['pairing_token']}",
        )
        assert status2 == 404
        assert body2["error"]["code"] == "PAIRING_TOKEN_UNKNOWN"

    def test_status_unknown_token_404(self, api_request):
        status, body = api_request(
            "GET",
            "/v1/integrations/claude-ai/extension/pair/status?pairing_token=does-not-exist",
        )
        assert status == 404


class TestPairCodeCollision:
    def test_many_concurrent_pairs_unique(self, api_request):
        """Six char / 31 glyph code space has ~887M codes. Ten codes in a
        row should be unique with overwhelming probability."""
        codes = []
        for _ in range(10):
            status, body = api_request(
                "POST", "/v1/integrations/claude-ai/extension/pair",
                body={"browser_label": "pytest collision check"},
            )
            if status != 201:
                pytest.skip(f"pair endpoint returned {status}")
            codes.append(body["pairing_code"])
        assert len(set(codes)) == len(codes), f"code collision among {codes}"


class TestPairingAuthLeak:
    def test_pair_response_does_not_leak_token_hash(self, api_request, fresh_pairing):
        """Response must not contain the *hash* fields — those stay in the DB."""
        for field in ("pairing_token_hash", "extension_token_hash"):
            assert field not in fresh_pairing
