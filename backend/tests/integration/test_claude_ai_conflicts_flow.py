"""Conflict resolution + bundle fetch + telemetry endpoint coverage.

These tests exercise the Phase 4 conflict flow end-to-end: create a
diverged link, list it, resolve via each of the three resolutions, and
verify the right follow-up op is enqueued (or none, for `skip`).
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
        body={"browser_label": "conflict test"},
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


@pytest.fixture
def linked_skill(api_request, paired_extension):
    """Create a skill, push it, complete the op to materialize a link.
    Returns (skill_id, claude_ai_skill_id, integration_id, token)."""
    integ_id, token = paired_extension
    slug = f"conflict-{uuid.uuid4().hex[:6]}"
    status, body = api_request(
        "POST", "/v1/skills",
        body={
            "name": slug, "slug": slug,
            "description": "conflict resolution test",
            "content_md": "# x",
            "collections": [f"ca-conflict-{slug[:18]}"],
        },
    )
    assert status == 201, f"skill create failed: {status} {body}"
    skill_id = body["id"]

    bearer = _bearer(token)
    _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
    ours = [op for op in ops if op["payload"].get("name") == slug][0]
    claude_ai_skill_id = f"skill_conflict_{uuid.uuid4().hex[:6]}"
    bearer(
        "POST",
        f"/v1/integrations/claude-ai/extension/operations/{ours['id']}/complete",
        body={
            "success": True,
            "result": {"claude_ai_skill_id": claude_ai_skill_id, "claude_ai_version": "v1"},
        },
    )
    return skill_id, claude_ai_skill_id, integ_id, token


class TestBundleFetch:
    """The extension fetches a ZIP for each upload op."""

    def test_bundle_endpoint_returns_zip(self, api_request, paired_extension):
        integ_id, token = paired_extension
        # Create a skill so we have a version to fetch.
        slug = f"bundle-{uuid.uuid4().hex[:6]}"
        status, body = api_request(
            "POST", "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "bundle test",
                "content_md": "# Content",
                "collections": [f"ca-conflict-{slug[:18]}"],
            },
        )
        assert status == 201
        skill_id = body["id"]

        bearer = _bearer(token)
        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["payload"].get("name") == slug][0]
        version_id = ours["payload"]["version_id"]

        import io
        import urllib.request
        import zipfile
        base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
        req = urllib.request.Request(
            f"{base}/v1/integrations/claude-ai/extension/skill-bundle"
            f"?skill_id={skill_id}&version_id={version_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req) as r:
            assert r.headers["Content-Type"] == "application/zip"
            data = r.read()
        # Verify it's a valid ZIP with SKILL.md inside.
        zf = zipfile.ZipFile(io.BytesIO(data))
        names = zf.namelist()
        assert any(n.endswith("SKILL.md") for n in names), f"no SKILL.md in {names}"

    def test_bundle_requires_bearer(self, api_request):
        import urllib.error
        import urllib.request
        base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
        req = urllib.request.Request(
            f"{base}/v1/integrations/claude-ai/extension/skill-bundle"
            f"?skill_id={uuid.uuid4()}&version_id={uuid.uuid4()}",
        )
        try:
            urllib.request.urlopen(req)
            pytest.fail("expected 401")
        except urllib.error.HTTPError as e:
            assert e.code == 401

    def test_bundle_404_for_unknown_version(self, api_request, paired_extension):
        _, token = paired_extension
        import urllib.error
        import urllib.request
        base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
        req = urllib.request.Request(
            f"{base}/v1/integrations/claude-ai/extension/skill-bundle"
            f"?skill_id={uuid.uuid4()}&version_id={uuid.uuid4()}",
            headers={"Authorization": f"Bearer {token}"},
        )
        try:
            urllib.request.urlopen(req)
            pytest.fail("expected 404")
        except urllib.error.HTTPError as e:
            assert e.code == 404


class TestConflictListing:
    def test_diverged_link_appears_in_conflict_list(self, api_request, db_session, linked_skill):
        """Phase 4: when a link is marked diverged, it shows up in the
        conflicts endpoint with full metadata for the resolution UI."""
        skill_id, claude_ai_skill_id, integ_id, _ = linked_skill

        # Manually mark the link diverged (Phase 1 doesn't yet auto-detect).
        from app.db.models.claude_ai import ClaudeAISkillLink
        from sqlalchemy import select
        link = db_session.execute(
            select(ClaudeAISkillLink).where(
                ClaudeAISkillLink.claude_ai_skill_id == claude_ai_skill_id
            )
        ).scalar_one()
        link.conflict_state = "diverged"
        db_session.commit()

        status, body = api_request("GET", "/v1/integrations/claude-ai/conflicts")
        assert status == 200
        ours = [c for c in body if c["claude_ai_skill_id"] == claude_ai_skill_id]
        assert len(ours) == 1
        assert ours[0]["skillnote_skill_name"] is not None
        assert ours[0]["skillnote_skill_slug"] is not None


class TestConflictResolve:
    def _make_diverged(self, db_session, linked_skill):
        from app.db.models.claude_ai import ClaudeAISkillLink
        from sqlalchemy import select
        skill_id, claude_ai_skill_id, integ_id, token = linked_skill
        link = db_session.execute(
            select(ClaudeAISkillLink).where(
                ClaudeAISkillLink.claude_ai_skill_id == claude_ai_skill_id
            )
        ).scalar_one()
        link.conflict_state = "diverged"
        db_session.commit()
        return link.id, skill_id, claude_ai_skill_id, integ_id, token

    def test_skip_clears_conflict(self, api_request, db_session, linked_skill):
        link_id, _, claude_ai_skill_id, _, _ = self._make_diverged(db_session, linked_skill)
        status, _ = api_request(
            "POST", f"/v1/integrations/claude-ai/conflicts/{link_id}/resolve",
            body={"resolution": "skip"},
        )
        assert status == 204

        # Link should no longer appear in conflicts list.
        _, body = api_request("GET", "/v1/integrations/claude-ai/conflicts")
        assert not any(c["link_id"] == str(link_id) for c in body)

    def test_keep_skillnote_enqueues_upload(self, api_request, db_session, linked_skill):
        link_id, skill_id, _, integ_id, token = self._make_diverged(db_session, linked_skill)
        # Drain any existing pending ops first so we can detect the new one.
        bearer = _bearer(token)
        bearer("GET", "/v1/integrations/claude-ai/extension/operations")

        status, _ = api_request(
            "POST", f"/v1/integrations/claude-ai/conflicts/{link_id}/resolve",
            body={"resolution": "keep_skillnote"},
        )
        assert status == 204
        # A new upload op should now be in the queue.
        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["skill_id"] == skill_id and op["kind"] == "upload"]
        assert len(ours) == 1

    def test_keep_claude_ai_enqueues_fetch_one(self, api_request, db_session, linked_skill):
        link_id, skill_id, claude_ai_skill_id, integ_id, token = self._make_diverged(
            db_session, linked_skill
        )
        bearer = _bearer(token)
        bearer("GET", "/v1/integrations/claude-ai/extension/operations")  # drain
        status, _ = api_request(
            "POST", f"/v1/integrations/claude-ai/conflicts/{link_id}/resolve",
            body={"resolution": "keep_claude_ai"},
        )
        assert status == 204
        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["kind"] == "fetch_one"]
        assert len(ours) == 1
        assert ours[0]["payload"]["claude_ai_skill_id"] == claude_ai_skill_id

    def test_resolve_already_resolved_returns_409(self, api_request, db_session, linked_skill):
        link_id, _, _, _, _ = self._make_diverged(db_session, linked_skill)
        api_request(
            "POST", f"/v1/integrations/claude-ai/conflicts/{link_id}/resolve",
            body={"resolution": "skip"},
        )
        status, body = api_request(
            "POST", f"/v1/integrations/claude-ai/conflicts/{link_id}/resolve",
            body={"resolution": "skip"},
        )
        assert status == 409
        assert body["error"]["code"] == "LINK_NOT_IN_CONFLICT"

    def test_invalid_resolution_422(self, api_request, db_session, linked_skill):
        link_id, _, _, _, _ = self._make_diverged(db_session, linked_skill)
        status, _ = api_request(
            "POST", f"/v1/integrations/claude-ai/conflicts/{link_id}/resolve",
            body={"resolution": "merge"},
        )
        assert status == 422


class TestTelemetryEndpoint:
    def test_telemetry_accepts_bearer(self, paired_extension):
        _, token = paired_extension
        bearer = _bearer(token)
        status, _ = bearer(
            "POST", "/v1/integrations/claude-ai/extension/telemetry",
            body={
                "category": "test_event",
                "ext_version": "0.1.0-test",
                "ts": "2026-05-24T12:00:00Z",
                "detail": {"path": "/api/x"},
            },
        )
        assert status == 204

    def test_telemetry_rejects_unauthed(self, api_request):
        status, _ = api_request(
            "POST", "/v1/integrations/claude-ai/extension/telemetry",
            body={"category": "x"},
        )
        assert status == 401
