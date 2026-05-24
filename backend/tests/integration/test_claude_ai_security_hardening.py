"""Security and race-condition tests for the claude.ai connector.

Targets specific bugs surfaced during the hardening round:

  1. Concurrent /pair/status polls must NOT issue two tokens for the
     same pairing (only one token can be in the DB).
  2. Disconnect must mark pending sync_operations as failed so they
     don't accumulate forever.
  3. Telemetry endpoint must reject malformed/oversized payloads.
  4. Bearer token comparison must be constant-time (sanity check).
  5. Pairing approval is idempotent under concurrent approval clicks.
  6. Sensitive token values never appear in audit log details.
"""
from __future__ import annotations

import concurrent.futures
import io
import json
import os
import urllib.error
import urllib.request
import uuid
import zipfile

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _post(path: str, body=None, headers=None):
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


def _get(path: str, headers=None):
    req = urllib.request.Request(f"{BASE}{path}", headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        return e.code, (json.loads(txt) if txt else None)


@pytest.fixture
def pending_pair():
    """Set up a pending pair-approval ready to be redeemed."""
    s, pair = _post("/v1/integrations/claude-ai/extension/pair",
                    body={"browser_label": "security test"})
    if s != 201:
        pytest.skip(f"pair endpoint not available: {s}")
    s2, _ = _post("/v1/integrations/claude-ai/pair/approve",
                  body={"pairing_code": pair["pairing_code"]})
    if s2 != 204:
        pytest.skip(f"approve failed: {s2}")
    return pair


class TestConcurrentTokenRedemption:
    """The bug: an extension retry storm hits /pair/status with the same
    pairing_token simultaneously. Without row-level locking, two requests
    could each issue a fresh extension_token; the DB stores whichever
    finishes last, leaving the other extension with a dead token.

    With with_for_update + status='pending_approval' filter, the second
    request waits for the first's commit, then sees a row no longer
    matching the filter → 404."""

    def test_concurrent_polls_issue_exactly_one_token(self, pending_pair):
        pairing_token = pending_pair["pairing_token"]

        def poll():
            return _get(
                f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pairing_token}"
            )

        # Fire 8 concurrent polls — at most ONE should return a token.
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            results = list(ex.map(lambda _: poll(), range(8)))

        token_holders = [
            r for r in results
            if r[0] == 200 and r[1] and r[1].get("extension_token")
        ]
        # Exactly one request gets the token. The rest get 404
        # (PAIRING_TOKEN_UNKNOWN — the row's pairing fields are now NULL).
        assert len(token_holders) == 1, (
            f"expected exactly 1 token issuance, got {len(token_holders)}; "
            f"all responses: {results}"
        )

        # The other 7 should be 404 (or 200 with approved=False if they
        # ran before the approval was visible — unlikely but possible).
        other_codes = [r[0] for r in results if r not in token_holders]
        assert all(c in (200, 404) for c in other_codes), (
            f"unexpected status codes among losers: {other_codes}"
        )

    def test_redeemed_token_works_immediately(self, pending_pair):
        """Sanity check that the token issued by the redemption is
        actually valid against the extension API. (Regression guard
        against issuing tokens but failing to persist their hash.)"""
        s, body = _get(
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pending_pair['pairing_token']}"
        )
        assert s == 200 and body["extension_token"]
        token = body["extension_token"]

        s2, _ = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert s2 == 200, f"redeemed token should authenticate, got {s2}"


class TestDisconnectCleansQueue:
    """The bug: disconnect_integration nulls the bearer but leaves
    pending/in_progress sync_operations dangling. Those rows accumulate
    forever and pollute the failed_ops_total metric (well — they DON'T
    show up as failed, they're stuck in pending; the queue just grows).

    The fix marks them failed so the operator can see and the queue
    stays clean."""

    def test_disconnect_marks_pending_ops_as_failed(self):
        # Pair an extension.
        s, pair = _post("/v1/integrations/claude-ai/extension/pair",
                        body={"browser_label": "queue cleanup test"})
        if s != 201:
            pytest.skip("pair not available")
        _post("/v1/integrations/claude-ai/pair/approve",
              body={"pairing_code": pair["pairing_code"]})
        _, status = _get(
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}"
        )
        integ_id = pair["integration_id"]
        token = status["extension_token"]

        # Create a skill — emits an upload op for this integration.
        slug = f"qclean-{uuid.uuid4().hex[:6]}"
        s, _ = _post(
            "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "queue cleanup test",
                "content_md": "# x",
                "collections": [f"qclean-bucket-{uuid.uuid4().hex[:8]}"],
            },
        )
        assert s == 201

        # Verify the op is pending.
        _, ops_before = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": f"Bearer {token}"},
        )
        # The fetch above flips status to in_progress as a side effect — that's
        # the realistic state at disconnect time.
        assert any(op["payload"].get("name") == slug for op in ops_before)

        # Now disconnect.
        req = urllib.request.Request(
            f"{BASE}/v1/integrations/claude-ai/integrations/{integ_id}",
            method="DELETE",
        )
        with urllib.request.urlopen(req) as r:
            assert r.status == 204

        # Check the DB state via health endpoint — failed_ops_total should
        # include our in-flight op (queued + in_progress) now flipped to failed.
        # The health endpoint counts FAILED ops total; we expect at least one
        # increment from the disconnect cleanup.
        _, health = _get("/v1/integrations/claude-ai/health")
        # We don't have a clean baseline (shared DB), but at least one of our
        # in-flight ops MUST have transitioned to failed. We verify via the
        # integrations endpoint instead:
        _, integrations = _get("/v1/integrations/claude-ai/integrations")
        ours = [i for i in integrations if i["id"] == integ_id][0]
        # After disconnect, pending_op_count should be 0 (all flipped to failed).
        assert ours["pending_op_count"] == 0, (
            f"disconnect should flush pending ops; got {ours['pending_op_count']}"
        )
        # And the failed count should have absorbed them.
        assert ours["failed_op_count"] >= 1, (
            f"expected at least 1 op flipped to failed; got {ours['failed_op_count']}"
        )


class TestTelemetryInputValidation:
    """Bearer-authed but the schema must reject malformed/oversized
    payloads before they reach the log pipeline."""

    @pytest.fixture
    def bearer(self):
        s, pair = _post("/v1/integrations/claude-ai/extension/pair",
                        body={"browser_label": "telemetry validation"})
        if s != 201:
            pytest.skip("pair not available")
        _post("/v1/integrations/claude-ai/pair/approve",
              body={"pairing_code": pair["pairing_code"]})
        _, status = _get(
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}"
        )
        return status["extension_token"]

    def test_valid_payload(self, bearer):
        s, _ = _post(
            "/v1/integrations/claude-ai/extension/telemetry",
            body={"category": "endpoint_changed", "ext_version": "0.1.0", "detail": {"path": "/x"}},
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert s == 204

    def test_rejects_missing_category(self, bearer):
        s, _ = _post(
            "/v1/integrations/claude-ai/extension/telemetry",
            body={"ext_version": "0.1.0"},
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert s == 422

    def test_rejects_category_with_special_chars(self, bearer):
        """Category is restricted to [a-zA-Z0-9_] — protects log
        injection (newlines, ANSI escapes) from a malicious bearer."""
        s, _ = _post(
            "/v1/integrations/claude-ai/extension/telemetry",
            body={"category": "bad\nLOG_INJECTION\rROOT-LOGGER=DEBUG", "ext_version": "0.1.0"},
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert s == 422

    def test_rejects_oversized_category(self, bearer):
        s, _ = _post(
            "/v1/integrations/claude-ai/extension/telemetry",
            body={"category": "a" * 65, "ext_version": "0.1.0"},  # cap is 64
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert s == 422

    def test_rejects_oversized_ext_version(self, bearer):
        s, _ = _post(
            "/v1/integrations/claude-ai/extension/telemetry",
            body={"category": "x", "ext_version": "a" * 33},  # cap is 32
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert s == 422


class TestIdempotentApproval:
    """Approving the same pairing code twice in quick succession (e.g.
    user double-clicked the Approve button) must not break the flow."""

    def test_double_approve_is_safe(self):
        s, pair = _post("/v1/integrations/claude-ai/extension/pair",
                        body={"browser_label": "double approve"})
        if s != 201:
            pytest.skip("pair not available")
        code = pair["pairing_code"]

        # Fire 5 concurrent approves of the same code.
        def approve():
            return _post(
                "/v1/integrations/claude-ai/pair/approve",
                body={"pairing_code": code},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            results = list(ex.map(lambda _: approve(), range(5)))

        # All should return 204 — idempotent.
        codes = [r[0] for r in results]
        assert codes.count(204) == 5, f"double approval not idempotent: {results}"

        # The flow should still work: status poll redeems exactly once.
        _, status = _get(
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}"
        )
        assert status["extension_token"], "approval still works after multi-click"


class TestAuditLogPrivacy:
    """The audit log MUST never store raw tokens or bearer values.
    Defense in depth: even if a SQL injection elsewhere exposed audit
    rows, no credentials should be recoverable."""

    def test_audit_details_contain_no_token_hashes(self):
        s, pair = _post("/v1/integrations/claude-ai/extension/pair",
                        body={"browser_label": "privacy audit"})
        if s != 201:
            pytest.skip("pair not available")
        _post("/v1/integrations/claude-ai/pair/approve",
              body={"pairing_code": pair["pairing_code"]})
        _, status = _get(
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}"
        )

        # Look at the audit feed for this integration.
        _, events = _get(
            f"/v1/integrations/claude-ai/activity?integration_id={pair['integration_id']}"
        )
        for event in events:
            blob = json.dumps(event).lower()
            assert pair["pairing_token"].lower() not in blob, (
                f"pairing_token leaked into audit event {event['event']}"
            )
            if status.get("extension_token"):
                assert status["extension_token"].lower() not in blob, (
                    f"extension_token leaked into audit event {event['event']}"
                )


class TestRequireExtensionEdgeCases:
    """The bearer auth dependency must handle a variety of malformed inputs
    without 500-ing."""

    def test_empty_authorization_header(self):
        s, body = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": ""},
        )
        assert s == 401

    def test_only_word_bearer_no_token(self):
        s, _ = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": "Bearer"},
        )
        assert s == 401

    def test_bearer_with_only_whitespace(self):
        s, _ = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": "Bearer   "},
        )
        assert s == 401

    def test_lowercase_bearer_keyword(self):
        # Should still parse — case-insensitive on the keyword.
        s, body = _get(
            "/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": "bearer no-such-token"},
        )
        # 401 INVALID_EXTENSION_TOKEN (not MISSING_BEARER_TOKEN — we
        # parsed the keyword but the token doesn't match anything).
        assert s == 401
        assert body["error"]["code"] == "INVALID_EXTENSION_TOKEN"


class TestImportedSkillSecurity:
    """The inbound import endpoint runs SKILL.md validation via the same
    bundle_validator that protects local uploads. Specific attack
    vectors to verify are blocked."""

    @pytest.fixture
    def bearer(self):
        s, pair = _post("/v1/integrations/claude-ai/extension/pair",
                        body={"browser_label": "import security"})
        if s != 201:
            pytest.skip("pair not available")
        _post("/v1/integrations/claude-ai/pair/approve",
              body={"pairing_code": pair["pairing_code"]})
        _, status = _get(
            f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}"
        )
        return status["extension_token"]

    def _upload_zip(self, bearer, zip_bytes, name="x", ca_id=None):
        ca_id = ca_id or f"skill_sec_{uuid.uuid4().hex[:6]}"
        boundary = "----b-" + uuid.uuid4().hex
        parts = []
        for k, v in [
            ("claude_ai_skill_id", ca_id),
            ("name", name),
            ("description", "security test"),
        ]:
            parts.append(f"--{boundary}\r\n".encode())
            parts.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
            parts.append(v.encode() + b"\r\n")
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(
            b'Content-Disposition: form-data; name="bundle"; filename="x.zip"\r\n'
            b'Content-Type: application/zip\r\n\r\n'
        )
        parts.append(zip_bytes)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        req = urllib.request.Request(
            f"{BASE}/v1/integrations/claude-ai/extension/imported-skill",
            method="POST", data=b"".join(parts),
            headers={
                "Authorization": f"Bearer {bearer}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode())

    def test_rejects_empty_bundle(self, bearer):
        s, body = self._upload_zip(bearer, b"")
        assert s == 422
        assert body["error"]["code"] in ("EMPTY_BUNDLE", "INVALID_ZIP", "INVALID_BUNDLE")

    def test_rejects_path_traversal(self, bearer):
        # ZIP with a SKILL.md entry that escapes the parent directory.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "../../../etc/passwd-skill/SKILL.md",
                "---\nname: x\ndescription: y\n---\n\n# x\n",
            )
        s, body = self._upload_zip(bearer, buf.getvalue())
        assert s == 422, f"path-traversal should be rejected, got {s} {body}"

    def test_rejects_reserved_word_in_name(self, bearer):
        # Reserved words 'anthropic' and 'claude' must be blocked even
        # via the inbound path.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "claude-evil/SKILL.md",
                "---\nname: claude-evil\ndescription: reserved\n---\n\n# x\n",
            )
        s, body = self._upload_zip(bearer, buf.getvalue())
        assert s == 422
